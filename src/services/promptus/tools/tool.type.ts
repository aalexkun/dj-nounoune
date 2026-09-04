import { Schema } from '@google/genai';

/** A Gemini function declaration; `parameters` is the API's own JSON-schema shape. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Schema;
}

export type FunctionCallResult = FunctionCallResultString | FunctionCallCacheResult;

export type FunctionCallResultString = {
  message: string;
  name: string;
  type: 'string';
};

export type FunctionCallCacheResult = {
  description: string;
  cache: string;
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
