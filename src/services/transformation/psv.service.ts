import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';
import { parseBpm, parseInteger } from '../../utils/parsing';

export interface ParsedPsvRow {
  _id?: string;
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
  | 'Path'
  | 'songId';

@Injectable()
export class PsvService {
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

  async fromPsv(rawPsv: string): Promise<ParsedPsvRow[]> {
    const records = parse(rawPsv, {
      delimiter: '|',
      columns: true, // Returns objects instead of arrays
      trim: true, // Trims whitespace around values
      skip_empty_lines: true, // Skips empty lines
      relax_column_count: true, // Doesn't crash if rows have different column counts
      quote: null, // Disables quoting (treats quotes as literal characters)
    });

    // 2. Process the stream
    const parsedPSV: ParsedPsvRow[] = [];

    // Iterate over records using the async iterator
    for await (const record of records) {
      // You can perform async operations here if needed, e.g., database calls
      // await someAsyncDbCall(record);
      const transformed = this.transformRecord(record);
      parsedPSV.push(transformed);
    }

    return parsedPSV;
  }

  toPsv(records: Partial<ParsedPsvRow>[], addHeader = false): string {
    const raw = records.map((record) => this.mapToRaw(record));
    let psv = '';

    if (addHeader) {
      psv = Object.keys(raw[0]).join('|') + '\n';
    }

    psv += raw.map((row) => Object.values(row).join('|')).join('\n');

    return psv;
  }

  private mapToRaw(song: Partial<ParsedPsvRow>): any {
    const raw: any = {};

    // Helper to add property only if value is not null/undefined
    const addIfSet = (key: string, value: any) => {
      if (value !== null && value !== undefined) {
        raw[key] = value;
      }
    };

    addIfSet('songId', song._id);
    addIfSet('Title', song.title);
    addIfSet('Artist', song.artist);
    addIfSet('Album', song.album);
    addIfSet('Album Artist', song.album_artist);
    addIfSet('Composer', song.composer);
    addIfSet('Genre', song.genre);
    addIfSet('Year', song.year);

    // Number conversions: Only add if the number exists
    if (song.track_number != null) raw['Track Number'] = song.track_number.toString();
    if (song.disc_number != null) raw['Disc Number'] = song.disc_number.toString();
    if (song.bpm != null) raw['BPM'] = song.bpm.toString();

    addIfSet('Category', song.category);
    addIfSet('Filename', song.filename);
    addIfSet('Path', song.path);

    // Technical Info flattening
    // We use optional chaining (?.) so if technical_info is missing, these result in undefined
    // and are skipped by the checks.
    addIfSet('.Ext', song.technical_info?.extension);

    if (song.technical_info?.bit_depth != null) {
      raw['Bit Depth'] = song.technical_info.bit_depth.toString();
    }

    if (song.technical_info?.bitrate != null) {
      raw['Bitrate'] = song.technical_info.bitrate.toString();
    }

    return raw;
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
      title: raw?.Title?.toString() ?? '',
      artist: raw?.Artist?.toString() ?? '',
      album: raw?.Album?.toString() ?? '',
      album_artist: raw['Album Artist']?.toString() ?? '',
      composer: raw?.Composer?.toString() ?? '',
      genre: raw?.Genre?.toString() ?? '',
      year: raw?.Year?.toString() ?? '',
      track_number: trackNumber,
      disc_number: discNumber,
      bpm: parseBpm(raw?.BPM),
      category: raw?.Category?.toString() ?? '',
      filename: raw?.Filename?.toString() ?? '',
      path: raw.Path?.toString() ?? '',
      technical_info: {
        extension: raw['.Ext']?.toString() ?? '',
        bit_depth: parseInteger(raw['Bit Depth']),
        bitrate: parseInteger(raw.Bitrate),
      },
    };
  }
}
