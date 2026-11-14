import { ThinkingLevel } from '@google/genai';
import { YesNoQuestion } from '../../../decision/decision.interfaces';

/**
 * The one question asked of `gemini-decision-1` before a playlist is built: does this brief need a
 * high level of thinking? Not a `PromptusRequest` - the Decisions API scores the two outcomes rather
 * than generating text, so there is no system instruction, no schema and no response class, only
 * this wording and a threshold.
 *
 * The criteria carry the weight. "Does it require a high level of thinking" on its own is a question
 * about the model, which it cannot answer; what it can score is whether the listener was precise or
 * open, and that is what the two descriptions spell out. Written against the requests this DJ
 * actually gets: "play whatever", "something for cooking", and at the other end a named scene, a
 * decade, a language, an ordering and an exclusion in one sentence.
 */
export const PLAYLIST_COMPLEXITY_QUESTION: YesNoQuestion = {
  instructions:
    'Does fulfilling this playlist request well require a high level of thinking: several constraints to satisfy at once, ' +
    'a precise artist, era, place, language or theme to get right, an ordering or a narrative to build, or exclusions to respect?',
  criteria: {
    trueDescription:
      'The listener is precise. They name particular artists, albums, songs, years or decades, countries, languages, moods to ' +
      'combine, tempo or length limits, a sequence to follow ("start slow and build up"), an occasion with rules ("dinner with my ' +
      'parents, nothing with swearing"), or several conditions that must all hold at the same time.',
    falseDescription:
      'The listener is open. They want some music of a broad kind: a genre, a vibe, "whatever", "something to cook to", ' +
      '"surprise me", "more like this", with at most one loose constraint and nothing to get exactly right.',
  },
};

/** The input the question is scored against: the brief, framed so the model knows what it is reading. */
export function playlistComplexityInput(naturalLanguageRequest: string): string {
  return `A listener asked a disc jockey for a playlist. The request, as typed:\n\n${naturalLanguageRequest}`;
}

/**
 * P(yes) at or above this is a HIGH job. A plain majority rather than anything stricter: the
 * downside of HIGH on an open brief is a slower, dearer playlist, the downside of MEDIUM on a precise
 * one is a playlist that misses the point, and the second is the one the listener notices.
 */
export const HIGH_THINKING_THRESHOLD = 0.5;

/** MEDIUM or HIGH, never anything else: the pipeline never runs a playlist below MEDIUM. */
export function playlistThinkingLevel(probabilityOfHigh: number): ThinkingLevel {
  return probabilityOfHigh >= HIGH_THINKING_THRESHOLD ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM;
}
