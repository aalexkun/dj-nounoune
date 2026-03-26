import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

export class MpdToolsDefinition {
  private constructor() {}

  public static readonly playMpdCommand: ToolDeclaration = {
    name: 'play_music',
    description: 'Send a list of songs to the MPD music server to start playback.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        songs: {
          type: Type.ARRAY,
          description: 'The array of song objects to play. Pass the exact results array returned by the query_music_database tool.',
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
    description: 'Send the stop command to MPD music Server',
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
