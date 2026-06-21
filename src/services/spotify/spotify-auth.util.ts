import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SpotifyWebApi from 'spotify-web-api-node';
import * as fs from 'fs';
import * as path from 'path';

export class SpotifyAuthUtil {
  private readonly logger = new Logger(SpotifyAuthUtil.name);

  constructor(
    private readonly spotifyApi: SpotifyWebApi,
    private readonly configService: ConfigService,
  ) {}

  public getAuthorizeUrl(scopes: string[], state: string = 'state'): string {
    const authorizeURL = this.spotifyApi.createAuthorizeURL(scopes, state);
    const redirectUrl = this.configService.get<string>('SPOTIFY_REDIRECT_URL');

    this.logger.log(`1. Visit this URL to authorize the app:\n${authorizeURL}`);
    this.logger.log(`2. After authorizing, you will be redirected to a URL like ${redirectUrl}?code=YOUR_CODE`);

    return authorizeURL;
  }

  public async handleAuthorizationCodeGrant(code: string): Promise<{ accessToken: string; refreshToken: string } | void> {
    if (!code) {
      this.logger.error('Error: No code provided.');
      return;
    }

    try {
      const data = await this.spotifyApi.authorizationCodeGrant(code);
      const { access_token: accessToken, refresh_token: refreshToken } = data.body;

      const sessionPath = path.join(process.cwd(), '.spotify-session.json');
      fs.writeFileSync(sessionPath, JSON.stringify({ accessToken, refreshToken }, null, 2), 'utf8');

      this.logger.log(
        `\nSuccess! Authenticated with Spotify. Session saved to .spotify-session.json`,
      );

      return { accessToken, refreshToken };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting tokens: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
