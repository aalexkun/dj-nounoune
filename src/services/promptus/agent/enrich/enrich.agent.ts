import { Logger } from '@nestjs/common';
import { GenerateContentResponse } from '@google/genai';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Agent } from '../../agent';
import { ToolsService } from '../../tools.service';
import { PromptusRequest } from '../../promptus.request';
import { EnrichMetadataRequest } from './request/enrich-metadata.request';
import { EnrichMetadataResponse } from './response/enrich-metadata.response';
import { LyricSemanticRequest } from './request/lyric-semantic.request';
import { LyricSemanticResponse } from './response/lyric-semantic.response';
import { DuplicateVerdictRequest } from './request/duplicate-verdict.request';
import { DuplicateVerdictResponse } from './response/duplicate-verdict.response';

/**
 * Library enrichment: batch metadata classification, per-song lyric distillation, and the
 * same-recording verdict the deduplication review tier asks for.
 *
 * Never registered as a tool. Enrichment is driven by the CLI and the scheduler, and no user
 * utterance should be able to start a run over the library.
 */
export class EnrichAgent extends Agent {
  name = 'EnrichAgent';
  protected readonly logger = new Logger(this.name);

  constructor(apiKey: string, toolService: ToolsService, eventEmitter: EventEmitter2) {
    super();
    this.initialiseAgent(apiKey, toolService, eventEmitter);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof EnrichMetadataRequest) {
      return new EnrichMetadataResponse(response) as ReqType;
    }

    if (request instanceof LyricSemanticRequest) {
      return new LyricSemanticResponse(response) as ReqType;
    }

    if (request instanceof DuplicateVerdictRequest) {
      return new DuplicateVerdictResponse(response) as ReqType;
    }

    throw new Error('Unsupported request in EnrichAgent.wrapResponse: ' + request.constructor.name);
  }
}
