import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as net from 'net';
import { MpdRequest } from './requests/MpdRequest';
import { NextMpdRequest } from './requests/NextMpdRequest';
import { PauseMpdRequest } from './requests/PauseMpdRequest';
import { PlayMpdRequest } from './requests/PlayMpdRequest';
import { PlayIdMpdRequest } from './requests/PlayIdMpdRequest';
import { PreviousMpdRequest } from './requests/PreviousMpdRequest';
import { SeekMpdRequest } from './requests/SeekMpdRequest';
import { SeekIdMpdRequest } from './requests/SeekIdMpdRequest';
import { SeekCurMpdRequest } from './requests/SeekCurMpdRequest';
import { StopMpdRequest } from './requests/StopMpdRequest';
import { StatusMpdRequest } from './requests/StatusMpdRequest';
import { CurrentSongMpdRequest } from './requests/CurrentSongMpdRequest';
import { ReadPictureMpdRequest } from './requests/ReadPictureMpdRequest';
import { AlbumArtMpdRequest } from './requests/AlbumArtMpdRequest';
import { BinaryMpdResponse, MpdPicture } from './responses/BinaryMpdResponse';
import { detectMimeType, isBinaryResponseComplete } from './binary-response.util';
import { AppService } from '../../app.service';
import { getErrorMessage } from '../../utils/error.utils';

/** Guard against a malformed `size:` turning the chunk walk into an unbounded read. */
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;

const NEWLINE = 0x0a;
const LETTER_O = 0x4f;
const LETTER_K = 0x4b;

/** What the server greets with. Anything else on a fresh connection is not an MPD server. */
const BANNER = 'OK MPD';

/** A greeting longer than this with no line break in it is not a greeting. */
const MAX_BANNER_BYTES = 256;

/**
 * Pause before the first reconnect attempt, doubled on each failure up to the ceiling.
 *
 * The daemon is on the same machine, so a refused connection comes back at once and a tight loop
 * would just fill the log. The ceiling keeps the wait after an MPD restart short enough that the
 * queue watcher, which polls every two seconds, is not what the user ends up waiting on.
 */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

/** Keeps a half-open socket from going unnoticed for longer than the OS default would allow. */
const KEEPALIVE_DELAY_MS = 10_000;

/**
 * One command waiting on the wire. `unknown` because the queue holds every request type at once;
 * `send<T>` restores the concrete response type at the call site. `resolve`/`reject` are declared
 * as methods on purpose: method parameters stay bivariant under `strictFunctionTypes`, which is
 * what lets a `Promise<T>` resolver be stored here.
 *
 * `timer` is the request's deadline. It starts when the request is queued, not when it is written,
 * because a caller waiting behind a stuck request is waiting all the same.
 */
type PendingRequest = {
  request: MpdRequest<unknown>;
  resolve(value: unknown): void;
  reject(reason?: unknown): void;
  timer: NodeJS.Timeout;
};

/**
 * Client for the MPD line protocol: one socket, a serialised FIFO of requests, one reply per request.
 *
 * Three things keep the FIFO from stalling, and all three were missing once:
 *
 * - **Every request has a deadline** (`MPD_TIMEOUT_MS`, queue time included). A request that expires
 *   while it is on the wire drops the connection, because its reply may still arrive and would be
 *   read as the answer to the next command. A request that expires while still queued is simply
 *   failed, which is what happens to every caller while the daemon is unreachable.
 * - **A dropped connection fails only the request on the wire.** Its command may or may not have
 *   run and its reply will never come. What is still queued was never sent and waits for the next
 *   connection under its own deadline. Before this, the request on the wire stayed "current"
 *   forever and nothing was ever written again, on any connection.
 * - **A new socket per connection, with its listeners registered once.** Reconnecting the same
 *   socket object and adding four more listeners each time fed every chunk to the buffer several
 *   times over, which is how a queue came back with each track repeated.
 */
