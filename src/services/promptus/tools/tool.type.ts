import { Schema } from '@google/genai';
import { ChatContext } from '../../chat/chat-context';

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
  /**
   * The `playlist` envelope this result was published as, when the call ran inside a chat.
   * The queue watcher reconciles against it, republishing the same id at a higher `rev` as MPD
   * reshuffles underneath it.
   */
  messageId?: string;
};

export interface ToolHandler {
  name: string;
  /**
   * `ctx` is the widened `sessionId` this used to take. Most handlers ignore it entirely, and
   * TypeScript lets those keep implementing the interface with a shorter parameter list — only
   * the six that delegate to an agent had to change.
   */
  execute(args: unknown, ctx?: ChatContext): Promise<FunctionCallResult>;
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
