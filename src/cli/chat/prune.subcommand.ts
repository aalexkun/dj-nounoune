import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Logger } from '@nestjs/common';

import { ChatRetentionService } from '../../services/chat/chat-retention.service';
import { getErrorMessage } from '../../utils/error.utils';

interface PruneOptions {
  dryRun?: boolean;
}

/**
 * One retention pass by hand.
 *
 * The scheduler runs this hourly on the server; this is how you find out what it would do before
 * trusting it with a history you care about. `--dry-run` counts without deleting.
 */
@SubCommand({
  name: 'prune',
  description: 'Drop every conversation past CHAT_HISTORY_LIMIT, oldest first, with its timeline',
})
export class ChatPruneSubCommand extends CommandRunner {
  private readonly logger = new Logger(ChatPruneSubCommand.name);

  constructor(private readonly retention: ChatRetentionService) {
    super();
  }

  @Option({
    flags: '--dry-run',
    description: 'Report what would be deleted and delete nothing',
  })
  parseDryRun(): boolean {
    return true;
  }

  async run(_inputs: string[], options: PruneOptions): Promise<void> {
    try {
      const result = await this.retention.prune(options.dryRun ?? false);

      this.logger.log(
        `${result.dryRun ? 'Would delete' : 'Deleted'} ${result.chatsDeleted} chat(s) and ${result.envelopesDeleted} envelope(s) across ${result.users} user(s), keeping ${this.retention.limit} each`,
      );
    } catch (error: unknown) {
      this.logger.error(`Could not prune chats: ${getErrorMessage(error)}`);
      process.exitCode = 1;
    }
  }
}
