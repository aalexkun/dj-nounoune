import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import { z } from 'zod';
import { PROVIDER_CREDENTIAL_PROVIDERS, ProviderCredential, ProviderCredentialDocument } from '../../schemas/provider-credential.schema';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * The providers that keep a session here, derived from the tuple the Mongo enum is built from so
 * the two cannot disagree: a fourth provider is one edit, in the schema.
 */
export type ProviderName = (typeof PROVIDER_CREDENTIAL_PROVIDERS)[number];

/** AES-256-GCM: authenticated, so a tampered or half-written row fails to decrypt rather than returning garbage. */
const ALGORITHM = 'aes-256-gcm';

/** AES-256 takes a 256-bit key, and `createCipheriv` throws on anything else. */
const KEY_LENGTH_BYTES = 32;

/** The IV length GCM is specified for. Longer ones are hashed by the mode and buy nothing. */
const IV_LENGTH_BYTES = 12;

/** Command that mints a usable key, quoted in every message about a missing one. */
const KEY_HINT = 'openssl rand -base64 32';

/**
 * The Spotify, Qobuz and YouTube sessions, encrypted at rest in `provider_credentials`.
 *
 * Replaces the three dotfiles at the repo root. The value handed to {@link save} is JSON inside the
 * ciphertext and comes back out through the caller's own Zod schema, so each provider service keeps
 * owning the shape of its session exactly as it did when it owned the file.
 *
 * **A missing key turns the store off, it does not stop the boot.** `CREDENTIAL_ENCRYPTION_KEY` is
 * optional in the same sense every provider's credentials are: without it the provider features are
 * unavailable and the app still serves chat, the queue and `/vibing-on`. So the constructor warns
 * once, {@link load} answers `null` — which every caller already handles, since it is also what an
 * absent dotfile used to produce — and {@link save} throws, because silently dropping a freshly
 * minted refresh token would be worse than failing the auth command. Nothing is ever written in
 * plaintext as a fallback.
 */
@Injectable()
export class CredentialStoreService {
  private readonly logger = new Logger(CredentialStoreService.name);

  /** The decoded 32-byte key, or `null` when it is missing or the wrong length. */
  private readonly key: Buffer | null;

  /** First 8 hex of sha256 of the raw key, stamped on every row so a rotation is recognisable. */
  private readonly keyId: string;

  /** Why the key was rejected, kept for the message {@link save} throws. Empty when the key is good. */
  private readonly keyProblem: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(ProviderCredential.name) private readonly credentialModel: Model<ProviderCredentialDocument>,
  ) {
    const raw = this.configService.get<string>('CREDENTIAL_ENCRYPTION_KEY') ?? '';
    const { key, problem } = CredentialStoreService.decodeKey(raw);

    this.key = key;
    this.keyProblem = problem;
    this.keyId = key ? createHash('sha256').update(raw.trim()).digest('hex').slice(0, 8) : '';

    if (!key) {
      this.logger.warn(`${problem} The Spotify, Qobuz and YouTube sessions cannot be read or written. Generate one with \`${KEY_HINT}\`.`);
    }
  }

  /**
   * Decodes `CREDENTIAL_ENCRYPTION_KEY`.
   *
   * Base64 is lenient — Node happily decodes a truncated or non-base64 string into a short buffer
   * rather than failing — so the length check is the real validation, and it is what catches the
   * common mistake of pasting a 32-*character* passphrase instead of 32 bytes of base64.
   */
  private static decodeKey(raw: string): { key: Buffer | null; problem: string } {
    const trimmed = raw.trim();

    if (!trimmed) {
      return { key: null, problem: 'CREDENTIAL_ENCRYPTION_KEY is not set.' };
    }

    const decoded = Buffer.from(trimmed, 'base64');

    if (decoded.length !== KEY_LENGTH_BYTES) {
      return {
        key: null,
        problem: `CREDENTIAL_ENCRYPTION_KEY must be base64 for exactly ${KEY_LENGTH_BYTES} bytes, and decodes to ${decoded.length}.`,
      };
    }

    return { key: decoded, problem: '' };
  }

  /** Whether a usable key is configured. Callers use it to skip work that would only fail. */
  public isEnabled(): boolean {
    return this.key !== null;
  }

  /**
   * Reads one provider's session back.
   *
   * Every failure answers `null` rather than throwing: an absent row, a row written under a
   * different key, a payload that no longer matches `schema`. That is deliberate — it is exactly
   * what an absent or unreadable dotfile used to produce, so the provider services' existing
   * "no session, run the auth command" branches keep working unchanged.
   *
   * @param provider - Which provider's session to read
   * @param schema - The caller's own shape for the decrypted JSON
   * @returns The parsed session, or `null` when there is nothing usable to return
   */
  public async load<T>(provider: ProviderName, schema: z.ZodType<T>): Promise<T | null> {
    if (!this.key) {
      return null;
    }

    try {
      const row = await this.credentialModel.findOne({ provider }).lean().exec();

      if (!row) {
        return null;
      }

      if (row.keyId !== this.keyId) {
        this.logger.warn(
          `The stored ${provider} session was encrypted with a different key (row ${row.keyId}, current ${this.keyId}) and cannot be read. ` +
            `Restore the previous CREDENTIAL_ENCRYPTION_KEY, or authenticate again to overwrite it.`,
        );
        return null;
      }

      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(row.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));

      const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');

      const parsed = schema.safeParse(JSON.parse(plaintext) as unknown);

      if (!parsed.success) {
        this.logger.warn(`The stored ${provider} session does not match the expected shape - ignoring it. Authenticate again to replace it.`);
        return null;
      }

      return parsed.data;
    } catch (error) {
      this.logger.warn(`Could not read the stored ${provider} session: ${getErrorMessage(error)}`);
      return null;
    }
  }

  /**
   * Encrypts and stores one provider's session, replacing whatever was there.
   *
   * @param provider - Which provider's session is being written
   * @param value - Anything `JSON.stringify` accepts; the reader's schema decides what it means
   * @param updatedBy - Email of the person who ran the auth flow, or `cli`
   * @throws When no usable `CREDENTIAL_ENCRYPTION_KEY` is configured. A refresh token that took a
   *   human in the loop to obtain must not be dropped quietly.
   */
  public async save(provider: ProviderName, value: unknown, updatedBy: string = 'cli'): Promise<void> {
    if (!this.key) {
      throw new Error(`Cannot store the ${provider} session: ${this.keyProblem} Generate one with \`${KEY_HINT}\` and set it in .env.`);
    }

    const plaintext = JSON.stringify(value);

    if (plaintext === undefined) {
      throw new Error(`Cannot store the ${provider} session: the value is not JSON-serialisable.`);
    }

    // A fresh IV per write, never derived from the provider name or a counter: reusing an IV under
    // one key is the failure mode GCM has no defence against.
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    await this.credentialModel
      .findOneAndUpdate(
        { provider },
        {
          $set: {
            provider,
            keyId: this.keyId,
            iv: iv.toString('base64'),
            ciphertext: ciphertext.toString('base64'),
            authTag: cipher.getAuthTag().toString('base64'),
            updatedBy,
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();
  }

  /** Forgets one provider's session. The next call that needs it reports there is none. */
  public async clear(provider: ProviderName): Promise<void> {
    await this.credentialModel.deleteOne({ provider }).exec();
  }
}
