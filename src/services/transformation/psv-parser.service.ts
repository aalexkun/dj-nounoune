import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { finished } from 'stream/promises';
import { parseBpm, parseInteger } from '../../utils/parsing';

export interface ParsedPsvRow {
  title: string;
  artist: string;
  album: string;
  album_artist: string;
  composer: string;
  genre: string;
  year: string;
  track_number: number;
  disc_number: number;
  bpm: number;
  category: string;
  filename: string;
  path: string;
  technical_info: {
    extension: string;
    bit_depth: number;
    bitrate: number;
  };
}

type Header =
  | 'Album'
  | 'Album Artist'
  | 'Artist'
  | 'Composer'
  | 'Genre'
  | 'Title'
  | 'Track#'
  | 'Disc-Track#'
  | 'Year'
  | '.Ext'
  | 'Bit Depth'
  | 'Bitrate'
  | 'BPM'
  | 'Category'
  | 'Filename'
  | 'Path';

@Injectable()
export class PsvParserService {
  /**
   * Reads a PSV file and yields transformed records one by one
   */
  async parseFile(filePath: string, onRecord: (record: ParsedPsvRow) => Promise<void>) {
    const absolutePath = path.resolve(filePath);

    // 1. Create the Read Stream
    const stream = fs.createReadStream(absolutePath).pipe(
      parse({
        delimiter: '|',
        columns: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
        quote: null,
      }),
    );

    // 2. Process the stream
    for await (const rawRecord of stream) {
      // 3. TRANSFORM: Convert raw strings to actual types
      const transformed = this.transformRecord(rawRecord);

      // 4. Pass to the callback (Load)
      await onRecord(transformed);
    }
  }

  private transformRecord(raw: Record<Header, string | number>): ParsedPsvRow {
    let discNumber = 1;
    let trackNumber = parseInteger(raw['Track#']);

    const discTrackRaw = raw['Disc-Track#']?.toString();
    if (discTrackRaw && discTrackRaw.includes('-')) {
      const parts = discTrackRaw.split('-');
      discNumber = parseInteger(parts[0]) || 1;
      trackNumber = parseInteger(parts[1]) || trackNumber;
    }

    return {
      title: raw.Title?.toString() ?? '',
      artist: raw.Artist?.toString() ?? '',
      album: raw.Album?.toString() ?? '',
      album_artist: raw['Album Artist']?.toString() ?? '',
      composer: raw.Composer?.toString() ?? '',
      genre: raw.Genre?.toString() ?? '',
      year: raw.Year?.toString() ?? '',
      track_number: trackNumber,
      disc_number: discNumber,
      bpm: parseBpm(raw.BPM),
      category: raw.Category?.toString() ?? '',
      filename: raw.Filename?.toString() ?? '',
      path: raw.Path?.toString() ?? '',
      technical_info: {
        extension: raw['.Ext']?.toString() ?? '',
        bit_depth: parseInteger(raw['Bit Depth']),
        bitrate: parseInteger(raw.Bitrate),
      },
    };
  }
}
