import { Logger } from '@nestjs/common';
import { GEMINI_DECISION } from '../config';
import { DecisionResponseSchema, NoulAnswerSchema, YesNoDecision, YesNoQuestion } from './decision.interfaces';

/**
 * The Decisions API is a separate surface from `generateContent`: its own endpoint, its own request
 * shape, and `v1beta` only. `@google/genai` gained `client.decisions.create` in 3.2.0 (published
 * 2026-11-11), which the project's seven-day `min-release-age` makes installable from 2026-11-19.
 * Until then this is the same call by hand, in the house style for an external API: `fetch`, Zod at
 * the boundary, a timeout. Swap it for the SDK method when the bump lands; the shapes are identical.
 */
const DECISIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';

/**
 * Tight on purpose. A decision exists to make the pipeline behind it cheaper and faster; one that
 * hangs would cost more than the thinking it was meant to save. The median answer is well under a
 * second, so this only ever fires on an outage, and the caller falls back.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/** One question per call, so the key is a constant rather than something callers must invent. */
const QUESTION_KEY = 'answer';

/**
 * Yes/no decisions from `gemini-decision-1`.
 *
 * Deliberately outside the `Agent` / `PromptusRequest` machinery: there is no prompt loop, no tool
 * call and no transcript here, just a question scored against an input. It is also outside
 * `ThrottleHandler`, which is keyed on `generateContent` models; the decision model has its own
 * quota (free tier 200 requests a minute) and this project asks it once per playlist.
 */
export class DecisionClient {
  private readonly logger = new Logger('DecisionClient');

  constructor(
    private readonly apiKey: string,
    private readonly model: string = GEMINI_DECISION,
  ) {}

  /**
   * Score `input` against one yes/no question. Throws on any transport, HTTP or shape failure:
   * the caller decides what a missing decision means, since that depends on what it was deciding.
   */
  async askYesNo(input: string, question: YesNoQuestion): Promise<YesNoDecision> {
    const body = {
      model: this.model,
      input,
      questions: {
        [QUESTION_KEY]: {
          type: 'noul',
          instructions: question.instructions,
          ...(question.criteria
            ? {
                criteria: {
                  true_description: question.criteria.trueDescription,
                  false_description: question.criteria.falseDescription,
                },
              }
            : {}),
        },
      },
    };

    const response = await fetch(DECISIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The error body names the actual problem (a bad model id, a quota); the status alone does not.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Decisions API answered ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
    }

    const payload: unknown = await response.json();
    const envelope = DecisionResponseSchema.safeParse(payload);
    if (!envelope.success) {
      throw new Error(`Decisions API payload did not match the schema: ${envelope.error.message}`);
    }

    const answer = NoulAnswerSchema.safeParse(envelope.data.answers[QUESTION_KEY]);
    if (!answer.success) {
      throw new Error(`Decisions API returned no noul answer under "${QUESTION_KEY}": ${answer.error.message}`);
    }

    this.logger.debug(`${this.model}: P(yes)=${answer.data.noul.toFixed(2)} confidence=${answer.data.confidence.toFixed(2)}`);

    return {
      yes: answer.data.noul >= 0.5,
      probability: answer.data.noul,
      confidence: answer.data.confidence,
    };
  }
}
