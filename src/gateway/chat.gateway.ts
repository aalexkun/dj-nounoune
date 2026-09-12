import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { ZodType } from 'zod';

import { AuthSessionService } from '../services/auth/auth-session.service';
import type { HandshakeIdentity } from '../services/auth/auth.types';
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

/**
 * What the handshake middleware leaves behind for the rest of the gateway.
 *
 * socket.io types `data` as `any`, so it is narrowed through this rather than read off the socket
 * directly — the whole connection path hangs off the identity being real.
 */
interface ChatSocketData {
  identity?: HandshakeIdentity;
}

/**
 * socket.io's own `next` takes its `ExtendedError`, which is `Error` with an optional `data`. Typed
 * as plain `Error` here so the middleware body needs no import out of the library's `dist`.
 */
type HandshakeNext = (err?: Error) => void;

/** A frame's `chatId`, when it names one. The four inbound schemas that carry it all spell it the same. */
function chatIdOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;

  const chatId: unknown = (data as { chatId?: unknown }).chatId;
  return typeof chatId === 'string' && chatId.length > 0 ? chatId : null;
}

/** The identity the handshake middleware stored, narrowed back out of socket.io's untyped bag. */
function socketIdentity(client: Socket): HandshakeIdentity | null {
  const data: unknown = client.data;
  if (typeof data !== 'object' || data === null) return null;

  const identity: unknown = (data as { identity?: unknown }).identity;
  if (typeof identity !== 'object' || identity === null) return null;

  const { user, deviceId, deviceName } = identity as Partial<HandshakeIdentity>;
  if (!user || typeof user.id !== 'string' || typeof deviceId !== 'string' || typeof deviceName !== 'string') return null;

  return { user, deviceId, deviceName };
}

