import { Content, ContentListUnion, FinishReason, FunctionCall, GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Logger } from '@nestjs/common';

import { ThrottleHandler } from './handler/throttle.handler';
import { ToolsService } from './tools.service';
import { PromptusRequest } from './promptus.request';
import { PromptusResponse } from './promptus.response';
import { FunctionCallResult } from './tools/tool.type';
import { Subject } from 'rxjs';
import * as chatGatewayTypes from '../../gateway/chat.gateway.types';
import { MessageUpdateCallback } from './promptus.type';

export abstract class Agent {
  public readonly name: string;
  protected readonly logger: Logger;
  private maxThinkingLoop = 10;
  protected client: GoogleGenAI;
  protected toolService: ToolsService;
  private throttleHandler: ThrottleHandler;

  protected abstract wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType;

  initialiseAgent(apiKey: string, toolService: ToolsService) {
    this.client = new GoogleGenAI({ apiKey });
    this.toolService = toolService;
    this.throttleHandler = new ThrottleHandler(this.client);
  }

  async generate<ReqType>(request: PromptusRequest<ReqType>, statusUpdate?: MessageUpdateCallback): Promise<ReqType> {
    this.logger.log(`Starting: Request ${request.constructor.name}`);

    let loop = 0;
    while (loop < this.maxThinkingLoop) {
      const aiRequest = await request.getGeneratedContent();
      await this.printTokenUsage(request.model, aiRequest.contents);
      const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);

      if (Array.isArray(response.candidates)) {
        this.logger.debug(response?.candidates[0].content);
        response.candidates.forEach((candidate) => (candidate.content ? request.addHistory(candidate.content) : null));
      }

      if (response.functionCalls) {
        const responseContent: any = {
          role: 'tool',
          parts: [],
        };

        for (const fc of response.functionCalls) {
          if (typeof statusUpdate === 'function') {
            statusUpdate(`Calling ${fc.name}`);
          }

          let result = await this.proceedFunctionCall(fc);
          if (result) {
            const fnResult = {
              functionResponse: {
                id: fc.id,
                name: fc.name,
                response: {
                  output: result.type === 'string' ? result.message : result,
                },
              },
            };
            responseContent.parts?.push(fnResult);

            // Move that somewhere elese
            // if (typeof statusUpdate === 'function' && fc.name === 'disc_jockey_what_is_playing' && result.type === 'string') {
            //   statusUpdate(result.message);
            // }
          } else {
            this.logger.error(`${fc} did not return any result`);
          }
        }
        request.pushFunctionResponse(responseContent);
        loop++;
      } else {
        return this.wrapResponse(request, response);
      }
    }

    this.logger.error(JSON.stringify(request));
    throw new Error('generate maxThinkingLoop');
  }

  protected async printTokenUsage(model: string, contents: ContentListUnion) {
    const tokenCount = await this.client.models.countTokens({
      model: model,
      contents: contents,
    });
    this.logger.debug(`Token Count: ${tokenCount.totalTokens} (Model: ${model})`);
  }

  protected async proceedFunctionCall(fc: FunctionCall): Promise<FunctionCallResult> {
    return await this.toolService.proceedFunctionCall(fc);
  }

  async parallelGenerate<ReqType>(requests: PromptusRequest<ReqType>[], concurrencyLimit: number = 1): Promise<ReqType[]> {
    this.logger.log(`Starting parallel generation for ${requests.length} requests (Concurrency Limit: ${concurrencyLimit})...`);

    const results: ReqType[] = new Array(requests.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < requests.length) {
        try {
          const index = currentIndex++;
          const request = requests[index];
          await this.throttleHandler.acquireTokens(request);
          results[index] = await this.generate(request);
          this.logger.log(`Completed request ${index + 1}/${requests.length}`);
        } catch (e) {
          this.logger.error(e);
        }
      }
    };

    const workers: Promise<void>[] = [];
    const actualConcurrency = Math.min(concurrencyLimit, requests.length);

    for (let i = 0; i < actualConcurrency; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    this.logger.log('Parallel generation completed.');
    return results;
  }
}
