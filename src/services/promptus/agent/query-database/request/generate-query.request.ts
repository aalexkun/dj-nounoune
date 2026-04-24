import { GenerateQueryResponse } from '../response/generate-query.response';
import { generateQueryPrompt } from './generate-query.prompt';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { CachedContent, Content, GenerateContentConfig } from '@google/genai';

export class GenerateQueryRequest extends PromptusRequest<GenerateQueryResponse> {
  public structuredResponse?: StructuredResponse = undefined;
  public tools: ToolDeclaration[] = [];
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context = generateQueryPrompt;
  private readonly _query: string;

  // public readonly structuredResponse: StructuredResponse = {
  //   responseMimeType: 'application/json',
  //   responseSchema: {
  //     type: 'OBJECT',
  //     properties: {
  //       collection: {
  //         type: 'STRING',
  //         enum: ['songs', 'albums', 'artists'],
  //         description: 'The MongoDB collection to query.',
  //       },
  //       function: {
  //         type: 'STRING',
  //         enum: ['aggregate'],
  //         description: 'The database operation to perform.',
  //       },
  //       params: {
  //         type: 'ARRAY',
  //         description: 'The MongoDB aggregation pipeline stages.',
  //         items: {
  //           type: 'TYPE_UNSPECIFIED',
  //         },
  //       },
  //     },
  //     required: ['collection', 'function', 'params'],
  //   },
  // };

  get model(): string {
    return this._model;
  }

  get role(): RequestRole {
    return this._role;
  }

  get context(): string {
    return this._context;
  }

  get query(): string {
    return this._query;
  }

  constructor(query: string) {
    super();
    this._query = query;
  }
}
