import { ToolDeclaration } from '../tool.type';

export class MongoToolsDefinition {
  private constructor() {}

  public static readonly genreDistribution: ToolDeclaration = {
    name: 'genre_distribution',
    description: 'Use this tool to get the genre distribution of the library. It will return a PSV file of the genre|count',
    parameters: {},
  } as const;
  public static readonly artistDistribution: ToolDeclaration = {
    name: 'artist_distribution',
    description: 'Use this tool to get the artist distribution of the library. It will return a PSV file of the artist|count',
    parameters: {},
  } as const;

  public static readonly bpmDistribution: ToolDeclaration = {
    name: 'bpm_distribution',
    description: 'Use this tool to get the songs bpm (beat per minute) distribution of the library. It will return a PSV file of the bpm|count',
    parameters: {},
  } as const;
}
