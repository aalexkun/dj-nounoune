import { FunctionCall, GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Logger } from '@nestjs/common';

import { ThrottleHandler } from './handler/throttle.handler';
import { ToolsService } from './tools.service';
import { PromptusRequest } from './promptus.request';

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

  async generate<ReqType>(request: PromptusRequest<ReqType>): Promise<ReqType> {
    this.logger.log(`Starting: Request ${request.constructor.name}`);

    let loop = 0;
    while (loop < this.maxThinkingLoop) {
      const aiRequest = await request.getGeneratedContent();
      await this.printTokenUsage(request.model, aiRequest.contents);
      const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);

      if (Array.isArray(response.candidates)) {
        response.candidates.forEach((candidate) => (candidate.content ? request.pushAiResponse(candidate.content) : null));
      }

      const functionCall = response.functionCalls;

      if (functionCall) {
        for (const fc of functionCall) {
          let result = await this.proceedFunctionCall(fc);
          if (result) {
            request.pushFunctionResponse(result, fc);
          }
        }
        loop++;
      } else {
        this.logger.log(`End: Request ${request.constructor.name}`);
        return this.wrapResponse(request, response);
      }
    }
    this.logger.error(JSON.stringify(request));
    throw new Error('generate maxThinkingLoop');
  }

  protected async printTokenUsage(model, contents) {
    const tokenCount = await this.client.models.countTokens({
      model: model,
      contents: contents,
    });
    this.logger.debug(`Token Count: ${tokenCount.totalTokens} (Model: ${model})`);
  }

  protected async proceedFunctionCall(fc: FunctionCall): Promise<string> {
    try {
      const result = await this.toolService.proceedFunctionCall(fc);
      return result.message;
    } catch (e) {
      this.logger.error(e);
      return 'An error occurred while processing the function call.' + e.message;
    }
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
