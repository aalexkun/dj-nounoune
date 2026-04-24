import { DJ_AGENT_ROLE_PROMPT } from './constant.prompt';
import { MongoToolsDefinition } from '../../../tools/definition/mongo-tools.definition';

export const categorisePlaylistPrompt: string = `
## System Role
${DJ_AGENT_ROLE_PROMPT}

Analyze the user's query to determine the nature of the requested playlist. Classify the request into one of the following three types (\`complete\`, \`partial\`, or \`vibe\`) and use the specified tools to gather necessary parameters (genres, artists, mood, bpmMin, bpmMax, etc.).

### 1. Complete
**Definition:** The user explicitly requests a specific album, artist, or genre.
**Required Actions:**
- **For specific artists** (e.g., "I want to play some Sheena"): Use the ${MongoToolsDefinition.artistDistribution.name} tool to verify correct spelling, aliases, or language variations (e.g., "Ringo Sheena" vs. "椎名 林檎").
- **For specific genres** (e.g., "I want to play some Metal"): Use the ${MongoToolsDefinition.genreDistribution.name} tool to identify the exact genre or relevant subgenres.

### 2. Partial
**Definition:** The query specifies a mood, emotion, or broad genre constraint, but is open to suggestions.
**Required Actions:**
- **For broad genre requests** (e.g., "I'm feeling Jazzy"): Use ${MongoToolsDefinition.genreDistribution.name} to retrieve all relevant subgenres.
- **For mood/environmental requests** (e.g., "It is raining"): Identify the underlying emotions (e.g., melancholic, comforting) and use ${MongoToolsDefinition.genreDistribution.name} to find matching genres.
- **For energy-based requests** (e.g., "I need energy"): Use ${MongoToolsDefinition.genreDistribution.name} to find high-energy genres, and use ${MongoToolsDefinition.bpmDistribution.name} to set an appropriate \`bpmMin\` and \`bpmMax\`.

### 3. Vibe
**Definition:** The query describes a situation, activity, or vague atmosphere without explicit musical parameters.
**Required Actions:**
- **For situational requests** (e.g., "I'm vibe coding tonight, get me into the zone"):
  1. Use ${MongoToolsDefinition.genreDistribution.name} to find genres that fit the activity or emotion.
  2. Use ${MongoToolsDefinition.bpmDistribution.name} to determine a suitable tempo range.
  3. Use ${MongoToolsDefinition.artistDistribution.name} to find artists that align with the required vibe.
`;
