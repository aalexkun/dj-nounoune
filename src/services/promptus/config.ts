/**
 * Model aliases for every Gemini call in Promptus.
 *
 * Requests and agents reference these constants rather than the raw model id, so
 * moving to a new version is a one line change here. Names are the model family
 * — the value carries whichever channel (`-latest`, `-preview`) is current.
 */
export const GEMINI_FLASH = 'gemini-3.8-flash';
export const GEMINI_FLASH_LITE = 'gemini-flash-lite-latest';
export const GEMINI_3_FLASH = 'gemini-3-flash-preview';

/** Per-model quota, as read off the Google AI Studio rate-limit dashboard for this key's tier. */
export interface ModelRateLimit {
  /** Requests per minute - enforced by ThrottleHandler. */
  rpm: number;
  /** Tokens per minute - enforced by ThrottleHandler. */
  tpm: number;
  /** Requests per day - counted and displayed by ThrottleHandler, never enforced. */
  rpd: number;
}

/**
 * The quota belongs to the API key and is set per model, so it is keyed by the exact model id a
 * request carries. Update from the dashboard when the tier changes.
 */
export const MODEL_RATE_LIMITS: Record<string, ModelRateLimit> = {
  [GEMINI_FLASH]: { rpm: 1_000, tpm: 2_000_000, rpd: 10_000 },
  [GEMINI_FLASH_LITE]: { rpm: 4_000, tpm: 4_000_000, rpd: 150_000 },
  // Not on the dashboard yet; Flash's figures as a stand-in until it is.
  [GEMINI_3_FLASH]: { rpm: 1_000, tpm: 2_000_000, rpd: 10_000 },
};

/** A model this table does not list gets the most conservative known figures rather than none. */
export function getModelRateLimit(model: string): ModelRateLimit {
  return MODEL_RATE_LIMITS[model] ?? MODEL_RATE_LIMITS[GEMINI_FLASH];
}
