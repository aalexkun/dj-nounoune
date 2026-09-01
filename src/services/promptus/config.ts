/**
 * Model aliases for every Gemini call in Promptus.
 *
 * Requests and agents reference these constants rather than the raw model id, so
 * moving to a new version is a one line change here. Names are the model family
 * — the value carries whichever channel (`-latest`, `-preview`) is current.
 */
export const GEMINI_FLASH = 'gemini-3.6-flash';
export const GEMINI_FLASH_LITE = 'gemini-flash-lite-latest';
export const GEMINI_3_FLASH = 'gemini-3-flash-preview';
