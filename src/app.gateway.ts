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
import { Session, SessionDocument } from './schemas/session.schema';
import { AppService } from './app.service';
import { PromptusService } from './services/promptus/promptus/promptus.service';

// Enable CORS if your client is on a different domain
@WebSocketGateway({ cors: true })
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly X_API_KEY: string;

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
    // 1. Extract API Key from headers or auth payload
    const apiKey = client.handshake.headers['x-api-key'] || client.handshake.auth['apiKey'];

    // 2. Validate API Key
    if (apiKey !== this.X_API_KEY) {
      console.warn(`Unauthorised connection attempt from ${client.id}`);
      client.disconnect();
      return;
    }

    // 3. Initialise session in MongoDB
    const newSession = new this.sessionModel({
      socketId: client.id,
      status: 'active',
    });

    await newSession.save();
    console.log(`Client connected and session saved: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    // 4. Update session status upon disconnect
    await this.sessionModel.updateOne(
      { socketId: client.id, status: 'active' },
      {
        status: 'disconnected',
        disconnectedAt: new Date(),
      },
    );
    console.log(`Client disconnected: ${client.id}`);
  }

  // 5. Route for ping response as pong
  @SubscribeMessage('ping')
  handlePing(client: Socket, payload: any): string {
    console.log(`Received ping from client: ${client.id}`);
    return 'pong';
  }

  // 1. Define the specific event name the client will emit
  @SubscribeMessage('chat_message')
  handleChatMessage(
    // 2. Extract the data payload sent by the client
    @MessageBody() payload: string,
    // 3. Access the specific client socket
    @ConnectedSocket() client: Socket,
  ) {
    this.promptusService.play(payload).then((sourIdQueued) => {
      sourIdQueued.map((sourId) => client.emit('chat_message_response', 'Queued: ' + sourId.sourceId));
    });
    console.log(`Message from ${client.id}: ${payload}`);
    client.emit('chat_message_response', 'Will start playing: ' + payload);
  }
}
