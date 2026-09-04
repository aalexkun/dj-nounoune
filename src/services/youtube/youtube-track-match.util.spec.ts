import {
  buildSearchQueries,
  isTopicChannel,
  normalizeChannelTitle,
  parseIsoDuration,
  parseVideoTitle,
  stripTitleNoise,
} from './youtube-track-match.util';

describe('normalizeChannelTitle', () => {
  it('strips the YouTube Music Topic suffix', () => {
    expect(normalizeChannelTitle('Radiohead - Topic')).toBe('Radiohead');
    expect(isTopicChannel('Radiohead - Topic')).toBe(true);
  });

  it('leaves an ordinary channel alone', () => {
    expect(normalizeChannelTitle('DaftPunkVEVO')).toBe('DaftPunkVEVO');
    expect(isTopicChannel('DaftPunkVEVO')).toBe(false);
  });
});

describe('stripTitleNoise', () => {
  it('drops promotional bracket groups', () => {
    expect(stripTitleNoise('Get Lucky (Official Video)')).toBe('Get Lucky');
    expect(stripTitleNoise('Paranoid Android [HD]')).toBe('Paranoid Android');
  });

  it('keeps peeling behind a group it must not drop', () => {
    // The bug this guards: anchoring at the end alone stops at the remaster tag and leaves the
    // (Official Video) in front of it untouched.
    expect(stripTitleNoise('Some Song (Official Video) [4K Remaster]')).toBe('Some Song [4K Remaster]');
  });

  it('keeps a qualifier that names a different recording', () => {
    expect(stripTitleNoise('Track (Kaytranada Remix) (Official Audio)')).toBe('Track (Kaytranada Remix)');
    expect(stripTitleNoise('Bohemian Rhapsody (Live Aid 1985)')).toBe('Bohemian Rhapsody (Live Aid 1985)');
  });

  it('never strips a title down to nothing', () => {
    expect(stripTitleNoise('(Reprise)')).toBe('(Reprise)');
  });

  it('does not treat bare words as noise', () => {
    expect(stripTitleNoise('Video Killed the Radio Star')).toBe('Video Killed the Radio Star');
  });

  it('leaves an unrecognised group in place', () => {
    expect(stripTitleNoise('Song (Some Unknown Tag)')).toBe('Song (Some Unknown Tag)');
  });
});

describe('parseVideoTitle', () => {
  it('splits Artist - Title', () => {
    expect(parseVideoTitle('Daft Punk - Get Lucky (Official Video)', 'DaftPunkVEVO')).toEqual({
      artist: 'Daft Punk',
      title: 'Get Lucky',
    });
  });

  it('trusts a Topic channel over splitting the title', () => {
    // A Topic channel names the artist outright and its titles are the bare track name, so a
    // hyphen inside one belongs to the title.
    expect(parseVideoTitle('Sgt Pepper - Reprise', 'The Beatles - Topic')).toEqual({
      artist: 'The Beatles',
      title: 'Sgt Pepper - Reprise',
    });
  });

  it('does not split a hyphenated artist name', () => {
    expect(parseVideoTitle('Jay-Z - 99 Problems', 'JayZVEVO')).toEqual({
      artist: 'Jay-Z',
      title: '99 Problems',
    });
  });

  it('handles en dash separators', () => {
    expect(parseVideoTitle('Aphex Twin – Windowlicker', 'WARP')).toEqual({
      artist: 'Aphex Twin',
      title: 'Windowlicker',
    });
  });

  it('reports an empty artist rather than inventing one', () => {
    // Guessing here would poison every downstream dedup lookup, which keys on the artist.
    expect(parseVideoTitle('just a title with no separator', null).artist).toBe('');
  });
});

describe('parseIsoDuration', () => {
  it('parses the shapes YouTube reports', () => {
    expect(parseIsoDuration('PT4M13S')).toBe(253);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
  });

  it('returns zero for a live stream or a missing value', () => {
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration(undefined)).toBe(0);
    expect(parseIsoDuration('nonsense')).toBe(0);
  });
});

describe('buildSearchQueries', () => {
  it('goes from most to least specific and de-duplicates', () => {
    expect(buildSearchQueries({ title: 'Get Lucky', artist: 'Daft Punk' })).toEqual(['Daft Punk Get Lucky', 'Get Lucky']);
  });

  it('collapses to a single query when only a title is given', () => {
    expect(buildSearchQueries({ title: 'Get Lucky' })).toEqual(['Get Lucky']);
  });
});
