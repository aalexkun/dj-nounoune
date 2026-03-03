import { MpdRequest } from './MpdRequest';
import { SeekMpdResponse } from '../responses/SeekMpdResponse';

export class SeekMpdRequest extends MpdRequest<SeekMpdResponse> {
    constructor(private songPos: number, private time: number | string) {
        super();
    }

    get command(): string {
        return 'seek';
    }

    get args(): string[] {
        return [this.songPos.toString(), this.time.toString()];
    }

    createResponse(raw: string): SeekMpdResponse {
        return new SeekMpdResponse(raw);
    }
}
