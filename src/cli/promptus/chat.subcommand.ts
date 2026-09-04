import { Injectable, Logger } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PromptusService } from '../../services/promptus/promptus.service';
import { ChatPromptusRequest } from '../../services/promptus/request/chat.promptus.request';
import { ChatEvent, ChatMessageResponseEventName, ChatStatusResponseEventName } from '../../services/chat/chat.event';
import { getErrorMessage } from '../../utils/error.utils';

interface ChatOptions {
  message?: string;
  session?: string;
  showTools?: boolean;
  json?: boolean;
  quiet?: boolean;
}

/**
 * One turn of the real chat agent, without a websocket.
 *
 * This is the same `ChatPromptusRequest` the gateway builds, run through the same
 * `PromptusService.generate` loop, so what it exercises is the live wiring: the system prompt, the
 * tool declarations the request carries, the model's choice between them, and the handlers behind
 * them. It is how you find out whether a prompt change actually moves the model onto the tool you
 * meant it to use.
 *
 * A session id is passed even though nothing is listening on a socket: that is what makes the agent
 * loop emit its progress events, and the id is threaded down into the nested agents, so the trace
 * printed here covers the sub-agents too rather than only the top-level calls.
 */
@SubCommand({
  name: 'chat',
  description: 'Run one chat turn against the live agent and print the tools it called',
})
@Injectable()
export class PromptusChatSubcommand extends CommandRunner {
  private readonly logger = new Logger(PromptusChatSubcommand.name);

  constructor(
    private promptusService: PromptusService,
    private eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async run(passedParams: string[], options: ChatOptions = {}): Promise<void> {
    // Free-form arguments are the message, so both of these work:
    //   promptus chat "Search for the artist Spice and album 10"
    //   promptus chat --message "Search for the artist Spice and album 10"
    const message = options.message ?? passedParams.join(' ').trim();

    if (!message) {
      this.logger.error('A message is required. Pass it as an argument or with --message.');
      return;
    }

    // History starts empty: a one-shot turn is what makes a run reproducible.
    const request = new ChatPromptusRequest(message, []);

    if (options.showTools) {
      this.logger.log(`${request.tools.length} tool(s) declared to the model:`);
      for (const tool of request.tools) {
        console.log(`  ${tool.name}`);
      }
    }

    const sessionId = options.session ?? `cli-${Date.now()}`;
    const stopTrace = options.quiet ? () => undefined : this.traceProgress(sessionId);

    this.logger.log(`> ${message}`);

    try {
      const response = await this.promptusService.generate(request, sessionId);

      if (options.json) {
        console.log(JSON.stringify(response.raw, null, 2));
        return;
      }

      console.log('');
      console.log(response.text ?? '(the model answered with no text)');
    } catch (error) {
      // The thinking loop throws once it runs out of iterations, which is the failure worth seeing
      // here: it usually means a tool kept answering in a way that invited another attempt.
      this.logger.error(`Chat turn failed: ${getErrorMessage(error)}`);
    } finally {
      stopTrace();
    }
  }

  /**
   * Mirrors the agent's progress events to the terminal, the way the gateway relays them to the
   * browser. Returns the unsubscribe, so a second invocation in the same process does not print
   * every turn twice.
   */
  private traceProgress(sessionId: string): () => void {
    const onStatus = (event: ChatEvent): void => {
      if (event.sessionId === sessionId) {
        console.log(`  [status] ${event.message}`);
      }
    };

    const onMessage = (event: ChatEvent): void => {
      if (event.sessionId === sessionId) {
        console.log(`  [tool]   ${event.message}`);
      }
    };

    this.eventEmitter.on(ChatStatusResponseEventName, onStatus);
    this.eventEmitter.on(ChatMessageResponseEventName, onMessage);

    return () => {
      this.eventEmitter.off(ChatStatusResponseEventName, onStatus);
      this.eventEmitter.off(ChatMessageResponseEventName, onMessage);
    };
  }

  @Option({
    flags: '-m, --message <message>',
    description: 'The message to send (defaults to the free-form arguments)',
  })
  parseMessage(val: string): string {
    return val;
  }

  @Option({
    flags: '-s, --session <session>',
    description: 'Session id the progress events are tagged with (defaults to a generated one)',
  })
  parseSession(val: string): string {
    return val;
  }

  @Option({
    flags: '--show-tools',
    description: 'List the tool declarations the request carries before sending it',
    defaultValue: false,
  })
  parseShowTools(): boolean {
    return true;
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
    flags: '-j, --json',
    description: 'Print the raw Gemini response instead of the answer text',
    defaultValue: false,
  })
  parseJson(): boolean {
    return true;
  }
}
