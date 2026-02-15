
import { MpdRequest } from './MpdRequest';
import { FindMpdResponse } from '../responses/FindMpdResponse';

export class FindMpdRequest extends MpdRequest<FindMpdResponse> {
    constructor(private type: string, private what: string) {
        super();
    }

    get command(): string {
        return 'find';
    }

    get args(): string[] {
        return [this.type, this.what];
    }

    createResponse(raw: string): FindMpdResponse {
        return new FindMpdResponse(raw);
    }
}
