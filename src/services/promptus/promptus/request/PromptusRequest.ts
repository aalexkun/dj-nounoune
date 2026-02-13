import { GenerateContentConfig, GenerateContentParameters } from '@google/genai';
import { promises as fs } from 'fs';

export type RequestRole = 'user' | 'model';

export abstract class PromptusRequest<TResponse> {
  declare readonly _responseType: TResponse;

  public abstract model: string;
  public abstract context: string;
  public abstract query: string;
  public abstract role: RequestRole;
  public abstract config: Partial<GenerateContentConfig>;

  public async getContext(): Promise<string> {
    try {
      return await fs.readFile(this.context, 'utf-8');
    } catch (e) {
      console.error(`Error reading context file: ${this.context}`, e);
      return '';
    }
  }

  public async getGeneratedContent(): Promise<GenerateContentParameters> {
    return {
      model: this.model,
      config: {
        systemInstruction: {
          parts: [{ text: await this.getContext() }],
        },
      },
      contents: [
        {
          role: this.role,
          parts: [{ text: this.query }],
        },
      ],
    };
  }
}
