import { MusicSearchResult } from '../agent/disc-jockey/disc-jockey.agent';

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export type FunctionCallResult = FunctionCallResultString | FunctionCallPlaylistResult;

export type FunctionCallResultString = {
  message: string;
  name: string;
  type: 'string';
};

export type FunctionCallPlaylistResult = {
  description: string;
  items: MusicSearchResult[];
  type: 'playlist';
};

export interface ToolHandler {
  name: string;
  execute(args: unknown): Promise<FunctionCallResult>;
}
