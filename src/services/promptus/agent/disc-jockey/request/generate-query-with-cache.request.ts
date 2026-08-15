import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { GenerateQueryWithCacheResponse } from '../response/generate-query-with-cache.response';
import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { ToolDeclaration } from '../../../tools/tool.type';
import { generateQueryWithCache, MAX_MONGO_DB_QUERY } from './generate-query-with-cache.prompt';

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
  /**
   * The model emits structured filter conditions, never a raw pipeline — the backend
   * compiles them into `$match` (see `buildMatch` in `music-db/mongo-filter.util.ts`).
   *
   * These `description` strings are the model's primary instructions: a cached request
   * carries no system instruction, so what is written here is what steers the output.
   */
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        aggregate: {
          type: 'ARRAY',
          description:
            `Up to ${MAX_MONGO_DB_QUERY} alternative structured database queries, each approaching the request from a different angle. ` +
            'Each one is compiled to a MongoDB $match and sampled independently, so prefer a few broad queries over many narrow ones. ' +
            'Use these for dimensions with a controlled vocabulary — genre, category, emotion, pace, language, country, year, technical quality. ' +
            'For a specific artist, album or track title also use the fulltext field. Return an empty array when no dimension applies.',
          items: {
            type: 'OBJECT',
            properties: {
              description: {
                type: 'STRING',
                description: 'Intent of this query in one plain-English sentence, e.g. "High-res fast electronic tracks for focused coding".',
              },
              filters: {
                type: 'ARRAY',
                description:
                  'Conditions combined with AND. Two conditions on the same field are merged, so a range is expressed as one $gte plus one $lt on that field.',
                items: {
                  type: 'OBJECT',
                  properties: {
                    collection: {
                      type: 'STRING',
                      enum: ['songs', 'artists', 'albums'],
                      description:
                        'Collection the field belongs to. Conditions on artists or albums are resolved first and then applied to their songs, so they can be freely mixed with songs conditions.',
                    },
                    field: {
                      type: 'STRING',
                      description:
                        'Dotted path exactly as it appears in the schema of the chosen collection, for example "genre", "pace", "emotion", "year" or ' +
                        '"source.technical_info.is_high_res" for songs, "artist" for artists, "release_year" for albums. ' +
                        'A path that does not exist in the schema is discarded, so never invent one.',
                    },
                    operator: {
                      type: 'STRING',
                      enum: ['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte', '$regex', '$exists', '$all'],
                      description:
                        'Comparison to apply. Use $in for "any of these values", $nin to exclude a set, $regex for a case-insensitive partial match, ' +
                        '$exists to require the field to be populated, and $all when every listed value must be present in an array field.',
                    },
                    value: {
                      type: 'ARRAY',
                      description:
                        'Always an array, even for a single value. $in, $nin and $all consume every entry; the comparison operators use the first. ' +
                        'Values must come from the controlled vocabulary in the provided database profile, matching its exact spelling and casing.',
                      items: {
                        anyOf: [{ type: 'STRING' }, { type: 'NUMBER' }, { type: 'BOOLEAN' }],
                      },
                    },
                    negate: {
                      type: 'BOOLEAN',
                      description: 'Set to true to invert the condition. Omit it otherwise.',
                    },
                  },
                  propertyOrdering: ['collection', 'field', 'operator', 'value', 'negate'],
                  required: ['collection', 'field', 'operator', 'value'],
                },
              },
            },
            propertyOrdering: ['description', 'filters'],
            required: ['description', 'filters'],
          },
        },
        fulltext: {
          type: 'ARRAY',
          description:
            'Search terms for the multilingual fuzzy index, used for artist, album and track-title lookups. ' +
            'Correct obvious typos and add spelling, transliteration and native-script variations of each name. Empty when the request names no specific work.',
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
      "description": "Up to 3 alternative structured database queries",
      "items": {
        "type": "object",
        "properties": {
          "description": {
            "type": "string",
            "description": "Intent of this query in one plain-English sentence"
          },
          "filters": {
            "type": "array",
            "description": "Conditions combined with AND",
            "items": {
              "type": "object",
              "properties": {
                "collection": {
                  "type": "string",
                  "enum": ["songs", "artists", "albums"],
                  "description": "Collection the field belongs to"
                },
                "field": {
                  "type": "string",
                  "description": "Dotted path exactly as it appears in the schema of the chosen collection"
                },
                "operator": {
                  "type": "string",
                  "enum": ["$eq", "$ne", "$in", "$nin", "$gt", "$gte", "$lt", "$lte", "$regex", "$exists", "$all"],
                  "description": "Comparison to apply"
                },
                "value": {
                  "type": "array",
                  "description": "Always an array, even for a single value",
                  "items": {
                    "anyOf": [{ "type": "string" }, { "type": "number" }, { "type": "boolean" }]
                  }
                },
                "negate": {
                  "type": "boolean",
                  "description": "Set to true to invert the condition"
                }
              },
              "required": [
                "collection",
                "field",
                "operator",
                "value"
              ]
            }
          }
        },
        "required": [
          "description",
          "filters"
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