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
    const collections = ['songs', 'artists', 'albums'];

    for (const collection of collections) {
      console.log(`\n======================================================`);
      console.log(`Starting Profiler Analysis for "${collection}" collection...`);
      console.log(`======================================================\n`);
      
      console.log('--- A. Schema Inference ---');
      const schema = await this.profilerService.inferSchema({ collection });
      console.log(JSON.stringify(schema, null, 2));

      // Only songs are currently indexed in OpenSearch, so we only run B, C, D for songs
      if (collection === 'songs') {
        // Common fields in the schema to analyze
        const fieldsToAnalyze = [
          'genre', 'country', 'year', 'artist', 'album', 'source.name',
          'source.technical_info.encoding', 'source.technical_info.extension',
          'source.technical_info.is_high_res', 'source.technical_info.is_cd_quality',
          'emotion','language','pace'
        ];
        
        console.log('\n--- B. Cardinality and Facet Generation ---');
        const cardinality = await this.profilerService.getCardinality({ collection }, fieldsToAnalyze);
        console.log(JSON.stringify(cardinality, null, 2));

        console.log('\n--- C. Completeness and Null Tracking ---');
        const completeness = await this.profilerService.getCompleteness({ collection }, fieldsToAnalyze);
        console.log(JSON.stringify(completeness, null, 2));

        const numericFields = [
          'track_number', 'disc_number', 'source.technical_info.bpm',
          'source.technical_info.size', 'source.technical_info.bitrate',
          'source.technical_info.sample_rate', 'source.technical_info.duration',
          'source.technical_info.bit_depth'
        ];
        console.log('\n--- D. Distribution Percentiles for Numerical Data ---');
        const distribution = await this.profilerService.getNumericDistribution({ collection }, numericFields);
        console.log(JSON.stringify(distribution, null, 2));
      } else {
        console.log(`\n(Skipping Cardinality, Completeness, and Distribution since "${collection}" is not indexed in OpenSearch yet)`);
      }
    }

    console.log('\nAnalysis Complete!');
  }
}
