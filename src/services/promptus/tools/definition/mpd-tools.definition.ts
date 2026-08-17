import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

export class MpdToolsDefinition {
  private constructor() {}

  public static readonly playMpdCommand: ToolDeclaration = {
    name: 'start_playback',
    description:
      'Send a list of songs to the MPD music server to begin playback. You must provide The cache key, exactly as returned by the disc_jockey_create_playlist tool.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        cacheKey: {
          type: Type.STRING,
          description: 'The cache key to retrieve the array of songs to play.',
        },
        clearQueue: {
          type: Type.BOOLEAN,
          description: 'Whether to clear the queue before playing the new songs.',
        },
      },
      required: ['cacheKey', 'clearQueue'],
    },
  };

  public static readonly stopMpdCommand: ToolDeclaration = {
    name: 'stop_playback',
    description: 'Send a command to the MPD music server to immediately halt all playback.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  } as const;

  public static readonly nextMpdCommand: ToolDeclaration = {
    name: 'next_song',
    description:
      'Skip the track playing on the MPD music server and start the next one in the queue. Use it when the user is bored with, dislikes or simply wants to move past the current song. Takes no argument: it acts on whatever is already queued.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  } as const;

  public static readonly previousMpdCommand: ToolDeclaration = {
    name: 'previous_song',
    description:
      'Go back to the previous track in the MPD queue and play it. Use it when the user wants to hear again the song that came before the current one. Takes no argument: it acts on whatever is already queued.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  } as const;

  public static readonly currentMpdCommand: ToolDeclaration = {
    name: 'current_song',
    description: 'Retrieve the current song playing on the MPD music Server',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  } as const;

  public static readonly playlistMpdCommand: ToolDeclaration = {
    name: 'current_playlist',
    description: 'Retrieve the current playlist on the MPD music Server',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  } as const;

  public static readonly createPlaylistMpdCommand: ToolDeclaration = {
    name: 'create_playlist',
    description: 'Create a new playlist on the MPD music Server',
    parameters: {
      type: Type.OBJECT,
      properties: {
        songs: {
          type: Type.ARRAY,
          description: 'The array of song objects to add to the playlist.',
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              sourceId: { type: Type.STRING },
              title: { type: Type.STRING },
              artist: { type: Type.STRING },
              album: { type: Type.STRING },
            },
            required: ['sourceId'], // sourceId is usually the most critical for playback
          },
        },
      },
      required: ['songs'],
    },
  } as const;
}
