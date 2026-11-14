import { z } from 'zod';

/**
 * A yes/no question for the Gemini Decisions API (`gemini-decision-1`).
 *
 * The model scores the two outcomes in one forward pass and answers with a calibrated probability
 * rather than text, which is why it is fast (a few hundred milliseconds end to end) and why it bills
 * no output tokens. It never sees the key an answer is filed under, only `instructions` and, when
 * given, the two criteria; the criteria are what turn a vague question into a reliable one.
 */
export interface YesNoQuestion {
  /** The question, as the model reads it. */
  instructions: string;
  /** What a yes looks like, and what a no looks like. Optional on the API; always worth writing. */
  criteria?: {
    trueDescription: string;
    falseDescription: string;
  };
}

/** The answer to a `noul` (yes/no) question, as the API returns it. */
export const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  /** Calibrated probability of yes. The API keeps it between 0.01 and 0.99. */
  noul: z.number().min(0).max(1),
  /** Probability that the top answer is the right one, 0 to 1. */
  confidence: z.number().min(0).max(1),
});

/**
 * The envelope. `answers` is keyed by the names the caller chose; each entry is parsed against its
 * own question type by the caller, since this schema cannot know which key carries which type.
 */
export const DecisionResponseSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  usage: z
    .object({
      total_input_tokens: z.number().optional(),
      total_output_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

/** What the caller gets back: the verdict at 0.5, and the two numbers it was read off. */
export interface YesNoDecision {
  yes: boolean;
  /** P(yes) as the model scored it. */
  probability: number;
  /** How sure the model is of the top answer. */
  confidence: number;
}
