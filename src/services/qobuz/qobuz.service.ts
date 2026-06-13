import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  QobuzErrorResponseSchema,
  QobuzUserFavoritesResponse,
  QobuzUserFavoritesResponseSchema,
  QobuzAlbum,
  QobuzAlbumSchema,
} from './qobuz.interfaces';
import { z } from 'zod';
import { QobuzAuthUtil } from './qobuz-auth.util';

@Injectable()
export class QobuzService implements OnModuleInit {
  private readonly logger = new Logger(QobuzService.name);

  private readonly API_BASE_URL = 'https://www.qobuz.com/api.json/0.2';
  private appId!: string;
  private appSecret!: string;
  private userAuthToken?: string;
  public auth!: QobuzAuthUtil;

  constructor(private readonly configService: ConfigService) {}

  public onModuleInit(): void {
    const appId = this.configService.get<string>('QOBUZ_APP_ID');
    const appSecret = this.configService.get<string>('QOBUZ_APP_SECRET');

    if (!appId || !appSecret) {
      this.logger.warn('QOBUZ_APP_ID or QOBUZ_APP_SECRET is missing. QobuzService will not function properly.');
    }

    this.appId = appId || '';
    this.appSecret = appSecret || '';

    this.auth = new QobuzAuthUtil(this.configService);
  }

  /**
   * Generates MD5 hash for the given input string
   */
  private md5(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Generates signature for protected Qobuz API endpoints.
   */
  private generateSignature(method: string, endpoint: string, params: Record<string, string>): string {
    const allParams = { ...params };
    allParams['app_id'] = this.appId;
    allParams['method'] = method;

    if (this.userAuthToken) {
      allParams['user_auth_token'] = this.userAuthToken;
    }

    // Sort parameters alphabetically by key
    const sortedKeys = Object.keys(allParams).sort();

    let signatureString = `${method}${endpoint}`;
    for (const key of sortedKeys) {
      signatureString += `${key}${allParams[key]}`;
    }
    signatureString += this.appSecret;

    return this.md5(signatureString);
  }

  /**
   * Formats a record of string parameters into a URL-encoded query string
   */
  private toQueryString(params: Record<string, string>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchParams.append(key, value);
    }
    return searchParams.toString();
  }

  /**
   * Send a GET request to the Qobuz API with signature authentication.
   */
  private async qobuzGet<T>(endpoint: string, params: Record<string, string>, schema: z.ZodSchema<T>): Promise<T> {

    if (!this.userAuthToken){
      throw new Error('User authentication token is missing. Please authenticate first.');
    }

    const requestParams = {
      ...params,
    };

    const headers: Record<string, string> = {};
    headers['X-User-Auth-Token'] = this.userAuthToken;
    headers['X-App-Id'] = this.appId;

    const queryString = this.toQueryString(requestParams);
    const url = `${this.API_BASE_URL}${endpoint}?${queryString}`;

    const response = await fetch(url, { headers });
    const jsonData = await response.json() as unknown;

    const errorResult = QobuzErrorResponseSchema.safeParse(jsonData);
    if (errorResult.success && errorResult.data.status === 'error') {
      throw new Error(`Qobuz API Error: ${errorResult.data.message} (code: ${errorResult.data.code})`);
    }

    return schema.parse(jsonData);
  }

  private getSessionFilePath(): string {
    return path.join(process.cwd(), '.qobuz-session.json');
  }

  private loadSession(): { userId?: string, userAuthToken?: string } {
    try {
      const sessionPath = this.getSessionFilePath();
      if (fs.existsSync(sessionPath)) {
        const data = fs.readFileSync(sessionPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.error(`Error loading Qobuz session: ${error}`);
    }
    return {};
  }

  /**
   * Authenticate with the Qobuz API using the username and md5 password
   */
  public async login(): Promise<string> {
    if (this.userAuthToken) {
      return this.userAuthToken;
    }

    const session = this.loadSession();
    this.userAuthToken   = session.userAuthToken;
    if (!this.userAuthToken) {
      throw new Error('Qobuz session data (.qobuz-session.json) is missing. Please authenticate first by running the auth CLI command.');
    }
    return this.userAuthToken;
  }

  /**
   * Retrieve the list of all favorite songs
   */
  public async getFavorites(limit: number = 50, offset: number = 0): Promise<QobuzUserFavoritesResponse> {
    await this.login();

    const params = {
      type: 'tracks',
      limit: limit.toString(),
      offset: offset.toString(),
    };

    return this.qobuzGet<QobuzUserFavoritesResponse>('/favorite/getUserFavorites', params, QobuzUserFavoritesResponseSchema);
  }

  /**
   * Retrieve the list of all favorite albums
   */
  public async getFavoriteAlbums(limit: number = 50, offset: number = 0): Promise<QobuzUserFavoritesResponse> {
    await this.login();

    const params = {
      type: 'albums',
      limit: limit.toString(),
      offset: offset.toString(),
    };

    return this.qobuzGet<QobuzUserFavoritesResponse>('/favorite/getUserFavorites', params, QobuzUserFavoritesResponseSchema);
  }

  /**
   * Retrieve full details of an album, including its tracks
   */
  public async getAlbum(albumId: string): Promise<QobuzAlbum> {
    const params = {
      album_id: albumId,
    };

    return this.qobuzGet<QobuzAlbum>('/album/get', params, QobuzAlbumSchema);
  }
}
