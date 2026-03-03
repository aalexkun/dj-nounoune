import { MpdRequest } from './MpdRequest';
import { NextMpdResponse } from '../responses/NextMpdResponse';

export class NextMpdRequest extends MpdRequest<NextMpdResponse> {
    get command(): string {
        return 'next';
    }

    get args(): string[] {
        return [];
    }

    createResponse(raw: string): NextMpdResponse {
        return new NextMpdResponse(raw);
    }
}
