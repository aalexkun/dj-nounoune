import { MpdResponse } from './MpdResponse';

export class PlaylistMpdResponse extends MpdResponse {
    tracks: Record<string, string>[] = [];

    constructor(rawResponse: string) {
        super(rawResponse);
        this.parseTracks();
    }

    private parseTracks() {
        const lines = this.rawResponse.split('\n');
        let currentTrack: Record<string, string> = {};

        for (const line of lines) {
            if (line === 'OK' || line.startsWith('ACK')) continue;

            const separatorIndex = line.indexOf(': ');
            if (separatorIndex === -1) continue;

            const key = line.substring(0, separatorIndex);
            const value = line.substring(separatorIndex + 2);

            if (key === 'file') {
                if (Object.keys(currentTrack).length > 0) {
                    this.tracks.push(currentTrack);
                }
                currentTrack = {};
            }

            currentTrack[key] = value;
        }

        if (Object.keys(currentTrack).length > 0) {
            this.tracks.push(currentTrack);
        }
    }
}
