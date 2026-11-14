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
  /**
   * Transmitted as the base of the outbound config, so a `thinkingConfig` set here does take
   * effect. It spent a long time declared-but-unread, which is why several requests carry a
   * `thinkingLevel` that had never once been exercised.
   *
   * Each shape was checked against the live API rather than assumed: plain, grounded, tool-bearing
   * and cached requests all answer normally with a thinking level set. The one wrinkle is
   * `AlbumCoverRequest`, the only request that is grounded *and* carries a responseSchema — it came
   * back with an empty body in roughly one run of six with thinking on, and none of six without.
   * Too small a sample to call causal, and harmless either way because `AlbumCoverResponse` reads
   * an empty answer as "no cover" rather than failing. Look there first if covers start going
   * missing more often than they used to.
   */
  public abstract config: Partial<GenerateContentConfig>;
  public abstract tools: ToolDeclaration[];
  public abstract history: Content[];

  /**
   * Opt a single request into Google Search grounding. Off by default: every existing request keeps
   * its ungrounded behaviour. A grounded request must declare neither `tools` (function declarations)
   * nor a `structuredResponse` — Gemini rejects both combinations — and it cannot use a `cache`.
   */
  public grounded: boolean = false;

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
      // The request's own config is the base layer: `thinkingConfig` lives there, and every key
      // computed below (systemInstruction, tools, cachedContent, the structured response) is
      // disjoint from it, so nothing set here is overwritten later.
      config: { ...this.config },
      // Get the histo or the query if no history is provided
      contents: this.history,
    };

    // No sampling knob is ever written here. `temperature`, `topP` and `topK` are deprecated on the
    // Gemini API: pinned to the model defaults since Gemini 3.6 Flash, so a custom value changed
    // nothing, and rejected with an error by the models after it. The model's own sampling is the
    // only sampling there is; `thinkingConfig.thinkingLevel` on a request's config is the one tuning
    // knob left, and `thinkingBudget` is refused (400 INVALID_ARGUMENT) the same way.

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
