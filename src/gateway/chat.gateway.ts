import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { ZodType } from 'zod';

import { AuthService } from '../services/auth/auth.service';
import { SessionService } from '../services/session/session.service';
import { ChatService } from '../services/chat/chat.service';
import { ChatStreamService } from '../services/chat/chat-stream.service';
import { ChatActionService } from '../services/chat/chat-action.service';
import { FeedbackService } from '../services/feedback/feedback.service';
import { MpcStateService } from '../services/queue-state/mpc-state.service';
import { QueueMirrorService } from '../services/queue-state/queue-mirror.service';
import { PlaylistReconcilerService } from '../services/queue-state/playlist-reconciler.service';
import { QueueStateService } from '../services/queue-state/queue-state.service';
import { PlaylogService } from '../services/playlog/playlog.service';
import { sessionContext } from '../services/chat/chat-context';
import {
  ChatActionMessage,
  ChatActionRequestSchema,
  ChatBatchMessage,
  ChatEditMessage,
  ChatEditSchema,
  ChatEnvelope,
  ChatEventMessage,
  ChatFeedbackMessage,
  ChatFeedbackSchema,
  ChatRefreshMessage,
  ChatRefreshSchema,
  ChatResyncMessage,
  ChatResyncSchema,
  ChatSendMessage,
  ChatSendSchema,
  ChatSetVerbosityMessage,
  ChatSetVerbositySchema,
} from '../services/chat/protocol';
import { getErrorMessage } from '../utils/error.utils';

/** What an inbound frame is answered with. There is no success payload beyond `ok`. */
type Ack = { ok: boolean; error?: string };

const OK: Ack = { ok: true };

