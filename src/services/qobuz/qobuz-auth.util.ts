import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { CredentialStoreService } from '../credential-store/credential-store.service';

/**
 * The Qobuz OAuth flow: print an authorize url, the user pastes back the code from the redirect,
 * the code is traded for a user token and the session goes into the credential store.
 *
 * A plain class rather than a provider — `QobuzService` constructs it in `onModuleInit` — so
 * everything it needs arrives through the constructor.
 */
export class QobuzAuthUtil {
  private readonly logger = new Logger(QobuzAuthUtil.name);

  private readonly OAUTH_APP_ID: string;
  private readonly OAUTH_PRIVATE_KEY: string;
  private readonly QOBUZ_API_BASE: string;
  private readonly QOBUZ_OAUTH_URL: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly credentialStore: CredentialStoreService,
  ) {
    this.OAUTH_APP_ID = this.configService.get<string>('QOBUZ_OAUTH_APP_ID') || '798273057';
    this.OAUTH_PRIVATE_KEY = this.configService.get<string>('QOBUZ_OAUTH_PRIVATE_KEY') || '6lz8C03UDIC7';
    this.QOBUZ_API_BASE = this.configService.get<string>('QOBUZ_API_BASE') || 'https://www.qobuz.com/api.json/0.2';
    this.QOBUZ_OAUTH_URL = this.configService.get<string>('QOBUZ_OAUTH_URL') || 'https://www.qobuz.com/signin/oauth';
  }

  public getAuthorizeUrl(): Promise<string> {
    const redirectUrl = this.configService.get<string>('QOBUZ_REDIRECT_URL') || 'https://dj-nounoune.supa-smart.lan/callback';

    const params = new URLSearchParams({
      ext_app_id: this.OAUTH_APP_ID,
      redirect_url: redirectUrl,
    });

    const authorizeURL = `${this.QOBUZ_OAUTH_URL}?${params.toString()}`;
    this.logger.log(`1. Visit this URL to authorize the app:\n${authorizeURL}`);

    return Promise.resolve(authorizeURL);
  }

  public async handleAuthorizationCodeGrant(code: string): Promise<{ userId: string; userAuthToken: string } | void> {
    if (!code) {
      this.logger.error('Error: No code provided.');
      return;
    }

    try {
      // Step 1: Exchange code for token
      const tokenUrl = new URL(`${this.QOBUZ_API_BASE}/oauth/callback`);
      tokenUrl.searchParams.append('code', code);
      tokenUrl.searchParams.append('private_key', this.OAUTH_PRIVATE_KEY);

      const tokenResponse = await fetch(tokenUrl.toString(), {
        method: 'GET',
        headers: {
          'X-App-Id': this.OAUTH_APP_ID,
        },
      });

      if (!tokenResponse.ok) {
        const text = await tokenResponse.text();
        throw new Error(`Token exchange failed (${tokenResponse.status}): ${text}`);
      }

      const tokenJson = (await tokenResponse.json()) as unknown;

      const TokenDataSchema = z.object({
        token: z.string(),
        user_id: z.union([z.string(), z.number()]),
      });
      const tokenData = TokenDataSchema.parse(tokenJson);

      const userAuthToken = tokenData.token;
      const userId = String(tokenData.user_id);

      // Step 2: Validate token and fetch profile
      const loginResponse = await fetch(`${this.QOBUZ_API_BASE}/user/login`, {
        method: 'POST',
        headers: {
          'X-App-Id': this.OAUTH_APP_ID,
          'X-User-Auth-Token': userAuthToken,
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: 'extra=partner',
      });

      if (!loginResponse.ok) {
        const text = await loginResponse.text();
        throw new Error(`Login validation failed (${loginResponse.status}): ${text}`);
      }

      const profileJson = (await loginResponse.json()) as unknown;

      const ProfileDataSchema = z
        .object({
          user: z
            .object({
              email: z.string().optional(),
            })
            .optional(),
        })
        .passthrough();

      const profileData = ProfileDataSchema.parse(profileJson);
      const userEmail = profileData.user?.email || 'Unknown User';

      // Thrown past rather than caught: a Qobuz user token takes a browser round trip to obtain and
      // is not something to lose to a warning line the operator will scroll past.
      await this.credentialStore.save('qobuz', { userId, userAuthToken });

      this.logger.log(`\nSuccess! Authenticated as ${userEmail}. Session stored, encrypted, in provider_credentials.`);

      return { userId, userAuthToken };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error during Qobuz OAuth flow: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
