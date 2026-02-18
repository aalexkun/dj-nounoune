import { GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { AppService } from '../../../app.service';

import { SearchPromptusRequest } from './request/SearchPromptusRequest';
import { EnrichPromptusRequest } from './request/EnrichPromptusRequest';
import { SearchPromptusResponse } from './response/SearchPromptusResponse';
import { EnrichPromptusResponse } from './response/EnrichPromptusResponse';
import { PromptusRequest } from './request/PromptusRequest';
import { GetSourceIdPromptusRequest } from './request/GetSourceIdPromptusRequest';
import { GetSourceIdPromptusResponse } from './response/GetSourceIdPromptusResponse';

@Injectable()
export class PromptusService {
  private apiKey: string;
  private readonly client: GoogleGenAI;
  private readonly logger = new Logger('PromptusService');

  constructor(appSerivce: AppService) {
    this.apiKey = appSerivce.getGenAiApiKey();
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
  }

  async generate<T>(request: PromptusRequest<T>): Promise<T> {
    const aiRequest = await request.getGeneratedContent();

    if (request.cache) {
      await this.cache(request.cache.file, request.cache.cacheName, request.cache.fileMineType);
    }

    const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);
    const responseText = this.parseResponse(response);

    if (request instanceof SearchPromptusRequest) {
      return new SearchPromptusResponse(response) as T;
    }

    if (request instanceof EnrichPromptusRequest) {
      return new EnrichPromptusResponse(response) as T;
    }

    if (request instanceof GetSourceIdPromptusRequest) {
      return new GetSourceIdPromptusResponse(response) as T;
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
