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
      'Use this tool to request a curated list of songs from the music expert agent based on a natural language prompt. The tool return a cache key value that can be passed directly to the start_playback tool.',
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

  public static readonly discJockeyArtistPerformance: ToolDeclaration = {
    name: 'disc_jockey_artist_performances',
    description:
      'Ask the music expert agent for the UPCOMING live performances of an artist — concerts, festival slots, residencies, tour dates. The agent searches the live web, so this is the only way to answer "is X touring?", "when does X play near me?" or "any festivals with X this summer?". Nothing in the music library can answer it. Relay the answer to the user as it comes back.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        natural_language_request: {
          type: Type.STRING,
          description:
            "The user's question, naming the artist. Include any region, city or time window they mentioned, and the location you already know they are in, so the agent can filter the dates.",
        },
      },
      required: ['natural_language_request'],
    },
  } as const;

  public static readonly discJockeyTalkAboutMusic: ToolDeclaration = {
    name: 'disc_jockey_talk_about_music',
    description:
      'Ask the music expert agent a general question about music that is NOT about the household library and does NOT need anything played: who an artist is, the story behind a record, how a genre came about, what someone released recently, comparisons and opinions. The agent answers conversationally and can search the live web. Use it whenever the user simply wants to talk about music. Do not use it to find something to play — that is `disc_jockey_create_playlist` — nor to list what the library holds — that is `disc_jockey_browse_database`.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        natural_language_request: {
          type: Type.STRING,
          description:
            "The user's question, plus whatever earlier turns of the conversation it depends on. The agent keeps no history, so a follow-up like 'and his brother?' has to be spelled out.",
        },
      },
      required: ['natural_language_request'],
    },
  } as const;

  public static readonly discJockeyBrowseDatabase: ToolDeclaration = {
    name: 'disc_jockey_browse_database',
    description:
      'Use this tool to browse the music database for artists, albums, or songs based on a natural language request. This tool returns a formatted list for display only and does not start playback. Use this when the user asks "what artists are in the db?", "show me albums by..." or similar requests.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        natural_language_request: {
          type: Type.STRING,
          description: "The user's exact natural language intent for browsing the database.",
        },
      },
      required: ['natural_language_request'],
    },
  } as const;
}