@Injectable()
export class MpdClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MpdClientService.name);
  private readonly timeoutMs: number;

  private socket: net.Socket | null = null;
  private requestQueue: PendingRequest[] = [];
  private currentRequest: PendingRequest | null = null;
  /** Kept as bytes: a picture payload cannot survive a round trip through a string. */
  private buffer: Buffer = Buffer.alloc(0);
  /** True once the banner has been read on the current socket, which is when commands may be sent. */
  private ready = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  /** Set by `onModuleDestroy`; stops the reconnect loop and refuses new requests. */
  private closing = false;

  constructor(private appService: AppService) {
    this.timeoutMs = this.appService.getMpdTimeoutMs();
  }

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.closing = true;
    this.clearReconnectTimer();

    const queued = this.requestQueue;
    this.requestQueue = [];

    this.dropConnection('MPD client is shutting down');

    for (const pending of queued) {
      this.fail(pending, new Error('MPD client is shutting down'));
    }
  }

  private hasHost(): boolean {
    return this.appService.getMpdHost() !== 'undefined';
  }

  /** Opens a fresh socket. A no-op while one exists, while a reconnect is pending, or when shutting down. */
  private connect() {
    if (this.closing || this.socket || this.reconnectTimer) return;

    if (!this.hasHost()) {
      this.logger.warn('MPD_HOST is not defined. Skipping connection.');
      return;
    }

    const host = this.appService.getMpdHost();
    const port = this.appService.getMpdPort();

    this.logger.debug(`Connecting to MPD server at ${host}:${port}`);

    this.ready = false;
    this.buffer = Buffer.alloc(0);

    const socket = new net.Socket();
    this.socket = socket;

    socket.setNoDelay(true);
    socket.setKeepAlive(true, KEEPALIVE_DELAY_MS);

    socket.once('connect', () => {
      this.logger.debug('TCP Connection established to MPD server');
      // A one-shot CLI command must not be kept alive by the socket it opened on the way.
      socket.unref();
    });

    // Every handler checks the socket is still the live one: a socket this client has already
    // replaced may still emit `close` on its way out, and that must not touch the new connection.
    socket.on('data', (data: Buffer) => {
      if (socket === this.socket) this.handleData(data);
    });

    socket.on('error', (err: Error) => {
      // `close` follows and does the recovery; this only says why.
      if (socket === this.socket) this.logger.warn(`MPD connection error: ${err.message}`);
    });

    socket.once('close', () => {
      if (socket !== this.socket) return;

      // The daemon closes a connection it has heard nothing on for `connection_timeout` (60 s by
      // default). With nothing on the wire that is routine; with a request on it, a loss.
      if (this.currentRequest) {
        this.logger.warn(`MPD connection closed while waiting for ${this.currentRequest.request.command}`);
      } else {
        this.logger.debug('MPD closed an idle connection');
      }

      this.dropConnection('MPD connection closed');
    });

    socket.connect(port, host);
  }

  /**
   * Lets go of the current socket and fails the request that was on the wire.
   *
   * Both the socket's own `close` and a deadline expiring on the wire come through here, so the
   * recovery is the same whoever noticed first. The queued requests are left alone: nothing was
   * sent on their behalf, and their own deadlines bound how long they wait for the next connection.
   *
   * A reconnect is scheduled only when somebody is waiting. An idle client reconnects on its next
   * request instead, so a connection the daemon closed for inactivity is not reopened just to go
   * idle again: the server's poller keeps its connection busy, and a finished CLI command is gone.
   */
  private dropConnection(reason: string) {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.buffer = Buffer.alloc(0);

    // Its `close` is ignored from here on: it is no longer `this.socket`.
    socket?.destroy();

    const pending = this.currentRequest;
    this.currentRequest = null;

    if (pending) {
      this.fail(pending, new Error(`${reason} while waiting for ${pending.request.command}`));
    }

    if (!this.closing && (pending || this.requestQueue.length > 0)) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.closing) return;

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);

    this.logger.debug(`Reconnecting to MPD in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);

    // A dead daemon must not keep a finished CLI command's process alive.
    this.reconnectTimer.unref();
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async send<T>(request: MpdRequest<T>): Promise<T> {
    if (this.closing) {
      throw new Error('MPD client is shutting down');
    }

    // Fails now rather than queueing forever: without a host there will never be a connection.
    if (!this.hasHost()) {
      throw new Error('MPD_HOST is not defined');
    }

    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        request,
        resolve,
        reject,
        timer: setTimeout(() => this.expire(pending), this.timeoutMs),
      };

      this.requestQueue.push(pending);
      this.processQueue();
    });
  }

  /** The deadline ran out. What happens next depends on whether the request had reached the wire. */
  private expire(pending: PendingRequest) {
    const command = pending.request.command;

    if (pending === this.currentRequest) {
      // The reply may still be on its way, and on this socket it would be taken for the answer to
      // the next command. The only safe way out is a new connection.
      this.logger.warn(`MPD did not answer ${command} within ${this.timeoutMs}ms, reconnecting`);
      this.currentRequest = null;
      this.fail(pending, new Error(`MPD did not answer ${command} within ${this.timeoutMs}ms`));
      this.dropConnection('MPD connection reset');
      return;
    }

    const index = this.requestQueue.indexOf(pending);
    if (index !== -1) this.requestQueue.splice(index, 1);

    this.fail(pending, new Error(`MPD request ${command} waited ${this.timeoutMs}ms without being sent`));
  }

  private succeed(pending: PendingRequest, value: unknown) {
    clearTimeout(pending.timer);
    pending.resolve(value);
  }

  private fail(pending: PendingRequest, error: Error) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  async next() {
    return this.send(new NextMpdRequest());
  }

  async pause(state?: 0 | 1) {
    return this.send(new PauseMpdRequest(state));
  }

  async play(songPos?: number) {
    return this.send(new PlayMpdRequest(songPos));
  }

  async playid(songId?: number) {
    return this.send(new PlayIdMpdRequest(songId));
  }

  async previous() {
    return this.send(new PreviousMpdRequest());
  }

  async seek(songPos: number, time: number | string) {
    return this.send(new SeekMpdRequest(songPos, time));
  }

  async seekid(songId: number, time: number | string) {
    return this.send(new SeekIdMpdRequest(songId, time));
  }

  async seekcur(time: number | string) {
    return this.send(new SeekCurMpdRequest(time));
  }

  async stop() {
    return this.send(new StopMpdRequest());
  }

  async currentsong() {
    return this.send(new CurrentSongMpdRequest());
  }

  async status() {
    return this.send(new StatusMpdRequest());
  }

  /** One chunk of the picture embedded in the file's own tags. See `fetchEmbeddedPicture`. */
  async readpicture(uri: string, offset: number = 0) {
    return this.send(new ReadPictureMpdRequest(uri, offset));
  }

  /** One chunk of the cover image found in the file's directory. See `fetchDirectoryArtwork`. */
  async albumart(uri: string, offset: number = 0) {
    return this.send(new AlbumArtMpdRequest(uri, offset));
  }

  /**
   * Whole picture embedded in the audio file itself (ID3 APIC frames, FLAC PICTURE blocks).
   * Null when the file carries none, which is the ordinary case rather than a failure.
   */
  async fetchEmbeddedPicture(uri: string): Promise<MpdPicture | null> {
    return this.fetchPicture('readpicture', uri, (offset) => new ReadPictureMpdRequest(uri, offset));
  }

  /**
   * Whole cover image sitting next to the file in its directory (cover.jpg, folder.png, ...).
   * Null when the directory holds none.
   */
  async fetchDirectoryArtwork(uri: string): Promise<MpdPicture | null> {
    return this.fetchPicture('albumart', uri, (offset) => new AlbumArtMpdRequest(uri, offset));
  }

  /**
   * Walks the offsets until the picture announced by `size:` is complete: the server hands over at
   * most `binarylimit` bytes (8 KiB by default) per request.
   */
  private async fetchPicture(command: string, uri: string, request: (offset: number) => MpdRequest<BinaryMpdResponse>): Promise<MpdPicture | null> {
    try {
      const chunks: Buffer[] = [];
      let mimeType: string | undefined;
      let received = 0;
      let total = 0;

      do {
        const response = await this.send(request(received));

        // A file without a picture answers a bare OK; a server that stops sending ends the walk.
        if (response.data.length === 0) break;

        mimeType = mimeType ?? response.mimeType;
        total = response.size;
        chunks.push(response.data);
        received += response.data.length;

        if (received > MAX_PICTURE_BYTES) {
          this.logger.warn(`${command} returned more than ${MAX_PICTURE_BYTES} bytes for ${uri}, discarding it`);
          return null;
        }
      } while (received < total);

      if (received === 0) {
        this.logger.debug(`${command} found no picture for ${uri}`);
        return null;
      }

      const data = Buffer.concat(chunks);
      return { mimeType: mimeType ?? detectMimeType(data), data };
    } catch (error: unknown) {
      // `ACK [50@0] {albumart} No file exists` is how the server says there is no artwork here.
      this.logger.debug(`${command} found no picture for ${uri}: ${getErrorMessage(error)}`);
      return null;
    }
  }

  private processQueue() {
    if (!this.ready) {
      // Nothing to do if a socket is already on its way; otherwise this is the safety net.
      this.connect();
      return;
    }

    if (this.currentRequest || this.requestQueue.length === 0) return;

    this.currentRequest = this.requestQueue.shift()!;
    // Nothing was in flight, so whatever is in the buffer was unsolicited.
    this.buffer = Buffer.alloc(0);
    const commandStr = this.currentRequest.request.getCommandString();
    this.logger.verbose(`Sending command: ${commandStr.trim()}`);
    this.socket!.write(commandStr);
  }

  private handleData(data: Buffer) {
    this.logger.verbose(`Received data chunk: ${this.describe(data)}`);

    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data]);

    if (!this.ready && !this.consumeBanner()) return;

    if (this.buffer.length === 0) return;

    if (this.isResponseComplete()) {
      this.finalizeRequest();
    }
  }

  /**
   * The server greets with `OK MPD <version>` before anything else. Returns false while the greeting
   * is still incomplete, so the caller waits for the rest rather than reading it as a response, and
   * false after dropping a connection whose first line was not a greeting at all.
   */
  private consumeBanner(): boolean {
    const lineEnd = this.buffer.indexOf(NEWLINE);

    if (lineEnd === -1) {
      if (this.buffer.length > MAX_BANNER_BYTES) {
        this.logger.error(`Expected the MPD banner, received ${this.buffer.length} bytes with no line break`);
        this.dropConnection('Not an MPD server');
      }
      return false;
    }

    const line = this.buffer.subarray(0, lineEnd).toString('utf8');

    if (!line.startsWith(BANNER)) {
      this.logger.error(`Expected the MPD banner, received: ${line}`);
      this.dropConnection('Not an MPD server');
      return false;
    }

    this.logger.log(`Received MPD banner: ${line}`);

    // The server sends nothing unsolicited, so this is normally empty.
    this.buffer = this.buffer.subarray(lineEnd + 1);
    this.ready = true;
    this.reconnectDelay = RECONNECT_MIN_MS;

    this.processQueue();

    return true;
  }

  /**
   * Text responses end at a line that is exactly `OK`. A picture cannot be framed that way, since
   * its bytes may hold that very sequence, so its length is taken from the `binary:` header instead.
   */
  private isResponseComplete(): boolean {
    if (this.currentRequest?.request.isBinary) {
      return isBinaryResponseComplete(this.buffer);
    }

    return endsWithOkLine(this.buffer) || isCompleteAck(this.buffer);
  }

  private finalizeRequest() {
    const raw = this.buffer;
    this.buffer = Buffer.alloc(0);

    const pending = this.currentRequest;

    if (!pending) {
      // Unsolicited message or leftover
      if (raw.toString('utf8').trim().length > 0) {
        this.logger.warn('Received data without active request: ' + raw.toString('utf8'));
      }
      return;
    }

    this.currentRequest = null;

    const isBinary = pending.request.isBinary;
    // Only the head is decoded for a picture: the rest is payload, and an error never gets that far.
    const head = raw.subarray(0, Math.min(raw.length, 256)).toString('utf8');

    if (head.startsWith('ACK')) {
      this.fail(pending, new Error(`MPD Error: ${head.trim()}`));
    } else {
      try {
        const response = pending.request.createResponse(isBinary ? raw : raw.toString('utf8'));
        this.succeed(pending, response);
      } catch (e: unknown) {
        this.fail(pending, new Error(`Response parsing error: ${getErrorMessage(e)}`));
      }
    }

    this.processQueue();
  }

  /** Keeps a picture payload out of the logs, where it would be both huge and unreadable. */
  private describe(data: Buffer): string {
    if (this.currentRequest?.request.isBinary) return `${data.length} bytes`;
    return data.toString('utf8').replace(/\n/g, '\\n');
  }
}

/**
 * Whether the buffer ends with a line that is exactly `OK`.
 *
 * Checked on the bytes at the tail rather than by decoding the whole buffer: `playlistinfo` on a
 * long queue arrives in many chunks, and decoding everything received so far on each of them is
 * work that grows with the square of the reply. Anchored on the line break before it, because a tag
 * value can end in those two letters (`Title: It's OK`) and a chunk can end right after it; taking
 * that for the end of the reply hands the rest of it to the next command as its answer.
 */
function endsWithOkLine(buffer: Buffer): boolean {
  const length = buffer.length;
  if (length < 3) return false;

  if (buffer[length - 1] !== NEWLINE || buffer[length - 2] !== LETTER_K || buffer[length - 3] !== LETTER_O) return false;

  return length === 3 || buffer[length - 4] === NEWLINE;
}

/** An error reply is one `ACK [...] {...} message` line, complete once its line break has arrived. */
function isCompleteAck(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === 'ACK [' && buffer[buffer.length - 1] === NEWLINE;
}
