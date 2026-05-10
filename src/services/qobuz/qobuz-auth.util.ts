import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export class QobuzAuthUtil {
  private readonly logger = new Logger(QobuzAuthUtil.name);

  private readonly OAUTH_APP_ID: string;
  private readonly OAUTH_PRIVATE_KEY: string;
  private readonly QOBUZ_API_BASE: string;
  private readonly QOBUZ_OAUTH_URL: string;

  constructor(private readonly configService: ConfigService) {
    this.OAUTH_APP_ID = this.configService.get<string>('QOBUZ_OAUTH_APP_ID') || '798273057';
    this.OAUTH_PRIVATE_KEY = this.configService.get<string>('QOBUZ_OAUTH_PRIVATE_KEY') || '6lz8C03UDIC7';
    this.QOBUZ_API_BASE = this.configService.get<string>('QOBUZ_API_BASE') || 'https://www.qobuz.com/api.json/0.2';
    this.QOBUZ_OAUTH_URL = this.configService.get<string>('QOBUZ_OAUTH_URL') || 'https://www.qobuz.com/signin/oauth';
  }

  public async getAuthorizeUrl(): Promise<string> {
    const redirectUrl = this.configService.get<string>('QOBUZ_REDIRECT_URL') || 'https://dj-nounoune.supa-smart.lan/callback';

    const params = new URLSearchParams({
      ext_app_id: this.OAUTH_APP_ID,
      redirect_url: redirectUrl,
    });

    const authorizeURL = `${this.QOBUZ_OAUTH_URL}?${params.toString()}`;
    this.logger.log(`1. Visit this URL to authorize the app:\n${authorizeURL}`);

    return authorizeURL;
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

      const tokenData = await tokenResponse.json();
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

      const profileData = await loginResponse.json();
      const userEmail = profileData.user?.email || 'Unknown User';

      const sessionPath = path.join(process.cwd(), '.qobuz-session.json');
      fs.writeFileSync(sessionPath, JSON.stringify({ userId, userAuthToken }, null, 2), 'utf8');

      this.logger.log(
        `\nSuccess! Authenticated as ${userEmail}. Session saved to .qobuz-session.json`,
      );

      return { userId, userAuthToken };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error during Qobuz OAuth flow: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
