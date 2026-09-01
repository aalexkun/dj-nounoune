import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { GoogleTokenResponseSchema, YoutubeSession, YoutubeSessionSchema } from './youtube.interfaces';
import { getErrorMessage } from '../../utils/error.utils';

/**
 * Google OAuth 2.0 for the YouTube Data API, in the same shape as the Spotify and Qobuz flows:
 * print an authorize url, the user pastes back the code from the redirect, the code is exchanged
 * for tokens and the session is written to a dotfile at the repo root.
 *
 * Two things about this provider are worth knowing before changing anything here.
 *
 * **Most of what this platform does needs no OAuth at all.** Search, video lookup, playlist
 * listing and playlist items are public data, reachable with nothing but an API key
 * (`YOUTUBE_API_KEY`). OAuth exists only for the user's *own* data — liked videos and private
 * playlists. `YoutubeService` therefore works with a key alone and only demands a session for the
 * handful of calls that genuinely cannot be answered without one.
 *
 * **Google validates the redirect uri against the client registration**, more strictly than Qobuz
 * does. A private hostname like the Qobuz callback's `.lan` domain is rejected outright: for a
 * "Web application" client Google requires a public TLD with https, and for a "Desktop app" client
 * it requires loopback. Loopback is the one that works without owning a public domain, which is
 * why `YOUTUBE_REDIRECT_URL` defaults to `http://localhost:3000/auth/youtube/callback`. Any port
 * is accepted on loopback, so this only has to match what is registered in the Cloud console.
 */
export class YoutubeAuthUtil {
  private readonly logger = new Logger(YoutubeAuthUtil.name);

  private readonly AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';

  /**
   * Read-only access to the signed-in account. `youtube.readonly` covers liked videos and private
   * playlists; nothing here ever writes to the user's YouTube account, so no write scope is asked
   * for — a consent screen that asks for less is one the user is more likely to grant.
   */
  public static readonly SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

  constructor(private readonly configService: ConfigService) {}

  private get clientId(): string {
    return this.configService.get<string>('YOUTUBE_CLIENT_ID') ?? '';
  }

  private get clientSecret(): string {
    return this.configService.get<string>('YOUTUBE_CLIENT_SECRET') ?? '';
  }

  private get redirectUrl(): string {
    return (
      this.configService.get<string>('YOUTUBE_REDIRECT_URL') ?? 'http://localhost:3000/auth/youtube/callback'
    );
  }

  public getSessionFilePath(): string {
    return path.join(process.cwd(), '.youtube-session.json');
  }

  /**
   * The url the user visits to grant access.
   *
   * `access_type=offline` plus `prompt=consent` is the combination that actually yields a refresh
   * token. Google omits the refresh token on every authorisation after the first for a given
   * client/user pair unless consent is forced, which turns a re-auth into a session that dies an
   * hour later with no way to renew it.
   */
  public getAuthorizeUrl(state: string = 'state'): string {
    if (!this.clientId) {
      throw new Error('YOUTUBE_CLIENT_ID is not defined, cannot start the YouTube OAuth flow.');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUrl,
      response_type: 'code',
      scope: YoutubeAuthUtil.SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });

    const authorizeUrl = `${this.AUTH_URL}?${params.toString()}`;

    this.logger.log(`1. Visit this URL to authorize the app:\n${authorizeUrl}`);
    this.logger.log(`2. After authorizing, you will be redirected to ${this.redirectUrl}?code=YOUR_CODE`);

    return authorizeUrl;
  }

  /**
   * Exchanges the authorization code for tokens and writes `.youtube-session.json`.
   *
   * @param code - The `code` query parameter from the redirect
   */
  public async handleAuthorizationCodeGrant(code: string): Promise<YoutubeSession | void> {
    if (!code) {
      this.logger.error('Error: No code provided.');
      return;
    }

    if (!this.clientId || !this.clientSecret) {
      throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must both be set to exchange the code.');
    }

    try {
      const body = new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUrl,
        grant_type: 'authorization_code',
      });

      const response = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token exchange failed (${response.status}): ${text}`);
      }

      const json = (await response.json()) as unknown;
      const token = GoogleTokenResponseSchema.parse(json);

      if (!token.refresh_token) {
        // Not fatal — the access token works for an hour — but the session will not survive that,
        // and the cause is almost always a consent screen Google skipped.
        this.logger.warn(
          'Google returned no refresh token. The session will expire in about an hour and cannot renew itself. ' +
            'Revoke the app at https://myaccount.google.com/permissions and authenticate again to force a fresh consent.',
        );
      }

      const session: YoutubeSession = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expirationTime: Date.now() + token.expires_in * 1000,
        scope: token.scope,
      };

      this.writeSession(session);
      this.logger.log('\nSuccess! Authenticated with YouTube. Session saved to .youtube-session.json');

      return session;
    } catch (error) {
      this.logger.error(`Error during the YouTube OAuth flow: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Trades the refresh token for a new access token.
   *
   * @returns The refreshed session, or `null` when there is nothing to refresh with
   */
  public async refreshAccessToken(refreshToken: string): Promise<YoutubeSession | null> {
    if (!refreshToken) {
      return null;
    }

    if (!this.clientId || !this.clientSecret) {
      this.logger.warn('Cannot refresh the YouTube token: YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET is missing.');
      return null;
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as unknown;
    const token = GoogleTokenResponseSchema.parse(json);

    // A refresh response carries no refresh token: the original one stays valid and must be
    // carried over, or the next refresh has nothing to work with.
    const session: YoutubeSession = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expirationTime: Date.now() + token.expires_in * 1000,
      scope: token.scope,
    };

    this.writeSession(session);

    return session;
  }

  /** Reads `.youtube-session.json`, or an empty session when it is absent or unreadable. */
  public loadSession(): YoutubeSession {
    try {
      const sessionPath = this.getSessionFilePath();

      if (!fs.existsSync(sessionPath)) {
        return {};
      }

      const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as unknown;
      const parsed = YoutubeSessionSchema.safeParse(raw);

      if (!parsed.success) {
        this.logger.warn('.youtube-session.json does not match the expected shape - ignoring it.');
        return {};
      }

      return parsed.data;
    } catch (error) {
      this.logger.error(`Error loading the YouTube session: ${getErrorMessage(error)}`);
      return {};
    }
  }

  public writeSession(session: YoutubeSession): void {
    fs.writeFileSync(this.getSessionFilePath(), JSON.stringify(session, null, 2), 'utf8');
  }
}