@WebSocketGateway({
  cors: true,
  pingInterval: 1000, // 10 seconds (Default is 25000)
  pingTimeout: 1000, // 5 seconds (Default is 20000)
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('ChatGateway');

  /**
   * One subscription for every session at once.
   *
   * Deliberately not one per socket: the fan-out is `ChatStreamService`'s `groupBy`, and a gateway
   * that only routes cannot reintroduce the per-channel bookkeeping this refactor removed.
   */
  private outbound?: Subscription;

  constructor(
    private readonly chatService: ChatService,
    private readonly chatStream: ChatStreamService,
    private readonly chatActions: ChatActionService,
    private readonly feedbackService: FeedbackService,
    private readonly mpcState: MpcStateService,
    private readonly queueMirror: QueueMirrorService,
    private readonly playlistReconciler: PlaylistReconcilerService,
    private readonly queueState: QueueStateService,
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly playlog: PlaylogService,
  ) {}

  /**
   * Connected sockets, counted for one reason: the disc jockey's commentary.
   *
   * `PlaylogService` will not spend a model call on a track nobody can see, and until this existed
   * its only notion of "somebody" was the /vibing-on page. A phone sitting on the Playing tab is
   * somebody. Socket ids rather than session ids, because two devices on one session are two
   * screens — and because this has to be decremented on a disconnect whose session survives it.
   */
  private readonly viewers = new Set<string>();

  onModuleInit(): void {
    this.outbound = this.chatStream.outbound$.subscribe(({ sessionId, envelope }) => {
      // Under `IS_CLI` the gateway was never bound and there is no server to reach a room on.
      if (!this.server?.sockets) return;

      this.server.to(sessionId).emit(ChatEventMessage, envelope);
    });
  }

  onModuleDestroy(): void {
    this.outbound?.unsubscribe();
  }

  /**
   * A credential from the handshake: the header first, then socket.io's `auth` bag. The bag is
   * typed as `any` by socket.io, so only a string is accepted out of it.
   */
  private credential(client: Socket, header: string, authKey: string): string | undefined {
    const fromHeader = client.handshake.headers[header];
    const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    if (headerValue) return headerValue;
    const fromAuth: unknown = client.handshake.auth[authKey];
    return typeof fromAuth === 'string' ? fromAuth : undefined;
  }

  async handleConnection(client: Socket) {
    const apiKey = this.credential(client, 'x-api-key', 'apiKey');
    const userId = this.credential(client, 'x-user-id', 'userId');

    if (!this.authService.validateApiKey(apiKey) || !userId) {
      this.logger.warn(`Unauthorised connection attempt from ${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const existing = await this.sessionService.retrieveUserSession(userId, client);
      const session = existing ?? (await this.sessionService.createSession(userId, client));

      if (!session) {
        this.logger.error('Error creating session');
        client.disconnect();
        return;
      }

      void client.join(session.id);
      session.status.next('active');

      // Opens the delivery gate. Anything emitted while this session was away is not replayed
      // here — the client asks for exactly what it is missing with `chat:resync`, which is the
      // only cursor that is right after a server restart or a fresh install too.
      this.chatStream.setConnection(session.id, 'active');

      this.logger.log(`${existing ? 'Reconnecting' : 'Creating'} session for ${userId} |${existing ? '=' : '+'}| ${session.id}`);

      await this.chatStream.emit(
        sessionContext(session.id),
        { type: 'system', event: 'session_resumed', text: 'Connected' },
        { role: 'system', level: 'debug' },
      );

      // Both are ephemeral, so there is nothing to replay — they are rebuilt from the queue
      // projection, which is why a reconnect never shows a stale transport or a stale queue. The
      // queue is here rather than in the timeline because MPD's queue is one global list owned by
      // the daemon, not by whichever conversation happened to fill it.
      await this.mpcState.openFor(session.id);
      await this.queueMirror.openFor(session.id);

      this.viewers.add(client.id);
      this.playlog.setViewerCount(this.viewers.size, 'chat');

      // The track may have started while nothing was watching, in which case it carries no
      // commentary yet. Not awaited and harmless to repeat: it returns early once one is there.
      this.playlog.enrichCurrentIfNeeded().catch((error: unknown) => {
        this.logger.warn(`Could not enrich for a joining client: ${getErrorMessage(error)}`);
      });
    } catch (error) {
      this.logger.error(`Error handling connection: ${getErrorMessage(error)}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const sessionId = this.sessionService.getSession(client.id)?.id;

    this.viewers.delete(client.id);
    this.playlog.setViewerCount(this.viewers.size, 'chat');

    // Closes the gate; nothing is buffered in memory while the client is away, because the durable
    // log already holds everything worth redelivering.
    if (sessionId) this.chatStream.setConnection(sessionId, 'disconnected');

    await this.sessionService.disconnected(client, (ended: string) => {
      this.mpcState.forget(ended);
      this.queueMirror.forget(ended);
      this.chatStream.endSession(ended);
    });
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // -----------------------------------------------------------------------------------------------
  // Inbound
  // -----------------------------------------------------------------------------------------------

  /**
   * Parses a frame and resolves the session behind the socket.
   *
   * Every inbound frame goes through a schema. The old gateway typed its `@MessageBody()` and never
   * checked it, which is an assertion rather than validation — a malformed frame walked straight
   * into `ChatService`.
   */
  private accept<T>(schema: ZodType<T>, payload: unknown, client: Socket, event: string): { sessionId: string; data: T } | Ack {
    const sessionId = this.sessionService.getSession(client.id)?.id;

    if (!sessionId) {
      this.logger.error(`No session for ${client.id} on ${event}`);
      return { ok: false, error: 'No session' };
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      this.logger.warn(`Discarded a malformed ${event} from ${client.id}: ${JSON.stringify(payload)}`);
      return { ok: false, error: 'Malformed payload' };
    }

    return { sessionId, data: parsed.data };
  }

  private static isAck<T>(result: { sessionId: string; data: T } | Ack): result is Ack {
    return 'ok' in result;
  }

  @SubscribeMessage(ChatSendMessage)
  handleSend(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Ack {
    const accepted = this.accept(ChatSendSchema, payload, client, ChatSendMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    const { sessionId, data } = accepted;

    // Not awaited: a turn runs for as long as the model takes, and the ack only says the frame was
    // accepted. Everything the turn produces arrives as envelopes.
    this.chatService
      .chat(sessionId, data.chatId, data.text, data.clientId)
      .catch((error: unknown) => this.logger.error(`Turn failed for ${sessionId}: ${getErrorMessage(error)}`));

    return OK;
  }

  /**
   * Defined and wired so the app can be built against it; not implemented.
   *
   * Editing needs the server to cancel an in-flight agent loop, mark its envelopes failed and emit
   * a fresh turn. `id`, `rev`, `state` and `supersededBy` are already on the wire, so adding it
   * later is not a protocol change.
   */
  @SubscribeMessage(ChatEditMessage)
  async handleEdit(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = this.accept(ChatEditSchema, payload, client, ChatEditMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    await this.chatStream.emit(
      { sessionId: accepted.sessionId, chatId: accepted.data.chatId, turnId: null },
      { type: 'error', code: 'not_implemented', message: 'Editing a message is not supported yet.', retryable: false },
      { role: 'system', state: 'failed' },
    );

    return { ok: false, error: 'not_implemented' };
  }

  @SubscribeMessage(ChatFeedbackMessage)
  handleFeedback(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Ack {
    const accepted = this.accept(ChatFeedbackSchema, payload, client, ChatFeedbackMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    this.feedbackService.record(accepted.data.feedback);
    return OK;
  }

  /** Backfill. The client passes the highest `seq` it holds and gets everything after it. */
  @SubscribeMessage(ChatResyncMessage)
  async handleResync(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = this.accept(ChatResyncSchema, payload, client, ChatResyncMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    try {
      const { chatId, sinceSeq, sinceUpdatedAt } = accepted.data;
      const envelopes = await this.chatStream.backlog(chatId, { sinceSeq, sinceUpdatedAt });
      client.emit(ChatBatchMessage, envelopes);
      this.logger.debug(`Resynced ${envelopes.length} envelope(s) to ${client.id} from seq ${sinceSeq} / rev time ${sinceUpdatedAt}`);
      return OK;
    } catch (error: unknown) {
      return { ok: false, error: getErrorMessage(error) };
    }
  }

  @SubscribeMessage(ChatActionMessage)
  async handleAction(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = this.accept(ChatActionRequestSchema, payload, client, ChatActionMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    const outcome = await this.chatActions.execute(accepted.data);

    if (outcome.ok) return OK;

    // A failure is the only thing worth an envelope; a success announces itself as the `rev` bump
    // on whatever the action changed.
    await this.chatStream.emit(
      { sessionId: accepted.sessionId, chatId: accepted.data.chatId ?? null, turnId: null },
      { type: 'error', code: outcome.code, message: outcome.message, retryable: outcome.retryable },
      { role: 'system', state: 'failed' },
    );

    return { ok: false, error: outcome.code };
  }

  /**
   * Re-reads MPD and answers with the live state, rather than with history.
   *
   * The client cannot wait for this to arrive on its own. Both mirrors are change-driven, and a
   * client that has fallen behind is usually looking at a queue that has not moved — so there is
   * nothing pending to publish and no amount of patience produces one.
   *
   * The envelopes also reach the room through the normal publish path, which makes this a
   * deliberate duplicate: the batch is the guarantee, the broadcast is the coincidence. Redelivery
   * costs one `rev` comparison on the device, which is the whole reason the protocol was built to
   * upsert on id in the first place.
   */
  @SubscribeMessage(ChatRefreshMessage)
  async handleRefresh(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = this.accept(ChatRefreshSchema, payload, client, ChatRefreshMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    const { sessionId, data } = accepted;

    try {
      // Now, not at the next tick. Answering a refresh out of a two-second-old projection would
      // reproduce in miniature exactly the staleness the client is asking to escape.
      const snapshot = await this.queueState.refresh();

      const envelopes = (
        await Promise.all([
          this.mpcState.openFor(sessionId),
          this.queueMirror.openFor(sessionId),
          // The conversation's own playlist message is a separate thing from the live queue: a
          // record of what was asked for, which the watcher keeps honest only while it stays bound.
          data.chatId && snapshot ? this.playlistReconciler.refreshChat(data.chatId, snapshot) : Promise.resolve(null),
        ])
      ).filter((envelope): envelope is ChatEnvelope => envelope !== null);

      client.emit(ChatBatchMessage, envelopes);
      this.logger.debug(`Refreshed ${envelopes.length} envelope(s) to ${client.id}`);
      return OK;
    } catch (error: unknown) {
      return { ok: false, error: getErrorMessage(error) };
    }
  }

  @SubscribeMessage(ChatSetVerbosityMessage)
  handleSetVerbosity(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Ack {
    const accepted = this.accept(ChatSetVerbositySchema, payload, client, ChatSetVerbosityMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    const effective = this.chatStream.setSessionVerbosity(accepted.sessionId, accepted.data.level);
    this.logger.log(`Session ${accepted.sessionId} verbosity → ${effective}`);
    return OK;
  }
}
