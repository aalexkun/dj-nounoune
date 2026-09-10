import { ChatAction } from './action.schema';
import { ChatRole } from './envelope.schema';
import { ChatPayload } from './payload.schema';

/**
 * The baseline menu every message carries, before its producer adds anything.
 *
 * Text selection and a long-press menu are the same gesture, so a bubble cannot have both: holding
 * a playlist row started a selection instead of opening its menu. Copying is therefore an
 * **action** rather than a selection — which is also what makes it work on the things that have no
 * selectable text to begin with, a playlist or a transport bar.
 *
 * Everything can be copied, because `copyText` is required on every envelope for exactly this
 * reason. Beyond that the set is per type, and deliberately thin: a producer that knows more —
 * the queue watcher, the playlist builder — passes its own list and overrides this entirely.
 */
export function defaultActionsFor(payload: ChatPayload, role: ChatRole): ChatAction[] {
  const actions: ChatAction[] = [{ kind: 'copy' }];

  // Re-running a turn means re-sending the prompt, so it only belongs on the prompt. Offered on an
  // assistant bubble it would re-send the assistant's own words back as a question.
  if (payload.type === 'text' && role === 'user') {
    actions.push({ kind: 'retry' });
  }

  return actions;
}
