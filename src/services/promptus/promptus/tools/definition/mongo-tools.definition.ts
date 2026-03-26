import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

export class MongoToolsDefinition {
  public static readonly queryMusicDatabase: ToolDeclaration = {
    name: 'query_music_database',
    description:
      'Use this tool to search the music database for songs, albums, or artists. It passes natural language requests to a specialised agent. It returns an array of matching tracks, where each track includes an id, sourceId, title, artist, and album. IMPORTANT FALLBACK INSTRUCTION: If a search returns an empty array, you MUST call this tool again using a different search strategy. For example, if searching by song title (e.g., "Play Yellow Submarine") fails, retry by asking to search by album name, artist, or a broader category.',
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

  public static readonly genreDistribution: ToolDeclaration = {
    name: 'genre_distribution',
    description: 'Use this tool to get the genre distribution of the library. It will return a PSV file of the genre|count',
    parameters: {},
  };
  public static readonly artistDistribution: ToolDeclaration = {
    name: 'artist_distribution',
    description: 'Use this tool to get the artist distribution of the library. It will return a PSV file of the artist|count',
    parameters: {},
  };

  public static readonly bpmDistribution: ToolDeclaration = {
    name: 'bpm_distribution',
    description: 'Use this tool to get the songs bpm (beat per minute) distribution of the library. It will return a PSV file of the bpm|count',
    parameters: {},
  };
}
