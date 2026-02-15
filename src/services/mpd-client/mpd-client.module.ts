
import { Module } from '@nestjs/common';
import { MpdClientService } from './mpd-client.service';
import { AppService } from '../../app.service';

@Module({
    providers: [MpdClientService, AppService], // AppService needed? Or import AppModule? AppService is in AppModule.
    exports: [MpdClientService],
})
export class MpdClientModule { }
