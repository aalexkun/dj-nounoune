import { MpdResponse } from './MpdResponse';

export class FindMpdResponse extends MpdResponse {
  get tracks(): Record<string, string>[] {
    const lines = this.rawResponse.split('\n');
    const tracks: Record<string, string>[] = [];
    let currentTrack: Record<string, string> = {};

    for (const line of lines) {
      if (line.startsWith('file: ')) {
        if (Object.keys(currentTrack).length > 0) {
          tracks.push(currentTrack);
        }
        currentTrack = {};
      }
      const separatorIndex = line.indexOf(': ');
      if (separatorIndex > -1) {
        const key = line.substring(0, separatorIndex);
        const value = line.substring(separatorIndex + 2);
        currentTrack[key] = value;
      }
    }
    if (Object.keys(currentTrack).length > 0) {
      tracks.push(currentTrack);
    }
    return tracks;
  }
}
