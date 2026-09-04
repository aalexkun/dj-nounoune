import { estypes } from '@elastic/elasticsearch';

export class SongIndices {
  static readonly name = 'songs';

  static readonly settings: estypes.IndicesIndexSettings = {
    analysis: {
      char_filter: {
        strip_punctuation: {
          type: 'pattern_replace',
          // Retains letters, numbers, and whitespace; strips everything else
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
            'asciifolding', // Converts café to cafe, Mötley to motley
          ],
        },
        // Handles Western + Chinese Pinyin
        chinese_pinyin_analyzer: {
          type: 'custom',
          char_filter: ['strip_punctuation'],
          tokenizer: 'standard', // Or 'smartcn' if installed
          filter: [
            'lowercase',
            'asciifolding', // <-- Protects Western terms in your Pinyin pipeline
            'pinyin',
          ],
        },
        // Handles Western + Japanese Romaji
        japanese_romaji_analyzer: {
          type: 'custom',
          char_filter: ['strip_punctuation'],
          tokenizer: 'kuromoji_tokenizer',
          filter: [
            'lowercase',
            'asciifolding', // <-- Protects Western terms in your Pinyin pipeline
            'kuromoji_baseform',
            'kuromoji_readingform', // CRITICAL: Converts Katakana/Kanji to Romaji (e.g. 四季 -> shiki)
          ],
        },
      },
      filter: {
        pinyin: {
          // @ts-expect-error the pinyin analysis plugin's filter type is not in the client's typings
          type: 'pinyin',
          keep_first_letter: true,
          keep_separate_first_letter: false,
          keep_full_pinyin: true,
          keep_original: true,
          limit_first_letter_length: 16,
          lowercase: true,
          remove_duplicated_term: true,
        },
      },
    },
  };
  static readonly mappings: estypes.MappingTypeMapping = {
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
    },
  };
}
