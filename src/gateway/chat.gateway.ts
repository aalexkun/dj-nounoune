import {
  WebSocketGateway,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument } from '../schemas/session.schema';
import { AppService } from '../app.service';
import { PromptusService } from '../services/promptus/promptus/promptus.service';
import { Logger } from '@nestjs/common';
import { bufferTime, concatMap, filter, from, map, Observable, Subject, Subscription, tap } from 'rxjs';

type ClientId = string;
type ChannelName = `${ClientId}-chat-feedback` | `${ClientId}-chat-message` | `${ClientId}-chat-message-status-response`;

// Enable CORS if your client is on a different domain
@WebSocketGateway({ cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly X_API_KEY: string;
  private readonly logger = new Logger('ChatGateway');

  private channels: ChannelName[] = ['-chat-feedback', '-chat-message', '-chat-message-status-response'];
  private clientSubjects = new Map<ChannelName, Subject<string>>();
  private clientSubscriptions = new Map<ChannelName, Subscription>();

  constructor(
    @InjectModel(Session.name)
    private sessionModel: Model<SessionDocument>,
    private readonly appService: AppService,
    private readonly promptusService: PromptusService,
  ) {
    const apiKey = this.appService.getAuthXApiKey();
    if (!apiKey) {
      throw new Error('AuthX API Key not found. Please set the AUTHX_API_KEY environment variable to a valid API Key.');
    }
    this.X_API_KEY = apiKey;
  }

  async handleConnection(client: Socket) {
    const apiKey = client.handshake.headers['x-api-key'] || client.handshake.auth['apiKey'];
    if (apiKey !== this.X_API_KEY) {
      this.logger.warn(`Unauthorised connection attempt from ${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const newSession = new this.sessionModel({
        socketId: client.id,
        status: 'active',
      });
      await newSession.save();
    } catch (error) {
      this.logger.error(`Error handleConnection session: ${error.message}`);
    }

    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    try {
      this.unSubscribeClient(client.id);

      await this.sessionModel.updateOne(
        { socketId: client.id, status: 'active' },
        {
          status: 'disconnected',
          disconnectedAt: new Date(),
        },
      );
    } catch (error) {
      this.logger.error(`Error handleDisconnect session: ${error.message}`);
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private unSubscribeClient(clientId: string) {
    for (const channel of this.channels) {
      this.clientSubjects.get(`${clientId}${channel}`)?.complete();
      this.clientSubscriptions.get(`${clientId}${channel}`)?.unsubscribe();
      this.clientSubjects.delete(`${clientId}${channel}`);
      this.clientSubscriptions.delete(`${clientId}${channel}`);
    }
  }

  @SubscribeMessage('chat-feedback')
  handleDataStream(@MessageBody() payload: any, @ConnectedSocket() client: Socket) {
    if (this.clientSubjects.has(`${client.id}-chat-feedback`)) {
      this.clientSubjects.get(`${client.id}-chat-feedback`)?.next(payload);
    } else {
      this.subscribeToFeedback(client).next(payload);
    }
  }

  private subscribeToFeedback(client: Socket): Subject<string> {
    const subject = new Subject<string>();
    const subscription = subject
      .pipe(
        bufferTime(5000),
        filter((bufferedMessages) => bufferedMessages?.length > 0),
        map((bufferedMessages) => bufferedMessages.reduce((count, message) => count + message.length, 0)),
      )
      .subscribe((totalSum) => {
        this.logger.log(`Count of reaction over the last 5 seconds: ${totalSum}`);
      });

    this.clientSubjects.set(`${client.id}-chat-feedback`, subject);
    this.clientSubscriptions.set(`${client.id}-chat-feedback`, subscription);
    return subject;
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(@MessageBody() payload: string, @ConnectedSocket() client: Socket) {
    if (this.clientSubjects.has(`${client.id}-chat-message`)) {
      this.clientSubjects.get(`${client.id}-chat-message`)?.next(payload);
    } else {
      this.subscribeToChat(client).next(payload);
    }
  }

  private subscribeToChat(client: Socket): Subject<string> {
    // Create a new subject and subscription for handling chat status messages
    const statusSubject = new Subject<string>();
    const statusSubscription = statusSubject.subscribe((status) => {
      client.emit('chat-message-status-response', status);
    });
    this.clientSubjects.set(`${client.id}-chat-message-status-response`, statusSubject);
    this.clientSubscriptions.set(`${client.id}-chat-message-status-response`, statusSubscription);

    // Pass the statusSubject to the chat function so it can dispatch status messages
    const subject = new Subject<string>();
    const subscription = subject
      .pipe(
        // tap((payload) => {
        //   this.logger.debug(`Message from ${client.id}: ${payload}`);
        //   client.emit('chat-message-response', 'Creating Playlist...');
        // }),
        concatMap((payload) => from(this.promptusService.chat(payload, statusSubject))),
      )
      .subscribe((message) => {
        client.emit('chat-message-response', message);
      });

    this.clientSubjects.set(`${client.id}-chat-message`, subject);
    this.clientSubscriptions.set(`${client.id}-chat-message`, subscription);

    return subject;
  }
}
