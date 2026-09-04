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
import { OnEvent } from '@nestjs/event-emitter';
import { SessionService } from '../services/session/session.service';
import { ChatService } from '../services/chat/chat.service';
import {
  ChatFeedbackEvent,
  ChatMessageEvent,
  ChatMessageResponseEvent,
  ChatMessageResponseEventName,
  ChatStatusResponseEvent,
  ChatStatusResponseEventName,
} from '../services/chat/chat.event';
import { getErrorMessage } from '../utils/error.utils';

@WebSocketGateway({
  cors: true,
  pingInterval: 1000, // 10 seconds (Default is 25000)
  pingTimeout: 1000, // 5 seconds (Default is 20000)
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('ChatGateway');

  constructor(
    private readonly chatService: ChatService,
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * A credential from the handshake: the header first, then socket.io's `auth` bag. The bag is
   * typed as `any` by socket.io, so only a string is accepted out of it.
   */
  private credential(client: Socket, header: string, authKey: string): string | undefined {
    const fromHeader = client.handshake.headers[header];
    const headerValue = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    if (headerValue) return headerValue;
    const fromAuth: unknown = client.handshake.auth[authKey];
    return typeof fromAuth === 'string' ? fromAuth : undefined;
  }

  async handleConnection(client: Socket) {
    const apiKey = this.credential(client, 'x-api-key', 'apiKey');
    const userId = this.credential(client, 'x-user-id', 'userId');

    if (!this.authService.validateApiKey(apiKey)) {
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
      const session = await this.sessionService.retrieveUserSession(userId, client);
      if (session) {
        void client.join(session.id);
        this.logger.log(`Reconnecting client ${session.id} |=| ${client.id}`);
        session.status.next('active');
      } else {
        const session = await this.sessionService.createSession(userId, client);

        if (!session) {
          this.logger.error(`Error createSession session`);
          client.disconnect();
          return;
        }

        this.logger.log(`Creating session for user ${userId} |+| ${session.id} `);
        this.chatService.subscribeToChat(session);
        this.chatService.subscribeToFeedback(session.id);
        void client.join(session.id);
      }
    } catch (error) {
      this.logger.error(`Error handleConnection session: ${getErrorMessage(error)}`);
      client.disconnect();
      return;
    }
  }

  async handleDisconnect(client: Socket) {
    await this.sessionService.disconnected(client, (sessionId: string) => this.chatService.unSubscribeSession(sessionId));
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat-feedback')
  handleDataStream(@MessageBody() payload: ChatFeedbackEvent, @ConnectedSocket() client: Socket) {
    const sessionId = this.sessionService.getSession(client.id)?.id;

    if (!sessionId) {
      this.logger.error(`No session id found chat-feedback ${client.id}`);
      return;
    }

    this.chatService.processFeedbackMessage(sessionId, payload);
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(@MessageBody() payload: ChatMessageEvent, @ConnectedSocket() client: Socket) {
    const sessionId = this.sessionService.getSession(client.id)?.id;
    if (!sessionId) {
      this.logger.error(`No session id found chat-feedback ${client.id}`);
      return;
    }

    this.chatService
      .processChatMessage(sessionId, payload)
      .then(() => this.logger.debug(`chat-message to ${sessionId} Exited`))
      .catch((error: unknown) => this.logger.error(`chat-message to ${sessionId} failed: ${getErrorMessage(error)}`));
  }

  /**
   * There is no socket server when the gateway was never bound — under `IS_CLI`, where the same
   * agents run from `promptus chat`. The events still fire, and reaching for a room on an undefined
   * server threw once per progress event, which the event emitter caught and logged as a stack
   * trace. Nothing is listening in that case, so there is nothing to relay.
   */
  private get hasSocketServer(): boolean {
    return !!this.server?.sockets;
  }

  @OnEvent(ChatMessageResponseEventName)
  sendChatMessageResponse(payload: ChatMessageResponseEvent) {
    if (!this.hasSocketServer) {
      return;
    }

    this.logger.debug(`${ChatMessageResponseEventName} to ${payload.sessionId}`);
    const socketsInRoom = this.server.sockets.adapter.rooms.get(payload.sessionId);
    if (socketsInRoom) {
      // 2. Convert the Set to an Array so it logs nicely
      this.logger.debug(`Room ${payload.sessionId} has ${socketsInRoom.size} client(s):`, Array.from(socketsInRoom));
    } else {
      this.logger.warn(`Room ${payload.sessionId} is completely empty! The broadcast will go nowhere.`);
    }

    this.server.to(payload.sessionId).emit('chat-message-response', payload.message);
  }

  @OnEvent(ChatStatusResponseEventName)
  sendChatMessageStatus(payload: ChatStatusResponseEvent) {
    if (!this.hasSocketServer) {
      return;
    }

    this.logger.debug(`${ChatStatusResponseEventName} to ${payload.sessionId}`);

    this.server.to(payload.sessionId).emit('chat-message-status-response', payload.message);
  }
}
