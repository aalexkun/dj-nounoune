import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { z } from 'zod';
import { PlaylogService } from '../services/playlog/playlog.service';
import {
  NowPlayingCommentaryEvent,
  NowPlayingCommentaryEventName,
  NowPlayingCoverEvent,
  NowPlayingCoverEventName,
  NowPlayingEvent,
  NowPlayingEventName,
} from '../services/playlog/now-playing.event';
import { getErrorMessage } from '../utils/error.utils';
import { MpdClientService } from '../services/mpd-client/mpd-client.service';
import { NextMpdRequest } from '../services/mpd-client/requests/NextMpdRequest';
import { PreviousMpdRequest } from '../services/mpd-client/requests/PreviousMpdRequest';
import { PlayMpdRequest } from '../services/mpd-client/requests/PlayMpdRequest';
import { StopMpdRequest } from '../services/mpd-client/requests/StopMpdRequest';
import {
  VibingControlAction,
  VibingControlMessage,
  VibingControlResult,
  VibingControlSchema,
  VibingPlaybackMessage,
  VibingPlaybackState,
  VibingReactionBroadcastMessage,
  VibingReactionMessage,
  VibingReactionSchema,
} from './vibing.gateway.types';
import { ChatService } from '../services/chat/chat.service';
import { ChatFeedbackEvent } from '../services/chat/chat.event';

/** How long a client has to acknowledge a push before it is reported as undelivered. */
const DELIVERY_ACK_TIMEOUT_MS = 5000;

/** Engine level packet tracing is one line per second per client, so it is opt-in. */
const TRACE_PACKETS = process.env.VIBING_TRACE_PACKETS === 'true';

/**
 * `ChatService` keys its feedback pipeline by session, and this namespace has no sessions. One
 * standing pseudo-session stands in for every viewer, which is what lets the page reuse the app's
 * counting — 5 second buffer, grouped counts, `PlaylogService.handleFeedbackEvent` — untouched.
 * The counts land on the playlog rather than on anyone's session, so nothing downstream cares that
 * several viewers share the id.
 */
const VIBING_FEEDBACK_SESSION = 'vibing-public';

/** Not an access check — anyone on the LAN may vote — just a ceiling on how fast one socket can. */
const REACTION_COOLDOWN_MS = 250;

/** Log lines shipped up from the page. Untrusted input: bounded and clipped before it reaches the log. */
const ClientLogSchema = z.object({
  entries: z
    .array(
      z.object({
        at: z.string().max(40).optional(),
        kind: z.string().max(40),
        message: z.string().max(400),
      }),
    )
    .max(25),
});

/**
 * Public feed behind the /vibing-on page. It lives on its own namespace so that
 * `ChatGateway`'s api-key handshake on the default namespace stays untouched: there is no auth,
 * no session and no room here, every viewer sees the same broadcast.
 *
 * Mostly one way — `vibing-control` and `vibing-reaction` are the exceptions, carrying the page's
 * transport buttons through to MPD and its reactions onto the current play.
 *
 * Both writes are deliberately open to anyone who can reach the page: this runs on the LAN, and
 * everyone on the LAN is allowed to drive playback and vote. That is the design, not an omission —
 * do not add a guard here without changing that decision first. What keeps it safe is scope rather
 * than identity: control is bounded to the queue MPD already holds (no enqueue, no clear, no
 * delete), reactions are bounded to four counters, both are rate limited or aggregated, and every
 * command is logged with the socket that sent it.
 *
 * It is also the audience counter. The commentary and cover lookups cost model calls, so
 * `PlaylogService` only makes them while somebody is actually watching.
 *
 * Heavily instrumented on purpose: viewers were going missing without the broadcast side noticing,
 * so every push is addressed per socket and acknowledged by the page rather than fired blind at the
 * namespace. `VIBING_TRACE_PACKETS=true` adds the engine.io ping/pong traffic underneath it.
 */
