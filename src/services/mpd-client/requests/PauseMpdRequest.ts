import { MpdRequest } from './MpdRequest';
import { PauseMpdResponse } from '../responses/PauseMpdResponse';

export class PauseMpdRequest extends MpdRequest<PauseMpdResponse> {
    constructor(private state?: 0 | 1) {
        super();
    }

    get command(): string {
        return 'pause';
    }

    get args(): string[] {
        return this.state !== undefined ? [this.state.toString()] : [];
    }

    createResponse(raw: string): PauseMpdResponse {
        return new PauseMpdResponse(raw);
    }
}
