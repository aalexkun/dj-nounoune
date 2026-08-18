import { Controller, Get, HttpStatus, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { PlaylogService } from '../services/playlog/playlog.service';
import { NowPlaying } from '../services/playlog/now-playing.event';
import { WeatherService } from '../services/weather/weather.service';
import { WeatherSnapshot } from '../services/weather/weather.interfaces';

/**
 * Public display page. Deliberately unguarded — like `AuthController`, and unlike `ChatController`,
 * it carries no `ApiAuthGuard`. Live updates arrive on the `/vibing` websocket namespace.
 */
@Controller('vibing-on')
export class VibingController {
  constructor(
    private readonly playlogService: PlaylogService,
    private readonly weatherService: WeatherService,
  ) {}

  @Get()
  servePage(@Res() res: Response) {
    res.sendFile(join(__dirname, '..', 'public', 'vibing', 'index.html'));
  }

  @Get('now-playing')
  getNowPlaying(): NowPlaying | null {
    return this.playlogService.nowPlaying;
  }

  /**
   * Conditions and the five day outlook for the header strip, and the sunrise and sunset the page
   * paints its sky from. Answers `null` when the feature is switched off, which the page reads as
   * "draw neither" and falls back to a fixed six to six day for the background.
   */
  @Get('weather')
  getWeather(): Promise<WeatherSnapshot | null> {
    return this.weatherService.getSnapshot();
  }

  /**
   * Artwork taken out of MPD rather than off a URL, for releases the importers left without an image.
   * The address is what `mpdArtworkUrl` builds; a track whose picture cannot be produced answers 404,
   * which the page already treats as "no cover".
   */
  @Get('artwork/:songId')
  async getArtwork(@Param('songId') songId: string, @Res() res: Response): Promise<void> {
    const picture = await this.playlogService.getArtwork(songId);

    if (!picture) {
      res.status(HttpStatus.NOT_FOUND).end();
      return;
    }

    res.setHeader('Content-Type', picture.mimeType);
    // The bytes belong to one immutable file; a day of browser cache saves re-reading it every load.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(picture.data);
  }
}
