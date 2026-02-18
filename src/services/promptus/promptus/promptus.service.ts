import { GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { AppService } from '../../../app.service';

import { SearchPromptusRequest } from './request/search.promptus.request';
import { EnrichPromptusRequest } from './request/enrich-promptus.request';
import { SearchPromptusResponse } from './response/search.promptus.response';
import { EnrichPromptusResponse } from './response/enrich.promptus.response';
import { PromptusRequest } from './request/promptus.request';
import { GetSourceIdPromptusRequest } from './request/get-source-id.promptus.request';
import { GetSourceIdPromptusResponse } from './response/get-source-id.promptus.response';
import { PromptusStrategy } from './promptus.type';

@Injectable()
export class PromptusService {
  private apiKey: string;
  private readonly client: GoogleGenAI;
  private readonly logger = new Logger('PromptusService');

  constructor(appService: AppService) {
    this.apiKey = appService.getGenAiApiKey();
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
  }

  async generate<ReqType>(request: PromptusRequest<ReqType | ReqType[]>): Promise<ReqType | ReqType[]> {
    let strategy: PromptusStrategy = Array.isArray(request) ? request[0].strategy : request.strategy;

    const aiRequest = await request.getGeneratedContent();

    if (request.cache) {
      await this.cache(request.cache.file, request.cache.cacheName, request.cache.fileMineType);
    }

    const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);

    return this.wrapResponse(request, response);
  }

  private wrapResponse<ReqType>(request: PromptusRequest<ReqType | ReqType[]>, response: GenerateContentResponse): ReqType | ReqType[] {
    if (Array.isArray(request)) {
      if (request.length === 0) {
        return [] as ReqType[];
      }

      if (request[0] instanceof SearchPromptusRequest) {
        return request.map((r) => new SearchPromptusResponse(response)) as ReqType[];
      }

      if (request[0] instanceof EnrichPromptusRequest) {
        return request.map((r) => new EnrichPromptusResponse(response)) as ReqType[];
      }

      if (request[0] instanceof GetSourceIdPromptusRequest) {
        return request.map((r) => new GetSourceIdPromptusResponse(response)) as ReqType[];
      }
    } else {
      if (request instanceof SearchPromptusRequest) {
        return new SearchPromptusResponse(response) as ReqType;
      }

      if (request instanceof EnrichPromptusRequest) {
        return new EnrichPromptusResponse(response) as ReqType;
      }

      if (request instanceof GetSourceIdPromptusRequest) {
        return new GetSourceIdPromptusResponse(response) as ReqType;
      }
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }

  private parseResponse(response: GenerateContentResponse): string {
    // response.candidates[0].finishMessage === 'MAX_TOKENS'
    return response.text || '';
  }

  private async cache(file: string, cacheName: string, fileMineType: string): Promise<void> {
    const cachedFiles = await this.client.files.list();

    if (cachedFiles) {
      this.logger.log(cachedFiles);
    }

    await this.client.files.upload({
      file: file,
      config: {
        name: cacheName,
        mimeType: fileMineType,
      },
    });
  }
}
