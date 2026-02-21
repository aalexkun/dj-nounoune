import { GenerateContentResponse, GoogleGenAI, CachedContent, createUserContent, createPartFromUri } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { AppService } from '../../../app.service';

import { SearchPromptusRequest } from './request/search.promptus.request';
import { EnrichPromptusRequest } from './request/enrich-promptus.request';
import { SearchPromptusResponse } from './response/search.promptus.response';
import { EnrichPromptusResponse } from './response/enrich.promptus.response';
import { PromptusRequest } from './request/promptus.request';
import { GetSourceIdPromptusRequest } from './request/get-source-id.promptus.request';
import { GetSourceIdPromptusResponse } from './response/get-source-id.promptus.response';

@Injectable()
export class PromptusService {
  private apiKey: string;
  private readonly client: GoogleGenAI;
  private readonly logger = new Logger('PromptusService');
  private currentFileCache: string[] = [];

  constructor(appService: AppService) {
    this.apiKey = appService.getGenAiApiKey();
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
  }

  async parallelGenerate<ReqType>(requests: PromptusRequest<ReqType>[], concurrencyLimit: number = 20): Promise<ReqType[]> {
    const results: ReqType[] = new Array(requests.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < requests.length) {
        const index = currentIndex++;
        results[index] = await this.generate(requests[index]);
      }
    };

    const workers: Promise<void>[] = [];
    const actualConcurrency = Math.min(concurrencyLimit, requests.length);

    for (let i = 0; i < actualConcurrency; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    return results;
  }

  async generate<ReqType>(request: PromptusRequest<ReqType>): Promise<ReqType> {
    const aiRequest = await request.getGeneratedContent();

    const response: GenerateContentResponse = await this.client.models.generateContent(aiRequest);
    return this.wrapResponse(request, response);
  }

  private wrapResponse<ReqType>(request: PromptusRequest<ReqType>, response: GenerateContentResponse): ReqType {
    if (request instanceof SearchPromptusRequest) {
      return new SearchPromptusResponse(response) as ReqType;
    }

    if (request instanceof EnrichPromptusRequest) {
      return new EnrichPromptusResponse(response) as ReqType;
    }

    if (request instanceof GetSourceIdPromptusRequest) {
      return new GetSourceIdPromptusResponse(response) as ReqType;
    }

    throw new Error('Unsupported generate In promptus.generate method. Please check request type for ' + request.constructor.name);
  }

  private parseResponse(response: GenerateContentResponse): string {
    // response.candidates[0].finishMessage === 'MAX_TOKENS'
    return response.text || '';
  }

  public async clearCache(cacheName: string): Promise<void> {
    const cachedFiles = await this.client.files.list();
    const existingFiles = cachedFiles.page;
    while (cachedFiles.hasNextPage()) {
      let nextItems = await cachedFiles.nextPage();
      existingFiles.push(...nextItems);
    }
    const filteredFiles = existingFiles.filter((file) => file.name?.includes(cacheName));
    for (const file of filteredFiles) {
      await this.client.files.delete({ name: file.name ?? '' });
    }

    const cachedContents = await this.client.caches.list();
    const existingCaches = cachedContents.page;
    while (cachedContents.hasNextPage()) {
      let nextItems = await cachedContents.nextPage();
      existingCaches.push(...nextItems);
    }
    const filteredCaches = existingCaches.filter((cache) => cache.displayName?.includes(cacheName));
    for (const cache of filteredCaches) {
      await this.client.caches.delete({ name: cache.name ?? '' });
    }
  }

  public async cache(
    file: string,
    cacheName: string,
    fileMineType: string,
    modelName: string,
    systemInstruction: string,
  ): Promise<CachedContent | undefined> {
    let cachedFiles = await this.client.files.list();
    let existingFiles = cachedFiles.page;
    while (cachedFiles.hasNextPage()) {
      let nextItems = await cachedFiles.nextPage();
      existingFiles = [...existingFiles, ...nextItems];
    }

    let existingFile = cachedFiles.page.find((cachedFile) => cachedFile.name === file);

    if (!existingFile) {
      existingFile = await this.client.files.upload({
        file: file,
        config: {
          name: cacheName,
          mimeType: fileMineType,
        },
      });
    }

    const existingCache = await this.client.caches.list();
    let cachedContents = existingCache.page;
    while (existingCache.hasNextPage()) {
      let nextItems = await existingCache.nextPage();
      cachedContents = [...cachedContents, ...nextItems];
    }

    let existingCacheContent = cachedContents.find((cache) => cache.displayName === cacheName);

    if (existingCacheContent) {
      return existingCacheContent;
    } else if (existingFile && existingFile.uri && existingFile.mimeType) {
      return await this.client.caches.create({
        model: modelName,
        config: {
          displayName: cacheName,
          contents: createUserContent(createPartFromUri(existingFile.uri, existingFile.mimeType)),
          systemInstruction,
        },
      });
    } else {
      throw new Error('Failed to cache file');
    }
  }
}
