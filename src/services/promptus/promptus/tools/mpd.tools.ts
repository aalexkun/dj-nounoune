import { ToolDeclaration } from './tool.type';
import { Type } from '@google/genai';

export class MpdTools {
  private constructor() {}

  public static readonly playMpdCommand: ToolDeclaration = {
    name: 'play_music',
    description: 'Use this tool when the user asks to play music, an artist, a genre, or a specific song.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query, artist name, song title, or genre requested by the user (e.g., "The Beatles", "jazz", "lo-fi beats").',
        },
      },
      required: ['query'],
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
}
