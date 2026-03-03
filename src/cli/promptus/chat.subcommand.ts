import { Injectable, Logger } from '@nestjs/common';
import { CommandRunner, SubCommand } from 'nest-commander';
import { PromptusService } from '../../services/promptus/promptus/promptus.service';
import { Subject } from 'rxjs';

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

    const subject = new Subject<string>();
    subject.subscribe((text: string) => {
      this.logger.log(text);
    });

    await this.promptusService.chat(searchText, subject);
  }
}
