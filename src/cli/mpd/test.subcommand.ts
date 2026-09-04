import { SubCommand, CommandRunner } from 'nest-commander';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';

@SubCommand({
  name: 'test',
  description: 'Test MPD Client connection and commands',
})
@Injectable()
export class TestMpdSubCommand extends CommandRunner {
  private readonly logger = new Logger(TestMpdSubCommand.name);

  // constructor(private mpdClient: MpdClientService) {
  constructor(private mpdClient: MpdClientService) {
    super();
  }

  run(): Promise<void> {
    this.logger.log('Starting MPD Test via Subcommand...');

    const socket = new net.Socket();

    this.logger.log('Attempting raw connection...');
    return new Promise<void>((resolve, reject) => {
      socket.connect(6600, '192.168.2.18', () => {
        this.logger.log('RAW SOCKET CONNECTED!');
        socket.write('close\n');
        socket.end();
        socket.destroy();
        resolve();
      });

      socket.on('error', (err: Error) => {
        this.logger.error('Raw socket error: ' + err.message);
        reject(err);
      });
    });
  }
}
