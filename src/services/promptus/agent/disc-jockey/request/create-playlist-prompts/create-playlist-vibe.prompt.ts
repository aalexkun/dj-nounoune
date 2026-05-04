import { createPlaylistBasePrompt } from './create-playlist-base';
import { AgentToolsDefinition } from '../../../../tools/definition/agent-tools.definition';

export const createPlaylistVibePrompt: string = `
${createPlaylistBasePrompt}


## Playlist Composition Process

###GENRES###

###ARTISTS###

###MINBPM### 

###MAXBPM###

### Sampling & Retrieval

Retrieve a broad selection of potential tracks based on your analysis. using the ${AgentToolsDefinition.searchMusicDatabase.name} tool. You can use this tool up to 5 times in a row if necessary.
Always retrieve a random sample of 25 songs to use to enrich the sample with chaos.
Iterative Querying: If a request yields zero results, pivot your approach and query for a different genre or criteria.'. 

### Processing Final results

After oversampling discard songs that are too repetitive e.g same artist or same genre.
Compose the playlist by mixing the songs in a random order.

`;
