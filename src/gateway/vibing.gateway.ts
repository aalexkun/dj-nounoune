import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PlaylogService } from '../services/playlog/playlog.service';
import { NowPlayingEvent, NowPlayingEventName } from '../services/playlog/now-playing.event';
import { getErrorMessage } from '../utils/error.utils';

/**
 * Read-only public feed behind the /vibing-on page. It lives on its own namespace so that
 * `ChatGateway`'s api-key handshake on the default namespace stays untouched: there is no auth,
 * no session and no room here, every viewer sees the same broadcast.
 *
 * It is also the audience counter. The commentary and cover lookups cost model calls, so
 * `PlaylogService` only makes them while somebody is actually watching.
 */
@WebSocketGateway({ namespace: '/vibing', cors: true })
export class VibingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('VibingGateway');

  /** Counted here rather than read off the namespace, so the tally cannot drift from the events. */
  private readonly viewers = new Set<string>();

  constructor(private readonly playlogService: PlaylogService) {}

  handleConnection(client: Socket) {
    this.viewers.add(client.id);
    this.playlogService.setViewerCount(this.viewers.size);
    this.logger.log(`Vibing client connected: ${client.id} (${this.viewers.size} watching)`);

    // Populate a page that loaded mid-track rather than making it wait for the next song change.
    const nowPlaying = this.playlogService.nowPlaying;
    if (nowPlaying) {
      client.emit('now-playing', nowPlaying);
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
    this.logger.log(`Vibing client disconnected: ${client.id} (${this.viewers.size} watching)`);
  }

  @OnEvent(NowPlayingEventName)
  broadcastNowPlaying(payload: NowPlayingEvent) {
    this.logger.debug(`${NowPlayingEventName}: ${payload.nowPlaying.title}`);
    this.server.emit('now-playing', payload.nowPlaying);
  }
}
