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
import { AuthService } from '../services/auth/auth.service';
import { Logger } from '@nestjs/common';
import { BehaviorSubject, bufferTime, concatMap, delayWhen, filter, from, map, of, Subject, Subscription, take, timer } from 'rxjs';
import * as chatGatewayTypes from './chat.gateway.types';
import { ChatFeedbackMessage } from './chat.gateway.types';
import { PromptusService } from '../services/promptus/promptus.service';
import { NounouneSession, SessionId, SessionService } from '../services/session/session.service';

type ChannelName =
  | `${SessionId}-chat-feedback`
  | `${SessionId}-chat-message`
  | `${SessionId}-chat-message-status-response`
  | `${SessionId}-user-status`;
type FeedbackCounts = Partial<Record<ChatFeedbackMessage['feedback'], number>>;

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
    private readonly promptusService: PromptusService,
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  async handleConnection(client: Socket) {
    const apiKey = client.handshake.headers['x-api-key'] || client.handshake.auth['apiKey'];
    const userId = client.handshake.headers['x-user-id'] || client.handshake.auth['userId'];

    if (!this.authService.validateApiKey(apiKey as string | undefined)) {
      this.logger.warn(`Unauthorised connection attempt from ${client.id}`);
      client.disconnect();
      return;
    }

    if (!userId) {
      this.logger.warn(`Unauthorised connection attempt from ${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const sessionId = await this.sessionService.retrieveUserSession(userId, client);

      if (sessionId) {
        client.join(sessionId);
        this.logger.log(`Reconnecting client ${sessionId} |=| ${client.id}`);
      } else {
        const sessionId = await this.sessionService.createSession(userId, client);
        if (sessionId) {
          client.join(sessionId);
        }
        this.logger.log(`Creating session for user ${userId} |+| ${sessionId} `);
      }
    } catch (error) {
      this.logger.error(`Error handleConnection session: ${error.message}`);
      client.disconnect();
      return;
    }
  }

  async handleDisconnect(client: Socket) {
    await this.sessionService.disconnected(client, (sessionId: string) => this.unSubscribeClient(sessionId));
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private unSubscribeClient(sessionId: string) {
    for (const channel of this.channels) {
      this.clientSubjects.get(`${sessionId}${channel}`)?.complete();
      this.clientSubscriptions.get(`${sessionId}${channel}`)?.unsubscribe();
      this.clientSubjects.delete(`${sessionId}${channel}`);
      this.clientSubscriptions.delete(`${sessionId}${channel}`);
    }
  }

  @SubscribeMessage('chat-feedback')
  handleDataStream(@MessageBody() payload: any, @ConnectedSocket() client: Socket) {
    const sessionId = this.sessionService.getSessionId(client.id)?.id;

    if (this.clientSubjects.has(`${sessionId}-chat-feedback`)) {
      this.clientSubjects.get(`${sessionId}-chat-feedback`)?.next(payload);
    } else if (sessionId) {
      this.subscribeToFeedback(client, sessionId).next(payload);
    } else {
      throw new Error('No session id found chat-feedback');
    }
  }

  private subscribeToFeedback(client: Socket, sessionId: SessionId): Subject<ChatFeedbackMessage> {
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

    this.clientSubjects.set(`${sessionId}-chat-feedback`, subject);
    this.clientSubscriptions.set(`${sessionId}-chat-feedback`, subscription);
    return subject;
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(@MessageBody() payload: chatGatewayTypes.ChatMessage, @ConnectedSocket() client: Socket) {
    const session = this.sessionService.getSessionId(client.id);

    if (this.clientSubjects.has(`${session?.id}-chat-message`)) {
      this.clientSubjects.get(`${session?.id}-chat-message`)?.next(payload);
    } else if (session) {
      this.subscribeToChat(client, session).next(payload);
    } else {
      throw new Error('No session id found chat-message');
    }
  }

  private subscribeToChat(client: Socket, session: NounouneSession): Subject<chatGatewayTypes.ChatMessage> {
    const persistentId = session.id;

    // Create a reusable delay function to keep the code DRY
    const waitForActiveConnection = () => {
      // If there is no tracker, assume they are connected and let it pass instantly
      if (!session.status) {
        return of(true);
      }

      // If the tracker exists, wait for the behaviour subject to emit 'active'
      return session.status.pipe(
        filter((status) => status === 'active'),
        take(1),
      );
    };

    // --- 1. Setup Status Stream ---
    const statusSubject = new Subject<chatGatewayTypes.ChatStatusMessage>();
    const statusSubscription = statusSubject
      .pipe(
        delayWhen(waitForActiveConnection), // Apply the pause logic
      )
      .subscribe((status) => {
        this.server.to(persistentId).emit('chat-message-response', status);
      });

    // Track by persistent ID
    this.clientSubjects.set(`${persistentId}-chat-status` as ChannelName, statusSubject);
    this.clientSubscriptions.set(`${persistentId}-chat-status` as ChannelName, statusSubscription);

    // --- 2. Setup Main Chat Stream ---
    const subject = new Subject<chatGatewayTypes.ChatMessage>();
    const subscription = subject
      .pipe(
        // Process the heavy AI lifting instantly
        concatMap((payload) => from(this.promptusService.chat(payload, statusSubject))),
        // 3. CRITICAL: Apply the exact same pause logic to the final message delivery
        delayWhen(waitForActiveConnection),
      )
      .subscribe((message) => {
        this.server.to(persistentId).emit('chat-message-response', message);
      });

    this.clientSubjects.set(`${persistentId}-chat-message`, subject);
    this.clientSubscriptions.set(`${persistentId}-chat-message`, subscription);

    return subject;
  }
}
