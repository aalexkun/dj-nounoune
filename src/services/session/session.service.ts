import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Connection, ConnectionDocument } from '../../schemas/connection.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Socket } from 'socket.io';
import { BehaviorSubject, Subscription, timer } from 'rxjs';
import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '../../utils/error.utils';

const FIVE_MIN_IN_MS = 5 * 60 * 1000;

/** What a device is called when the client named neither itself nor its user agent. */
const UNKNOWN_DEVICE = 'Unknown Device';

export type SessionId = string;
export type SessionStatus = 'active' | 'disconnected' | 'expired';
export type NounouneSession = {
  id: string;
  status: BehaviorSubject<SessionStatus>;
  socketId: string;
  userId: string;
  deviceId: string;
  deviceName?: string;
  connectionId: string;
};

/**
 * What identifies a phone, and what a human calls it.
 *
 * `deviceId` is the key and is minted once by the client; `deviceName` is for the log line and the
 * connection listing. They are passed together because a session that is created stores both while
 * only the id ever matches.
 */
export type DeviceIdentity = {
  deviceId: string;
  deviceName: string;
};

@Injectable()
export class SessionService implements OnModuleInit {
  private logger = new Logger('SessionService');
  private sessions = new Map<SessionId, NounouneSession>();
  private pendingLogouts = new Map<SessionId, Subscription>();

  constructor(@InjectModel(Connection.name) private connectionModel: Model<ConnectionDocument>) {}

  async onModuleInit() {
    // The wipe belongs to the server that owns the sockets. A CLI command boots this same module,
    // and without the gate every `npm run cli` cleared the live server's rows from under it — which
    // mattered little while a session was keyed on a user agent, and matters now that `deviceId`
    // is what a reconnecting phone is matched on.
    if (process.env.IS_CLI === 'true') return;

    this.logger.log('Server starting: Clearing stale WebSocket connections...');

    try {
      // Deletes all documents in the collection
      const result = await this.connectionModel.deleteMany({});

      this.logger.log(`Successfully cleared ${result.deletedCount} stale connections.`);
    } catch (error) {
      this.logger.error(`Failed to clear connections: ${getErrorMessage(error)}`);
    }
  }

  getSession(socketId: string) {
    return this.sessions.get(socketId);
  }

  /**
   * The session this phone was already using, if it still has one.
   *
   * Matched on `deviceId` rather than on the user-agent it used to be matched on: every build of
   * the Android app reports the same `DomoticGiraffe/1.0 (Android)` string, so two phones on one
   * account shared a single `Connection` document and the second silently took the first's room
   * over. The id is minted once per install, so two devices are two sessions however alike their
   * user agents read.
   */
  async retrieveUserSession(userId: string, deviceId: string, client: Socket) {
    const existingSessionDoc = await this.connectionModel
      .findOne({
        userId: userId,
        status: { $ne: 'expired' },
        deviceId,
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
        // The document outlived the in-memory session — a server restart, most often. The device is
        // described from the row rather than from the handshake, so the new session inherits the
        // name the old one was recorded under.
        return await this.createSession(userId, { deviceId, deviceName: existingSessionDoc.deviceName ?? UNKNOWN_DEVICE }, client);
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

    const logoutSubscription = timer(FIVE_MIN_IN_MS).subscribe(() => {
      void this.logoutAfterGrace(sessionInfo, clientId, deviceConnectionId, sessionCleanupCallback);
    });

    this.pendingLogouts.set(deviceConnectionId, logoutSubscription);
    await this.connectionModel.updateOne({ socketId: client.id }, { status: 'disconnected' }).exec();
    this.sessions.get(clientId)?.status?.next('disconnected');

    this.logger.log(`[Session logout scheduled in ${FIVE_MIN_IN_MS}ms]: Session id ${sessionInfo.id} `);
  }

  /** The grace timer's body, kept out of the subscriber so that callback stays synchronous. */
  private async logoutAfterGrace(
    sessionInfo: NounouneSession,
    clientId: string,
    deviceConnectionId: string,
    sessionCleanupCallback: (sessionId: string) => void,
  ): Promise<void> {
    try {
      this.logger.log(`[Session Disconnected for ${FIVE_MIN_IN_MS}ms] Logout session: ${deviceConnectionId}`);
      const lastDevice = await this.logoutDevice(sessionInfo);

      if (lastDevice) {
        sessionCleanupCallback(sessionInfo.id);
      }
    } catch (err) {
      this.logger.error(`Failed to logout user ${clientId}: ${getErrorMessage(err)}`);
    } finally {
      this.pendingLogouts.get(deviceConnectionId)?.unsubscribe();
      this.pendingLogouts.delete(deviceConnectionId);
    }
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

  /**
   * A fresh session for this device.
   *
   * Both halves of `device` are stored: the id is what the next connect is matched on, the name is
   * what a log line and the connection listing read.
   */
  async createSession(userId: string, device: DeviceIdentity, client: Socket) {
    const newSession = new this.connectionModel({
      socketId: client.id,
      sessionId: randomUUID(),
      status: 'active',
      deviceId: device.deviceId,
      deviceName: device.deviceName || UNKNOWN_DEVICE,
      ...(userId ? { userId: userId } : {}),
    });
    const session = await newSession.save();

    if (client.id && session) {
      const nounouneSession = {
        id: session.sessionId,
        socketId: session.socketId,
        userId: session.userId,
        status: new BehaviorSubject<SessionStatus>('active'),
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        connectionId: session.id.toString(),
      };
      this.sessions.set(client.id, nounouneSession);

      return nounouneSession;
    }

    return null;
  }
}
