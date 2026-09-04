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
 * The search and play tools write nothing to Mongo — same stance as the Qobuz tools. The one
 * exception is `youtube_import_to_library`, which is the chat's door onto `youtube import-playlist`:
 * it runs the same `YoutubeService.importPlaylist`, and only when the user asked for the music to
 * be kept.
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

  public static readonly importCommand: ToolDeclaration = {
    name: 'youtube_import_to_library',
    description:
      'Import music that is on YouTube into the household music library, so it becomes a permanent part of the collection rather than a one-off stream. Use it when the user wants to KEEP, ADD, SAVE or IMPORT into the library something that is playing from YouTube or something youtube_search_music just found — this is the YouTube counterpart of qobuz_add_favorite, and the right tool whenever current_song reports sourceName "youtube". ' +
      'A playlist is what gets imported, as an album: give playlistIds when you have them (from youtube_search_music, or the playlist the user named). ' +
      'When all you have is a video — the one playing now, its id in the sourceId of current_song, or a hit from the track search — give it in videoIds and the release playlist holding that video is found and imported whole, which is what people mean by "add this" said over a track: the record, not the lone upload. Pass artist_name and album_title from current_song alongside it whenever they are known; they are what make that lookup land on the right record. ' +
      'Never invent an id, and never use this for Qobuz ids or for music the library already holds. Report exactly what was imported, by album and artist, so the user can catch a wrong record.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        playlistIds: {
          type: Type.ARRAY,
          description: 'YouTube playlist ids to import, each as one album. Release playlists (ids starting with OLAK5uy_) are the ideal input.',
          items: { type: Type.STRING },
        },
        videoIds: {
          type: Type.ARRAY,
          description:
            'YouTube video ids (11 characters). Each is resolved to the release playlist that contains it, and that playlist is imported as the album. Use this for "the song playing now" when current_song says the source is youtube.',
          items: { type: Type.STRING },
        },
        artist_name: {
          type: Type.STRING,
          description:
            'Optional. The artist of the video(s), as current_song or the search reported it. Sharpens the search for the release playlist.',
        },
        album_title: {
          type: Type.STRING,
          description:
            'Optional. The album the video(s) belong to, when current_song or the search reported one. With it the release playlist is looked up by name first, which is far more reliable than by track.',
        },
      },
      required: [],
    },
  } as const;
}
