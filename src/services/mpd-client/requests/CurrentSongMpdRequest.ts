import { MpdRequest } from './MpdRequest';
import { CurrentSongMpdResponse } from '../responses/CurrentSongMpdResponse';

export class CurrentSongMpdRequest extends MpdRequest<CurrentSongMpdResponse> {
    get command(): string {
        return 'currentsong';
    }

    get args(): string[] {
        return [];
    }

    createResponse(raw: string): CurrentSongMpdResponse {
        return new CurrentSongMpdResponse(raw);
    }
}
