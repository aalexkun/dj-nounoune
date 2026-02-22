import { FinishReason, GenerateContentResponse } from '@google/genai';

export class PromptusResponse {
  public readonly finishReason: FinishReason;

  constructor(public readonly raw: GenerateContentResponse) {
    // Safely access the first candidate
    const candidate = raw.candidates?.[0];
    // Store the reason on the instance

    switch (candidate?.finishReason) {
      case FinishReason.STOP:
        this.finishReason = candidate?.finishReason;
        break;

      case FinishReason.MAX_TOKENS:
        // The token ceiling was hit (either your config limit or the model's absolute limit).
        this.finishReason = candidate?.finishReason;
        throw new Error('Generation halted: MAX_TOKENS reached limit.');

      case FinishReason.SAFETY:
        // The response was blocked by Google's safety filters (e.g., hate speech, dangerous content).
        this.finishReason = candidate?.finishReason;
        throw new Error('Generation halted: Content flagged by safety settings.');

      case FinishReason.RECITATION:
        // The model was stopped because it started reciting copyrighted or proprietary data verbatim.
        this.finishReason = candidate?.finishReason;
        throw new Error('Generation halted: Content flagged for unauthorised recitation.');

      case FinishReason.OTHER:
        // A catch-all for system-level or internal API interruptions.
        this.finishReason = candidate?.finishReason;
        throw new Error('Generation halted: An unknown system error occurred (OTHER).');

      case FinishReason.FINISH_REASON_UNSPECIFIED:
        // The API did not return a specific reason, or the candidate is missing.
        this.finishReason = candidate?.finishReason;
        console.warn('⚠️ Warning: Finish reason is unspecified or undefined.');
        break;

      case undefined:
      default:
        throw new Error('Generation halted: An unknown system error occurred (finishReason).' + JSON.stringify(raw));
    }
  }
}
