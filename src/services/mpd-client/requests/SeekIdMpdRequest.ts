import { MpdRequest } from './MpdRequest';
import { SeekIdMpdResponse } from '../responses/SeekIdMpdResponse';

export class SeekIdMpdRequest extends MpdRequest<SeekIdMpdResponse> {
    constructor(private songId: number, private time: number | string) {
        super();
    }

    get command(): string {
        return 'seekid';
    }

    get args(): string[] {
        return [this.songId.toString(), this.time.toString()];
    }

    createResponse(raw: string): SeekIdMpdResponse {
        return new SeekIdMpdResponse(raw);
    }
}
