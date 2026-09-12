import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProviderCredentialDocument = HydratedDocument<ProviderCredential>;

/**
 * The three streaming providers whose sessions live here. `ProviderName` in
 * `credential-store.service.ts` is derived from it; the enum below is what stops a typo reaching the collection.
 */
export const PROVIDER_CREDENTIAL_PROVIDERS = ['spotify', 'qobuz', 'youtube'] as const;

/**
 * One streaming provider's session, encrypted at rest.
 *
 * These used to be `.spotify-session.json`, `.qobuz-session.json` and `.youtube-session.json` at
 * the repo root, which had two problems: the tokens sat in plaintext, and the path was relative to
 * `process.cwd()`, so in the image — where the working directory is root-owned and the process runs
 * as `node` — a refresh could not be written back at all.
 *
 * The payload is AES-256-GCM ciphertext over the JSON the provider service used to write to its
 * dotfile, so each service keeps parsing the value with its own Zod schema and nothing else about
 * the shape changed. The key is `CREDENTIAL_ENCRYPTION_KEY` and is never stored here: without it a
 * dump of this collection is three rows of base64 and no tokens.
 *
 * **Mongo rather than Redis, deliberately.** These are the only copy of refresh tokens that took a
 * human in the loop to obtain, and for Qobuz that loop involves Wireshark. `promptus clear-cache`
 * and `RedisCacheService.deleteByPattern('*')` would take them with it. Redis holds what can be
 * re-minted by tapping a button; Mongo holds what cannot.
 */
@Schema({
  timestamps: true,
  autoCreate: true,
  collection: 'provider_credentials',
  versionKey: '__v',
})
export class ProviderCredential {
  @Prop({
    type: String,
    required: true,
    unique: true,
    enum: [...PROVIDER_CREDENTIAL_PROVIDERS],
    description: 'Streaming provider this session belongs to: spotify, qobuz or youtube',
  })
  provider: string;

  @Prop({
    required: true,
    description:
      'First 8 hex characters of the sha256 of the raw key that encrypted this row. Not a secret and not usable to decrypt: it only lets the store say "this row was written under a different CREDENTIAL_ENCRYPTION_KEY" instead of reporting a corrupt payload after a rotation',
  })
  keyId: string;

  @Prop({
    required: true,
    description:
      'AES-256-GCM initialisation vector, base64 of 12 bytes. Freshly generated on every write — reusing one under the same key breaks GCM',
  })
  iv: string;

  @Prop({
    required: true,
    description: 'The encrypted session, base64. Plaintext is the JSON the provider service reads back with its own Zod schema',
  })
  ciphertext: string;

  @Prop({
    required: true,
    description: 'AES-256-GCM authentication tag, base64 of 16 bytes. Decryption fails rather than returning garbage when the row was tampered with',
  })
  authTag: string;

  @Prop({
    description: 'Email of the person who ran the auth flow, or "cli" when it was run from the command line',
  })
  updatedBy?: string;
}

export const ProviderCredentialSchema = SchemaFactory.createForClass(ProviderCredential);
