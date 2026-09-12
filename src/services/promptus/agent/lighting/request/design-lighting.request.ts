import { CachedContent, Content, GenerateContentConfig, ThinkingLevel } from '@google/genai';
import { GEMINI_FLASH } from '../../../config';
import { PromptusRequest, RequestRole, StructuredResponse } from '../../../promptus.request';
import { ToolDeclaration } from '../../../tools/tool.type';
import { HueToolsDefinition } from '../../../tools/definition/hue-tools.definition';
import { DesignLightingResponse } from '../response/design-lighting.response';
import { designLightingPrompt } from './design-lighting.prompt';
import { LightingBrief, renderCurrentState, renderMemory, renderRooms, renderScenes } from '../lighting-brief.util';

/**
 * One lighting request: "make the living room cosy", "too bright", "movie night".
 *
 * Tool-bearing shape on Flash at `ThinkingLevel.HIGH`. High rather than medium because the job
 * is a small design problem, not a lookup: which room, which of eleven lamps, what layer each
 * plays, what the household said last time — and one wrong guess lights the bedroom at midnight.
 * No structured response: the answer is prose for the user and the work is in the tool calls.
 *
 * The instruction is constant and lives in `context`. Everything that changes per request — the
 * room map, the live state, the saved scenes, the memory — travels in the query, in that order,
 * with the request itself last so it is the freshest thing the model reads.
 */
export class DesignLightingRequest extends PromptusRequest<DesignLightingResponse> {
  public tools: ToolDeclaration[] = [
    HueToolsDefinition.applyLighting,
    HueToolsDefinition.saveScene,
    HueToolsDefinition.applyScene,
    HueToolsDefinition.readLights,
  ];
  public structuredResponse?: StructuredResponse = undefined;
  public cache?: CachedContent = undefined;
  public history: Content[] = [];
  public config: Partial<GenerateContentConfig> = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
    },
  };

  private readonly _model = GEMINI_FLASH;
  private readonly _role: RequestRole = 'user';
  private readonly _context = designLightingPrompt;
  private readonly _query: string;

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

  constructor(naturalLanguageRequest: string, brief: LightingBrief) {
    super();
    this._query = [
      '# ROOM MAP',
      renderRooms(brief.rooms),
      '',
      '# CURRENT STATE',
      renderCurrentState(brief.lights),
      '',
      '# SAVED SCENES',
      renderScenes(brief.scenes),
      '',
      '# WHAT THE HOUSEHOLD HAS TAUGHT YOU',
      renderMemory(brief.memory),
      '',
      `# NOW: ${new Date().toISOString()}`,
      '',
      '# REQUEST',
      naturalLanguageRequest.trim(),
    ].join('\n');
  }
}
