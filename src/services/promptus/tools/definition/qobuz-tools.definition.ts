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
      'Look an artist up in the Qobuz streaming catalog to see WHO they are and WHAT they have released: their Qobuz id and their discography with album ids. Use it when the user named an artist and nothing more — "what has she put out", "play something by them" — so you can then choose a record and play it with qobuz_start_playback. ' +
      'Do NOT use it when the user also named an album or a song: qobuz_find_artist_track is locked to the artist and is the only one of the two that cannot answer with somebody else. ' +
      'If the search returns no artist, the Qobuz catalog does not carry them. Do not call this tool again with another spelling. The next rung is spotify_search_artist with the same name, and youtube_search_music only after Spotify has come back empty too.',
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
            'Optional, and rarely what you want: prefer qobuz_find_artist_track when a song is named. Supplied here it runs a loose catalog search whose hits are only ranked against the artist, not restricted to them.',
        },
      },
      required: ['artist_name'],
    },
  } as const;

  public static readonly findArtistTrackCommand: ToolDeclaration = {
    name: 'qobuz_find_artist_track',
    description:
      'Find a specific album or recording BY A NAMED ARTIST in the Qobuz catalog, locked to that artist. The name is resolved to a Qobuz artist id first and every id it returns is verified against it, so it can never hand back another performer covering the same song. ' +
      'This is the tool to use whenever the user named an artist together with an album or a song — "the album 10 by Spice", "play Bad Behaviour by Spice" — and it is the one to use for an album by name, because the tracklist is read off the record itself instead of guessed at. ' +
      'Give album_title on its own to get the whole record in running order; give track_title on its own to find that recording anywhere in their catalog; give both to pick one track off one record. ' +
      'An empty answer means that artist has no such release on Qobuz. Do not retry it through qobuz_search_artist hoping for a longer list: that list would be other people. The next step is spotify_search_music with the same artist, album and song, and youtube_search_music only after Spotify is empty too.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        artist_name: {
          type: Type.STRING,
          description: 'The artist the music belongs to, spelled as the user gave it. Everything returned is verified to be theirs.',
        },
        album_title: {
          type: Type.STRING,
          description:
            'Optional. An album by that artist, matched against their own discography. Supply it whenever the user named a record — even a title as short and generic as "10", which a plain catalog search cannot handle.',
        },
        track_title: {
          type: Type.STRING,
          description:
            "Optional. The recording the user asked for. With album_title it selects from that tracklist; without one it searches the artist's catalog.",
        },
      },
      required: ['artist_name'],
    },
  } as const;

  public static readonly playCommand: ToolDeclaration = {
    name: 'qobuz_start_playback',
    description:
      'Queue tracks straight from the Qobuz catalog and start playing them, without going through the music library. Takes Qobuz track ids, Qobuz album ids, or both — an album id queues the whole album in running order. The ids must come from qobuz_find_artist_track, qobuz_search_artist or current_song; never invent one. For music the library already holds, use disc_jockey_create_playlist and start_playback instead.',
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
      'Ids come from qobuz_find_artist_track or qobuz_search_artist, or from the qobuzTrackId and qobuzAlbumId fields of current_song. With scope "album" a track id is enough: the album holding it is resolved and favourited. Music the household owns only as a local file has no Qobuz id at all and cannot be favourited — say so rather than inventing one.',
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
