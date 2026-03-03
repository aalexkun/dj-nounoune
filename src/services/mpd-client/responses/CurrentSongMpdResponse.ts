import { MpdResponse } from './MpdResponse';

export interface CurrentSongInfo {
    file?: string;
    album?: string;
    artist?: string;
    title?: string;
    [key: string]: string | undefined;
}

export class CurrentSongMpdResponse extends MpdResponse {
    song: CurrentSongInfo | null = null;

    constructor(rawResponse: string) {
        super(rawResponse);
        this.parseSong();
    }

    private parseSong() {
        const lines = this.rawResponse.split('\n');
        const trackInfo: Record<string, string> = {};

        for (const line of lines) {
            if (line === 'OK' || line.startsWith('ACK')) continue;

            const separatorIndex = line.indexOf(': ');
            if (separatorIndex === -1) continue;

            const key = line.substring(0, separatorIndex);
            const value = line.substring(separatorIndex + 2);

            trackInfo[key] = value;
        }

        if (Object.keys(trackInfo).length > 0) {
            this.song = {
                file: trackInfo['file'],
                album: trackInfo['Album'],
                artist: trackInfo['Artist'],
                title: trackInfo['Title'],
                ...trackInfo
            };
        }
    }
}
