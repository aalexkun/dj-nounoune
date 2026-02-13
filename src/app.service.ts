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
}
