import { CommandRunner, SubCommand } from 'nest-commander';
import { ProfilerService } from '../../services/profiler/profiler.service';

@SubCommand({
  name: 'run',
  description: 'Run the profiler analysis and output the result',
})
export class ProfilerRunSubCommand extends CommandRunner {
  constructor(private readonly profilerService: ProfilerService) {
    super();
  }

  async run(): Promise<void> {
    console.log('Starting Profiler Analysis...');
    const out = await this.profilerService.getDatabaseProfileForPrompt();
    console.log(out);
  }
}
