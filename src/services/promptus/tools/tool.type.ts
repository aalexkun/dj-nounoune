import { MusicSearchResult } from '../agent/disc-jockey/disc-jockey.agent';
import { PopulatedSong } from '../../music-db/music-db.service';

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
  items: PopulatedSong[];
  type: 'playlist';
};

export interface ToolHandler {
  name: string;
  execute(args: unknown, sessionId?: string): Promise<FunctionCallResult>;
}

export type NaturalLanguageRequest = {
  natural_language_request: string;
};

export const isNaturalLanguageRequest = (args: unknown): args is NaturalLanguageRequest => {
  if (!args || typeof args !== 'object') {
    return false;
  }

  const obj = args as Record<string, unknown>;

  return typeof obj.natural_language_request === 'string';
};
