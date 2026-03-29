import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

export class AgentToolsDefinition {
  private constructor() {}

  public static readonly searchMusicDatabase: ToolDeclaration = {
    name: 'searchMusicDatabase',
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
  };

  public static readonly discJockeyCreatePlaylist: ToolDeclaration = {
    name: 'disc_jockey_create_playlist',
    description: 'Use this tool to create playlist using natural language request',
    parameters: {
      type: Type.OBJECT,
      properties: {
        natural_language_request: {
          type: Type.STRING,
          description: "The user's exact natural language intent.",
        },
      },
      required: ['natural_language_request'],
    },
  };

  public static readonly discJockeyWhatIsPlaying: ToolDeclaration = {
    name: 'disc_jockey_what_is_playing',
    description: 'Use this tool to give information on the current playing songs. ',
    parameters: {
      type: Type.OBJECT,
      properties: {
        request: {
          type: Type.STRING,
          description: 'The user information request',
        },
      },
      required: ['request'],
    },
  };
}
