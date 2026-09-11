import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EMPTY, Observable, Subject, Subscription, catchError, filter, fromEventPattern, groupBy, mergeMap, share, switchMap, takeUntil } from 'rxjs';

import { Chat, ChatDocument } from '../../schemas/chat.schema';
import { ChatEnvelopeDoc, ChatEnvelopeDocument } from '../../schemas/chat-envelope.schema';
import { SessionId, SessionStatus } from '../session/session.service';
import { getErrorMessage } from '../../utils/error.utils';
import { ChatContext, childContext, newId } from './chat-context';
import { ChatDelivery, ChatEnvelopeEvent, ChatEnvelopeEventName } from './chat-stream.event';
import {
  ChatAction,
  ChatEnvelope,
  ChatPayload,
  ChatRole,
  ChatState,
  PROTOCOL_VERSION,
  Verbosity,
  VerbositySchema,
  copyTextFor,
  defaultActionsFor,
  isPersistable,
  withinVerbosity,
} from './protocol';

/**
 * How far along a client already is, in both of the dimensions an envelope can move in.
 *
 * `sinceSeq` is exclusive and orders; `sinceUpdatedAt` is exclusive and versions. Neither implies
 * the other, which is the whole reason both are here.
 */
export type BacklogCursor = {
  sinceSeq?: number;
  sinceUpdatedAt?: number;
};

/** Overrides a caller can set on one envelope. Everything else is derived. */
export type EmitOptions = {
  role?: ChatRole;
  state?: ChatState;
  level?: Verbosity;
  actions?: ChatAction[];
  clientId?: string;
  /** Overrides the derived `copyText`. Rarely needed — the derivation is usually right. */
  copyText?: string;
};

/**
 * Everything the app says, from the event bus to the socket.
 *
 * The old fan-out was a hand-maintained `Map<ChannelName, Subject>` beside a parallel
 * `Map<ChannelName, Subscription>`, kept in step by a string array of channel suffixes. All three
 * of the defects this refactor absorbs were bookkeeping slips against that pair: a subject
 * registered under a fourth suffix the sweep array could not contain (it needed an
 * `as ChannelName` cast to be written at all), an emitter name that no listener matched, and
 * messages dropped whenever a client was away.
 *
 * So the fix is not a longer array. `groupBy` maintains the per-session partition and its
 * `duration` selector tears it down, which makes that class of leak structurally impossible:
 * there is no map here to forget an entry in.
 */
