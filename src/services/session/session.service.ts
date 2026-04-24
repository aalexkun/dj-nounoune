import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Connection, ConnectionDocument } from '../../schemas/connection.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Socket } from 'socket.io';
import { BehaviorSubject, Subscription, timer } from 'rxjs';
import { randomUUID } from 'node:crypto';

const FIVE_MIN_IN_MS = 5 * 60 * 1000;

export type SessionId = string;
export type SessionStatus = 'active' | 'disconnected' | 'expired';
export type NounouneSession = {
  id: string;
  status: BehaviorSubject<SessionStatus>;
  socketId: string;
  userId: string;
  deviceName?: string;
  connectionId: string;
};

@Injectable()
export class SessionService implements OnModuleInit {
  private logger = new Logger('SessionService');
  private sessions = new Map<SessionId, NounouneSession>();
  private pendingLogouts = new Map<SessionId, Subscription>();

  constructor(@InjectModel(Connection.name) private connectionModel: Model<ConnectionDocument>) {}

  async onModuleInit() {
    this.logger.log('Server starting: Clearing stale WebSocket connections...');

    try {
      // Deletes all documents in the collection
      const result = await this.connectionModel.deleteMany({});

      this.logger.log(`Successfully cleared ${result.deletedCount} stale connections.`);
    } catch (error) {
      this.logger.error(`Failed to clear connections: ${error.message}`);
    }
  }

  getSession(socketId: string) {
    return this.sessions.get(socketId);
  }

  async retrieveUserSession(userId: string, client: Socket) {
    const deviceName = client.handshake.headers['user-agent'] || client.handshake.headers['User-Agent'] || 'Unknown Device';
    const existingSessionDoc = await this.connectionModel
      .findOne({
        userId: userId,
        status: { $ne: 'expired' },
        deviceName,
      })
      .exec();

    if (existingSessionDoc) {
      const oldSocketId = existingSessionDoc?.socketId || null;
      await existingSessionDoc.updateOne({ socketId: client.id, status: 'active' }).exec();
      const connectionId = existingSessionDoc.id.toString();

      // Cleanup any pending logout
      this.pendingLogouts.get(connectionId)?.unsubscribe();
      this.pendingLogouts.delete(connectionId);

      // Remap client id with NounouneSession behaviorSubject
      if (oldSocketId && this.sessions.has(oldSocketId)) {
        const nounouneSession = this.sessions.get(oldSocketId);
        if (nounouneSession) {
          this.sessions.set(client.id, {
            ...nounouneSession,
            connectionId: connectionId,
          });
          this.sessions.delete(oldSocketId);
          return this.sessions.get(client.id);
        }
      } else {
        return await this.createSession(userId, client);
      }
    }

    return null;
  }

  async disconnected(client: Socket, sessionCleanupCallback: (sessionId: string) => void) {
    const clientId = client.id;
    const sessionInfo = this.sessions.get(clientId);

    if (!sessionInfo?.connectionId) {
      this.logger.error('Could not find session id for client: ' + clientId);
      return;
    }

    const deviceConnectionId = sessionInfo.connectionId;

    const logoutSubscription = timer(FIVE_MIN_IN_MS).subscribe(async () => {
      try {
        this.logger.log(`[Session Disconnected for ${FIVE_MIN_IN_MS}ms] Logout session: ${deviceConnectionId}`);
        const lastDevice = await this.logoutDevice(sessionInfo);

        if (lastDevice) {
          sessionCleanupCallback(sessionInfo.id);
        }
      } catch (err) {
        this.logger.error(`Failed to logout user ${clientId}: ${err.message}`);
      } finally {
        this.pendingLogouts.get(deviceConnectionId)?.unsubscribe();
        this.pendingLogouts.delete(deviceConnectionId);
      }
    });

    this.pendingLogouts.set(deviceConnectionId, logoutSubscription);
    await this.connectionModel.updateOne({ socketId: client.id }, { status: 'disconnected' }).exec();
    this.sessions.get(clientId)?.status?.next('disconnected');

    this.logger.log(`[Session logout scheduled in ${FIVE_MIN_IN_MS}ms]: Session id ${sessionInfo.id} `);
  }

  private async logoutDevice(nounouneSession: NounouneSession): Promise<boolean> {
    await this.connectionModel.updateOne(
      { _id: nounouneSession.connectionId },
      {
        status: 'expired',
        logoutAt: new Date(),
      },
    );

    nounouneSession.status.complete();
    this.sessions.delete(nounouneSession.socketId);

    const activeDevice = await this.connectionModel.countDocuments({ sessionId: nounouneSession.id, status: { $ne: 'expired' } });
    return activeDevice.valueOf() === 0;
  }

  async createSession(userId: string, client: Socket) {
    const newSession = new this.connectionModel({
      socketId: client.id,
      sessionId: randomUUID(),
      status: 'active',
      deviceName: client.handshake.headers['user-agent'] || client.handshake.headers['User-Agent'] || 'Unknown Device',
      ...(userId ? { userId: userId } : {}),
    });
    const session = await newSession.save();

    if (client.id && session) {
      const nounouneSession = {
        id: session.sessionId,
        socketId: session.socketId,
        userId: session.userId,
        status: new BehaviorSubject<SessionStatus>('active'),
        deviceName: session.deviceName,
        connectionId: session.id.toString(),
      };
      this.sessions.set(client.id, nounouneSession);

      return nounouneSession;
    }

    return null;
  }
}
