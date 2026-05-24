

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
        normal_text_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'asciifolding',
          ],
        },
        // Handles Western + Chinese Pinyin
        chinese_pinyin_analyzer: {
          type: 'custom',
          char_filter: ['strip_punctuation'],
          tokenizer: 'whitespace', // Or 'smartcn' if installed
          filter: ['lowercase', 'pinyin_first_letter_and_full_pinyin_filter'],
        },
        // Handles Western + Japanese Romaji
        japanese_romaji_analyzer: {
          type: 'custom',
          char_filter: ['strip_punctuation'],
          tokenizer: 'kuromoji_tokenizer',
          filter: [
            'lowercase',
            'kuromoji_baseform',
            'kuromoji_readingform', // CRITICAL: Converts Katakana/Kanji to Romaji (e.g. 四季 -> shiki)
          ],
        },
      },
      filter: {
        pinyin_first_letter_and_full_pinyin_filter: {
          type: 'pinyin',
          keep_first_letter: true,
          keep_full_pinyin: false,
          keep_none_chinese: true,
          keep_original: false,
          limit_first_letter_length: 16,
          lowercase: true,
          trim_whitespace: true,
          keep_none_chinese_in_first_letter: true,
        },
      },
    },
  } as const;

  static readonly mappings = {
    properties: {
      title: {
        type: 'text',
        fields: {
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
      album: {
        type: 'text',
        fields: {
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
      semantic_title: {
        type: 'text',
      },
      semantic_artist: {
        type: 'text',
      },
      semantic_album: {
        type: 'text',
      },
      title_vector: {
        type: 'knn_vector',
        dimension: NeuralSearch.dimension, // need to match model dimention
        method: {
          name: 'hnsw',
          engine: 'lucene',
          space_type: 'l2',
          parameters: {},
        },
      },
      artist_vector: {
        type: 'knn_vector',
        dimension: NeuralSearch.dimension, // need to match model dimention
        method: {
          name: 'hnsw',
          engine: 'lucene',
          space_type: 'l2',
          parameters: {},
        },
      },
      album_vector: {
        type: 'knn_vector',
        dimension: NeuralSearch.dimension, // need to match model dimention
        method: {
          name: 'hnsw',
          engine: 'lucene',
          space_type: 'l2',
          parameters: {},
        },
      },
    },
  } as const;
}
