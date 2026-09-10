import { isSameEntityName, parseAlbum, parseTitle, scoreDuplicate, SongIdentity } from './duplicate-score.util';

function song(overrides: Partial<SongIdentity>): SongIdentity {
  return { id: 'x', title: 'Song', artist: 'Artist', album: 'Album', isrcs: [], ...overrides };
}

describe('parseTitle', () => {
  it('keeps a plain title whole', () => {
    expect(parseTitle('Live and Let Die')).toEqual({ core: 'Live and Let Die', recordingMarkers: [], masteringMarkers: [], featured: [] });
  });

  it('pulls variant markers out of brackets and dash tails', () => {
    expect(parseTitle('Song (Live at Wembley) - Remastered 2009')).toMatchObject({
      core: 'Song',
      recordingMarkers: ['live'],
      masteringMarkers: ['remaster', 'year'],
    });
  });

  it('pulls featured credits out of the title', () => {
    expect(parseTitle('Go Down Deh (feat. Sean Paul & Shaggy)')).toMatchObject({ core: 'Go Down Deh', featured: ['Sean Paul', 'Shaggy'] });
  });

  it('reads angle and full-width brackets, and Japanese variant words', () => {
    expect(parseTitle('透明だった世界 <Backing Track>')).toMatchObject({ core: '透明だった世界', recordingMarkers: ['instrumental'] });
    expect(parseTitle('ほととぎす（カラオケ）')).toMatchObject({ core: 'ほととぎす', recordingMarkers: ['instrumental'] });
    expect(parseTitle('さびしいヴァージョン').recordingMarkers).toEqual([]);
  });

  it('keeps a bracket group that is part of the name', () => {
    expect(parseTitle('Scarface (Push It to the Limit)').core).toBe('Scarface (Push It to the Limit)');
    expect(parseTitle('Title (Part 2)').core).toBe('Title (Part 2)');
  });
});

describe('parseAlbum', () => {
  it('separates the edition from the record', () => {
    expect(parseAlbum('Album (Deluxe Edition)')).toMatchObject({ core: 'Album', edition: ['deluxe edition'] });
    expect(parseAlbum('Album - 20th Anniversary Edition').core).toBe('Album');
    expect(parseAlbum('Album').edition).toEqual([]);
  });
});