@Injectable()
export class ChatStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatStreamService.name);
  private readonly subscriptions = new Subscription();

  /**
   * The one bridge from the app's event bus into the stream world. Everything past this point is
   * operators; nothing downstream touches the emitter again.
   */
  private readonly envelopes$ = fromEventPattern<ChatEnvelopeEvent>(
    (handler) => this.eventEmitter.on(ChatEnvelopeEventName, handler),
    (handler) => this.eventEmitter.off(ChatEnvelopeEventName, handler),
  ).pipe(share());

  /** Connection transitions, pushed by the gateway. `deliver` filters this by session. */
  private readonly connections = new Subject<{ sessionId: SessionId; status: SessionStatus }>();

  /** Fires once per session when it is finally gone, which is what closes its `groupBy` group. */
  private readonly sessionEnds = new Subject<SessionId>();

  private readonly outbound = new Subject<ChatDelivery>();

  /**
   * What the gateway subscribes to, once, for every session at once.
   *
   * Deliberately not a subscription per socket: the fan-out belongs in the pipeline, and a gateway
   * that only routes cannot reintroduce the bookkeeping this replaced.
   */
  readonly outbound$: Observable<ChatDelivery> = this.outbound.asObservable();

  /**
   * Current connection state per session.
   *
   * A map of plain enum values — a fact about the world that the socket lifecycle makes inherently
   * imperative — not a map of subjects and subscriptions of our own making. That distinction is
   * the whole point: this one is read in a single place and cleared in a single place.
   */
  private readonly connectionState = new Map<SessionId, SessionStatus>();

  /** Per-session render ceiling from `chat:set_verbosity`, clamped by the server ceiling. */
  private readonly sessionVerbosity = new Map<SessionId, Verbosity>();

  /**
   * The latest revision of every session-scoped envelope, because those are never written to Mongo
   * and `update` still has to read the current one. Bounded by the number of live sessions.
   */
  private readonly ephemeral = new Map<string, { sessionId: SessionId; envelope: ChatEnvelope }>();

  /** Sequence counter for session-scoped envelopes, which have no chat document to count on. */
  private readonly sessionSeq = new Map<SessionId, number>();

  /** Nothing above this is emitted at all, so it is never persisted and never reaches a client. */
  private readonly ceiling: Verbosity;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    @InjectModel(ChatEnvelopeDoc.name) private readonly envelopeModel: Model<ChatEnvelopeDocument>,
    @InjectModel(Chat.name) private readonly chatModel: Model<ChatDocument>,
  ) {
    const configured = VerbositySchema.safeParse(this.configService.get<string>('CHAT_VERBOSITY'));
    this.ceiling = configured.success ? configured.data : 'info';
  }

  onModuleInit(): void {
    this.subscriptions.add(
      this.envelopes$
        .pipe(
          // The per-session partition, and its teardown, in one operator. When `sessionEnds` fires
          // the group completes, its inner subscription unsubscribes, and `groupBy` drops the key
          // from its own internal map.
          groupBy((event) => event.sessionId, { duration: (group) => this.sessionEnded$(group.key) }),
          mergeMap((session$) => this.deliver(session$, session$.key)),
        )
        .subscribe({
          next: (delivery) => this.outbound.next(delivery),
          // The sharp edge of a stream-shaped design: one unhandled throw here would complete the
          // outer subscription and silence every session for the life of the process. `deliver`
          // already catches per session; this is the backstop that says so out loud.
          error: (error: unknown) => this.logger.error(`Chat delivery pipeline stopped: ${getErrorMessage(error)}`),
        }),
    );
  }

  onModuleDestroy(): void {
    this.subscriptions.unsubscribe();
    this.outbound.complete();
    this.connections.complete();
    this.sessionEnds.complete();
  }

  /**
   * One session's delivery.
   *
   * Nothing is buffered in memory while a client is away — the durable log already holds it, and
   * the client asks for what it missed with `chat:resync` once it is back. That is strictly
   * stronger than the `delayWhen` gate it replaces, which held emissions in memory (so a server
   * restart lost them), delayed each one independently (so ordering was not guaranteed when the
   * gate opened), and only ever covered the final answer because agents emitted past it.
   *
   * There is no dedup operator here on purpose. Redelivery is already a no-op: the client applies
   * an envelope only when its `rev` is higher than what it holds, so idempotency lives on the side
   * that actually knows what it has.
   */
  private deliver(session$: Observable<ChatEnvelopeEvent>, sessionId: SessionId): Observable<ChatDelivery> {
    return this.connection$(sessionId).pipe(
      switchMap((status) => (status === 'active' ? session$ : EMPTY)),
      filter((event) => withinVerbosity(event.envelope.level, this.verbosityFor(sessionId))),
      takeUntil(this.sessionEnded$(sessionId)),
      catchError((error: unknown) => {
        this.logger.error(`Delivery failed for session ${sessionId}: ${getErrorMessage(error)}`);
        return EMPTY;
      }),
    );
  }

  private connection$(sessionId: SessionId): Observable<SessionStatus> {
    return new Observable<SessionStatus>((subscriber) => {
      subscriber.next(this.connectionState.get(sessionId) ?? 'disconnected');

      return this.connections
        .pipe(
          filter((change) => change.sessionId === sessionId),
          takeUntil(this.sessionEnded$(sessionId)),
        )
        .subscribe((change) => subscriber.next(change.status));
    });
  }

  private sessionEnded$(sessionId: SessionId): Observable<SessionId> {
    return this.sessionEnds.pipe(filter((ended) => ended === sessionId));
  }

  // ---------------------------------------------------------------------------------------------
  // Session lifecycle, driven by the gateway
  // ---------------------------------------------------------------------------------------------

  setConnection(sessionId: SessionId, status: SessionStatus): void {
    this.connectionState.set(sessionId, status);
    this.connections.next({ sessionId, status });
  }

  /** Closes the session's group and releases everything keyed on it. */
  endSession(sessionId: SessionId): void {
    this.connectionState.delete(sessionId);
    this.sessionVerbosity.delete(sessionId);
    this.sessionSeq.delete(sessionId);

    for (const [id, held] of this.ephemeral) {
      if (held.sessionId === sessionId) this.ephemeral.delete(id);
    }

    this.sessionEnds.next(sessionId);
  }

  /** Clamped by the server ceiling: a client cannot ask for more than the deploy allows. */
  setSessionVerbosity(sessionId: SessionId, level: Verbosity): Verbosity {
    const effective = withinVerbosity(level, this.ceiling) ? level : this.ceiling;
    this.sessionVerbosity.set(sessionId, effective);
    return effective;
  }

  private verbosityFor(sessionId: SessionId): Verbosity {
    return this.sessionVerbosity.get(sessionId) ?? 'info';
  }

  // ---------------------------------------------------------------------------------------------
  // Emitting
  // ---------------------------------------------------------------------------------------------

  /**
   * Build, persist and publish one envelope.
   *
   * Persistence happens here rather than in the pipeline so that a caller holds a durable envelope
   * the moment this resolves — which is what makes `update` safe to read back, and what stops a
   * reconcile racing a write that has not landed yet.
   */
  async emit(ctx: ChatContext, payload: ChatPayload, options: EmitOptions = {}): Promise<ChatEnvelope | null> {
    const level = options.level ?? 'info';
    const role = options.role ?? 'assistant';

    // Above the deploy's ceiling nothing is built, stored or sent. Cheapest possible filter.
    if (!withinVerbosity(level, this.ceiling)) return null;

    const now = Date.now();
    const envelope: ChatEnvelope = {
      v: PROTOCOL_VERSION,
      id: newId(),
      rev: 0,
      seq: await this.nextSeq(ctx),
      chatId: ctx.chatId,
      turnId: ctx.turnId,
      parentId: ctx.parentId ?? null,
      clientId: options.clientId,
      supersededBy: null,
      role,
      state: options.state ?? 'complete',
      level,
      createdAt: now,
      updatedAt: now,
      copyText: options.copyText ?? copyTextFor(payload),
      // Every message gets a menu, because copying is an action here rather than a text
      // selection — the two are the same gesture and cannot share a bubble.
      actions: options.actions ?? defaultActionsFor(payload, role),
      payload,
    };

    await this.store(ctx.sessionId, envelope);
    this.publish(ctx.sessionId, envelope);
    return envelope;
  }

  /**
   * Republish an existing envelope at a higher `rev`.
   *
   * The whole update story, and the only one: streaming text, a thought resolving from "searching"
   * to "found 24 songs", a playlist row whose source changed under a negentropy swap, and one day
   * an edited message are all this operation.
   */
  async update(envelopeId: string, mutate: (envelope: ChatEnvelope) => ChatEnvelope): Promise<ChatEnvelope | null> {
    const held = this.ephemeral.get(envelopeId);

    if (held) {
      const next = { ...mutate(held.envelope), rev: held.envelope.rev + 1, updatedAt: Date.now() };
      this.ephemeral.set(envelopeId, { sessionId: held.sessionId, envelope: next });
      this.publish(held.sessionId, next);
      return next;
    }

    const doc = await this.envelopeModel.findOne({ envelopeId }).exec();
    if (!doc) {
      this.logger.warn(`Cannot update unknown envelope ${envelopeId}`);
      return null;
    }

    const sessionId = doc.sessionId;
    const next = { ...mutate(toEnvelope(doc)), rev: doc.rev + 1, updatedAt: Date.now() };

    await this.envelopeModel.updateOne({ envelopeId }, { $set: toDoc(next) }).exec();

    // A persisted envelope is not tied to one connection: whoever is on that chat should see it.
    this.publishToChat(sessionId, next);
    return next;
  }

  /**
   * Open a sub-thread and return the context its children hang off.
   *
   * The one grouping mechanism in the protocol. Nested agents — chat to disc jockey to query
   * database, three deep here — nest for free, because this hands back the context that then gets
   * threaded down through `generate` and `execute`.
   */
  async openThread(ctx: ChatContext, label: string, agent?: string): Promise<ChatContext> {
    const envelope = await this.emit(
      ctx,
      { type: 'thread', label, agent, childCount: 0, collapsedByDefault: true },
      { role: 'agent', state: 'pending' },
    );

    // Above the ceiling: the children will be dropped too, so the parent context is unchanged.
    if (!envelope) return ctx;

    return childContext(ctx, envelope.id);
  }

  /** Resolve a thread: same id, higher rev, `complete`, with the summary the collapsed row shows. */
  async closeThread(ctx: ChatContext, summary?: string, childCount?: number): Promise<void> {
    if (!ctx.parentId) return;

    await this.update(ctx.parentId, (envelope) => {
      if (envelope.payload.type !== 'thread') return envelope;

      const payload = {
        ...envelope.payload,
        summary: summary ?? envelope.payload.summary,
        childCount: childCount ?? envelope.payload.childCount,
      };

      return { ...envelope, state: 'complete' as const, payload, copyText: copyTextFor(payload) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------------

  /**
   * What a client missed, from the cursor it says it holds. Feeds `chat:resync` and the REST route.
   *
   * **Two cursors, because there are two ways to fall behind.** `seq` covers what was said while
   * the client was away. It cannot cover what *changed* while the client was away: a revision keeps
   * its `seq` and only bumps `rev`, so a `seq` cursor is structurally blind to exactly the
   * envelopes most likely to be stale — the playlist the queue watcher has been reconciling all
   * along, an answer that finished streaming after the screen went dark, a thread that resolved.
   * `revisedAt` covers those, and the client sends the highest it holds of each.
   *
   * The overlap between the two is free: the client applies an envelope only when `rev` is higher
   * than what it holds, so a message returned by both arms costs one comparison.
   *
   * A caller that passes no `sinceUpdatedAt` gets the old `seq`-only behaviour rather than the whole
   * timeline — `revisedAt > 0` would match every document ever written.
   */
  async backlog(chatId: string, cursor: BacklogCursor = {}, limit = 500): Promise<ChatEnvelope[]> {
    const sinceSeq = cursor.sinceSeq ?? 0;
    const sinceUpdatedAt = cursor.sinceUpdatedAt ?? 0;

    const filter =
      sinceUpdatedAt > 0 ? { chatId, $or: [{ seq: { $gt: sinceSeq } }, { revisedAt: { $gt: sinceUpdatedAt } }] } : { chatId, seq: { $gt: sinceSeq } };

    const docs = await this.envelopeModel.find(filter).sort({ seq: 1 }).limit(limit).exec();

    return docs.map(toEnvelope);
  }

  async findById(envelopeId: string): Promise<ChatEnvelope | null> {
    const held = this.ephemeral.get(envelopeId);
    if (held) return held.envelope;

    const doc = await this.envelopeModel.findOne({ envelopeId }).exec();
    return doc ? toEnvelope(doc) : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private publish(sessionId: SessionId, envelope: ChatEnvelope): void {
    this.eventEmitter.emit(ChatEnvelopeEventName, new ChatEnvelopeEvent(sessionId, envelope));
  }

  /**
   * A revision of a chat-scoped envelope, to whoever is actually listening.
   *
   * The stored `sessionId` is a **hint, not an address**. It names the session that first produced
   * the envelope, and the tempting reading — send the revision back where it came from — is wrong
   * for everything the queue watcher touches: MPD state is owned by no session, and a session is
   * mortal. A phone that closed for more than the five minute grace comes back under a fresh
   * `randomUUID()`, so every playlist reconcile after that was addressed to a session id nothing
   * would ever answer to again, and `deliver` dropped it on the floor. Permanently, and silently.
   *
   * So the hint is used only while that session is still active, and otherwise this falls back to
   * every live session. The cost of the fallback is a session receiving an envelope for a chat it
   * is not looking at, which the client already filters out when it builds a timeline.
   */
  private publishToChat(sessionId: string | undefined, envelope: ChatEnvelope): void {
    if (sessionId && this.connectionState.get(sessionId) === 'active') {
      this.publish(sessionId, envelope);
      return;
    }

    for (const session of this.connectionState.keys()) {
      this.publish(session, envelope);
    }
  }

  private async store(sessionId: SessionId, envelope: ChatEnvelope): Promise<void> {
    // Session-scoped and diagnostic envelopes are live state, not history. The transport bar is
    // regenerated from Redis on every reconnect, and a debugging session should not permanently
    // fatten a chat.
    if (!isPersistable(envelope)) {
      this.ephemeral.set(envelope.id, { sessionId, envelope });
      return;
    }

    try {
      await this.envelopeModel.create({ ...toDoc(envelope), sessionId });
    } catch (error: unknown) {
      // A failed write must not take the pipeline down with it — the message still reaches the
      // client, it simply will not come back on a resync.
      this.logger.error(`Could not persist envelope ${envelope.id}: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Ordering, allocated where it can be made atomic.
   *
   * A chat counts on its own document, so the counter is durable alongside the data the
   * `{ chatId, seq }` unique index protects — a Redis counter would restart at one after a flush
   * and collide. Session-scoped envelopes are never stored, so an in-memory counter is enough.
   */
  private async nextSeq(ctx: ChatContext): Promise<number> {
    if (!ctx.chatId) {
      const next = (this.sessionSeq.get(ctx.sessionId) ?? 0) + 1;
      this.sessionSeq.set(ctx.sessionId, next);
      return next;
    }

    try {
      const updated = await this.chatModel
        .findOneAndUpdate({ _id: new Types.ObjectId(ctx.chatId) }, { $inc: { seqCounter: 1 } }, { new: true, projection: { seqCounter: 1 } })
        .exec();

      if (updated) return updated.seqCounter;
    } catch (error: unknown) {
      this.logger.error(`Could not allocate a seq for chat ${ctx.chatId}: ${getErrorMessage(error)}`);
    }

    // The chat is gone or Mongo refused. A clock-based fallback keeps ordering monotonic for the
    // client rather than restarting at one and colliding with what is already stored.
    return Date.now();
  }
}

/** Mongo document → wire envelope. */
function toEnvelope(doc: ChatEnvelopeDocument): ChatEnvelope {
  return {
    v: PROTOCOL_VERSION,
    id: doc.envelopeId,
    rev: doc.rev,
    seq: doc.seq,
    chatId: doc.chatId,
    turnId: doc.turnId,
    parentId: doc.parentId,
    clientId: doc.clientId,
    supersededBy: doc.supersededBy,
    role: doc.role,
    state: doc.state,
    level: doc.level,
    createdAt: doc.sentAt,
    updatedAt: doc.revisedAt,
    copyText: doc.copyText,
    actions: doc.actions,
    payload: doc.payload,
  };
}

/** Wire envelope → Mongo document. `chatId` is non-null here: only persistable envelopes reach it. */
function toDoc(envelope: ChatEnvelope): Omit<ChatEnvelopeDoc, 'chatId'> & { chatId: string } {
  return {
    envelopeId: envelope.id,
    rev: envelope.rev,
    seq: envelope.seq,
    chatId: envelope.chatId ?? '',
    turnId: envelope.turnId,
    parentId: envelope.parentId,
    clientId: envelope.clientId,
    supersededBy: envelope.supersededBy,
    role: envelope.role,
    state: envelope.state,
    level: envelope.level,
    sentAt: envelope.createdAt,
    revisedAt: envelope.updatedAt,
    copyText: envelope.copyText,
    actions: envelope.actions,
    payload: envelope.payload,
  };
}
