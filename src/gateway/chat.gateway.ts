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
import { AuthService } from '../services/auth/auth.service';
import { Logger } from '@nestjs/common';
import { bufferTime, concatMap, filter, from, map, Observable, Subject, Subscription, tap } from 'rxjs';
import * as chatGatewayTypes from './chat.gateway.types';
import { ChatFeedbackMessage } from './chat.gateway.types';
import { PromptusService } from '../services/promptus/promptus.service';

type ClientId = string;
type ChannelName = `${ClientId}-chat-feedback` | `${ClientId}-chat-message` | `${ClientId}-chat-message-status-response`;
type FeedbackCounts = Partial<Record<ChatFeedbackMessage['feedback'], number>>;

// Enable CORS if your client is on a different domain
@WebSocketGateway({ cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('ChatGateway');

  private channels: ChannelName[] = ['-chat-feedback', '-chat-message', '-chat-message-status-response'];
  private clientSubjects = new Map<
    ChannelName,
    Subject<chatGatewayTypes.ChatStatusMessage | chatGatewayTypes.ChatMessage | chatGatewayTypes.ChatFeedbackMessage>
  >();
  private clientSubscriptions = new Map<ChannelName, Subscription>();

  constructor(
    @InjectModel(Session.name)
    private sessionModel: Model<SessionDocument>,
    private readonly promptusService: PromptusService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket) {
    const apiKey = client.handshake.headers['x-api-key'] || client.handshake.auth['apiKey'];
    const userId = client.handshake.headers['x-user-id'] || client.handshake.auth['userId'];

    if (!this.authService.validateApiKey(apiKey as string | undefined)) {
      this.logger.warn(`Unauthorised connection attempt from ${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const newSession = new this.sessionModel({
        socketId: client.id,
        status: 'active',
        ...(userId ? { userId: userId as string } : {}),
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

  private subscribeToFeedback(client: Socket): Subject<ChatFeedbackMessage> {
    const subject = new Subject<ChatFeedbackMessage>();
    const subscription = subject
      .pipe(
        bufferTime(5000),
        filter((bufferedMessages) => bufferedMessages?.length > 0),
        map((bufferedMessages) => {
          // 2. Reduce the array into an object that counts each feedback type
          return bufferedMessages.reduce((acc, message) => {
            const type = message.feedback;
            // Initialise at 0 if it doesn't exist, then increment by 1
            acc[type] = (acc[type] || 0) + 1;
            return acc;
          }, {} as FeedbackCounts);
        }),
      )
      .subscribe((groupedCounts) => {
        // 3. The output will now be an object instead of a single integer
        this.logger.log('Count of reactions over the last 5 seconds:', groupedCounts);

        // Example output in your logs:
        // { awesome: 4, wtf: 1, great: 2 }
      });

    this.clientSubjects.set(`${client.id}-chat-feedback`, subject);
    this.clientSubscriptions.set(`${client.id}-chat-feedback`, subscription);
    return subject;
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(@MessageBody() payload: chatGatewayTypes.ChatMessage, @ConnectedSocket() client: Socket) {
    if (this.clientSubjects.has(`${client.id}-chat-message`)) {
      this.clientSubjects.get(`${client.id}-chat-message`)?.next(payload);
    } else {
      this.subscribeToChat(client).next(payload);
    }
  }

  private subscribeToChat(client: Socket): Subject<chatGatewayTypes.ChatMessage> {
    // Create a new subject and subscription for handling chat status messages
    const statusSubject = new Subject<chatGatewayTypes.ChatStatusMessage>();
    const statusSubscription = statusSubject.subscribe((status) => {
      client.emit('chat-message-status-response', status);
    });
    this.clientSubjects.set(`${client.id}-chat-message-status-response`, statusSubject);
    this.clientSubscriptions.set(`${client.id}-chat-message-status-response`, statusSubscription);

    // Pass the statusSubject to the chat function so it can dispatch status messages
    const subject = new Subject<chatGatewayTypes.ChatMessage>();
    const subscription = subject.pipe(concatMap((payload) => from(this.promptusService.chat(payload, statusSubject)))).subscribe((message) => {
      client.emit('chat-message-response', message);
    });

    this.clientSubjects.set(`${client.id}-chat-message`, subject);
    this.clientSubscriptions.set(`${client.id}-chat-message`, subscription);

    return subject;
  }
}