describe('scoreDuplicate', () => {
  const primary = song({ id: 'a', title: 'Push It to the Limit', artist: 'Paul Engemann', album: 'Scarface', duration: 178 });

  it('auto-merges an identical recording with matching duration', () => {
    const verdict = scoreDuplicate(
      primary,
      song({ id: 'b', title: 'Push It To The Limit', artist: 'Paul Engemann', album: 'Scarface', duration: 179 }),
    );
    expect(verdict.tier).toBe('auto');
  });

  it('auto-merges when the only difference is a promotional accent or case', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'Beyoncé', title: 'Halo', album: 'I Am... Sasha Fierce' }),
      song({ artist: 'Beyonce', title: 'Halo', album: 'I Am Sasha Fierce' }),
    );
    expect(verdict.tier).toBe('auto');
  });

  it('rejects a live version of the same song', () => {
    const verdict = scoreDuplicate(primary, song({ id: 'b', title: 'Push It to the Limit (Live)', artist: 'Paul Engemann', album: 'Scarface' }));
    expect(verdict.tier).toBe('reject');
    expect(verdict.reasons[0]).toContain('different recording');
  });

  it('rejects durations far apart', () => {
    const verdict = scoreDuplicate(
      primary,
      song({ id: 'b', title: 'Push It to the Limit', artist: 'Paul Engemann', album: 'Scarface', duration: 313 }),
    );
    expect(verdict.tier).toBe('reject');
  });

  it('still reviews an identical title under a different track number across editions', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'Freddie Hubbard', album: 'Breaking Point', title: 'Mirrors', trackNumber: 6 }),
      song({ artist: 'Freddie Hubbard', album: 'Breaking Point (Remastered)', title: 'Mirrors - Remastered 2004', trackNumber: 5 }),
    );
    expect(verdict.tier).toBe('review');
  });

  it('rejects a different album, by policy', () => {
    const verdict = scoreDuplicate(primary, song({ id: 'b', title: 'Push It to the Limit', artist: 'Paul Engemann', album: '80s Movie Hits' }));
    expect(verdict.tier).toBe('reject');
  });

  it('reviews a shared ISRC on a different album rather than rejecting it', () => {
    const verdict = scoreDuplicate(
      song({ ...primary, isrcs: ['USSM18400123'] }),
      song({ id: 'b', title: 'Push It to the Limit', artist: 'Paul Engemann', album: '80s Movie Hits', isrcs: ['USSM18400123'] }),
    );
    expect(verdict.tier).toBe('review');
  });

  it('auto-merges a shared ISRC on the same record', () => {
    const verdict = scoreDuplicate(
      song({ ...primary, isrcs: ['USSM18400123'] }),
      song({ id: 'b', title: 'Push It 2 the Limit', artist: 'P. Engemann', album: 'Scarface', isrcs: ['ussm1-8400123'] }),
    );
    expect(verdict.tier).toBe('auto');
  });

  it('reviews a deluxe edition of the same record', () => {
    const verdict = scoreDuplicate(
      primary,
      song({ id: 'b', title: 'Push It to the Limit', artist: 'Paul Engemann', album: 'Scarface (Deluxe Edition)' }),
    );
    expect(verdict.tier).toBe('review');
    expect(verdict.reasons.join(' ')).toContain('edition');
  });

  it('reviews a remaster of the same recording', () => {
    const verdict = scoreDuplicate(
      primary,
      song({ id: 'b', title: 'Push It to the Limit - Remastered', artist: 'Paul Engemann', album: 'Scarface', duration: 180 }),
    );
    expect(verdict.tier).toBe('review');
  });

  it('ignores a leading article on the artist', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'The Beatles', title: 'Help!', album: 'Help!', duration: 138 }),
      song({ artist: 'Beatles', title: 'Help!', album: 'Help!', duration: 139 }),
    );
    expect(verdict.tier).toBe('auto');
  });

  it('lets an identical title and album vouch for a stage name, as far as review', () => {
    const verdict = scoreDuplicate(
      song({ artist: '方大同', album: '橙月 Orange Moon', title: '三人遊', trackNumber: 7 }),
      song({ artist: 'Khalil Fong', album: '橙月 Orange Moon', title: '三人遊', trackNumber: 7 }),
    );
    expect(verdict.tier).toBe('review');
    expect(verdict.reasons.join(' ')).toContain('differ entirely');

    // Not when a track number contradicts, and never straight to auto.
    expect(
      scoreDuplicate(
        song({ artist: '方大同', album: '橙月 Orange Moon', title: '三人遊', trackNumber: 7 }),
        song({ artist: 'Khalil Fong', album: '橙月 Orange Moon', title: '三人遊', trackNumber: 9 }),
      ).tier,
    ).toBe('reject');
  });

  it('rejects an artist that merely contains the name', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'Spice', title: 'Bad Girl', album: '10' }),
      song({ artist: 'Spice Girls', title: 'Bad Girl', album: '10' }),
    );
    expect(verdict.tier).toBe('reject');
  });

  it('rejects sibling tracks that differ by a number', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'Fantômas', album: 'Fantômas', title: 'Book 1: Page 8', trackNumber: 8 }),
      song({ artist: 'Fantômas', album: 'Fantômas', title: 'Book 1: Page 21', trackNumber: 21 }),
    );
    expect(verdict.tier).toBe('reject');
    expect(verdict.reasons[0]).toContain('number');
  });

  it('rejects different discs of a box set', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'A', album: 'Works [Disc 3]', title: 'Theme' }),
      song({ artist: 'A', album: 'Works [Disc 4]', title: 'Theme' }),
    );
    expect(verdict.tier).toBe('reject');
  });

  it('rejects movements of the same work under different track numbers', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'Wilhelm Kempff', album: 'Sonatas', title: 'Sonata No. 23 "Appassionata" - I. Allegro assai', trackNumber: 10 }),
      song({ artist: 'Wilhelm Kempff', album: 'Sonatas', title: 'Sonata No. 23 "Appassionata" - II. Andante con moto', trackNumber: 11 }),
    );
    expect(verdict.tier).toBe('reject');
  });

  it('keeps the symbols that make a name: M.I.A. is not Mia, /\\/\\/\\ is itself', () => {
    expect(
      scoreDuplicate(song({ artist: 'M.I.A.', title: 'Paper Planes', album: 'Kala' }), song({ artist: 'Mia', title: 'Paper Planes', album: 'Kala' }))
        .tier,
    ).toBe('reject');
    expect(
      scoreDuplicate(
        song({ artist: 'M.I.A.', title: 'XXXO', album: '/\\/\\/\\ Y /\\' }),
        song({ artist: 'M.I.A.', title: 'XXXO', album: '/\\/\\/\\ Y /\\' }),
      ).tier,
    ).toBe('auto');
    expect(
      scoreDuplicate(song({ artist: 'M.I.A.', title: 'XXXO', album: '/\\/\\/\\ Y /\\' }), song({ artist: 'M.I.A.', title: 'XXXO', album: 'Maya' }))
        .tier,
    ).toBe('reject');
    expect(
      scoreDuplicate(song({ artist: 'bbno$', title: 'Lalala', album: 'Recess' }), song({ artist: 'bbno$', title: 'Lalala', album: 'Recess' })).tier,
    ).toBe('auto');
  });

  it('treats the same album document as the same record whatever it is called', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'Kimya Dawson & Antsy Pants', album: 'Juno', albumId: 'alb1', title: 'Tree Hugger', trackNumber: 7 }),
      song({
        artist: 'Kimya Dawson and Antsy Pants',
        album: 'Juno (Music From The Motion Picture)',
        albumId: 'alb1',
        title: 'Tree Huger',
        trackNumber: 7,
      }),
    );
    expect(verdict.tier).toBe('auto');
    expect(verdict.reasons.join(' ')).toContain('same slot');
  });

  it('does not let a shared slot merge two different works that read alike', () => {
    const verdict = scoreDuplicate(
      song({
        artist: 'Ensemble 415',
        album: 'Tartini Concerti',
        albumId: 'alb',
        title: 'Concerto for cello and orchestra in D Major',
        trackNumber: 2,
      }),
      song({
        artist: 'Ensemble 415',
        album: 'Tartini Concerti',
        albumId: 'alb',
        title: 'Concerto for violin and orchestra in G Major',
        trackNumber: 2,
      }),
    );
    expect(verdict.tier).not.toBe('auto');
  });

  it('rejects two different slots on the same record even with the same title', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'The Wailers', album: 'Legend', title: 'Jamming', trackNumber: 1 }),
      song({ artist: 'The Wailers', album: 'Legend', title: 'Jamming', trackNumber: 15 }),
    );
    expect(verdict.tier).toBe('reject');
    expect(
      scoreDuplicate(
        song({ album: 'Set', albumId: 'a', title: 'Song', trackNumber: 3, discNumber: 1 }),
        song({ album: 'Set', albumId: 'a', title: 'Song', trackNumber: 3, discNumber: 2 }),
      ).tier,
    ).toBe('reject');
  });

  it('lets a track number differ across editions', () => {
    const verdict = scoreDuplicate(
      song({ artist: 'The Wailers', album: 'Legend', title: 'Jamming', trackNumber: 1 }),
      song({ artist: 'The Wailers', album: 'Legend (Deluxe Edition)', title: 'Jamming', trackNumber: 15 }),
    );
    expect(verdict.tier).toBe('review');
  });

  it('treats duration as a soft signal', () => {
    expect(
      scoreDuplicate(primary, song({ id: 'b', title: 'Push It to the Limit', artist: 'Paul Engemann', album: 'Scarface', duration: 184 })).tier,
    ).toBe('review');
    expect(
      scoreDuplicate(primary, song({ id: 'b', title: 'Push It to the Limit', artist: 'Paul Engemann', album: 'Scarface', duration: 200 })).tier,
    ).toBe('reject');
  });

  it('reviews a small spelling gap on the title', () => {
    const verdict = scoreDuplicate(
      primary,
      song({ id: 'b', title: 'Push It to the Limits', artist: 'Paul Engemann', album: 'Scarface', duration: 178 }),
    );
    expect(verdict.tier).toBe('review');
  });
});

describe('isSameEntityName', () => {
  it('treats editions of a record as the same album name', () => {
    expect(isSameEntityName('Scarface', 'Scarface (Expanded Motion Picture Soundtrack)', 'album')).toBe(true);
  });

  it('does not treat containment as the same artist', () => {
    expect(isSameEntityName('Spice', 'Spice Girls', 'artist')).toBe(false);
  });
});
