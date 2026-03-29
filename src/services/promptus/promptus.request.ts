import { GenerateContentConfig, GenerateContentParameters, SchemaUnion, CachedContent, ContentListUnion, FunctionCall, Content } from '@google/genai';
import { promises as fs } from 'fs';
import { randomUUID } from 'node:crypto';
import { ToolDeclaration } from './tools/tool.type';

export type RequestRole = 'user' | 'model';

export interface StructuredResponse {
  responseMimeType: string;
  responseSchema?: SchemaUnion;
  responseJsonSchema?: unknown;
}

export abstract class PromptusRequest<TResponse> {
  declare readonly _responseType: TResponse;

  private genaiRequest: GenerateContentParameters;
  public abstract model: string;
  public abstract context: string;
  public abstract query: string;
  public abstract role: RequestRole;
  public abstract cache?: CachedContent;
  public abstract structuredResponse?: StructuredResponse;
  public abstract config: Partial<GenerateContentConfig>;
  public abstract tools: ToolDeclaration[];
  public abstract history: Content[];

  public async getContext(): Promise<string> {
    try {
      return await fs.readFile(this.context, 'utf-8');
    } catch (e) {
      console.error(`Error reading context file: ${this.context}`, e);
      return '';
    }
  }

  public pushAiResponse(history: ContentListUnion): void {
    if (Array.isArray(this.genaiRequest.contents)) {
      if (typeof history === 'object' && history !== null && 'role' in history && 'parts' in history) {
        this.history.push(history);
      }
    }
  }

  public pushFunctionResponse(fnResult: string, fc: FunctionCall): void {
    if (Array.isArray(this.genaiRequest.contents)) {
      const responseContent: Content = {
        role: 'tool',
        parts: [
          {
            functionResponse: {
              willContinue: false,
              name: fc.name,
              response: {
                output: fnResult,
                error: null,
              },
            },
          },
        ],
      };
      this.history.push(responseContent);
    }
  }

  private async initialiseGenAiRequest() {
    this.genaiRequest = {
      model: this.model,
      config: {
        httpOptions: {
          headers: {
            'x-request-id': randomUUID(),
          },
        },
      },
      // Get the histo or the query if no history is provided
      contents: [
        ...(this.history?.length > 0
          ? this.history
          : [
              {
                role: this.role,
                parts: [{ text: this.query }],
              },
            ]),
      ],
    };

    if (this.history)
      if (this.genaiRequest.config) {
        // If cache is provided, systemInstruction can't be set
        if (this.cache?.name) {
          this.genaiRequest.config['cachedContent'] = this.cache.name;
        } else {
          // set systemInstruction
          this.genaiRequest.config['systemInstruction'] = {
            parts: [{ text: await this.getContext() }],
          };

          // set tools
          if (this.tools?.length > 0) {
            this.genaiRequest.config['tools'] = [
              {
                functionDeclarations: this.tools,
              },
            ];
          }
        }
      }

    if (this.structuredResponse) {
      this.genaiRequest.config = { ...this.genaiRequest.config, ...this.structuredResponse };
    }
  }

  public async getGeneratedContent(): Promise<GenerateContentParameters> {
    await this.initialiseGenAiRequest();
    return this.genaiRequest;
  }
}
