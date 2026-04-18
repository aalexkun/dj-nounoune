import { Agent } from '../../agent';
import { Logger } from '@nestjs/common';
import { ToolsService } from '../../tools.service';
import { GenerateContentResponse } from '@google/genai';
import { PromptusRequest } from '../../promptus.request';
import { GenerateQueryRequest } from './request/generate-query.request';
import { GenerateQueryResponse } from './response/generate-query.response';
import { GetJsonpathRequest } from './request/get-jsonpath.request';
import { MusicDbAggregateResult, MusicDbService } from '../../../music-db/music-db.service';
import { MusicSearchResult } from '../disc-jockey/disc-jockey.agent';
import { GetJsonpathResponse } from './response/get-jsonpath.response';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface GetJsonPathArgs {
  sourceObject: MusicDbAggregateResult;
  targetProperties: (keyof MusicSearchResult)[];
}

export class QueryDatabaseAgent extends Agent {
  name = 'QueryBuilderAgent';
  protected readonly logger = new Logger(this.name);

  constructor(
    apiKey: string,
    protected toolService: ToolsService,
    protected eventEmitter: EventEmitter2,
    private musicDBService: MusicDbService,
  ) {
    super();
    this.initialiseAgent(apiKey, toolService, eventEmitter);
  }

  async generateQuery(prompt: string, sessionId?: string): Promise<MusicDbAggregateResult[]> {
    const generateRequest = new GenerateQueryRequest(prompt);
    const response = await this.generate(generateRequest, sessionId);

    if (!response.collection || !response.function || !response.params) {
      this.logger.log(generateRequest);
      this.logger.error(response);
      throw new Error('Invalid generateQuery Response');
    }

    if (response.function !== 'aggregate') {
      throw new Error('Generate Query Function not implemented');
    }

    return await this.musicDBService.aggregate(response.collection, response.params);
  }

  async getJSONPath(args: GetJsonPathArgs) {
    const getPathRequest = new GetJsonpathRequest(JSON.stringify(args.sourceObject));
    return await this.generate(getPathRequest);
  }

  protected wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof GenerateQueryRequest) {
      return new GenerateQueryResponse(response) as ReqType;
    }

    if (request instanceof GetJsonpathRequest) {
      return new GetJsonpathResponse(response) as ReqType;
    }

    throw new Error('Method not implemented.');
  }
}
