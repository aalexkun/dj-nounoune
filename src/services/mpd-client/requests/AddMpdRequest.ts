
import { MpdRequest } from './MpdRequest';
import { AddMpdResponse } from '../responses/AddMpdResponse';

export class AddMpdRequest extends MpdRequest<AddMpdResponse> {
    constructor(private uri: string) {
        super();
    }

    get command(): string {
        return 'add';
    }

    get args(): string[] {
        return [this.uri];
    }

    createResponse(raw: string): AddMpdResponse {
        return new AddMpdResponse(raw);
    }
}
