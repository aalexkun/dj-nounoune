import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { GenerateQueryWithCacheResponse } from '../response/generate-query-with-cache.response';
import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { ToolDeclaration } from '../../../tools/tool.type';
import { generateQueryWithCache } from './generate-query-with-cache.prompt';

export class GenerateQueryWithCacheRequest extends PromptusRequest<GenerateQueryWithCacheResponse> {
  cache: CachedContent;
  config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
    },
  };
  context: string = generateQueryWithCache;
  history: Content[];
  readonly model: string = 'gemini-flash-latest';
  query: string;
  role: RequestRole = 'user';
  tools: ToolDeclaration[];
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        aggregate: {
          type: 'ARRAY',
          description: 'List of MongoDB Aggregation Queries',
          items: {
            type: 'OBJECT',
            properties: {
              description: {
                type: 'STRING',
                description: 'intent of the query',
              },
              query: {
                type: 'STRING',
                description: 'MongoDB Aggregation Query (JSON string of the pipeline)',
              },
            },
            propertyOrdering: ['description', 'query'],
            required: ['description', 'query'],
          },
        },
        fulltext: {
          type: 'ARRAY',
          description: 'List of fulltext search terms',
          items: {
            type: 'STRING',
          },
        },
      },
      propertyOrdering: ['aggregate', 'fulltext'],
      required: ['aggregate', 'fulltext'],
    },
  };

  constructor(query: string, cache: CachedContent) {
    super();
    this.query = query;
    this.cache = cache;
  }
}


/*
aistudio
{
  "type": "object",
  "properties": {
    "aggregate": {
      "type": "array",
      "description": "List of MongoDB Aggregation Queries",
      "items": {
        "type": "object",
        "properties": {
          "description": {
            "type": "string",
            "description": "Description of the query"
          },
          "query": {
            "type": "string",
            "description": "MongoDB Aggregation Query (JSON string of the pipeline)"
          }
        },
        "required": [
          "description",
          "query"
        ]
      }
    },
    "fulltext": {
      "type": "array",
      "description": "List of fulltext search terms",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "aggregate",
    "fulltext"
  ]
}
 */