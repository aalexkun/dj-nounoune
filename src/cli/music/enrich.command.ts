import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { FfprobeService } from '../../services/ffprobe/ffprobe.service';
import { MusicDbService, PopulatedSong } from '../../services/music-db/music-db.service';
import { AppService } from '../../app.service';
import { extname } from 'path';
import { SongDocument } from '../../schemas/song.schema';
import { PromptusService } from '../../services/promptus/promptus/promptus.service';
import { EnrichPromptusRequest } from '../../services/promptus/promptus/request/EnrichPromptusRequest';
import { ParsedPsvRow, PsvService } from '../../services/transformation/psv.service';
import { FileService } from '../../services/file/file.service';
import { chunkArray } from '../../utils/array.utils';

interface EnrichCommandOptions {
  ai?: boolean;
}

@SubCommand({
  name: 'enrich',
  description: 'Enrich the songs collection with technical metadata from ffprobe.',
})
export class EnrichCommand extends CommandRunner {
  private readonly logger = new Logger(EnrichCommand.name);

  constructor(
    private ffprobeService: FfprobeService,
    private musicDbService: MusicDbService,
    private appService: AppService,
    private promptusService: PromptusService,
    private psvSerive: PsvService,
    private fileService: FileService,
  ) {
    super();
  }

  async run(inputs: string[], options: EnrichCommandOptions): Promise<void> {
    let aiEnrichedSongs: ParsedPsvRow[] = [];
    // Generate the PSV file for batch processing.
    if (options.ai) {
      const populatedSong = await this.musicDbService.getAllPopulatedSongs();
      aiEnrichedSongs = await this.updateAi(populatedSong);
    }

    const songs = await this.musicDbService.getAllSongs();
    for (let song of songs) {
      song = await this.updateFfprobe(song);

      if (options.ai) {
        let aiEnrichedSong = aiEnrichedSongs.find((s) => s._id === song._id.toString());

        song.year = aiEnrichedSong?.year || song.year;
        song.bpm = aiEnrichedSong?.bpm || song.bpm;
        song.category = aiEnrichedSong?.category || song.category;
        song.genre = aiEnrichedSong?.genre || song.genre;
        song.album_artist = aiEnrichedSong?.album_artist || song.album_artist;
        song.composer = aiEnrichedSong?.composer || song.composer;
      }

      try {
        // await this.musicDbService.upsertSong(song);
      } catch (e) {
        this.logger.error(e);
      }
    }
  }

  private async updateFfprobe(song: SongDocument): Promise<SongDocument> {
    const rootPath = this.appService.getLibraryRootPath();
    const filePath = song.source.find((s) => s.name === 'file')?.sourceId;
    const probeData = await this.ffprobeService.getTechnicalInfo(`${rootPath}${filePath}`);

    const audioStream = probeData.streams.find((s) => s.codec_type === 'audio');
    if (!audioStream) {
      throw new Error('No audio stream found in file');
    }

    const sampleRate = audioStream.sample_rate ? parseInt(audioStream.sample_rate, 10) : 0;

    let bitDepth = 0;
    if (audioStream.bits_per_raw_sample) {
      bitDepth = parseInt(audioStream.bits_per_raw_sample, 10);
    } else if (audioStream.bits_per_sample) {
      bitDepth = audioStream.bits_per_sample;
    }

    const isHighRes = bitDepth > 16 || sampleRate > 48000;
    const isCdQuality = bitDepth >= 16 && sampleRate >= 44100;

    song.technical_info = {
      ...song.technical_info,
      encoding: audioStream.codec_name,
      size: probeData.format.size ? parseInt(probeData.format.size, 10) : 0,
      duration: parseFloat(probeData.format.duration || audioStream.duration || '0'),
      bitrate: parseInt(probeData.format.bit_rate || audioStream.bit_rate || '0'),
      sample_rate: sampleRate,
      bit_depth: bitDepth || 16,
      extension: extname(probeData.format.filename).replace('.', ''),
      is_high_res: isHighRes,
      is_cd_quality: isCdQuality,
    };

    return song;
  }

  private async updateAi(populatedSong: PopulatedSong[]): Promise<ParsedPsvRow[]> {
    const indexMap = new Map<string, string>();

    const songsForPromptus: Partial<ParsedPsvRow>[] = populatedSong.map((song, index) => {
      const originalId = song?._id?._id.toString() || '';
      const sequentialId = (index + 1).toString();
      indexMap.set(sequentialId, originalId);
      return {
        _id: sequentialId,
        title: song.title,
        artist: song.artist.artist,
        album: song.album.title,
      };
    });

    let enrichRequest = new EnrichPromptusRequest('Use the following file to retrieve the genre for each of those songs.');
    enrichRequest.cache = {
      cacheName: 'enrich-songs-library.psv',
      file: 'files/enrich-songs-library.psv',
      fileMineType: 'text/plain',
    };

    // Save the file as tmp and cache it for the request
    await this.fileService.saveFile('enrich-songs-library.psv', this.psvSerive.toPsv(songsForPromptus, true));
    //  const aiOutput = await this.promptusService.generate(enrichRequest);
    // return await this.psvSerive.fromPsv(aiOutput.psv);
    return [];
  }

  @Option({
    flags: ', --ai',
    description: 'Run enrich with ai prompt',
    defaultValue: true,
  })
  parseAi(): boolean {
    return true;
  }
}
