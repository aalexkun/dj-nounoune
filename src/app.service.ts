import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private configService: ConfigService) {}

  getGenAiApiKey(): string {
    return this.configService.get<string>('GENAI_API_KEY') || 'undefined';
  }

  getImportLibraryPath(): string {
    return this.configService.get<string>('IMPORT_LIBRARY_PATH') || 'undefined';
  }

  getAuthXApiKey(): string | undefined {
    return this.configService.get<string | undefined>('AUTHX_API_KEY');
  }

  getImportLibraryRootPath(): string {
    return this.configService.get<string>('IMPORT_LIBRARY_PATH_ROOT') || 'Linux';
  }

  getLibraryRootPath(): string {
    return this.configService.get<string>('LIBRARY_ROOT_PATH') || 'undefined';
  }
  getMpdHost(): string {
    return this.configService.get<string>('MPD_HOST') || 'undefined';
  }
  getMpdPort(): number {
    return this.configService.get<number>('MPD_PORT') || 6600;
  }

  getImportPathStyle(): string {
    return this.configService.get<string>('IMPORT_LIBRARY_PATH_STYLE') || 'Linux';
  }

  /**
   * Whether the disc jockey may search the web for artwork the importers never provided.
   *
   * Enabled unless explicitly turned off, so nothing changes for an environment that predates the
   * flag. Turning it off costs nothing but the search: covers already held on the album document are
   * unaffected, and so is a cover carried over from an earlier play of the same track.
   */
  isAlbumCoverSearchEnabled(): boolean {
    const raw = this.configService.get<string>('VIBING_ALBUM_COVER_SEARCH')?.trim().toLowerCase();
    return raw !== 'false' && raw !== '0';
  }
}
