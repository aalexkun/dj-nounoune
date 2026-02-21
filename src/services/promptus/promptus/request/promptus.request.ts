import { GenerateContentConfig, GenerateContentParameters, SchemaUnion, CachedContent } from '@google/genai';
import { promises as fs } from 'fs';
import { PromptusStrategy } from '../promptus.type';

export type RequestRole = 'user' | 'model';

export interface StructuredResponse {
  responseMimeType: string;
  responseSchema?: SchemaUnion;
  responseJsonSchema?: unknown;
}

export abstract class PromptusRequest<TResponse> {
  declare readonly _responseType: TResponse;

  public abstract model: string;
  public abstract context: string;
  public abstract query: string;
  public abstract role: RequestRole;
  public abstract cache?: CachedContent;
  public abstract structuredResponse?: StructuredResponse;
  public abstract config: Partial<GenerateContentConfig>;

  public async getContext(): Promise<string> {
    try {
      return await fs.readFile(this.context, 'utf-8');
    } catch (e) {
      console.error(`Error reading context file: ${this.context}`, e);
      return '';
    }
  }

  get strategy(): PromptusStrategy {
    return 'sequential';
  }

  public async getGeneratedContent(): Promise<GenerateContentParameters> {
    let request = {
      model: this.model,
      config: {},
      contents: [
        {
          role: this.role,
          parts: [{ text: this.query }],
        },
      ],
    };

    if (this.cache?.name) {
      request.config['cachedContent'] = this.cache.name;
    } else {
      request.config['systemInstruction'] = {
        parts: [{ text: await this.getContext() }],
      };
    }

    if (this.structuredResponse) {
      request.config = { ...request.config, ...this.structuredResponse };
    }

    return request;
  }
}
