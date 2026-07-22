import { CachedContent, createPartFromUri, createUserContent, GoogleGenAI } from '@google/genai';
import { ReadonlyAgentCache } from '../agent';

export class CacheHandler {
  constructor(private client: GoogleGenAI) {}

  public async clearCache(cacheName: string): Promise<void> {
    const cachedFiles = await this.client.files.list();
    const existingFiles = cachedFiles.page;
    while (cachedFiles.hasNextPage()) {
      const nextItems = await cachedFiles.nextPage();
      existingFiles.push(...nextItems);
    }
    const filteredFiles = existingFiles.filter((file) => file.name?.includes(cacheName));
    for (const file of filteredFiles) {
      await this.client.files.delete({ name: file.name ?? '' });
    }

    const cachedContents = await this.client.caches.list();
    const existingCaches = cachedContents.page;
    while (cachedContents.hasNextPage()) {
      const nextItems = await cachedContents.nextPage();
      existingCaches.push(...nextItems);
    }
    const filteredCaches = existingCaches.filter((cache) => cache.displayName?.includes(cacheName));
    for (const cache of filteredCaches) {
      await this.client.caches.delete({ name: cache.name ?? '' });
    }
  }

  public async listCache(): Promise<CachedContent[]> {
    const cachedContents = await this.client.caches.list();
    const existingCaches = cachedContents.page;
    while (cachedContents.hasNextPage()) {
      const nextItems = await cachedContents.nextPage();
      existingCaches.push(...nextItems);
    }
    return existingCaches;
  }

  public async cache( cacheSetting: ReadonlyAgentCache): Promise<CachedContent | undefined> {
    const cachedFiles = await this.client.files.list();
    let existingFiles = cachedFiles.page;
    while (cachedFiles.hasNextPage()) {
      const nextItems = await cachedFiles.nextPage();
      existingFiles = [...existingFiles, ...nextItems];
    }

    let existingFile = cachedFiles.page.find((cachedFile) => cachedFile.name === cacheSetting.file);

    if (!existingFile) {
      existingFile = await this.client.files.upload({
        file: cacheSetting.file,
        config: {
          name: cacheSetting.name,
          mimeType: cacheSetting.fileMineType,
        },
      });
    }

    const existingCache = await this.client.caches.list();
    let cachedContents = existingCache.page;
    while (existingCache.hasNextPage()) {
      const nextItems = await existingCache.nextPage();
      cachedContents = [...cachedContents, ...nextItems];
    }

    const existingCacheContent = cachedContents.find((cache) => cache.displayName === cacheSetting.name);

    if (existingCacheContent) {
      return existingCacheContent;
    } else if (existingFile && existingFile.uri && existingFile.mimeType) {
      return await this.client.caches.create({
        model: cacheSetting.model,
        config: {
          displayName: cacheSetting.name,
          contents: createUserContent(createPartFromUri(existingFile.uri, existingFile.mimeType)),
          systemInstruction: cacheSetting.systemInstruction || '',
        },
      });
    } else {
      throw new Error('Failed to cache file');
    }
  }
}
