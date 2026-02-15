import { MpdRequest } from './MpdRequest';
import { ClearMpdResponse } from '../responses/ClearMpdResponse';

export class ClearMpdRequest extends MpdRequest<ClearMpdResponse> {
    get command(): string {
        return 'clear';
    }

    get args(): string[] {
        return [];
    }

    createResponse(raw: string): ClearMpdResponse {
        return new ClearMpdResponse(raw);
    }
}
