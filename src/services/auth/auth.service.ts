import { Injectable, Logger } from '@nestjs/common';
import { AppService } from '../../app.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConnectionDocument, Connection } from '../../schemas/connection.schema';

/**
 * The transitional shared key.
 *
 * `AUTHX_API_KEY` is one secret for every device, baked into every APK ever built, and the server
 * then believes whatever `x-user-id` the caller sends. It is kept only while phones running the old
 * build are still in use; the real credential is a session bearer token (`AuthSessionService`).
 *
 * The key is **optional**, and it is off by default. Absent, the legacy path is off and every
 * caller must present a bearer token (it used to throw at construction, which meant the CLI needed
 * a key for an HTTP check it never performs). Present, the path is still off until
 * `AUTHX_API_KEY_ENABLED=true` says otherwise: the key alone admits nobody. So the rollout is one
 * flag set to true, the cutover is deleting it, and a phone that turns out to still run the old
 * build gets the flag back rather than an 80 character secret re-pasted. None of it is a code change.
 */
@Injectable()
export class AuthService {
  /** `null` when no key is configured. */
  private readonly X_API_KEY: string | null;

  /** The key is configured **and** `AUTHX_API_KEY_ENABLED=true`. Either alone leaves the path off. */
  private readonly legacyEnabled: boolean;

  private readonly log = new Logger('AuthService');

  constructor(
    private readonly appService: AppService,
    @InjectModel(Connection.name) private sessionModel: Model<ConnectionDocument>,
  ) {
    const apiKey = this.appService.getAuthXApiKey()?.trim();
    this.X_API_KEY = apiKey ? apiKey : null;
    this.legacyEnabled = this.X_API_KEY !== null && this.appService.isAuthXApiKeyEnabled();

    if (!this.X_API_KEY) {
      this.log.warn('AUTHX_API_KEY is not set — the legacy x-api-key path is disabled; callers must present a session bearer token.');
    } else if (!this.legacyEnabled) {
      this.log.log(
        'AUTHX_API_KEY is set but AUTHX_API_KEY_ENABLED is not true — the legacy x-api-key path is off; callers must present a session bearer token.',
      );
    } else {
      this.log.warn('The legacy x-api-key path is ON (AUTHX_API_KEY_ENABLED=true). Remove the flag once every phone runs the Google sign-in build.');
    }
  }

  /** Whether the legacy `x-api-key` + `x-user-id` pair is still accepted anywhere. */
  isLegacyEnabled(): boolean {
    return this.legacyEnabled;
  }

  /** `false` whenever the path is off, whatever the caller sent: the switch cannot be bypassed by a consumer that forgets `isLegacyEnabled`. */
  validateApiKey(apiKey: string | string[] | undefined): boolean {
    if (!this.legacyEnabled || !this.X_API_KEY) return false;
    return apiKey === this.X_API_KEY;
  }
}
