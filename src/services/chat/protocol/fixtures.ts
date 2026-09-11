import { ChatEnvelope, ChatEnvelopeSchema, PROTOCOL_VERSION } from './envelope.schema';
import { ChatPayload, ChatPayloadType } from './payload.schema';

/**
 * One golden sample per payload type, shared by both repos.
 *
 * These are the contract, not a test aid. The Android side decodes every one of them in a unit
 * test, which is what catches the failure that actually happens between two independently deployed
 * repos: the server changed a field and the app did not. Codegen would be more machinery than a
 * one-client project earns; a directory of JSON both sides read is enough.
 *
 * Every fixture is built through `ChatEnvelopeSchema.parse`, so a sample that drifted out of the
 * schema fails the generator rather than being written and quietly trusted.
 */

/** Fixed so a regenerated fixture set produces an empty diff unless something really changed. */
const AT = 1_714_500_000_000;

const SONG = {
  songId: '65f1a2b3c4d5e6f7a8b9c0d1',
  title: 'Roads',
  artist: 'Portishead',
  album: 'Dummy',
  year: '1994',
  genre: 'Trip Hop',
  durationMs: 302_000,
  coverUrl: 'https://static.qobuz.com/images/covers/dummy600.jpg',
  source: 'qobuz' as const,
  sourceId: '1234567',
  bitrate: 1_411,
  sampleRate: 44_100,
  isHighRes: false,
  isCdQuality: true,
  bitDepth: 16,
  encoding: 'flac',
  bpm: 84,
  category: 'Electronic',
  emotion: 'melancholic',
  pace: 'slow',
  label: 'Go! Beat',
  country: 'United Kingdom',
  language: 'English',
  artistIntro: 'Bristol, 1991. A trio who made paranoia sound like a lounge act.',
  // The late arrival, and the reason the fixture carries one: a client that drops this field on a
  // later revision of an envelope it has already drawn is the bug this contract exists to catch.
  description: 'The one everybody knows, and still the saddest thing on **Dummy**.',
};

function envelope(seq: number, payload: ChatPayload, overrides: Partial<ChatEnvelope> = {}): ChatEnvelope {
  return ChatEnvelopeSchema.parse({
    v: PROTOCOL_VERSION,
    id: `01JD00000000000000000000${seq.toString().padStart(2, '0')}`,
    rev: 0,
    seq,
    chatId: '65e0000000000000000000aa',
    turnId: '01JDTURN0000000000000001',
    parentId: null,
    supersededBy: null,
    role: 'assistant',
    state: 'complete',
    level: 'info',
    createdAt: AT,
    updatedAt: AT,
    copyText: '',
    actions: [],
    payload,
    ...overrides,
  });
}

/**
 * Keyed by payload type so a missing fixture is a compile error rather than a gap nobody notices.
 */
