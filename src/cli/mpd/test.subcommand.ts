
import { SubCommand, CommandRunner } from 'nest-commander';
import { MpdClientService } from '../../services/mpd-client/mpd-client.service';
import { ConnectMpdRequest } from '../../services/mpd-client/requests/ConnectMpdRequest';
import { FindMpdRequest } from '../../services/mpd-client/requests/FindMpdRequest';
import { Injectable, Logger } from '@nestjs/common';

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

    async run(inputs: string[], options: Record<string, any>): Promise<void> {
        this.logger.log('Starting MPD Test via Subcommand...');

        const net = require('net');
        const socket = new net.Socket();

        this.logger.log('Attempting raw connection...');
        socket.connect(6600, '192.168.2.18', () => {
            this.logger.log('RAW SOCKET CONNECTED!');
            socket.write('close\n');
            socket.end();
            socket.destroy();
            process.exit(0);
        });

        socket.on('error', (err) => {
            this.logger.error('Raw socket error: ' + err.message);
            process.exit(1);
        });

        // await new Promise(resolve => setTimeout(resolve, 5000));
    }
}