@WebSocketGateway({ namespace: '/vibing', cors: true })
export class VibingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('VibingGateway');

  /**
   * Counted here rather than read off the namespace, so the tally cannot drift from the events.
   * Holds the sockets themselves so each push can be addressed — and acknowledged — individually.
   */
  private readonly viewers = new Map<string, Socket>();

  /** Last reaction per socket, for the cooldown. Dropped with the socket in `handleDisconnect`. */
  private readonly lastReactionAt = new Map<string, number>();

  constructor(
    private readonly playlogService: PlaylogService,
    private readonly mpdClientService: MpdClientService,
    private readonly chatService: ChatService,
  ) {}

  /**
   * ping settings are engine.io options, and the engine is per HTTP server rather than per
   * namespace: whatever `ChatGateway` declares applies here too. Printed once at boot so the values
   * actually in force are on the record next to the disconnects they cause.
   */
  afterInit(server: Server) {
    // Opened once for the lifetime of the process, and never unsubscribed: unlike a chat session
    // there is no point at which the last viewer leaving should tear the counting down.
    this.chatService.subscribeToFeedback(VIBING_FEEDBACK_SESSION);

    const engine = (
      server as unknown as {
        server?: { engine?: { opts?: { pingInterval?: number; pingTimeout?: number; transports?: string[] } } };
      }
    ).server?.engine;
    const opts = engine?.opts;

    if (!opts) {
      this.logger.warn('Could not read the engine.io options for the /vibing namespace');
      return;
    }

    this.logger.log(
      `/vibing namespace ready — engine.io pingInterval=${opts.pingInterval}ms pingTimeout=${opts.pingTimeout}ms ` +
        `transports=[${(opts.transports ?? []).join(', ')}] (shared with the default namespace)`,
    );
  }

  handleConnection(client: Socket) {
    this.viewers.set(client.id, client);
    this.playlogService.setViewerCount(this.viewers.size);
    this.logger.log(
      `Vibing client connected: ${client.id} (${this.viewers.size} watching) ` +
        `transport=${client.conn.transport.name} address=${client.handshake.address} ` +
        `ua="${client.handshake.headers['user-agent'] ?? 'unknown'}"`,
    );

    this.traceTransport(client);

    // Populate a page that loaded mid-track rather than making it wait for the next song change.
    const nowPlaying = this.playlogService.nowPlaying;
    if (nowPlaying) {
      this.deliverTo(client, 'now-playing', nowPlaying, `catch-up "${nowPlaying.title}"`);
    } else {
      this.logger.debug(`No snapshot to catch ${client.id} up with`);
    }

    // The transport buttons start disabled, so the page needs the player state before it can be used.
    this.readPlayback()
      .then((playback) => this.deliverTo(client, VibingPlaybackMessage, playback, `catch-up ${playback.state}`))
      .catch((error: unknown) => {
        this.logger.error(`Error reading the playback state for a joining viewer: ${getErrorMessage(error)}`);
      });

    // The track may have started while nobody was watching, in which case it carries no commentary
    // yet. Harmless to call on every connect: it returns early once the commentary is there.
    this.playlogService.enrichCurrentIfNeeded().catch((error: unknown) => {
      this.logger.error(`Error enriching for a joining viewer: ${getErrorMessage(error)}`);
    });
  }

  handleDisconnect(client: Socket) {
    this.viewers.delete(client.id);
    this.lastReactionAt.delete(client.id);
    this.playlogService.setViewerCount(this.viewers.size);
    this.logger.warn(
      `Vibing client disconnected: ${client.id} (${this.viewers.size} watching) ` +
        `transport=${client.conn.transport.name} lifetime=${this.lifetimeOf(client)}`,
    );
  }

  @OnEvent(NowPlayingEventName)
  broadcastNowPlaying(payload: NowPlayingEvent) {
    this.logger.debug(`${NowPlayingEventName}: ${payload.nowPlaying.title}`);
    this.deliver('now-playing', payload.nowPlaying, `${payload.nowPlaying.title} — ${payload.nowPlaying.artist}`);
  }

  @OnEvent(NowPlayingCommentaryEventName)
  broadcastCommentary(payload: NowPlayingCommentaryEvent) {
    this.logger.debug(`${NowPlayingCommentaryEventName}: ${payload.commentary.songId}`);
    this.deliver('now-playing-commentary', payload.commentary, `commentary for ${payload.commentary.songId}`);
  }

  @OnEvent(NowPlayingCoverEventName)
  broadcastCover(payload: NowPlayingCoverEvent) {
    this.logger.debug(`${NowPlayingCoverEventName}: ${payload.cover.coverUrl}`);
    this.deliver('now-playing-cover', payload.cover, `cover for ${payload.cover.songId}`);
  }

  /**
   * Application level liveness, independent of the engine.io ping. The page sends this on its
   * watchdog tick, so a socket the server still believes in but that no longer round-trips shows up
   * as a gap in this log rather than as silence.
   */
  @SubscribeMessage('vibing-ping')
  handleVibingPing(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): void {
    const sentAt = typeof payload === 'number' ? payload : undefined;

    this.logger.debug(
      `vibing-ping from ${client.id} (transport=${client.conn.transport.name}` +
        `${sentAt ? `, ${Date.now() - sentAt}ms out` : ''})`,
    );

    // Answered with an event rather than an ack: an explicit round trip on the wire, in both logs.
    client.emit('vibing-pong', { sentAt, at: Date.now() });
  }

  /** Client side trace, relayed here so an unattended display leaves something behind in the server log. */
  @SubscribeMessage('vibing-client-log')
  handleClientLog(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): void {
    const parsed = ClientLogSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger.warn(`Discarded a malformed client log from ${client.id}`);
      return;
    }

    for (const entry of parsed.data.entries) {
      this.logger.debug(`[client ${client.id}] ${entry.at ?? ''} ${entry.kind}: ${entry.message}`);
    }
  }

  /**
   * Transport control from the page — open to every viewer on the LAN, see the note on the class.
   *
   * Returned rather than emitted: the value becomes the socket.io ack, so the page learns the state
   * its own click produced. Every other viewer gets the same state pushed as `vibing-playback`.
   */
  @SubscribeMessage(VibingControlMessage)
  async handleControl(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): Promise<VibingControlResult> {
    const parsed = VibingControlSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger.warn(`Discarded a malformed control message from ${client.id}: ${JSON.stringify(payload)}`);
      return { ok: false, error: 'Unsupported control action' };
    }

    const { action } = parsed.data;

    try {
      const playback = await this.applyControl(action);

      // `status` is the page asking where things stand, not a command: nothing to announce.
      if (action !== 'status') {
        this.logger.log(`vibing-control "${action}" from ${client.id} → state=${playback.state}`);
        this.deliver(VibingPlaybackMessage, playback, `${action} → ${playback.state}`);
      }

      return { ok: true, action, playback };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      this.logger.error(`vibing-control "${action}" from ${client.id} failed: ${message}`);
      return { ok: false, action, error: message };
    }
  }

  /**
   * A viewer reacting to the track. Handed straight to `ChatService`, which buffers five seconds of
   * them, groups them by type and increments the counters on the current play — the same path the
   * Android app's `chat-feedback` takes, so there is one implementation of the counting.
   *
   * Broadcast to the other viewers as well: react from a phone, watch the giraffe float up the
   * television. That broadcast is deliberately unacknowledged, unlike every other push here — a
   * dropped reaction is confetti, and acking one per tap would drown the delivery log.
   */
  @SubscribeMessage(VibingReactionMessage)
  handleReaction(@MessageBody() payload: unknown, @ConnectedSocket() client: Socket): { ok: boolean; error?: string } {
    const parsed = VibingReactionSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger.warn(`Discarded a malformed reaction from ${client.id}: ${JSON.stringify(payload)}`);
      return { ok: false, error: 'Unsupported reaction' };
    }

    const now = Date.now();
    const previous = this.lastReactionAt.get(client.id) ?? 0;

    if (now - previous < REACTION_COOLDOWN_MS) {
      this.logger.debug(`Dropped a reaction from ${client.id}: ${now - previous}ms since the last one`);
      return { ok: false, error: 'Too fast' };
    }

    this.lastReactionAt.set(client.id, now);

    const { reaction } = parsed.data;
    this.logger.log(`vibing-reaction "${reaction}" from ${client.id}`);

    this.chatService.processFeedbackMessage(
      VIBING_FEEDBACK_SESSION,
      new ChatFeedbackEvent(VIBING_FEEDBACK_SESSION, reaction, reaction),
    );

    client.broadcast.emit(VibingReactionBroadcastMessage, { reaction, at: now });

    return { ok: true };
  }

  private async applyControl(action: VibingControlAction): Promise<VibingPlaybackState> {
    switch (action) {
      case 'next':
        await this.mpdClientService.send(new NextMpdRequest());
        break;
      case 'previous':
        await this.mpdClientService.send(new PreviousMpdRequest());
        break;
      case 'play':
        await this.mpdClientService.send(new PlayMpdRequest());
        break;
      case 'stop':
        await this.mpdClientService.send(new StopMpdRequest());
        break;
      case 'toggle':
        await this.toggle();
        break;
      case 'status':
        break;
    }

    if (action !== 'status') {
      // The poller runs on a ten second interval, which is a long time to look at the track the
      // viewer just skipped away from. Not awaited: the ack must not wait on Mongo and the model.
      this.playlogService.checkCurrentSong().catch((error: unknown) => {
        this.logger.error(`Error refreshing now-playing after "${action}": ${getErrorMessage(error)}`);
      });
    }

    return this.readPlayback();
  }

  /** Resolved server side so the decision is made on the player's state rather than the page's copy. */
  private async toggle(): Promise<void> {
    const status = await this.mpdClientService.status();

    if (status.state === 'play') {
      await this.mpdClientService.send(new StopMpdRequest());
      return;
    }

    await this.mpdClientService.send(new PlayMpdRequest());
  }

  /** A player that cannot be reached reports `unknown`, which is what greys the page's buttons out. */
  private async readPlayback(): Promise<VibingPlaybackState> {
    try {
      const status = await this.mpdClientService.status();

      return {
        state: status.state ?? 'unknown',
        songId: status.songId ?? undefined,
        queueLength: status.playlistLength ?? undefined,
        at: Date.now(),
      };
    } catch (error: unknown) {
      this.logger.warn(`Could not read the MPD status: ${getErrorMessage(error)}`);
      return { state: 'unknown', at: Date.now() };
    }
  }

  /** Push to every viewer individually, so an undelivered payload names the socket that lost it. */
  private deliver(event: string, payload: unknown, label: string): void {
    const targets = Array.from(this.viewers.values());

    if (targets.length === 0) {
      this.logger.warn(`${event} (${label}) went nowhere — no vibing clients connected`);
      return;
    }

    this.logger.log(`${event} (${label}) → ${targets.length} client(s): ${targets.map((client) => client.id).join(', ')}`);

    for (const client of targets) {
      this.deliverTo(client, event, payload, label);
    }

    this.reconcile(targets.map((client) => client.id));
  }

  /**
   * The ack is what turns "we called emit" into "the page has it". A timeout here is the signature of
   * a half-open socket: the server still lists the client, the bytes go out, nothing comes back.
   */
  private deliverTo(client: Socket, event: string, payload: unknown, label: string): void {
    if (!client.connected) {
      this.logger.warn(`${event} (${label}) skipped for ${client.id}: socket is no longer connected`);
      return;
    }

    const startedAt = Date.now();

    client.timeout(DELIVERY_ACK_TIMEOUT_MS).emit(event, payload, (error: unknown) => {
      const elapsed = Date.now() - startedAt;

      if (error) {
        this.logger.warn(
          `${event} (${label}) NOT acknowledged by ${client.id} after ${elapsed}ms — ` +
            `connected=${client.connected} transport=${client.conn?.transport?.name}`,
        );
        return;
      }

      this.logger.debug(`${event} (${label}) acknowledged by ${client.id} in ${elapsed}ms`);
    });
  }

  /** Our tally against the namespace's own, in case a socket dies without `handleDisconnect` firing. */
  private reconcile(tracked: string[]): void {
    this.server
      .fetchSockets()
      .then((sockets) => {
        const actual = sockets.map((socket) => socket.id);
        const missing = tracked.filter((id) => !actual.includes(id));
        const extra = actual.filter((id) => !tracked.includes(id));

        if (missing.length === 0 && extra.length === 0) return;

        this.logger.warn(
          `Viewer tally drifted from the namespace — tracked but gone: [${missing.join(', ')}], ` +
            `in the namespace but untracked: [${extra.join(', ')}]`,
        );
      })
      .catch((error: unknown) => {
        this.logger.debug(`Could not fetch the namespace sockets: ${getErrorMessage(error)}`);
      });
  }

  /**
   * Transport level trace. `close` is the one that matters: it carries engine.io's own reason
   * ("ping timeout", "transport close", "transport error") for a drop the socket.io layer only
   * reports as a disconnect.
   */
  private traceTransport(client: Socket): void {
    const connection = client.conn;

    client.on('disconnect', (reason: string, description?: unknown) => {
      this.logger.warn(`[${client.id}] socket.io disconnect: ${reason}${description ? ` — ${String(description)}` : ''}`);
    });

    connection.on('upgrade', () => {
      this.logger.log(`[${client.id}] transport upgraded to ${connection.transport.name}`);
    });

    connection.on('close', (reason: string, description?: unknown) => {
      this.logger.warn(`[${client.id}] engine.io closed: ${reason}${description ? ` — ${String(description)}` : ''}`);
    });

    connection.on('error', (error: unknown) => {
      this.logger.warn(`[${client.id}] engine.io error: ${getErrorMessage(error)}`);
    });

    if (!TRACE_PACKETS) return;

    connection.on('heartbeat', () => {
      this.logger.verbose(`[${client.id}] pong received`);
    });

    connection.on('packet', (packet: { type?: string }) => {
      this.logger.verbose(`[${client.id}] ← ${packet?.type}`);
    });

    connection.on('packetCreate', (packet: { type?: string }) => {
      this.logger.verbose(`[${client.id}] → ${packet?.type}`);
    });
  }

  private lifetimeOf(client: Socket): string {
    const issued = client.handshake.issued;
    return issued ? `${Math.round((Date.now() - issued) / 1000)}s` : 'unknown';
  }
}
