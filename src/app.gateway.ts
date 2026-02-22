import { WebSocketGateway, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument } from './schemas/session.schema';
import { AppService } from './app.service';

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
    return 'pong';
  }
}
