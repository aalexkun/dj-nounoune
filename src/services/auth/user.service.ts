import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { User, UserDocument } from '../../schemas/user.schema';
import { AuthenticatedUser } from './auth.types';
import { GoogleIdentity } from './google-id-token.verifier';

/**
 * How long a `User` read is reused before Mongo is asked again.
 *
 * Every REST call and every socket handshake resolves a session to its owner, and the only thing
 * that read is really for is the `blocked` flag and `sessionEpoch`. Sixty seconds is the price of a
 * block or a revoke taking effect, and it is the difference between one Mongo read per minute and
 * one per request.
 */
const CACHE_TTL_MS = 60_000;

/**
 * The people who may use this server.
 *
 * Two gates, in order: `AUTH_ALLOWED_EMAILS` decides who may ever sign in, and `status` on the
 * document decides whether someone who already has may continue. An empty allow-list means nobody —
 * a server with the variable unset refuses every sign-in rather than accepting every Google account
 * on earth, which is the only safe reading of "not configured" here.
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  /** Lower-cased, trimmed. Empty means nobody may sign in. */
  private readonly allowedEmails: ReadonlySet<string>;

  /** `_id` string -> document, valid until `expiresAt`. See {@link CACHE_TTL_MS}. */
  private readonly cache = new Map<string, { user: UserDocument; expiresAt: number }>();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {
    this.allowedEmails = new Set(
      (this.configService.get<string>('AUTH_ALLOWED_EMAILS') ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    );

    if (this.allowedEmails.size === 0) {
      this.logger.warn('AUTH_ALLOWED_EMAILS is empty — no Google account can sign in. Set it to a comma separated list of addresses.');
    }
  }

  /** Whether an address is on `AUTH_ALLOWED_EMAILS`. Case-insensitive, as the list is. */
  public isAllowed(email: string): boolean {
    return this.allowedEmails.has(email.trim().toLowerCase());
  }

  /** The configured allow-list, for the CLI to print. */
  public allowList(): string[] {
    return [...this.allowedEmails];
  }

  /**
   * Upserts the person behind a verified Google identity and records the login.
   *
   * Matched on `sub` first, then on the email — a Google account that was deleted and re-created
   * keeps its address but gets a new `sub`, and re-pointing is the only way that person keeps their
   * conversations. The reverse (one `sub`, a renamed address) is handled by writing the email back
   * on every sign-in.
   *
   * @throws ForbiddenException naming the email when it is not allow-listed or the user is blocked
   */
  public async signIn(identity: GoogleIdentity): Promise<UserDocument> {
    const email = identity.email.trim().toLowerCase();

    if (!this.isAllowed(email)) {
      throw new ForbiddenException(`${email} is not allowed to sign in on this server.`);
    }

    let user = await this.userModel.findOne({ googleSub: identity.sub }).exec();

    if (!user) {
      user = await this.userModel.findOne({ email }).exec();
      if (user) {
        this.logger.log(`Re-pointing ${email} to a new Google account id — the account was re-created at Google.`);
        user.googleSub = identity.sub;
      }
    }

    if (!user) {
      user = new this.userModel({ googleSub: identity.sub, email, status: 'active', sessionEpoch: 0 });
      this.logger.log(`First sign-in for ${email}`);
    }

    if (user.status === 'blocked') {
      throw new ForbiddenException(`${email} is blocked on this server.`);
    }

    user.email = email;
    if (identity.name) user.name = identity.name;
    if (identity.picture) user.picture = identity.picture;
    user.lastLoginAt = new Date();

    await user.save();
    this.invalidate(user._id.toString());

    return user;
  }

  /**
   * The owner of a session, from cache when it is fresh.
   *
   * A legacy caller's id (`Alexis-le-Trotteur`) is not an ObjectId; it is answered `null` here
   * rather than letting Mongoose throw a CastError on every request during the transition.
   */
  public async findById(id: string): Promise<UserDocument | null> {
    const cached = this.cache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.user;

    if (!isValidObjectId(id)) return null;

    const user = await this.userModel.findById(id).exec();
    if (user) {
      this.cache.set(id, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    } else {
      this.cache.delete(id);
    }

    return user;
  }

  public async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.trim().toLowerCase() }).exec();
  }

  /** Everybody known to this server, oldest sign-up first, for the CLI report. */
  public async list(): Promise<UserDocument[]> {
    return this.userModel.find().sort({ createdAt: 1 }).exec();
  }

  /** @returns The updated document, or `null` when no such address has ever signed in */
  public async block(email: string): Promise<UserDocument | null> {
    return this.setStatus(email, 'blocked');
  }

  /** @returns The updated document, or `null` when no such address has ever signed in */
  public async unblock(email: string): Promise<UserDocument | null> {
    return this.setStatus(email, 'active');
  }

  /**
   * Invalidates every session this person holds, on every device, in one write.
   *
   * The sessions themselves are left in Redis to expire: a record is refused when its `epoch` is
   * below the user's, so there is nothing to enumerate and no set to keep in step.
   *
   * @param emailOrId - An email address or a `User._id`
   * @returns The updated document, or `null` when nothing matched
   */
  public async bumpEpoch(emailOrId: string): Promise<UserDocument | null> {
    const filter = emailOrId.includes('@') ? { email: emailOrId.trim().toLowerCase() } : isValidObjectId(emailOrId) ? { _id: emailOrId } : null;
    if (!filter) return null;

    const user = await this.userModel.findOneAndUpdate(filter, { $inc: { sessionEpoch: 1 } }, { returnDocument: 'after' }).exec();
    if (user) this.invalidate(user._id.toString());

    return user;
  }

  /** The wire shape of a user: `id` is the document's `_id`, which is what `Chat.userId` holds. */
  public toAuthenticated(user: UserDocument): AuthenticatedUser {
    return {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      picture: user.picture,
    };
  }

  /** Drops a cached read so the next resolve sees a block, an unblock or a bumped epoch at once. */
  public invalidate(id: string): void {
    this.cache.delete(id);
  }

  private async setStatus(email: string, status: 'active' | 'blocked'): Promise<UserDocument | null> {
    const user = await this.userModel
      .findOneAndUpdate({ email: email.trim().toLowerCase() }, { $set: { status } }, { returnDocument: 'after' })
      .exec();

    if (user) this.invalidate(user._id.toString());

    return user;
  }
}
