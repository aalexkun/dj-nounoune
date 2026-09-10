import { CachedContent, Content, ContentListUnion, FunctionCall, GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Logger } from '@nestjs/common';

import { ThrottleHandler } from './handler/throttle.handler';
import { ToolsService } from './tools.service';
import { PromptusRequest } from './promptus.request';
import { FunctionCallResult } from './tools/tool.type';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheHandler } from './handler/cache.handler';
import { ChatContext, newId } from '../chat/chat-context';
import { ChatStreamService } from '../chat/chat-stream.service';

type ReadonlyExcept<T, K extends keyof T> = Readonly<Omit<T, K>> & Pick<T, K>;
type cacheName = string;
type AgentCache = {
  name: cacheName;
  file: `files/${cacheName}`;
  fileMineType?: string;
  model: string;
  /**
   * Baked into the CachedContent as its system instruction and applied to every request that
   * references the cache. Named to keep it apart from the request's own `context`, which a cached
   * request never sends. Empty when the instruction is the cached file itself.
   */
  cacheInstruction: string;
  cacheContent: CachedContent | undefined;
};

export type ReadonlyAgentCache = ReadonlyExcept<AgentCache, 'cacheContent'>;

export abstract class Agent {
  public readonly name: string;
  protected readonly logger: Logger;

  /**
   * Raised from 25. A thread can now hold up to this many tool calls, which is a UI concern as
   * much as a model one — the client collapses and caps the visible children rather than relying
   * on indentation.
   */
  private maxThinkingLoop = 50;
  protected client: GoogleGenAI;
  protected toolService: ToolsService;
  protected eventEmitter: EventEmitter2;

  /**
   * Optional on purpose. `EnrichAgent` is driven by the CLI and the scheduler and is never part of
   * a conversation, so it is constructed without one and emits nothing — the same outcome as being
   * called with no `ChatContext`.
   */
  protected chatStream?: ChatStreamService;
  private throttleHandler: ThrottleHandler;
  public cacheHandler: CacheHandler;

  protected abstract wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType;

  initialiseAgent(apiKey: string, toolService: ToolsService, eventEmitter: EventEmitter2, chatStream?: ChatStreamService) {
    this.client = new GoogleGenAI({ apiKey });
    this.toolService = toolService;
    this.eventEmitter = eventEmitter;
    this.chatStream = chatStream;
    // The per-model buckets are shared by every agent in the process - the quota is per API key,
    // not per agent - so this instance is only a handle onto them.
    this.throttleHandler = new ThrottleHandler();
    this.cacheHandler = new CacheHandler(this.client);
  }

  /**
   * The function-calling loop, and the whole of an agent's chat output.
   *
   * When a `ChatContext` is present this opens one `thread` envelope per invocation and hangs every
   * tool call underneath it. That is the entire nesting mechanism: `openThread` returns the child
   * context, the child context is what gets threaded into `proceedFunctionCall`, and a nested agent
   * reached through a tool therefore opens its thread as a child of this one. Chat to disc jockey
   * to query database nests three deep without any of the three knowing about the others.
   *
   * With no context — the CLI, the scheduler, `parallelGenerate` — nothing is emitted at all.
   */
  async generate<ReqType>(request: PromptusRequest<ReqType>, ctx?: ChatContext): Promise<ReqType> {
    this.logger.log(`Starting: Request ${request.constructor.name}`);

    const stream = ctx ? this.chatStream : undefined;
    const threadCtx = stream && ctx ? await stream.openThread(ctx, `${this.name}: ${request.query}`, this.name) : undefined;
    let toolCalls = 0;

    try {
      let loop = 0;
      while (loop < this.maxThinkingLoop) {
        const aiRequest = request.getGeneratedContent();
        await this.printTokenUsage(request.model, aiRequest.contents);
        const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);
        // Every call counts against the day, tool-loop iterations included. Displayed, not enforced.
        await this.throttleHandler.recordRequest(request.model);

        if (Array.isArray(response.candidates)) {
          this.logger.debug(response?.candidates[0].content);
          response.candidates.forEach((candidate) => (candidate.content ? request.addHistory(candidate.content) : null));
        }

        if (response.functionCalls) {
          const responseContent: Content = {
            role: 'MODEL',
            parts: [],
          };

          for (const fc of response.functionCalls) {
            toolCalls++;
            const tool = fc.name ?? 'unknown';
            // `fc.id` is absent on most Gemini responses; the pair only has to agree with itself.
            const callId = fc.id ?? newId();

            if (stream && threadCtx) {
              await stream.emit(threadCtx, { type: 'tool_call', callId, tool, args: fc.args ?? {} }, { role: 'tool', level: 'debug' });
            }

            const result = await this.proceedFunctionCall(fc, threadCtx);

            if (stream && threadCtx) {
              await stream.emit(
                threadCtx,
                { type: 'tool_result', callId, tool, ok: !!result, summary: summariseResult(result) },
                { role: 'tool', level: 'debug' },
              );
            }

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
            } else {
              this.logger.error(`${JSON.stringify(fc)} did not return any result`);
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
    } finally {
      // In `finally` so a thread that threw still resolves in the UI rather than spinning forever.
      if (stream && threadCtx) {
        await stream.closeThread(threadCtx, `${toolCalls} tool call${toolCalls === 1 ? '' : 's'}`, toolCalls);
      }
    }
  }

  protected async printTokenUsage(model: string, contents: ContentListUnion) {
    const tokenCount = await this.client.models.countTokens({
      model: model,
      contents: contents,
    });
    this.logger.debug(`Token Count: ${tokenCount.totalTokens} (Model: ${model})`);
  }

  protected async proceedFunctionCall(fc: FunctionCall, ctx?: ChatContext): Promise<FunctionCallResult> {
    return await this.toolService.proceedFunctionCall(fc, ctx);
  }

  async parallelGenerate<ReqType>(requests: PromptusRequest<ReqType>[], concurrencyLimit: number = 1): Promise<ReqType[]> {
    this.logger.log(`Starting parallel generation for ${requests.length} requests (Concurrency Limit: ${concurrencyLimit})...`);

    const results = new Array<ReqType>(requests.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < requests.length) {
        try {
          const index = currentIndex++;
          const request = requests[index];
          await this.throttleHandler.acquire(request);
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

/** Enough of a tool's answer to make the collapsed thread row readable, and no more. */
const RESULT_SUMMARY_LIMIT = 240;

function summariseResult(result: FunctionCallResult | undefined): string {
  if (!result) return 'no result';

  const text = result.type === 'string' ? result.message : result.description;
  return text.length > RESULT_SUMMARY_LIMIT ? `${text.slice(0, RESULT_SUMMARY_LIMIT)}…` : text;
}
