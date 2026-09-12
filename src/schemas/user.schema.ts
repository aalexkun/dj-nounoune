import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/** `blocked` wins over `AUTH_ALLOWED_EMAILS`: a listed person who is blocked still cannot sign in. */
export type UserStatus = 'active' | 'blocked';

/**
 * One document per person who has signed in with Google at least once.
 *
 * Keyed on Google's `sub` claim because that is the stable identity — an email can be renamed at
 * Google and reassigned inside a Workspace — with the email beside it because that is what humans,
 * the CLI and `AUTH_ALLOWED_EMAILS` match on. Nobody is created here by an administrator: the first
 * successful sign-in of an allow-listed address is what writes the row.
 *
 * `Chat.userId` holds this document's `_id` as a string. Not the email (it appears in logs and can
 * change) and not the Google `sub` (opaque enough, but then two collections would carry Google's key).
 */
@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, description: 'Google account id (`sub` claim), the stable identity' })
  googleSub: string;

  @Prop({ required: true, unique: true, lowercase: true, description: 'Google account email, the login and what the allow-list matches' })
  email: string;

  @Prop({ description: 'Display name as Google reports it' })
  name?: string;

  @Prop({ description: 'Avatar url as Google reports it' })
  picture?: string;

  @Prop({
    type: String,
    required: true,
    enum: ['active', 'blocked'],
    default: 'active',
    description: 'active | blocked; blocked wins over the allow-list',
  })
  status: UserStatus;

  @Prop({ required: true, default: 0, description: 'Bumped to invalidate every session minted before it' })
  sessionEpoch: number;

  @Prop({ description: 'Last successful sign-in' })
  lastLoginAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
