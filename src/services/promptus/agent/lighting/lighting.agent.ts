import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Content, GenerateContentResponse } from '@google/genai';
import { Agent } from '../../agent';
import { ToolsService } from '../../tools.service';
import { PromptusRequest } from '../../promptus.request';
import { ChatContext } from '../../../chat/chat-context';
import { ChatStreamService } from '../../../chat/chat-stream.service';
import { DomoticService } from '../../../domotic/domotic.service';
import { LightingSceneService } from '../../../domotic/lighting-scene.service';
import { HouseholdLightingMemory, LightingMemoryService } from '../../../domotic/lighting-memory.service';
import { getErrorMessage } from '../../../../utils/error.utils';
import { DesignLightingRequest } from './request/design-lighting.request';
import { DesignLightingResponse } from './response/design-lighting.response';
import { LightingMemoryRequest } from './request/lighting-memory.request';
import { LightingMemoryResponse } from './response/lighting-memory.response';
import { LightingBrief, describeActions } from './lighting-brief.util';

/** What is kept of the reply in the memory log. The summariser saw the whole of it already. */
const REPLY_LOG_CHARS = 300;

/**
 * The lighting designer: the specialised agent behind the chat's `lighting_designer` tool.
 *
 * Shaped like `DiscJockeyAgent` — stateless, plain-`new`ed by `ToolsService.initialiseAgent`,
 * exposed to the chat as one tool — with one addition: it keeps a notebook. Every request is
 * served from a brief that includes what the household has taught it so far, and once the request
 * is answered the notebook is rewritten to account for it. That second step runs beside the user's
 * path, not on it, exactly as `ChatTitleService` does: the reply is never held up by bookkeeping
 * and a failure costs nothing but one missed lesson.
 */
export class LightingAgent extends Agent {
  name = 'LightingDesigner';
  protected readonly logger = new Logger(this.name);

  /**
   * Memory rewrites are chained so two requests close together fold into the notebook in order.
   * The second rewrite then reads the first one's summary instead of racing it to the document.
   */
  private memoryChain: Promise<void> = Promise.resolve();

  constructor(
    apiKey: string,
    toolService: ToolsService,
    eventEmitter: EventEmitter2,
    private readonly domoticService: DomoticService,
    private readonly sceneService: LightingSceneService,
    private readonly memoryService: LightingMemoryService,
    chatStream?: ChatStreamService,
  ) {
    super();
    this.initialiseAgent(apiKey, toolService, eventEmitter, chatStream);
  }

  /**
   * One lighting request, end to end: brief the model, let it act through the Hue tools, hand back
   * its reply, and queue the notebook rewrite.
   */
  async design(naturalLanguageRequest: string, ctx?: ChatContext): Promise<DesignLightingResponse> {
    const brief = await this.brief();
    const request = new DesignLightingRequest(naturalLanguageRequest, brief);
    const response = await this.generate(request, ctx);

    this.remember(naturalLanguageRequest, request.history, response.text ?? '', brief.memory);

    return response;
  }

  /**
   * Resolves once every queued notebook rewrite has landed.
   *
   * For callers whose process ends with the command: nest-commander closes the app, and with it
   * the Mongo client, the moment a command's `run` returns, so `domotic ask` awaits this before
   * returning or the rewrite dies with "Client must be connected". The chat never needs it.
   */
  settled(): Promise<void> {
    return this.memoryChain;
  }

  /** Everything the designer is told before it reads the request. Four reads, in parallel. */
  async brief(): Promise<LightingBrief> {
    const [rooms, lights, scenes, memory] = await Promise.all([
      this.domoticService.getRoomConfig(),
      this.domoticService.listLights(),
      this.sceneService.list(),
      this.memoryService.get(),
    ]);

    return { rooms, lights, scenes, memory };
  }

  /** Rewrite the notebook, not awaited by the caller. Errors are logged; nobody is waiting. */
  private remember(request: string, history: Content[], reply: string, memory: HouseholdLightingMemory): void {
    this.memoryChain = this.memoryChain
      .then(() => this.updateMemory(request, history, reply, memory))
      .catch((error: unknown) => {
        this.logger.warn(`Could not update the lighting memory: ${getErrorMessage(error)}`);
      });
  }

  private async updateMemory(request: string, history: Content[], reply: string, memory: HouseholdLightingMemory): Promise<void> {
    const actions = describeActions(history);

    // Re-read rather than trusting the brief: a rewrite queued ahead of this one may have landed.
    const latest = memory.requests === 0 ? memory : await this.memoryService.get();
    const response = await this.generate(new LightingMemoryRequest(latest.summary, latest.recent, { request, actions, reply }));
    const summary = response.summary || latest.summary;

    await this.memoryService.record(summary, { at: new Date(), request, actions, reply: reply.slice(0, REPLY_LOG_CHARS) });
    this.logger.log(`Lighting memory updated after "${request.slice(0, 60)}" (${actions.length} action(s), ${summary.length} chars)`);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof DesignLightingRequest) {
      return new DesignLightingResponse(response) as ReqType;
    }
    if (request instanceof LightingMemoryRequest) {
      return new LightingMemoryResponse(response) as ReqType;
    }
    throw new Error('Unsupported request in LightingAgent.wrapResponse: ' + request.constructor.name);
  }
}
