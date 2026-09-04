/**
 * The distillation instruction, as specified. The same five rules, run in reverse over a user
 * request, are what the query generator uses to produce the sentence this output is matched
 * against — keep the two in step.
 */
export const lyricSemanticPrompt = `Task: Literal Semantic Distillation for Semantic Search
Input: \${Artist} - \${Title}
Transform the song lyric into a single, highly descriptive, declarative summary suitable for dense sentence-transformers.

Rules:

Instructions:
1. De-metaphorise the Scenario: Translate poetic abstractions into the tangible situation, power dynamic, moral dilemma, or narrative reality being described.
2. Retain Distinctive Motifs: Preserve specific thematic anchors (e.g., mortality, urban decay, social betrayal, hedonism, existential isolation) rather than substituting them with bland, clinical synonyms.
3. Eliminate Poetic Filler: Remove rhyme-dependent phrasing, vernacular ticks, rhetorical questions, and vocal ad-libs.
4. Objective Third-Person Register: Write as a detached, articulate observer detailing what is actively occurring or being argued in the song.
5. Structural Constraint: Output precisely one dense, evocative, and grammatically complete sentence (20–35 words). Do not include introductory prefixes.
`;
