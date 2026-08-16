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

/** How long a client has to acknowledge a push before it is reported as undelivered. */
const DELIVERY_ACK_TIMEOUT_MS = 5000;

/** Engine level packet tracing is one line per second per client, so it is opt-in. */
const TRACE_PACKETS = process.env.VIBING_TRACE_PACKETS === 'true';

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
 * Read-only public feed behind the /vibing-on page. It lives on its own namespace so that
 * `ChatGateway`'s api-key handshake on the default namespace stays untouched: there is no auth,
 * no session and no room here, every viewer sees the same broadcast.
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

  constructor(private readonly playlogService: PlaylogService) {}

  /**
   * ping settings are engine.io options, and the engine is per HTTP server rather than per
   * namespace: whatever `ChatGateway` declares applies here too. Printed once at boot so the values
   * actually in force are on the record next to the disconnects they cause.
   */
  afterInit(server: Server) {
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

    // The track may have started while nobody was watching, in which case it carries no commentary
    // yet. Harmless to call on every connect: it returns early once the commentary is there.
    this.playlogService.enrichCurrentIfNeeded().catch((error: unknown) => {
      this.logger.error(`Error enriching for a joining viewer: ${getErrorMessage(error)}`);
    });
  }

  handleDisconnect(client: Socket) {
    this.viewers.delete(client.id);
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
