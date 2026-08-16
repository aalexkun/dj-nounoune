import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { PlaylogService } from '../services/playlog/playlog.service';
import { NowPlaying } from '../services/playlog/now-playing.event';

/**
 * Public display page. Deliberately unguarded — like `AuthController`, and unlike `ChatController`,
 * it carries no `ApiAuthGuard`. Live updates arrive on the `/vibing` websocket namespace.
 */
@Controller('vibing-on')
export class VibingController {
  constructor(private readonly playlogService: PlaylogService) {}

  @Get()
  servePage(@Res() res: Response) {
    res.sendFile(join(__dirname, '..', 'public', 'vibing', 'index.html'));
  }

  @Get('now-playing')
  getNowPlaying(): NowPlaying | null {
    return this.playlogService.nowPlaying;
  }
}
