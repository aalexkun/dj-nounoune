import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AppService } from '../../app.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConnectionDocument, Connection } from '../../schemas/connection.schema';

@Injectable()
export class AuthService {
  private readonly X_API_KEY: string;
  private readonly log = new Logger('AuthService');

  constructor(
    private readonly appService: AppService,
    @InjectModel(Connection.name) private sessionModel: Model<ConnectionDocument>,
  ) {
    const apiKey = this.appService.getAuthXApiKey();
    if (!apiKey) {
      throw new Error('AuthX API Key not found. Please set the AUTHX_API_KEY environment variable to a valid API Key.');
    }
    this.X_API_KEY = apiKey;
  }

  validateApiKey(apiKey: string | string[] | undefined): boolean {
    return apiKey === this.X_API_KEY;
  }

  checkApiKey(apiKey: string | string[] | undefined) {
    if (!this.validateApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid API Key');
    }
  }
}
