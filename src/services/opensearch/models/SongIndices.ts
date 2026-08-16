

export const NeuralSearch = {
  Model: 'huggingface/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  Version: '1.0.1',
  dimension: 384,
  format: 'TORCH_SCRIPT',
} as const;

export class SongIndices {
  static readonly name = 'songs';

  static readonly settings = {
    index: {
      knn: true,
    },
    analysis: {
      char_filter: {
        strip_punctuation: {
          type: 'pattern_replace',
          pattern: '[^\\p{L}\\p{Nd}\\s]',
          replacement: '',
        },
      },
      analyzer: {
        artistic_text_analyzer: {
          // keep ponctuation
          type: 'custom',
          tokenizer: 'whitespace',
          filter: ['lowercase'],
        },
        normal_text_analyzer: {
          // strip ponctuation
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase'],
        },
        // Handles Western + Chinese Pinyin
        chinese_pinyin_analyzer: {
          type: 'custom',
          char_filter: ['strip_punctuation'],
          tokenizer: 'standard',
          filter: ['lowercase', 'pinyin_first_letter_and_full_pinyin_filter'],
        },
        // Handles Western + Japanese Romaji
        japanese_romaji_analyzer: {
          type: 'custom',
          char_filter: ['strip_punctuation'],
          tokenizer: 'kuromoji_tokenizer',
          filter: ['kuromoji_readingform_romaji', 'lowercase'],
        },
      },
      filter: {
        kuromoji_readingform_romaji: {
          type: 'kuromoji_readingform',
          use_romaji: true,
        },
        pinyin_first_letter_and_full_pinyin_filter: {
          type: 'pinyin',
          keep_first_letter: false,
          keep_full_pinyin: true,
          keep_none_chinese: true,
          keep_none_chinese_together: true,
          none_chinese_pinyin_tokenize: false,
          lowercase: true,
        },
      },
    },
  } as const;

  static readonly mappings = {
    properties: {
      artist_id: { type: 'keyword' },
      album_id: { type: 'keyword' },
      track_number: { type: 'integer' },
      disc_number: { type: 'integer' },
      title: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 512,
          },
          normalizer: {
            type: 'text',
            analyzer: 'normal_text_analyzer',
          },
          pinyin: {
            type: 'text',
            analyzer: 'chinese_pinyin_analyzer',
          },
          romaji: {
            type: 'text',
            analyzer: 'japanese_romaji_analyzer',
          },
        },
      },
      artist: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 512,
          },
          normalizer: {
            type: 'text',
            analyzer: 'artistic_text_analyzer',
          },
          pinyin: {
            type: 'text',
            analyzer: 'chinese_pinyin_analyzer',
          },
          romaji: {
            type: 'text',
            analyzer: 'japanese_romaji_analyzer',
          },
        },
      },
      album: {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 512,
          },
          normalizer: {
            type: 'text',
            analyzer: 'artistic_text_analyzer',
          },
          pinyin: {
            type: 'text',
            analyzer: 'chinese_pinyin_analyzer',
          },
          romaji: {
            type: 'text',
            analyzer: 'japanese_romaji_analyzer',
          },
        },
      },
      // Explicit so that `source.name` is filterable as an exact term. Dynamic mapping would make
      // it `text` + `.keyword`, which the active-source filter and the profiler both have to
      // second-guess. Only `name` is declared - the rest of the sub-document stays dynamic.
      source: {
        properties: {
          name: { type: 'keyword' },
        },
      },
      song_semantic: {
        type: 'text',
      },
      song_vector: {
        type: 'knn_vector',
        dimension: NeuralSearch.dimension,
        method: {
          name: 'hnsw',
          engine: 'lucene',
          space_type: 'cosinesimil',
          parameters: {},
        },
      },
    },
  } as const;
}
