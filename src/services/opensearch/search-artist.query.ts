

export class SearchArtistQuery {
  
  constructor(private artist: string,private modelId: string) {
  }

  getBody() {
    return {
      query: {
        bool: {
          minimum_should_match: 1,
          should: [
            {
              multi_match: {
                query: this.artist,
                fields: ['artist.normalizer', 'artist.pinyin', 'artist.romaji'],
              },
            },
            {
              neural: {
                artist_vector: {
                  query_text: this.artist,
                  model_id: this.modelId,
                  k: 5,
                },
              },
            },
          ],
        },
      },
      collapse: {
        field: 'artist.keyword',
      },
    };
  }
}