import { DuplicateSongCheck } from './opensearch.service';


export class DeduplicationSearchQuery {

  constructor(
    private songAttributes: DuplicateSongCheck,
    private modelId: string,
  ){}


  getQuery() {
    return {
        bool: {
          must_not: [
            {
              term: {
                _id: this.songAttributes.songId, // Filter out the current song
              },
            },
          ],
          must: [
            // 1. ARTIST: (Any text match) OR (Neural match)
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  {
                    multi_match: {
                      query: this.songAttributes.artist,
                      fields: ['artist.normalizer', 'artist.pinyin', 'artist.romaji'],
                    },
                  },
                  {
                    neural: {
                      artist_vector: {
                        query_text: this.songAttributes.artist,
                        model_id: this.modelId,
                        k: 5,
                      },
                    },
                  },
                ],
              },
            },

            // 2. ALBUM: (Any text match) OR (Neural match)
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  {
                    multi_match: {
                      query: this.songAttributes.album,
                      fields: ['album.normalizer', 'album.pinyin', 'album.romaji'],
                    },
                  },
                  {
                    neural: {
                      album_vector: {
                        query_text: this.songAttributes.album,
                        model_id: this.modelId,
                        k: 5,
                      },
                    },
                  },
                ],
              },
            },

            // 3. TITLE & TRACK NUMBER: (Any text match) OR (Neural match AND Track Logic)
            {
              bool: {
                minimum_should_match: 1,
                should: [
                  {
                    multi_match: {
                      query: this.songAttributes.title,
                      fields: ['title.normalizer', 'title.pinyin', 'title.romaji'],
                    },
                  },
                  {
                    bool: {
                      must: [
                        {
                          neural: {
                            title_vector: {
                              query_text: this.songAttributes.title,
                              model_id: this.modelId,
                              k: 5,
                            },
                          },
                        },
                        {
                          bool: {
                            minimum_should_match: 1,
                            should: [
                              {
                                term: {
                                  track_number: this.songAttributes.track_number,
                                },
                              },
                              {
                                bool: {
                                  must_not: {
                                    exists: {
                                      field: 'track_number',
                                    },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
    };
  }
}