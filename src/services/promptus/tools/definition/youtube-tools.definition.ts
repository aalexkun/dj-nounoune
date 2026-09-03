import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

/**
 * The fallback pair, for music Qobuz does not carry.
 *
 * Deliberately separate from the Qobuz tools rather than folded into them, because the two
 * catalogs are not the same kind of thing and the model has to be able to tell the user which one
 * it ended up playing from. Qobuz is a licensed catalog with an artist entity behind every
 * recording; YouTube is an open upload site where the artist is a guess read off a free-text
 * upload title. That difference is why the descriptions here are worded as a *second* attempt: a
 * YouTube hit is worth playing when the alternative is nothing, and is not worth preferring when
 * Qobuz already answered.
 *
 * Nothing here writes to Mongo — same stance as the Qobuz tools. `youtube import-playlist` on the
 * CLI is the only path that creates song documents.
 */
export class YoutubeToolsDefinition {
  private constructor() {}

  public static readonly searchMusicCommand: ToolDeclaration = {
    name: 'youtube_search_music',
    description:
      'Search YouTube for a recording or an album. This is the FALLBACK, and only to be used after a Qobuz lookup has already come back empty for the same music — never as the first place you look, and never when Qobuz already answered. ' +
      'Give track_title for a song, album_title for a record (which is looked up as a release playlist and answers with the tracklist in running order), and artist_name alongside either so the hits can be ranked against the right performer. ' +
      'YouTube has no artist entity, so unlike qobuz_find_artist_track this cannot promise the result is really theirs: hits that do not look like the named artist are dropped, but what survives is a judgement, not a guarantee. Say it is from YouTube when you report it. ' +
      'If this comes back empty then the music could not be found anywhere: tell the user so and STOP. There is no third place to look, and no spelling to retry.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        artist_name: {
          type: Type.STRING,
          description: 'The artist, spelled as the user gave it. Strongly recommended: without it the ranking has only the title to go on.',
        },
        track_title: {
          type: Type.STRING,
          description: 'The song to look for. Give this or album_title, or both.',
        },
        album_title: {
          type: Type.STRING,
          description:
            'The record to look for. It is matched against YouTube release playlists, which are the only YouTube object shaped like an album, and answers with the tracklist in running order.',
        },
      },
      required: [],
    },
  } as const;

  public static readonly playCommand: ToolDeclaration = {
    name: 'youtube_start_playback',
    description:
      'Queue audio straight from YouTube and start playing it. Takes YouTube video ids, YouTube playlist ids, or both — a playlist id queues the whole thing in order. ' +
      'The ids must come from youtube_search_music; never invent one and never pass a Qobuz id here. Use qobuz_start_playback for Qobuz ids and start_playback for music the library already holds.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        videoIds: {
          type: Type.ARRAY,
          description: 'YouTube video ids (11 characters) to queue, in the order they should play.',
          items: { type: Type.STRING },
        },
        playlistIds: {
          type: Type.ARRAY,
          description: 'YouTube playlist ids to queue whole, in playlist order.',
          items: { type: Type.STRING },
        },
        clearQueue: {
          type: Type.BOOLEAN,
          description: 'Whether to empty the queue before adding these. False appends after what is already queued.',
        },
      },
      required: ['clearQueue'],
    },
  } as const;
}
