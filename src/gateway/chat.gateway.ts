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
import * as chatGatewayTypes from './chat.gateway.types';
import { SessionService } from '../services/session/session.service';
import { ChatService } from '../services/chat/chat.service';
import {
  ChatMessageResponseEvent,
  ChatMessageResponseEventName,
  ChatStatusResponseEvent,
  ChatStatusResponseEventName,
} from '../services/chat/chat.event';

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
      const session = await this.sessionService.retrieveUserSession(userId, client);
      if (session) {
        client.join(session.id);
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
        client.join(session.id);
      }
    } catch (error) {
      this.logger.error(`Error handleConnection session: ${error.message}`);
      client.disconnect();
      return;
    }
  }

  async handleDisconnect(client: Socket) {
    await this.sessionService.disconnected(client, (sessionId: string) => this.chatService.unSubscribeSession(sessionId));
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('chat-feedback')
  handleDataStream(@MessageBody() payload: any, @ConnectedSocket() client: Socket) {
    const sessionId = this.sessionService.getSession(client.id)?.id;

    if (!sessionId) {
      this.logger.error(`No session id found chat-feedback ${client.id}`);
      return;
    }

    this.chatService.processFeedbackMessage(sessionId, payload);
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(@MessageBody() payload: any, @ConnectedSocket() client: Socket) {
    const sessionId = this.sessionService.getSession(client.id)?.id;
    if (!sessionId) {
      this.logger.error(`No session id found chat-feedback ${client.id}`);
      return;
    }

    this.chatService.processChatMessage(sessionId, payload).then((message) => {
      this.logger.debug(`chat-message to ${sessionId} Exited`);
    });
  }

  @OnEvent(ChatMessageResponseEventName)
  sendChatMessageResponse(payload: ChatMessageResponseEvent) {
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
    this.logger.debug(`${ChatStatusResponseEventName} to ${payload.sessionId}`);

    this.server.to(payload.sessionId).emit('chat-message-status-response', payload.message);
  }
}
