import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';

import { GEMINI_FLASH_LITE } from '../config';
import { PromptusRequest, RequestRole, StructuredResponse } from '../promptus.request';
import { ToolDeclaration } from '../tools/tool.type';
import { ChatTitleResponse } from '../response/chat-title.response';
import { chatTitlePrompt } from './chat-title.prompt';

/** One line of the transcript, already reduced to who spoke and what they said. */
export interface ChatTitleTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * The cheapest request in the project, and the one that runs most often.
 *
 * It fires beside every user turn, so all three knobs are set against that: `GEMINI_FLASH_LITE`
 * rather than Flash (four times the quota at a fraction of the cost), `ThinkingLevel.LOW` because
 * naming a conversation is recall rather than reasoning, and a structured response so the answer is
 * two fields instead of prose that would then need parsing out.
 *
 * Plain shape — instruction in `context`, no tools, no cache, no grounding. It never touches the
 * library and it must never be reachable as a tool: nothing a user types should be able to rename
 * their own conversation on demand.
 */
export class ChatTitleRequest extends PromptusRequest<ChatTitleResponse> {
  public tools: ToolDeclaration[] = [];
  public cache?: CachedContent = undefined;
  public history: Content[] = [];
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.LOW,
    },
  };

  private readonly _model = GEMINI_FLASH_LITE;
  private readonly _role: RequestRole = 'user';
  private readonly _context = chatTitlePrompt;
  private readonly _query: string;

  public readonly structuredResponse: StructuredResponse = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        rename: {
          type: 'BOOLEAN',
          description:
            'True when the current title no longer describes this conversation and should be replaced; false when it still fits. A placeholder such as "New chat" is always true.',
        },
        title: {
          type: 'STRING',
          description: 'The title the conversation should carry: the new one when `rename` is true, the current one unchanged when it is false.',
        },
      },
      propertyOrdering: ['rename', 'title'],
      required: ['rename', 'title'],
    },
  };

  get model(): string {
    return this._model;
  }

  get role(): RequestRole {
    return this._role;
  }

  get context(): string {
    return this._context;
  }

  get query(): string {
    return this._query;
  }

  constructor(currentTitle: string, turns: ChatTitleTurn[]) {
    super();
    this._query = ['# CURRENT TITLE', currentTitle || '(none)', '', '# CONVERSATION', ...turns.map((turn) => `${turn.role}: ${turn.text}`)].join(
      '\n',
    );
  }
}
