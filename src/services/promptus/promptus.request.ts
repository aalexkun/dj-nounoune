import { GenerateContentConfig, GenerateContentParameters, SchemaUnion, CachedContent, ContentListUnion, FunctionCall, Content } from '@google/genai';
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

  public get contextContent(): string {
    return this.context;
  }

  public addHistory(history: ContentListUnion): void {
    if (typeof history === 'object' && history !== null && 'role' in history && 'parts' in history) {
      this.history.push(history);
    } else {
      console.error('Could not add history ');
    }
  }

  public pushFunctionResponse(responseContent: Content): void {
    if (Array.isArray(this.genaiRequest.contents)) {
      this.history.push(responseContent);
    }
  }

  private initialiseGenAiRequest() {
    if (!this.history || this.history?.length == 0) {
      this.history = [
        {
          role: this.role,
          parts: [{ text: this.query }],
        },
      ];
    }

    this.genaiRequest = {
      model: this.model,
      config: {},
      // Get the histo or the query if no history is provided
      contents: this.history,
    };

    if (this.history)
      if (this.genaiRequest.config) {
        // If cache is provided, systemInstruction can't be set
        if (this.cache?.name) {
          this.genaiRequest.config['cachedContent'] = this.cache.name;
        } else {
          // set systemInstruction
          this.genaiRequest.config['systemInstruction'] = {
            parts: [{ text: this.contextContent }],
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

  public getGeneratedContent(): GenerateContentParameters {
    this.initialiseGenAiRequest();
    return this.genaiRequest;
  }
}