@WebSocketGateway({
  cors: true,
  pingInterval: 1000, // 10 seconds (Default is 25000)
  pingTimeout: 1000, // 5 seconds (Default is 20000)
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
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
    private readonly authSessions: AuthSessionService,
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
   * Authorises the handshake before a socket is ever connected.
   *
   * A middleware rather than a check in `handleConnection` because it can **refuse with a reason**:
   * the client receives `connect_error` carrying `unauthorized`, which is the one failure it must
   * not retry — a dead session is told apart from a dead server, and the app drops to its login
   * screen instead of reconnecting forever against a token that will never work.
   *
   * `server.use` registers on the default namespace only, which is `io.of('/')`. `VibingGateway`
   * declares `namespace: '/vibing'` and is therefore untouched by this, which is the intent: the
   * public display stays open to the LAN.
   */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authoriseHandshake(socket, next);
    });
  }

  /**
   * The middleware body, kept out of the subscriber so `server.use`'s callback stays synchronous.
   *
   * `AuthSessionService.resolveHandshake` never throws: a `null` is the refusal, and it covers both
   * the new `auth: { token, deviceId, deviceName }` bag and the legacy headers while the shared key
   * is still configured.
   */
  private async authoriseHandshake(socket: Socket, next: HandshakeNext): Promise<void> {
    try {
      const identity = await this.authSessions.resolveHandshake(socket.handshake.auth, socket.handshake.headers);

      if (!identity) {
        this.logger.warn(`Refused an unauthorised handshake from ${socket.id}`);
        next(new Error('unauthorized'));
        return;
      }

      (socket.data as ChatSocketData).identity = identity;
      next();
    } catch (error: unknown) {
      // Belt and braces: `resolveHandshake` is documented not to throw, and a socket admitted
      // because it did would be an unauthenticated one.
      this.logger.error(`Handshake authorisation failed for ${socket.id}: ${getErrorMessage(error)}`);
      next(new Error('unauthorized'));
    }
  }

  async handleConnection(client: Socket) {
    const identity = socketIdentity(client);

    if (!identity) {
      // Unreachable through the middleware above, which refuses before a socket connects. Kept as
      // the defensive half: a socket that arrived here with no identity is not one to serve.
      this.logger.error(`Connection with no handshake identity from ${client.id}`);
      client.disconnect();
      return;
    }

    const userId = identity.user.id;

    try {
      const existing = await this.sessionService.retrieveUserSession(userId, identity.deviceId, client);
      const session =
        existing ?? (await this.sessionService.createSession(userId, { deviceId: identity.deviceId, deviceName: identity.deviceName }, client));

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

      this.logger.log(
        `${existing ? 'Reconnecting' : 'Creating'} session for ${userId} on ${identity.deviceName} |${existing ? '=' : '+'}| ${session.id}`,
      );

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
   * Parses a frame, resolves the session behind the socket, and refuses another user's chat.
   *
   * Every inbound frame goes through a schema. The old gateway typed its `@MessageBody()` and never
   * checked it, which is an assertion rather than validation — a malformed frame walked straight
   * into `ChatService`.
   *
   * The owner is checked here rather than in each handler, for the same reason the service filters
   * on `userId` in the query: a rule stated once per frame cannot be forgotten by the next frame
   * somebody adds. Any payload naming a `chatId` is checked; the ones that do not — a feedback
   * reaction, a verbosity change, a refresh of the transport bar — are session state and have no
   * owner to check.
   *
   * The user comes from the socket's handshake identity, never from the `Connection` document: the
   * session row is a record of a device, and it is the bearer token that says who is holding it.
   */
  private async accept<T>(
    schema: ZodType<T>,
    payload: unknown,
    client: Socket,
    event: string,
  ): Promise<{ sessionId: string; userId: string; data: T } | Ack> {
    const identity = socketIdentity(client);
    const sessionId = this.sessionService.getSession(client.id)?.id;

    if (!identity) {
      this.logger.warn(`No handshake identity for ${client.id} on ${event}`);
      return { ok: false, error: 'unauthorized' };
    }

    if (!sessionId) {
      this.logger.error(`No session for ${client.id} on ${event}`);
      return { ok: false, error: 'No session' };
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      this.logger.warn(`Discarded a malformed ${event} from ${client.id}: ${JSON.stringify(payload)}`);
      return { ok: false, error: 'Malformed payload' };
    }

    const userId = identity.user.id;
    const chatId = chatIdOf(parsed.data);

    if (chatId) {
      try {
        await this.chatService.assertOwned(chatId, userId);
      } catch {
        // Answered the same way whether the chat is missing or simply somebody else's, which is the
        // point: an ack that distinguished them would confirm the id names a real conversation.
        this.logger.warn(`Refused ${event} on chat ${chatId} for ${userId}`);
        return { ok: false, error: 'not_found' };
      }
    }

    return { sessionId, userId, data: parsed.data };
  }

  private static isAck<T>(result: { sessionId: string; userId: string; data: T } | Ack): result is Ack {
    return 'ok' in result;
  }

  @SubscribeMessage(ChatSendMessage)
  async handleSend(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = await this.accept(ChatSendSchema, payload, client, ChatSendMessage);
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
    const accepted = await this.accept(ChatEditSchema, payload, client, ChatEditMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    await this.chatStream.emit(
      { sessionId: accepted.sessionId, chatId: accepted.data.chatId, turnId: null },
      { type: 'error', code: 'not_implemented', message: 'Editing a message is not supported yet.', retryable: false },
      { role: 'system', state: 'failed' },
    );

    return { ok: false, error: 'not_implemented' };
  }

  @SubscribeMessage(ChatFeedbackMessage)
  async handleFeedback(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = await this.accept(ChatFeedbackSchema, payload, client, ChatFeedbackMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    this.feedbackService.record(accepted.data.feedback);
    return OK;
  }

  /** Backfill. The client passes the highest `seq` it holds and gets everything after it. */
  @SubscribeMessage(ChatResyncMessage)
  async handleResync(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = await this.accept(ChatResyncSchema, payload, client, ChatResyncMessage);
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
    const accepted = await this.accept(ChatActionRequestSchema, payload, client, ChatActionMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    // The user goes down with the request: an action names a `messageId`, and a frame that carries
    // no `chatId` can still resolve to an envelope inside somebody else's conversation. `accept`
    // could not have checked that one — only the envelope knows which chat it belongs to.
    const outcome = await this.chatActions.execute(accepted.data, accepted.userId);

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
    const accepted = await this.accept(ChatRefreshSchema, payload, client, ChatRefreshMessage);
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
  async handleSetVerbosity(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<Ack> {
    const accepted = await this.accept(ChatSetVerbositySchema, payload, client, ChatSetVerbosityMessage);
    if (ChatGateway.isAck(accepted)) return accepted;

    const effective = this.chatStream.setSessionVerbosity(accepted.sessionId, accepted.data.level);
    this.logger.log(`Session ${accepted.sessionId} verbosity → ${effective}`);
    return OK;
  }
}
