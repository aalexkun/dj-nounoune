import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

export class MpdToolsDefinition {
  private constructor() {}

  public static readonly playMpdCommand: ToolDeclaration = {
    name: 'start_playback',
    description:
      'Send a list of songs to the MPD music server to begin playback. You must provide an array of song objects, exactly as returned by the disc_jockey_create_playlist tool.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        songs: {
          type: Type.ARRAY,
          description: 'The array of song objects to play. Must contain the sourceId.',
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
  };

  public static readonly stopMpdCommand: ToolDeclaration = {
    name: 'stop_playback',
    description: 'Send a command to the MPD music server to immediately halt all playback.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

  public static readonly currentMpdCommand: ToolDeclaration = {
    name: 'current_song',
    description: 'Retrieve the current song playing on the MPD music Server',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

  public static readonly playlistMpdCommand: ToolDeclaration = {
    name: 'current_playlist',
    description: 'Retrieve the current playlist on the MPD music Server',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  };

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
  };
}