export const FIXTURES: Record<ChatPayloadType, ChatEnvelope> = {
  text: envelope(
    1,
    { type: 'text', format: 'markdown', text: 'Queued up something moody for you — **Portishead**, then a slow drift outward.' },
    {
      role: 'user',
      clientId: 'client-7f3a',
      copyText: 'Queued up something moody for you — Portishead, then a slow drift outward.',
      actions: [{ kind: 'copy' }],
    },
  ),

  thread: envelope(
    2,
    {
      type: 'thread',
      label: 'Disc Jockey · building a playlist',
      agent: 'DiscJockey',
      summary: '24 songs, 1h 47m',
      childCount: 3,
      collapsedByDefault: true,
    },
    { role: 'agent', copyText: 'Disc Jockey · building a playlist — 24 songs, 1h 47m' },
  ),

  thought: envelope(
    3,
    { type: 'thought', agent: 'QueryDatabase', label: 'Reading the library profile', detail: 'Matching "moody" against the emotion vocabulary.' },
    { role: 'agent', parentId: '01JD0000000000000000000002', copyText: 'Reading the library profile' },
  ),

  tool_call: envelope(
    4,
    {
      type: 'tool_call',
      callId: 'call-0091',
      tool: 'search_music_database',
      args: { natural_language_request: 'slow, melancholic, mostly instrumental' },
    },
    { role: 'tool', parentId: '01JD0000000000000000000002', level: 'debug', copyText: 'search_music_database(…)' },
  ),

  tool_result: envelope(
    5,
    { type: 'tool_result', callId: 'call-0091', tool: 'search_music_database', ok: true, summary: '24 songs matched across 3 branches' },
    { role: 'tool', parentId: '01JD0000000000000000000002', level: 'debug', copyText: '24 songs matched across 3 branches' },
  ),

  playlist: envelope(
    6,
    {
      type: 'playlist',
      title: 'Something moody',
      live: true,
      mpdVersion: 812,
      items: [
        {
          elementId: 'row-1',
          position: 0,
          songId: '65f1a2b3c4d5e6f7a8b9c0d1',
          title: 'Roads',
          artist: 'Portishead',
          album: 'Dummy',
          durationMs: 302_000,
          source: 'qobuz',
          artworkUrl: 'https://static.qobuz.com/images/covers/dummy600.jpg',
          state: 'playing',
          actions: [
            { kind: 'copy' },
            {
              kind: 'share',
              target: { title: 'Roads', text: 'Portishead — Roads', url: 'https://open.qobuz.com/track/1234567', mimeType: 'text/plain' },
            },
            { kind: 'song_info', songId: '65f1a2b3c4d5e6f7a8b9c0d1' },
            { kind: 'queue_next', songId: '65f1a2b3c4d5e6f7a8b9c0d1' },
            { kind: 'remove_from_playlist', songId: '65f1a2b3c4d5e6f7a8b9c0d1' },
          ],
        },
        {
          elementId: 'row-2',
          position: 1,
          songId: '65f1a2b3c4d5e6f7a8b9c0d2',
          title: 'Angel',
          artist: 'Massive Attack',
          album: 'Mezzanine',
          durationMs: 379_000,
          source: 'file',
          state: 'queued',
          // No share url: a local file has nothing public to link to.
          actions: [
            { kind: 'copy' },
            { kind: 'share', target: { title: 'Angel', text: 'Massive Attack — Angel', mimeType: 'text/plain' } },
            { kind: 'play_now', songId: '65f1a2b3c4d5e6f7a8b9c0d2', source: 'file' },
          ],
        },
      ],
    },
    { copyText: '1 - [Portishead] Dummy - Roads\n2 - [Massive Attack] Mezzanine - Angel', actions: [{ kind: 'copy' }] },
  ),

  now_playing: envelope(7, { type: 'now_playing', song: SONG }, { copyText: 'Portishead — Roads (Dummy)', actions: [{ kind: 'copy' }] }),

  mpc: envelope(
    8,
    {
      type: 'mpc',
      state: 'play',
      song: SONG,
      elapsedMs: 74_000,
      durationMs: 302_000,
      sampledAt: AT,
      volume: 68,
      modes: { repeat: false, random: true, single: false, consume: false },
      queue: { position: 0, length: 24 },
      recent: [
        { title: 'Angel', artist: 'Massive Attack', coverUrl: 'https://static.qobuz.com/images/covers/mezzanine600.jpg' },
        { title: 'Teardrop', artist: 'Massive Attack' },
      ],
    },
    {
      // Session-scoped: the transport bar belongs to the connection, not to a conversation.
      chatId: null,
      turnId: null,
      role: 'system',
      copyText: 'Playing — Portishead — Roads',
      actions: [
        { kind: 'mpc_previous' },
        { kind: 'mpc_pause' },
        { kind: 'mpc_stop' },
        { kind: 'mpc_next' },
        { kind: 'mpc_seek', durationMs: 302_000 },
        // Not buttons: what a long press on the track name opens.
        { kind: 'copy' },
        {
          kind: 'share',
          target: { title: 'Roads', text: 'Portishead — Roads (Dummy)', url: 'https://open.qobuz.com/track/1234567', mimeType: 'text/plain' },
        },
      ],
    },
  ),

  system: envelope(
    9,
    {
      type: 'system',
      event: 'source_upgraded',
      text: 'Upgraded "Angel" from the local file to Qobuz.',
      data: { songId: '65f1a2b3c4d5e6f7a8b9c0d2', provider: 'qobuz' },
    },
    { role: 'system', copyText: 'Upgraded "Angel" from the local file to Qobuz.' },
  ),

  log: envelope(
    10,
    { type: 'log', scope: 'QueueStateService', text: 'MPD queue version 811 → 812, 24 entries resolved', data: { version: 812 } },
    { role: 'system', level: 'debug', copyText: 'MPD queue version 811 → 812, 24 entries resolved' },
  ),

  error: envelope(
    11,
    { type: 'error', code: 'no_songs_found', message: 'Nothing in the library matched that. Try naming an artist?', retryable: true },
    { state: 'failed', copyText: 'Nothing in the library matched that. Try naming an artist?', actions: [{ kind: 'retry' }] },
  ),
};

