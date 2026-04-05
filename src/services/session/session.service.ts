import { Injectable, Logger } from '@nestjs/common';
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
};

@Injectable()
export class SessionService {
  private logger = new Logger('SessionService');
  private sessions = new Map<SessionId, NounouneSession>();
  private pendingLogouts = new Map<SessionId, Subscription>();

  constructor(@InjectModel(Connection.name) private sessionModel: Model<ConnectionDocument>) {}

  getSessionId(clientId: string) {
    return this.sessions.get(clientId);
  }

  async retrieveUserSession(userId: string, client: Socket) {
    const existingSessionDoc = await this.sessionModel
      .findOne({
        userId: userId,
        status: 'disconnected',
      })
      .exec();

    if (existingSessionDoc) {
      const oldSocketId = existingSessionDoc?.socketId || null;
      await existingSessionDoc.updateOne({ socketId: client.id, status: 'active' }).exec();
      const userSessionId = existingSessionDoc.sessionId;
      const connectionId = existingSessionDoc.id.toString();

      // Cleanup any pending logout
      this.pendingLogouts.delete(connectionId);

      // Remap client id with NounouneSession behaviorSubject
      if (oldSocketId && this.sessions.has(oldSocketId)) {
        const nounouneSession = this.sessions.get(oldSocketId);
        if (nounouneSession) {
          this.sessions.set(client.id, nounouneSession);
          this.sessions.delete(oldSocketId);
          nounouneSession.status.next('active');
        }
      } else {
        return await this.createSession(userId, client);
      }

      return userSessionId;
    }

    return null;
  }

  async disconnected(client: Socket, sessionCleanupCallback: (sessionId: string) => void) {
    const clientId = client.id;
    const sessionInfo = this.sessions.get(clientId);

    if (!sessionInfo?.id) {
      this.logger.error('Could not find session id for client: ' + clientId);
      return;
    }

    const deviceSessionId = sessionInfo.id;

    const logoutSubscription = timer(FIVE_MIN_IN_MS).subscribe(async () => {
      try {
        this.logger.log(`[Session Disconnected for ${FIVE_MIN_IN_MS}ms] Logout session: ${deviceSessionId}`);
        const lastDevice = await this.logoutDevice(sessionInfo);
        sessionInfo.status.complete();
        this.sessions.delete(clientId);
        if (lastDevice) {
          sessionCleanupCallback(sessionInfo.id);
        }
      } catch (err) {
        this.logger.error(`Failed to logout user ${clientId}: ${err.message}`);
      } finally {
        this.pendingLogouts.delete(deviceSessionId);
      }
    });

    this.pendingLogouts.set(deviceSessionId, logoutSubscription);
    await this.sessionModel.updateOne({ socketId: client.id }, { status: 'disconnected' }).exec();
    this.sessions.get(clientId)?.status?.next('disconnected');

    this.logger.log(`[Session logout scheduled in ${FIVE_MIN_IN_MS}ms]: Session id ${sessionInfo.id} `);
  }

  private async logoutDevice(nounouneSession: NounouneSession): Promise<boolean> {
    await this.sessionModel.updateOne(
      { socketId: nounouneSession.socketId },
      {
        status: 'expired',
        logoutAt: new Date(),
      },
    );

    const activeDevice = await this.sessionModel.countDocuments({ sessionId: nounouneSession.id, status: { $ne: 'expired' } });
    return activeDevice.valueOf() === 0;
  }

  async createSession(userId: string, client: Socket) {
    const newSession = new this.sessionModel({
      socketId: client.id,
      sessionId: randomUUID(),
      status: 'active',
      deviceName: client.handshake.headers['user-agent'],
      ...(userId ? { userId: userId as string } : {}),
    });
    const session = await newSession.save();

    if (client.id && session) {
      const nounouneSession = {
        id: session.sessionId,
        socketId: session.socketId,
        userId: session.userId,
        status: new BehaviorSubject<SessionStatus>('active'),
        deviceName: session.deviceName,
      };
      this.sessions.set(client.id, nounouneSession);

      return nounouneSession.id;
    }

    return null;
  }
}
