import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SpotifyWebApi from 'spotify-web-api-node';

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

      this.logger.log(`\nSuccess! Add these to your .env file:\nSPOTIFY_ACCESS_TOKEN=${accessToken}\nSPOTIFY_REFRESH_TOKEN=${refreshToken}`);

      return { accessToken, refreshToken };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting tokens: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
