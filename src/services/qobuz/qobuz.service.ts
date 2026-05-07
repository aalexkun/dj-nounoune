import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { QobuzErrorResponse, QobuzLoginResponse, QobuzUserFavoritesResponse } from './qobuz.interfaces';

@Injectable()
export class QobuzService implements OnModuleInit {
  private readonly logger = new Logger(QobuzService.name);

  private readonly API_BASE_URL = 'https://www.qobuz.com/api.json/0.2';
  private appId!: string;
  private appSecret!: string;
  private userAuthToken?: string;

  constructor(private readonly configService: ConfigService) {}

  public onModuleInit(): void {
    const appId = this.configService.get<string>('QOBUZ_APP_ID');
    const appSecret = this.configService.get<string>('QOBUZ_APP_SECRET');

    if (!appId || !appSecret) {
      this.logger.warn('QOBUZ_APP_ID or QOBUZ_APP_SECRET is missing. QobuzService will not function properly.');
    }

    this.appId = appId || '';
    this.appSecret = appSecret || '';
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
  private async signedGet<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // The timestamp used in the signature MUST match the one sent as request_ts
    const paramsForSignature = { ...params, timestamp };
    const signature = this.generateSignature('GET', endpoint, paramsForSignature);

    const requestParams = {
      ...params,
      app_id: this.appId,
      request_ts: timestamp,
      request_sig: signature,
    };

    if (this.userAuthToken) {
      requestParams['user_auth_token'] = this.userAuthToken;
    }

    const queryString = this.toQueryString(requestParams);
    const url = `${this.API_BASE_URL}${endpoint}?${queryString}`;

    const headers: Record<string, string> = {};
    if (this.userAuthToken) {
      headers['X-User-Auth-Token'] = this.userAuthToken;
    }

    const response = await fetch(url, { headers });
    const data = (await response.json()) as QobuzErrorResponse & T;

    if (data.status === 'error') {
      throw new Error(`Qobuz API Error: ${data.message} (code: ${data.code})`);
    }

    return data as T;
  }

  /**
   * Authenticate with the Qobuz API using the username and md5 password
   */
  public async login(): Promise<string> {
    if (this.userAuthToken) {
      return this.userAuthToken;
    }

    const userToken = this.configService.get<string>('QOBUZ_USER_TOKEN');
    const userId = this.configService.get<string>('QOBUZ_USER_ID');

    if (!userId || !userToken) {
      throw new Error('QOBUZ_USER_TOKEN or QOBUZ_USER_ID environment variables are missing');
    }

    const params: Record<string, string> = {
      user_id: userId,
      user_auth_token: userToken,
    };

    const queryString = this.toQueryString(params);
    const url = `${this.API_BASE_URL}/user/login?${queryString}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-App-Id': this.appId
      },
    });

    const data = (await response.json()) as QobuzErrorResponse & QobuzLoginResponse;

    if (data.status === 'error') {
      throw new Error(`Qobuz Authentication Error: ${data.message} (code: ${data.code})`);
    }

    const loginData = data as QobuzLoginResponse;
    this.userAuthToken = loginData.user_auth_token;

    this.logger.log(`Successfully authenticated with Qobuz API as ${loginData.user.email}`);

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

    return this.signedGet<QobuzUserFavoritesResponse>('/favorite/getUserFavorites', params);
  }
}
