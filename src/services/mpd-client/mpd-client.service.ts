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
import { CurrentSongMpdRequest } from './requests/CurrentSongMpdRequest';
import { AppService } from '../../app.service';

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
  private buffer: string = '';
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
    this.buffer = '';
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

  private processQueue() {
    if (!this.isConnected || !this.hasReceivedBanner) {
      if (!this.isConnected && (this.client.destroyed || !this.client.writable) && !this.client.connecting) {
        this.connect();
      }
      return;
    }

    if (this.currentRequest || this.requestQueue.length === 0) return;

    this.currentRequest = this.requestQueue.shift()!;
    this.buffer = ''; // Ensure buffer is clear for new response
    const commandStr = this.currentRequest.request.getCommandString();
    this.logger.debug(`Sending command: ${commandStr.trim()}`);
    this.client.write(commandStr);
  }

  private handleData(data: Buffer) {
    let chunk = data.toString();
    this.logger.debug(`Received data chunk: ${chunk.replace(/\n/g, '\\n')}`);

    if (!this.hasReceivedBanner) {
      if (chunk.startsWith('OK MPD')) {
        const lineEnd = chunk.indexOf('\n');
        if (lineEnd !== -1) {
          this.logger.log('Received MPD Banner: ' + chunk.substring(0, lineEnd));
          this.hasReceivedBanner = true;
          chunk = chunk.substring(lineEnd + 1);
          this.processQueue(); // Ready to send commands
        } else {
          // Partial banner? Wait for more data?
          // MPD banner is short. Unlikely to be partial.
          // But valid to check.
          this.logger.warn('Received partial data looking like banner: ' + chunk);
          // If acts weirdly, we might need to buffer.
        }
      } else {
        this.logger.warn('Received data but expecting banner: ' + chunk);
      }
    }

    if (chunk.length === 0) return;

    this.buffer += chunk;

    if (this.isResponseComplete(this.buffer)) {
      this.finalizeRequest();
    }
  }

  private isResponseComplete(buffer: string): boolean {
    return buffer.endsWith('OK\n') || buffer.startsWith('ACK [');
  }

  private finalizeRequest() {
    if (!this.currentRequest) {
      // Unsolicited message or leftover
      if (this.buffer.trim().length > 0) {
        this.logger.warn('Received data without active request: ' + this.buffer);
      }
      this.buffer = '';
      return;
    }

    const raw = this.buffer;
    this.buffer = '';

    if (raw.startsWith('ACK')) {
      this.currentRequest.reject(new Error(`MPD Error: ${raw.trim()}`));
    } else {
      try {
        const response = this.currentRequest.request.createResponse(raw);
        this.currentRequest.resolve(response);
      } catch (e: any) {
        this.currentRequest.reject(new Error(`Response parsing error: ${e.message}`));
      }
    }

    this.currentRequest = null;
    this.processQueue();
  }
}
