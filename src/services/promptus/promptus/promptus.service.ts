import { GenerateContentResponse, GoogleGenAI } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { LogService } from '../../logger.service';
import { AppService } from '../../../app.service';

import { SearchPromptusRequest } from './request/SearchPromptusRequest';
import { EnrichPromptusRequest } from './request/EnrichPromptusRequest';
import { SearchPromptusResponse } from './response/SearchPromptusResponse';
import { EnrichPromptusResponse } from './response/EnrichPromptusResponse';
import { PromptusRequest } from './request/PromptusRequest';

@Injectable()
export class PromptusService {
  private apiKey: string;
  private readonly client: GoogleGenAI;

  constructor(
    private logService: LogService,
    appSerivce: AppService,
  ) {
    this.logService.setContext('PromptusService');
    this.apiKey = appSerivce.getGenAiApiKey();
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
  }

  async generate<T>(request: PromptusRequest<T>): Promise<T> {
    const aiRequest = await request.getGeneratedContent();
    console.log(aiRequest);

    const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);

    const responseText = this.parseResponse(response);

    console.dir(response);

    if (request instanceof SearchPromptusRequest) {
      return new SearchPromptusResponse(response) as T;
    }

    if (request instanceof EnrichPromptusRequest) {
      return new EnrichPromptusResponse(response) as T;
    }

    throw new Error('Unsupported request type');
  }

  private parseResponse(response: GenerateContentResponse): string {
    return response.text || '';
  }
}
