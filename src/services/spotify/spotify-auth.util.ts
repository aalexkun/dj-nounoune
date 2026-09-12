import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import SpotifyWebApi from 'spotify-web-api-node';
import { CredentialStoreService } from '../credential-store/credential-store.service';

/**
 * The Spotify authorization-code flow: print an authorize url, the user pastes back the code from
 * the redirect, the code is exchanged for tokens and the session goes into the credential store.
 *
 * A plain class rather than a provider — `SpotifyService` constructs it in `onModuleInit`, once the
 * `SpotifyWebApi` client exists — so everything it needs arrives through the constructor.
 */
export class SpotifyAuthUtil {
  private readonly logger = new Logger(SpotifyAuthUtil.name);

  constructor(
    private readonly spotifyApi: SpotifyWebApi,
    private readonly configService: ConfigService,
    private readonly credentialStore: CredentialStoreService,
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
      const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = data.body;

      const expirationTime = Date.now() + expiresIn * 1000;

      // Thrown past rather than caught: a refresh token that took a browser round trip to obtain is
      // not something to lose to a warning line the operator will scroll past.
      await this.credentialStore.save('spotify', { accessToken, refreshToken, expirationTime });

      this.logger.log(`\nSuccess! Authenticated with Spotify. Session stored, encrypted, in provider_credentials.`);

      return { accessToken, refreshToken };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting tokens: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }
}
