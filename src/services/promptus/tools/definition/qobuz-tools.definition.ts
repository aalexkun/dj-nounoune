import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

/**
 * Tools that reach past the household library into the Qobuz catalog: finding an artist that was
 * never imported, streaming their tracks straight from Qobuz, and adding them to the favourites.
 *
 * Everything here bypasses the song documents entirely — nothing is written to Mongo, nothing is
 * indexed. That is the point: it is how the chat answers "play the new one, we don't own it".
 */
export class QobuzToolsDefinition {
  private constructor() {}

  public static readonly searchArtistCommand: ToolDeclaration = {
    name: 'qobuz_search_artist',
    description:
      'Look an artist up in the Qobuz streaming catalog and get back their Qobuz id, their discography with album ids, and — when a track title is given — the matching track ids. Use it for music the household library does not hold, so it can then be played with qobuz_start_playback. ' +
      'If the search returns no artist, that is final: the catalog does not carry them. Do not call this tool again with another spelling, and do not fall back to another tool — tell the user the artist is not on Qobuz and stop.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        artist_name: {
          type: Type.STRING,
          description: 'The artist name to look up, spelled as the user gave it.',
        },
        track_title: {
          type: Type.STRING,
          description:
            'Optional. A specific recording by that artist. Supply it when the user named a song, so the answer carries the track ids needed to play it.',
        },
      },
      required: ['artist_name'],
    },
  } as const;

  public static readonly playCommand: ToolDeclaration = {
    name: 'qobuz_start_playback',
    description:
      'Queue tracks straight from the Qobuz catalog and start playing them, without going through the music library. Takes Qobuz track ids, Qobuz album ids, or both — an album id queues the whole album in running order. The ids must come from qobuz_search_artist or from current_song; never invent one. For music the library already holds, use disc_jockey_create_playlist and start_playback instead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        trackIds: {
          type: Type.ARRAY,
          description: 'Qobuz track ids to queue, in the order they should play.',
          items: { type: Type.STRING },
        },
        albumIds: {
          type: Type.ARRAY,
          description: 'Qobuz album ids to queue whole, in the order they should play.',
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

  public static readonly favoriteCommand: ToolDeclaration = {
    name: 'qobuz_add_favorite',
    description:
      'Add an album — or, when the user explicitly asked for the song itself, a track — to the Qobuz favourites of the account. Use it whenever the user wants to keep, save, like, bookmark or favourite what they are hearing or what you just found. ' +
      'Work out from the conversation WHAT they mean: they are almost always talking about the record, not the single track, so `scope` is "album" unless they said "this song", "this track", "just the tune" or picked one title out of several. ' +
      'Work out from the conversation WHICH release they mean too — the one playing now, or the one you named a moment ago — and never ask them to repeat an id. ' +
      'Ids come from qobuz_search_artist, or from the qobuzTrackId and qobuzAlbumId fields of current_song. With scope "album" a track id is enough: the album holding it is resolved and favourited. Music the household owns only as a local file has no Qobuz id at all and cannot be favourited — say so rather than inventing one.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scope: {
          type: Type.STRING,
          enum: ['album', 'track'],
          description:
            'What the user is asking to keep. Default to "album" — that is what people mean almost every time, even when they point at a song ("save this", "I like this one", "keep that for me"). Only use "track" when they singled the recording out in so many words.',
        },
        trackIds: {
          type: Type.ARRAY,
          description:
            'Qobuz track ids. With scope "track" these are what gets favourited. With scope "album" they are resolved to the album each one belongs to, which is the usual way to save what is playing.',
          items: { type: Type.STRING },
        },
        albumIds: {
          type: Type.ARRAY,
          description: 'Qobuz album ids to favourite directly. Ignored when scope is "track".',
          items: { type: Type.STRING },
        },
      },
      required: ['scope'],
    },
  } as const;
}
