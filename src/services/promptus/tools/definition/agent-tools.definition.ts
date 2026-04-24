import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

export class AgentToolsDefinition {
  private constructor() {}

  public static readonly searchMusicDatabase: ToolDeclaration = {
    name: 'search_music_database',
    description: 'Use this tool to search songs in the music database using a natural language request',
    parameters: {
      type: Type.OBJECT,
      properties: {
        natural_language_request: {
          type: Type.STRING,
          description:
            'The user\'s exact natural language intent. If this is a retry attempt after a failed search, explicitly state the new strategy to the database agent (e.g., "The song search failed, try searching for Yellow Submarine as an album instead").',
        },
      },
      required: ['natural_language_request'],
    },
  } as const;

  public static readonly discJockeyCreatePlaylist: ToolDeclaration = {
    name: 'disc_jockey_create_playlist',
    description:
      'Use this tool to request a curated list of songs from the music expert agent based on a natural language prompt. Pass the resulting array of songs directly to the start_playback tool.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        natural_language_request: {
          type: Type.STRING,
          description: "The user's exact natural language intent for the type of music they want to hear.",
        },
      },
      required: ['natural_language_request'],
    },
  } as const;

  public static readonly discJockeyWhatIsPlaying: ToolDeclaration = {
    name: 'disc_jockey_what_is_playing',
    description:
      "Use this tool to ask the music expert agent for information about the currently playing song or playlist. Use this when the user asks 'what is this song?' or similar questions. You can simply wrap the response and relay the DJ's answer directly back to the user",
    parameters: {
      type: Type.OBJECT,
      properties: {
        natural_language_request: {
          type: Type.STRING,
          description: "The user's specific question about the current music.",
        },
      },
      required: ['natural_language_request'],
    },
  } as const;
}
