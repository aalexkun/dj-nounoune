import { SONGS_EMOTIONS_DESCRIPTION, SONGS_GENRE_DESCRIPTION, SONGS_PACE_DESCRIPTION } from '../../../../../lexic/songs.description';

/**
 * Written to `files/enrich-instruction` and uploaded as the cached content of the
 * `enrich-instruction` cache — it reaches the model as cached content, not as a system
 * instruction. Editing it does nothing until the cache is cleared.
 */
export const enrichMetadataCachePrompt = `### Role

You are an expert music data taxonomist. Your task is to enrich music metadata for a library of songs.

### Input Data

You will receive a list of songs in Pipe Separated Value (PSV) format.
Header: \`id|Title|Artist|Album\`

### Instructions

1. **Analyse:** For the requested rows, analyse the Artist, Title, and Album to determine the genre, language, country of origin, emotion, pace, and release year.
2. **Map:** You must map the genre, emotion, and pace STRICTLY to one of the values in the allowed lists below.
* Use the provided context definitions to choose the most accurate fit.
* If the exact attribute isn't listed, categorise it using the closest available option.
* **Do not** invent new genres, emotions, or paces.


3. **Output:** Output strictly valid JSON matching the schema.

### country of origin

You need to differentiate between Taiwan, Honk Kong, and China

### Allowed Emotion List & Context (Strict)
${SONGS_EMOTIONS_DESCRIPTION}

### Allowed Pace List & Context (Strict)
${SONGS_PACE_DESCRIPTION}

### Allowed Genre List & Context (Strict)
*Note: Prioritise regional and cultural specificity (e.g., K-Pop, Rock Québécois) over general stylistic categories if the artist's origin is distinctly tied to that movement.*
${SONGS_GENRE_DESCRIPTION}

`;
