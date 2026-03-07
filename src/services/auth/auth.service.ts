import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AppService } from '../../app.service';

@Injectable()
export class AuthService {
    private readonly X_API_KEY: string;

    constructor(private readonly appService: AppService) {
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
