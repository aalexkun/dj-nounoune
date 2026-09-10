export class SongEntity {
  static readonly path = '/_zentity';
  static readonly model = 'song_entity';
  static readonly attributes = {
    title: { type: 'string' },
    artist: { type: 'string' },
    album: { type: 'string' },
  };
  static readonly matchers = {
    omni_text_match: {
      clause: {
        multi_match: {
          query: '{{value}}',
          fields: ['{{field}}.normalizer', '{{field}}.pinyin', '{{field}}.romaji'],
          type: 'cross_fields',
          minimum_should_match: '100%',
          zero_terms_query: 'none',
        },
      },
    },
  };

  static readonly resolvers = {
    strict_track_match: {
      attributes: ['title', 'artist', 'album'],
    },
  };

  static readonly indices = {
    songs: {
      fields: {
        title: {
          attribute: 'title',
          matcher: 'omni_text_match',
        },
        artist: {
          attribute: 'artist',
          matcher: 'omni_text_match',
        },
        album: {
          attribute: 'album',
          matcher: 'omni_text_match',
        },
      },
    },
  };

  static getBody() {
    return {
      attributes: SongEntity.attributes,
      resolvers: SongEntity.resolvers,
      matchers: SongEntity.matchers,
      indices: SongEntity.indices,
    };
  }
}
