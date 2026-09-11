import {
  GenerateContentConfig,
  GenerateContentParameters,
  SchemaUnion,
  CachedContent,
  ContentListUnion,
  Content,
  ToolListUnion,
} from '@google/genai';
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

  /**
   * Opt a single request into Google Search grounding. Off by default: every existing request keeps
   * its ungrounded behaviour. A grounded request must declare neither `tools` (function declarations)
   * nor a `structuredResponse` — Gemini rejects both combinations — and it cannot use a `cache`.
   */
  public grounded: boolean = false;

  /**
   * Sampling spread, both unset by default so the GenAI library's own defaults apply. A request
   * with no opinion about variety must not be silently re-tuned just because the knob exists here.
   *
   * Raise them on a request whose answers read the same every time: `topP` is the one that actually
   * bites, since nucleus sampling truncates the candidate set before `topK` is ever reached.
   */
  public topK?: number;
  public topP?: number;

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
      // The request's own config is the base layer rather than an afterthought: `thinkingConfig`
      // and the sampling knobs live there, and every key computed below (systemInstruction, tools,
      // cachedContent, the structured response) is disjoint from it, so nothing is overwritten.
      // Until this spread existed the field was declared, assigned by four requests and read by
      // nobody, which is why their `thinkingLevel` never reached Gemini.
      config: { ...this.config },
      // Get the histo or the query if no history is provided
      contents: this.history,
    };

    // Applied only when set: an unset knob must leave the library default in place.
    if (this.genaiRequest.config) {
      if (this.topK !== undefined) this.genaiRequest.config.topK = this.topK;
      if (this.topP !== undefined) this.genaiRequest.config.topP = this.topP;
    }

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

          // opt-in per request, see `grounded`
          if (this.grounded) {
            const tools: ToolListUnion = this.genaiRequest.config['tools'] ?? [];
            this.genaiRequest.config['tools'] = [...tools, { googleSearch: {} }];
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
