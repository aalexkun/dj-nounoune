import { ToolDeclaration } from '../tool.type';
import { Type } from '@google/genai';

/**
 * The middle rung of the streaming ladder: Qobuz first, Spotify second, YouTube last.
 *
 * Spotify sits between the two for a reason the descriptions have to carry. Like Qobuz it is a
 * licensed catalog with an artist entity behind every recording, so a hit can be verified to be
 * the named artist's by id — something YouTube cannot promise. Unlike Qobuz it is lossy: 320 kbps
 * Ogg, which is why it is never preferred when Qobuz already answered, and why the model is told
 * to say which catalog it ended up playing from.
 *
 * The search and play tools write nothing to Mongo, the same stance as the Qobuz and YouTube
 * pairs: these recordings have no song document, and inventing one for a track the user asked to
 * hear once would seed the library with rows no importer ever saw.
 */
export class SpotifyToolsDefinition {
  private constructor() {}

  public static readonly searchArtistCommand: ToolDeclaration = {
    name: 'spotify_search_artist',
    description:
      'Look an artist up in the Spotify catalog to see WHO they are and WHAT they have released: their Spotify id and their discography with album ids. This is the SECOND place to look for an artist, after qobuz_search_artist or qobuz_find_artist_track has come back with no artist of that name — never the first, and never when Qobuz already found them. ' +
      'Use it when the user named an artist and nothing more — "what has she put out", "play something by them" — so you can then choose a record and play it with spotify_start_playback. Give track_title alongside to also find that one recording of theirs, verified against their Spotify id. ' +
      'If this returns no artist either, the one step left is youtube_search_music, once, with the same name. Do not call this tool again with another spelling.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        artist_name: {
          type: Type.STRING,
          description: 'The artist name to look up, spelled as the user gave it.',
        },
        track_title: {
          type: Type.STRING,
          description: 'Optional. A recording by that artist to find alongside the discography. Only hits verified to be theirs are reported.',
        },
      },
      required: ['artist_name'],
    },
  } as const;

  public static readonly searchMusicCommand: ToolDeclaration = {
    name: 'spotify_search_music',
    description:
      'Search the Spotify catalog for a recording or an album. This is the SECOND attempt, to be used only after a Qobuz lookup has already come back empty for the same music — never as the first place you look, and never when Qobuz already answered. It comes BEFORE youtube_search_music: Spotify is a licensed catalog with a verified artist behind every hit, where YouTube is a guess read off an upload title. ' +
      "Give artist_name whenever the user named one — the name is resolved to a Spotify artist id and every hit is verified against it, so it cannot answer with somebody else covering the same song. Give track_title for a song, album_title for a record (matched against the artist's own discography and answered with the tracklist in running order), or both to pick one track off one record. " +
      'Say it is from Spotify when you report it. If this comes back empty, youtube_search_music is the one search left — and if that is empty too, the music could not be found anywhere.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        artist_name: {
          type: Type.STRING,
          description: 'The artist, spelled as the user gave it. Strongly recommended: with it every hit is verified to be theirs by id.',
        },
        track_title: {
          type: Type.STRING,
          description: 'The song to look for. Give this or album_title, or both.',
        },
        album_title: {
          type: Type.STRING,
          description:
            'The record to look for. With artist_name it is matched against their discography and answered with the tracklist in running order.',
        },
      },
      required: [],
    },
  } as const;

  public static readonly playCommand: ToolDeclaration = {
    name: 'spotify_start_playback',
    description:
      'Queue tracks straight from the Spotify catalog and start playing them, without going through the music library. Takes Spotify track ids, Spotify album ids, or both — an album id queues the whole album in running order. ' +
      'The ids must come from spotify_search_music or spotify_search_artist, or from the sourceId of current_song when its sourceName is spotify; never invent one, and never pass a Qobuz or YouTube id here. Use qobuz_start_playback for Qobuz ids, youtube_start_playback for YouTube ids, and start_playback for music the library already holds. ' +
      'Tell the user it is streaming from Spotify.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        trackIds: {
          type: Type.ARRAY,
          description: 'Spotify track ids to queue, in the order they should play.',
          items: { type: Type.STRING },
        },
        albumIds: {
          type: Type.ARRAY,
          description: 'Spotify album ids to queue whole, in the order they should play.',
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
