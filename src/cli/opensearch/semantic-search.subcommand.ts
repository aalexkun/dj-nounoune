import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { Injectable, Logger } from '@nestjs/common';
import { OpensearchService } from '../../services/opensearch/opensearch.service';
import { ToolsService } from '../../services/promptus/tools.service';
import { getErrorMessage } from '../../utils/error.utils';

interface SemanticSearchOptions {
  raw?: boolean;
  limit?: number;
}

/**
 * Exercises the lyric-semantic branch end to end and prints both halves of it: the sentence the
 * query generator produces from the request, and what the kNN index returns for that sentence.
 * `--raw` skips the generator and searches the text as given, which isolates the index from the
 * prompt when one of the two looks wrong.
 */
@SubCommand({
  name: 'semantic',
  arguments: '<request...>',
  description: 'Run a request through the semantic branch and print the normalised sentence and the songs it retrieves.',
})
@Injectable()
export class OpensearchSemanticSearchSubCommand extends CommandRunner {
  private readonly logger = new Logger(OpensearchSemanticSearchSubCommand.name);

  constructor(
    private readonly opensearchService: OpensearchService,
    private readonly toolsService: ToolsService,
  ) {
    super();
  }

  async run(inputs: string[], options: SemanticSearchOptions): Promise<void> {
    const request = inputs.join(' ').trim();
    if (!request) {
      this.logger.error('Give the request as the argument, e.g. opensearch semantic "songs about leaving town"');
      return;
    }

    const limit = options.limit ?? 20;

    try {
      let text = request;

      if (!options.raw) {
        const discJockey = this.toolsService.getDiscJockeyAgent();
        if (!discJockey) {
          this.logger.error('The disc jockey agent is not initialised; use --raw to search the text directly.');
          return;
        }

        const generated = await discJockey.generateQuery(request);
        console.log(`\nRequest:   ${request}`);
        console.log(`Semantic:  ${generated.semantic ? `"${generated.semantic}"` : '(none)'}`);
        console.log(`Fulltext:  ${generated.fulltext.length > 0 ? generated.fulltext.join(' | ') : '(none)'}`);
        console.log(`Aggregate: ${generated.aggregate.length} definition(s)${generated.aggregate.map((d) => `\n           - ${d.description}`).join('')}`);

        if (!generated.semantic) {
          console.log(
            '\nThe generator produced no semantic sentence - it read this as an identity or formal-dimension request, so the branch would not run. Use --raw to search the text as given.',
          );
          return;
        }
        text = generated.semantic;
      } else {
        console.log(`\nSearching as given: "${text}"`);
      }

      const result = await this.opensearchService.searchBySemantic(text, limit);
      if (!result) {
        this.logger.error('Semantic search returned nothing - is OpenSearch reachable and the model deployed?');
        return;
      }

      const hits = result.hits.hits;
      console.log(`\n${hits.length} hit(s), k=${limit}:`);
      if (hits.length === 0) {
        console.log('  (none - no indexed song carries a vector yet, or nothing is close)');
        return;
      }

      hits.forEach((hit, index) => {
        const src = hit._source;
        console.log(`\n${String(index + 1).padStart(3)}. [${hit._score.toFixed(4)}] ${src.artist} - ${src.title}  (${src.album})`);
        console.log(`       ${src.song_semantic ?? '(no song_semantic stored)'}`);
      });
      console.log('');
    } catch (error) {
      this.logger.error(`Semantic search failed: ${getErrorMessage(error)}`);
    }
  }

  @Option({
    flags: '-r, --raw',
    description: 'Search the text as given, skipping the query generator',
    defaultValue: false,
  })
  parseRaw(): boolean {
    return true;
  }

  @Option({
    flags: '-l, --limit [limit]',
    description: 'Neighbours to retrieve (default 20)',
  })
  parseLimit(limit: string): number {
    return parseInt(limit, 10);
  }
}
