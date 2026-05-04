import { GenerateContentConfig, CachedContent, Content } from '@google/genai';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { CreatePlaylistResponse } from '../response/create-playlist.response';
import { ToolDeclaration } from '../../../tools/tool.type';
import { AgentToolsDefinition } from '../../../tools/definition/agent-tools.definition';

import { CategorisePlaylistResponse } from '../response/categorise-playlist.response';
import { createPlaylistCompletePrompt } from './create-playlist-prompts/create-playlist-complete.prompt';
import { createPlaylistPartialPrompt } from './create-playlist-prompts/create-playlist-partial.prompt';
import { createPlaylistVibePrompt } from './create-playlist-prompts/create-playlist-vibe.prompt';

export class CreatePlaylistRequest extends PromptusRequest<CreatePlaylistResponse> {
  public tools: ToolDeclaration[] = [AgentToolsDefinition.searchMusicDatabase];
  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      description: 'An object containing a description and a list of songs.',
      properties: {
        description: {
          type: 'STRING',
          description: 'A description of the returned data',
        },
        items: {
          type: 'ARRAY',
          description: 'A list of songs.',
          items: {
            type: 'OBJECT',
            properties: {
              id: {
                type: 'STRING',
                description: 'The identifier of the song',
              },
              sourceId: {
                type: 'STRING',
                description: 'The source identifier of the song',
              },
              title: {
                type: 'STRING',
                description: 'The title of the song',
              },
              artist: {
                type: 'STRING',
                description: 'The artist of the song',
              },
              album: {
                type: 'STRING',
                description: 'The album the song belongs to',
              },
            },
            required: ['id', 'sourceId', 'title', 'artist', 'album'],
          },
        },
      },
      required: ['description', 'items'],
    },
  };
  public config: Partial<GenerateContentConfig>;
  public cache?: CachedContent;
  public history: Content[] = [];
  private readonly _model = 'gemini-3-flash-preview';
  private readonly _role: RequestRole = 'user';
  private readonly _context: string;
  private readonly _query: string;

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

  constructor(query: string, categorisesKnowledge: CategorisePlaylistResponse) {
    super();
    this._query = query;

    if (categorisesKnowledge.playlistClassification.type === 'complete') {
      this._context = this.mergeContext(createPlaylistCompletePrompt, categorisesKnowledge);
    } else if (categorisesKnowledge.playlistClassification.type === 'partial') {
      this._context = this.mergeContext(createPlaylistPartialPrompt, categorisesKnowledge);
    } else if (categorisesKnowledge.playlistClassification.type === 'vibe') {
      this._context = this.mergeContext(createPlaylistVibePrompt, categorisesKnowledge);
    }
  }

  private mergeContext(prompt: string, categorisesKnowledge: CategorisePlaylistResponse) {
    let context = prompt;

    const genres = categorisesKnowledge.playlistClassification.genres?.join(', ') ?? '';
    const artists = categorisesKnowledge.playlistClassification.artists?.join(', ') ?? '';
    const bpmMin = categorisesKnowledge.playlistClassification.bpmMin ?? '';
    const bpmMax = categorisesKnowledge.playlistClassification.bpmMax ?? '';

    if (categorisesKnowledge.playlistClassification.genres && categorisesKnowledge.playlistClassification.genres.length > 0) {
      context = context.replace('###GENRES###', `List of available genres for the request: ${genres}`);
    } else {
      context = context.replace('###GENRES###', '');
    }

    if (categorisesKnowledge.playlistClassification.artists && categorisesKnowledge.playlistClassification.artists.length > 0) {
      context = context.replace('###ARTISTS###', `List of available artists for the request:  ${artists}`);
    } else {
      context = context.replace('###ARTISTS###', '');
    }

    if (typeof categorisesKnowledge.playlistClassification.bpmMin === 'number') {
      context = context.replace('###MINBPM###', `Songs Minimum BPM: ${bpmMin}`);
    } else {
      context = context.replace('###MINBPM###', '');
    }

    if (typeof categorisesKnowledge.playlistClassification.bpmMax === 'number') {
      context = context.replace('###MAXBPM###', `Songs Maximum BPM: ${bpmMax}`);
    } else {
      context = context.replace('###MAXBPM###', '');
    }

    return context;
  }
}