/**
 * Samples that are not a payload type of their own, but a *scoping* the client has to route on.
 *
 * `FIXTURES` is keyed by payload type so a missing one is a compile error. That is the right shape
 * for coverage and the wrong shape for this: a `playlist` with a null `chatId` is the same payload
 * reaching the app down a completely different path — the live queue mirror rather than a
 * conversation — and a client that renders it into a timeline is broken in a way no per-type
 * fixture would catch.
 */
export const EXTRA_FIXTURES: Record<string, ChatEnvelope> = {
  queue: envelope(
    12,
    {
      type: 'playlist',
      // No title: the live queue is not a playlist anybody named.
      live: true,
      mpdVersion: 812,
      items: [
        {
          elementId: 'row-0',
          position: 0,
          songId: '65f1a2b3c4d5e6f7a8b9c0d1',
          title: 'Roads',
          artist: 'Portishead',
          album: 'Dummy',
          durationMs: 302_000,
          source: 'qobuz',
          artworkUrl: 'https://static.qobuz.com/images/covers/dummy600.jpg',
          state: 'playing',
          actions: [
            { kind: 'copy' },
            {
              kind: 'share',
              target: { title: 'Roads', text: 'Portishead — Roads', url: 'https://open.qobuz.com/track/1234567', mimeType: 'text/plain' },
            },
            { kind: 'song_info', songId: '65f1a2b3c4d5e6f7a8b9c0d1' },
            { kind: 'queue_next', songId: '65f1a2b3c4d5e6f7a8b9c0d1' },
            { kind: 'remove_from_playlist', songId: '65f1a2b3c4d5e6f7a8b9c0d1' },
          ],
        },
        {
          elementId: 'row-1',
          position: 1,
          songId: '65f1a2b3c4d5e6f7a8b9c0d2',
          title: 'Angel',
          artist: 'Massive Attack',
          album: 'Mezzanine',
          durationMs: 379_000,
          source: 'file',
          state: 'queued',
          actions: [
            { kind: 'copy' },
            { kind: 'share', target: { title: 'Angel', text: 'Massive Attack — Angel', mimeType: 'text/plain' } },
            { kind: 'play_now', songId: '65f1a2b3c4d5e6f7a8b9c0d2', source: 'file' },
          ],
        },
      ],
    },
    {
      // Session-scoped, exactly like the transport bar: MPD has one queue and no conversation owns
      // it. This is the routing fact the fixture exists to pin down.
      chatId: null,
      turnId: null,
      role: 'system',
      copyText: '1 - [Portishead] Dummy - Roads\n2 - [Massive Attack] Mezzanine - Angel',
      actions: [{ kind: 'copy' }],
    },
  ),
};

/** Filename → envelope, ready to write. */
export function fixtureFiles(): Array<{ name: string; envelope: ChatEnvelope }> {
  return [...Object.entries(FIXTURES), ...Object.entries(EXTRA_FIXTURES)].map(([name, envelope]) => ({ name: `${name}.json`, envelope }));
}
