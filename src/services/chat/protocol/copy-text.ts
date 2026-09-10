import { ChatPayload } from './payload.schema';

/**
 * The plain-text rendering of a payload.
 *
 * Two jobs, which is why the server fills it on every envelope rather than letting the client
 * derive it:
 *
 * 1. It is what the `copy` action puts on the clipboard, so copying a playlist yields a numbered
 *    list rather than nothing.
 * 2. It is the **fallback render** for a payload type the client does not know yet. Two repos
 *    deploy independently; without a server-supplied text for every type, a newer payload would
 *    show up as an empty bubble on an older app.
 */
export function copyTextFor(payload: ChatPayload): string {
  switch (payload.type) {
    case 'text':
      return payload.text;

    case 'thread':
      return payload.summary ? `${payload.label} — ${payload.summary}` : payload.label;

    case 'thought':
      return payload.detail ? `${payload.label} — ${payload.detail}` : payload.label;

    case 'tool_call':
      return `${payload.tool}(${JSON.stringify(payload.args)})`;

    case 'tool_result':
      return payload.summary;

    case 'playlist':
      return payload.items
        .map((item) => {
          const album = item.album ? ` ${item.album} -` : '';
          return `${item.position + 1} - [${item.artist}]${album} ${item.title}`;
        })
        .join('\n');

    case 'now_playing': {
      const album = payload.song.album ? ` (${payload.song.album})` : '';
      return `${payload.song.artist} — ${payload.song.title}${album}`;
    }

    case 'mpc': {
      if (!payload.song) return 'Nothing playing';
      const verb = payload.state === 'play' ? 'Playing' : payload.state === 'pause' ? 'Paused' : 'Stopped';
      return `${verb} — ${payload.song.artist} — ${payload.song.title}`;
    }

    case 'system':
      return payload.text;

    case 'log':
      return `[${payload.scope}] ${payload.text}`;

    case 'error':
      return payload.message;
  }
}
