import { MpdRequest } from './MpdRequest';
import { SeekCurMpdResponse } from '../responses/SeekCurMpdResponse';

export class SeekCurMpdRequest extends MpdRequest<SeekCurMpdResponse> {
    constructor(private time: number | string) {
        super();
    }

    get command(): string {
        return 'seekcur';
    }

    get args(): string[] {
        return [this.time.toString()];
    }

    createResponse(raw: string): SeekCurMpdResponse {
        return new SeekCurMpdResponse(raw);
    }
}
