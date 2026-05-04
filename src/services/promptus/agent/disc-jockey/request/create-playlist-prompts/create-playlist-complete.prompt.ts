import { createPlaylistBasePrompt } from './create-playlist-base';
import { AgentToolsDefinition } from '../../../../tools/definition/agent-tools.definition';

export const createPlaylistCompletePrompt: string = `
${createPlaylistBasePrompt}


## Playlist Composition Process

Use the tool ${AgentToolsDefinition.searchMusicDatabase.name} to retrieve songs from the database. for the following elements

###GENRES###

###ARTISTS###

`;
