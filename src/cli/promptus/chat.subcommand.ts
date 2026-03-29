import { Injectable, Logger } from '@nestjs/common';
import { CommandRunner, SubCommand } from 'nest-commander';
import { Subject } from 'rxjs';
import * as chatGatewayTypes from '../../gateway/chat.gateway.types';
import { PromptusService } from '../../services/promptus/promptus.service';

@SubCommand({
  name: 'chat',
  description: 'chat with dj-nounoune',
})
@Injectable()
export class PromptusChatSubcommand extends CommandRunner {
  private readonly logger = new Logger(PromptusChatSubcommand.name);

  constructor(private promptusService: PromptusService) {
    super();
  }
  async run(passedParams: string[], options?: Record<string, any>): Promise<void> {
    const searchText = passedParams.join(' ');

    const subject = new Subject<chatGatewayTypes.ChatStatusMessage>();

    await this.promptusService.chat(
      {
        chatId: 'cli',
        message: searchText,
      },
      subject,
    );
  }
}
