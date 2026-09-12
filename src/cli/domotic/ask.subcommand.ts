import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ToolsService } from '../../services/promptus/tools.service';
import { ChatEnvelopeEvent, ChatEnvelopeEventName } from '../../services/chat/chat-stream.event';
import { ChatContext, newId } from '../../services/chat/chat-context';
import { getErrorMessage } from '../../utils/error.utils';

interface AskOptions {
  quiet?: boolean;
  brief?: boolean;
}

/**
 * One request to the lighting designer, without the chat in front of it.
 *
 * Runs the same `LightingAgent.design` the `lighting_designer` tool runs, so what it exercises is
 * the live wiring: the brief, the prompt, the Hue tools and the memory rewrite. The lights really
 * change. A `ChatContext` is passed so the tool trace prints, as `promptus chat` does.
 */
@SubCommand({
  name: 'ask',
  description: 'Ask the lighting designer agent for a lighting change, e.g. "make the living room cosy"',
  arguments: '<request...>',
})
@Injectable()
export class DomoticAskSubCommand extends CommandRunner {
  private readonly logger = new Logger(DomoticAskSubCommand.name);

  constructor(
    private readonly toolsService: ToolsService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async run(inputs: string[], options: AskOptions): Promise<void> {
    const request = inputs.join(' ').trim();

    if (!request) {
      this.logger.error('Say what you want the lights to do, e.g. domotic ask "dim the bedroom for reading".');
      return;
    }

    const agent = this.toolsService.getLightingAgent();

    if (!agent) {
      this.logger.error('The lighting designer is not available (is GENAI_API_KEY set?).');
      return;
    }

    if (options.brief) {
      const brief = await agent.brief();
      console.log(JSON.stringify({ rooms: brief.rooms, scenes: brief.scenes, memory: brief.memory, lights: brief.lights }, null, 2));
      return;
    }

    const sessionId = `cli-${Date.now()}`;
    const ctx: ChatContext = { sessionId, chatId: null, turnId: newId() };
    const stopTrace = options.quiet ? () => undefined : this.traceProgress(sessionId);

    this.logger.log(`> ${request}`);

    try {
      const response = await agent.design(request, ctx);

      console.log('');
      console.log(response.text ?? '(the designer answered with no text)');

      // The notebook rewrite runs beside the answer; here nothing else keeps the app open for it.
      await agent.settled();
    } catch (error) {
      this.logger.error(`Lighting request failed: ${getErrorMessage(error)}`);
    } finally {
      stopTrace();
    }
  }

  private traceProgress(sessionId: string): () => void {
    const onEnvelope = (event: ChatEnvelopeEvent): void => {
      if (event.sessionId !== sessionId) return;

      const { payload } = event.envelope;
      const label = payload.type === 'tool_call' ? 'tool' : payload.type === 'thread' ? 'agent' : payload.type;
      console.log(`  [${label.padEnd(11)}] ${event.envelope.copyText}`);
    };

    this.eventEmitter.on(ChatEnvelopeEventName, onEnvelope);

    return () => {
      this.eventEmitter.off(ChatEnvelopeEventName, onEnvelope);
    };
  }

  @Option({
    flags: '-q, --quiet',
    description: 'Print only the final answer, without the tool trace',
    defaultValue: false,
  })
  parseQuiet(): boolean {
    return true;
  }

  @Option({
    flags: '-b, --brief',
    description: 'Print the brief the designer would be given (rooms, state, scenes, memory) and stop',
    defaultValue: false,
  })
  parseBrief(): boolean {
    return true;
  }
}
