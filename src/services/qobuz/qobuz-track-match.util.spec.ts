import { buildSearchQueries, normalizeForMatch, similarity } from './qobuz-track-match.util';

describe('normalizeForMatch', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeForMatch('Irène Drésel')).toBe('irene dresel');
    expect(normalizeForMatch("Don't Stop!")).toBe('dont stop');
  });

  it('splits letter/digit runs so tokenisation matches either spelling', () => {
    // The case that made a real POLYSICS track look like a different song.
    expect(normalizeForMatch('Code4')).toBe(normalizeForMatch('Code 4'));
    expect(normalizeForMatch('Blink182')).toBe('blink 182');
  });

  it('returns an empty string for nothing', () => {
    expect(normalizeForMatch(undefined)).toBe('');
    expect(normalizeForMatch('')).toBe('');
  });
});

describe('similarity', () => {
  it('scores an exact match, ignoring case and spacing', () => {
    expect(similarity('Push It to the Limit', 'PUSH IT TO THE LIMIT')).toBe(1);
    expect(similarity('Code4', 'Code 4')).toBe(1);
  });

  it('scores a qualified catalog title below an exact one but well above noise', () => {
    const qualified = similarity('Push It to the Limit', 'Push It To The Limit (From "Scarface")');

    expect(qualified).toBeGreaterThan(0.85);
    expect(qualified).toBeLessThan(1);
  });

  it('gives nothing to unrelated text or missing input', () => {
    expect(similarity('Push It to the Limit', 'Symphony No. 5')).toBe(0);
    expect(similarity('Anything', undefined)).toBe(0);
  });
});

describe('buildSearchQueries', () => {
  it('goes from most to least specific', () => {
    expect(buildSearchQueries({ title: 'Moul', artist: 'Irène Drésel', album: 'Rose Fluo' })).toEqual([
      'Moul Irène Drésel Rose Fluo',
      'Moul Irène Drésel',
      'Moul Rose Fluo',
      'Moul',
    ]);
  });

  it('collapses to a single query when only the title is known', () => {
    expect(buildSearchQueries({ title: 'Moul' })).toEqual(['Moul']);
  });
});
