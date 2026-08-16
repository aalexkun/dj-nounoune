import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { ToolsService } from '../../services/promptus/tools.service';
import { AppService } from '../../app.service';
import { MpdToolsDefinition } from '../../services/promptus/tools/definition/mpd-tools.definition';
import { DiscJockeyAgent } from '../../services/promptus/agent/disc-jockey/disc-jockey.agent';
import { isReachableImageUrl } from '../../utils/image-url.util';
import { getErrorMessage } from '../../utils/error.utils';

/** What the `current_song` tool hands back. Everything is optional — MPD may be idle. */
const CurrentSongSchema = z.object({
  file: z.string().optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  album: z.string().optional(),
});

interface WhatsPlayingOptions {
  artist?: string;
  album?: string;
  cover?: boolean;
  commentary?: boolean;
}

/**
 * Manual harness for the two prompts the now-playing page depends on. The page only runs them when
 * somebody is watching, which makes them awkward to exercise — this runs both on demand and prints
 * the raw model output.
 */
@SubCommand({
  name: 'whats-playing',
  description: 'Run the disc jockey commentary and album cover prompts against the current track',
})
export class WhatsPlayingCommand extends CommandRunner {
  private readonly logger = new Logger(WhatsPlayingCommand.name);

  constructor(
    private readonly toolsService: ToolsService,
    private readonly appService: AppService,
  ) {
    super();
  }

  async run(inputs: string[], options: WhatsPlayingOptions): Promise<void> {
    const discJockey = this.toolsService.getDiscJockeyAgent();

    if (!discJockey) {
      this.logger.error('Disc jockey agent is not available');
      return;
    }

    const current = await this.resolveCurrentSong();
    const artist = options.artist ?? current.artist;
    const album = options.album ?? current.album;

    console.log('\n=== currently playing ===');
    console.log(`  title : ${current.title ?? '(unknown)'}`);
    console.log(`  artist: ${current.artist ?? '(unknown)'}`);
    console.log(`  album : ${current.album ?? '(unknown)'}`);
    if (current.file) console.log(`  file  : ${current.file}`);

    if (options.commentary !== false) {
      await this.runCommentary(discJockey);
    }

    if (options.cover !== false) {
      await this.runCoverLookup(discJockey, artist, album);
    }
  }

  /** Reuses the same `current_song` tool the model calls, rather than re-resolving MPD here. */
  private async resolveCurrentSong(): Promise<z.infer<typeof CurrentSongSchema>> {
    try {
      const result = await this.toolsService.proceedFunctionCall({
        name: MpdToolsDefinition.currentMpdCommand.name,
        args: {},
      });

      if (result.type !== 'string') return {};

      return CurrentSongSchema.parse(JSON.parse(result.message));
    } catch (error: unknown) {
      this.logger.warn(`Could not resolve the current song: ${getErrorMessage(error)}`);
      return {};
    }
  }

  private async runCommentary(discJockey: DiscJockeyAgent): Promise<void> {
    console.log('\n=== WhatIsPlayingRequest ===');
    const startedAt = Date.now();

    try {
      const response = await discJockey.whatIsPlaying('What is currently playing?');
      console.log(`(${Date.now() - startedAt}ms)\n`);
      console.log(response.text ?? '(empty response)');
    } catch (error: unknown) {
      console.log(`FAILED after ${Date.now() - startedAt}ms: ${getErrorMessage(error)}`);
    }
  }

  private async runCoverLookup(discJockey: DiscJockeyAgent, artist?: string, album?: string): Promise<void> {
    console.log('\n=== AlbumCoverRequest ===');

    if (!this.appService.isAlbumCoverSearchEnabled()) {
      console.log('Skipped: album cover search is off (VIBING_ALBUM_COVER_SEARCH).');
      console.log('For a one-off run: $env:VIBING_ALBUM_COVER_SEARCH=\'true\'; npm run cli -- music whats-playing');
      return;
    }

    if (!artist || !album) {
      console.log('Skipped: no artist/album to search for. Pass --artist and --album to test it directly.');
      return;
    }

    console.log(`query : ${artist} - ${album}`);
    const startedAt = Date.now();

    try {
      const imageUrl = await discJockey.findAlbumCover(artist, album);
      console.log(`(${Date.now() - startedAt}ms)`);

      if (!imageUrl) {
        console.log('imageUrl : none — the model returned an empty url');
        return;
      }

      // The same check the enrichment applies before it will store or display a model-supplied URL.
      const reachable = await isReachableImageUrl(imageUrl);
      console.log(`imageUrl : ${imageUrl}`);
      console.log(`reachable: ${reachable ? 'yes' : 'no — this URL would be discarded'}`);
    } catch (error: unknown) {
      console.log(`FAILED after ${Date.now() - startedAt}ms: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-a, --artist [artist]',
    description: 'Artist to look the cover up for, instead of the one playing',
  })
  parseArtist(value: string): string {
    return value;
  }

  @Option({
    flags: '-l, --album [album]',
    description: 'Album to look the cover up for, instead of the one playing',
  })
  parseAlbum(value: string): string {
    return value;
  }

  @Option({
    flags: '--no-cover',
    description: 'Skip the album cover prompt',
  })
  parseNoCover(): boolean {
    return false;
  }

  @Option({
    flags: '--no-commentary',
    description: 'Skip the disc jockey commentary prompt',
  })
  parseNoCommentary(): boolean {
    return false;
  }
}
