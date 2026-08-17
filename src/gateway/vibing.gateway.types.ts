import { z } from 'zod';
import { MpdPlaybackState } from '../services/mpd-client/responses/StatusMpdResponse';

/** Sent by the page to drive the player. Answered with a `VibingPlaybackState` over the socket ack. */
export const VibingControlMessage = 'vibing-control';

/** Pushed to every viewer whenever the transport state changes, so several screens stay in step. */
export const VibingPlaybackMessage = 'vibing-playback';

/**
 * `toggle` is what the page's middle button sends: the server reads the player state and picks
 * start or stop, rather than the page acting on a state it may have watched go stale.
 */
export const VibingControlSchema = z.object({
  action: z.enum(['next', 'previous', 'play', 'stop', 'toggle', 'status']),
});

export type VibingControl = z.infer<typeof VibingControlSchema>;
export type VibingControlAction = VibingControl['action'];

/** `unknown` covers a player that could not be reached — the page greys the buttons out on it. */
export type VibingPlaybackState = {
  state: MpdPlaybackState | 'unknown';
  /** MPD's queue-level id, not a `Song._id`. Only useful to tell one playing track from another. */
  songId?: string;
  /** Songs currently queued, so the page can tell "stopped" from "nothing loaded". */
  queueLength?: number;
  at: number;
};

/** A viewer reacting to the track playing. Counted into `Playlog.feedback` like the app's own. */
export const VibingReactionMessage = 'vibing-reaction';

/** Pushed to the other viewers so a reaction sent from a phone animates on the television too. */
export const VibingReactionBroadcastMessage = 'vibing-reaction-broadcast';

/**
 * The same four the Android app sends on `chat-feedback`, and the only ones
 * `PlaylogService.handleFeedbackEvent` will count — anything else is dropped there with a warning.
 */
export const VibingReactionSchema = z.object({
  reaction: z.enum(['awesome', 'great', 'duh', 'wtf']),
});

export type VibingReaction = z.infer<typeof VibingReactionSchema>['reaction'];

/** The ack the page gets back. `ok: false` carries the reason instead of failing silently. */
export type VibingControlResult = {
  ok: boolean;
  action?: VibingControlAction;
  error?: string;
  playback?: VibingPlaybackState;
};
