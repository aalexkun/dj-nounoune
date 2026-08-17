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

@Injectable()
export class MpdClientService implements OnModuleInit, OnModuleDestroy {
  private readonly client: net.Socket;
  private readonly logger = new Logger(MpdClientService.name);
  private requestQueue: {
    request: MpdRequest<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  }[] = [];
  private currentRequest: {
    request: MpdRequest<any>;
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  } | null = null;
  /** Kept as bytes: a picture payload cannot survive a round trip through a string. */
  private buffer: Buffer = Buffer.alloc(0);
  private isConnected: boolean = false;
  private hasReceivedBanner: boolean = false;

  constructor(private appService: AppService) {
    this.client = new net.Socket();
  }

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.disconnect();
  }

  private connect() {
    const host = this.appService.getMpdHost();
    const port = this.appService.getMpdPort();

    if (host === 'undefined') {
      this.logger.warn('MPD_HOST is not defined. Skipping connection.');
      return;
    }

    this.logger.debug(`Connecting to MPD server at ${host}:${port}`);

    // Reset state on new connection attempt
    this.isConnected = false;
    this.hasReceivedBanner = false;
    this.buffer = Buffer.alloc(0);
    if (this.currentRequest) {
      // todo
      // Should check if we need to fail pending request or requeue
      // For simplicity, fail current request if connection drops mid-processing?
      // Or just requeue? Let's requeue if not sent?
      // If sent, we don't know state. Fail is safer.
      // But here we are connecting.
    }

    this.client.connect(port, host);
    this.client.on('connect', () => {
      this.logger.debug('TCP Connection established to MPD server');
      this.client.unref();
      this.isConnected = true;
      this.processQueue();
    });

    this.client.on('data', (data) => {
      this.handleData(data);
    });

    this.client.on('close', () => {
      this.logger.debug('Connection closed');
      this.isConnected = false;
      this.hasReceivedBanner = false;
      // Retry logic could be added here
    });

    this.client.on('error', (err) => {
      this.logger.error(`Connection error: ${err.message}`);
      this.isConnected = false;
    });
  }

  private disconnect() {
    if (this.client) {
      this.client.destroy();
    }
  }

  async send<T>(request: MpdRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ request, resolve, reject });
      this.processQueue();
    });
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
   * Whole cover image sitting next to the file in its directory (cover.jpg, folder.png, …).
   * Null when the directory holds none.
   */
  async fetchDirectoryArtwork(uri: string): Promise<MpdPicture | null> {
    return this.fetchPicture('albumart', uri, (offset) => new AlbumArtMpdRequest(uri, offset));
  }

  /**
   * Walks the offsets until the picture announced by `size:` is complete — the server hands over at
   * most `binarylimit` bytes (8 KiB by default) per request.
   */
  private async fetchPicture(
    command: string,
    uri: string,
    request: (offset: number) => MpdRequest<BinaryMpdResponse>,
  ): Promise<MpdPicture | null> {
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
    if (!this.isConnected || !this.hasReceivedBanner) {
      if (!this.isConnected && (this.client.destroyed || !this.client.writable) && !this.client.connecting) {
        this.connect();
      }
      return;
    }

    if (this.currentRequest || this.requestQueue.length === 0) return;

    this.currentRequest = this.requestQueue.shift()!;
    this.buffer = Buffer.alloc(0); // Ensure buffer is clear for new response
    const commandStr = this.currentRequest.request.getCommandString();
    this.logger.debug(`Sending command: ${commandStr.trim()}`);
    this.client.write(commandStr);
  }

  private handleData(data: Buffer) {
    this.logger.debug(`Received data chunk: ${this.describe(data)}`);

    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data]);

    if (!this.hasReceivedBanner && !this.consumeBanner()) return;

    if (this.buffer.length === 0) return;

    if (this.isResponseComplete()) {
      this.finalizeRequest();
    }
  }

  /**
   * The server greets with `OK MPD <version>` before anything else. Returns false while the greeting
   * is still incomplete, so the caller waits for the rest rather than reading it as a response.
   */
  private consumeBanner(): boolean {
    if (this.buffer.length < 6) return false;

    if (this.buffer.subarray(0, 6).toString('latin1') !== 'OK MPD') {
      this.logger.warn('Received data but expecting banner: ' + this.buffer.toString('utf8'));
      return true; // Not a banner: let the normal response path deal with it.
    }

    const lineEnd = this.buffer.indexOf(NEWLINE);
    if (lineEnd === -1) {
      this.logger.warn('Received partial data looking like banner: ' + this.buffer.toString('utf8'));
      return false;
    }

    this.logger.log('Received MPD Banner: ' + this.buffer.subarray(0, lineEnd).toString('utf8'));
    this.hasReceivedBanner = true;

    // Held aside because `processQueue` clears the buffer for the command it is about to send.
    const remainder = this.buffer.subarray(lineEnd + 1);
    this.buffer = Buffer.alloc(0);
    this.processQueue(); // Ready to send commands
    this.buffer = Buffer.concat([this.buffer, remainder]);

    return true;
  }

  /**
   * Text responses end at the closing `OK`. A picture cannot be framed that way — its bytes may hold
   * that very sequence — so its length is taken from the `binary:` header instead.
   */
  private isResponseComplete(): boolean {
    if (this.currentRequest?.request.isBinary) {
      return isBinaryResponseComplete(this.buffer);
    }

    const text = this.buffer.toString('utf8');
    return text.endsWith('OK\n') || text.startsWith('ACK [');
  }

  private finalizeRequest() {
    if (!this.currentRequest) {
      // Unsolicited message or leftover
      if (this.buffer.toString('utf8').trim().length > 0) {
        this.logger.warn('Received data without active request: ' + this.buffer.toString('utf8'));
      }
      this.buffer = Buffer.alloc(0);
      return;
    }

    const raw = this.buffer;
    this.buffer = Buffer.alloc(0);

    const isBinary = this.currentRequest.request.isBinary;
    // Only the head is decoded for a picture: the rest is payload, and an error never gets that far.
    const head = raw.subarray(0, Math.min(raw.length, 256)).toString('utf8');

    if (head.startsWith('ACK')) {
      this.currentRequest.reject(new Error(`MPD Error: ${head.trim()}`));
    } else {
      try {
        const response = this.currentRequest.request.createResponse(isBinary ? raw : raw.toString('utf8'));
        this.currentRequest.resolve(response);
      } catch (e: unknown) {
        this.currentRequest.reject(new Error(`Response parsing error: ${getErrorMessage(e)}`));
      }
    }

    this.currentRequest = null;
    this.processQueue();
  }

  /** Keeps a picture payload out of the logs, where it would be both huge and unreadable. */
  private describe(data: Buffer): string {
    if (this.currentRequest?.request.isBinary) return `${data.length} bytes`;
    return data.toString('utf8').replace(/\n/g, '\\n');
  }
}
