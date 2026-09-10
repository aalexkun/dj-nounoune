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
        ampersand_to_and: {
          type: 'mapping',
          mappings: ['& => and'],
        },
      },
      normalizer: {
        // Whole-string, case-insensitive, symbols intact: `/\/\/\ Y /\` is a term, `bbno$` is a
        // term, `M.I.A.` is not `Mia`. The exact layer every other subfield is a fallback to.
        exact_normalizer: {
          type: 'custom',
          filter: ['lowercase', 'trim'],
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
        // Identity matching without any plugin: accents folded (Beyoncé = Beyonce), `&` read as
        // `and`, punctuation left to the standard tokenizer (`M.I.A.` stays one token, so it is
        // not `Mia`). Neither of the two analyzers above folds, and the pinyin filter *removes*
        // the accented letter (`beyonc`) rather than folding it. Used by the dedup recall query.
        identity_text_analyzer: {
          type: 'custom',
          char_filter: ['ampersand_to_and'],
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding'],
        },
        // The ICU counterpart, and the one that reaches every script: Cyrillic, Greek, Hangul,
        // Han and kana are transliterated to Latin and folded, so `Кино` and `Kino` are one term
        // and `소녀시대` is `sonyeosidae`. Whitespace-tokenised on purpose: the ICU tokenizer would
        // drop the `$` of `bbno$`, the dots of `M.I.A.` and the whole of `/\/\/\`, and those are
        // the names that need an identity most. Two transliteration paths (this and the pinyin /
        // romaji filters) so the recall does not hinge on one plugin's reading of a name.
        icu_transliteration_analyzer: {
          type: 'custom',
          tokenizer: 'whitespace',
          filter: ['icu_latin_transform', 'icu_folding'],
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
        icu_latin_transform: {
          type: 'icu_transform',
          id: 'Any-Latin; Latin-ASCII',
        },
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
          identity: {
            type: 'text',
            analyzer: 'identity_text_analyzer',
          },
          icu: {
            type: 'text',
            analyzer: 'icu_transliteration_analyzer',
          },
          exact: {
            type: 'keyword',
            normalizer: 'exact_normalizer',
            ignore_above: 512,
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
          identity: {
            type: 'text',
            analyzer: 'identity_text_analyzer',
          },
          icu: {
            type: 'text',
            analyzer: 'icu_transliteration_analyzer',
          },
          exact: {
            type: 'keyword',
            normalizer: 'exact_normalizer',
            ignore_above: 512,
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
          identity: {
            type: 'text',
            analyzer: 'identity_text_analyzer',
          },
          icu: {
            type: 'text',
            analyzer: 'icu_transliteration_analyzer',
          },
          exact: {
            type: 'keyword',
            normalizer: 'exact_normalizer',
            ignore_above: 512,
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
