import {
  ACTIVE_SOURCE_TYPES_ENV,
  buildActiveSourceMatch,
  filterActiveSources,
  getActiveSourceTypes,
  isSourceActive,
  resetActiveSourceTypesCache,
} from './active-source.util';

const sources = [{ name: 'file' }, { name: 'qobuz' }, { name: 'spotify' }];

const withEnv = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env[ACTIVE_SOURCE_TYPES_ENV];
  } else {
    process.env[ACTIVE_SOURCE_TYPES_ENV] = value;
  }
  resetActiveSourceTypesCache();
};

describe('active source types', () => {
  const original = process.env[ACTIVE_SOURCE_TYPES_ENV];

  afterEach(() => {
    withEnv(original);
  });

  describe('when unconfigured', () => {
    it.each([undefined, '', '   ', ','])('treats %p as no restriction', (value) => {
      withEnv(value);

      expect(getActiveSourceTypes()).toBeNull();
      expect(buildActiveSourceMatch()).toBeNull();
      expect(isSourceActive('spotify')).toBe(true);
      expect(filterActiveSources(sources)).toEqual(sources);
    });
  });

  it('parses a comma separated list', () => {
    withEnv('file,qobuz');

    expect(getActiveSourceTypes()).toEqual(['file', 'qobuz']);
    expect(isSourceActive('file')).toBe(true);
    expect(isSourceActive('spotify')).toBe(false);
    expect(filterActiveSources(sources)).toEqual([{ name: 'file' }, { name: 'qobuz' }]);
  });

  it('tolerates whitespace, casing and duplicates', () => {
    withEnv(' File , QOBUZ ,file ');

    expect(getActiveSourceTypes()).toEqual(['file', 'qobuz']);
  });

  it('drops unknown source types', () => {
    withEnv('file,tidal');

    expect(getActiveSourceTypes()).toEqual(['file']);
    expect(isSourceActive('tidal')).toBe(false);
  });

  it('falls back to no restriction when nothing known survives', () => {
    withEnv('tidal,deezer');

    expect(getActiveSourceTypes()).toBeNull();
    expect(isSourceActive('spotify')).toBe(true);
  });

  it('builds a match on at least one active source', () => {
    withEnv('file');

    expect(buildActiveSourceMatch()).toEqual({ source: { $elemMatch: { name: { $in: ['file'] } } } });
  });

  it('memoises the resolved list', () => {
    withEnv('file');
    expect(getActiveSourceTypes()).toEqual(['file']);

    process.env[ACTIVE_SOURCE_TYPES_ENV] = 'qobuz';
    expect(getActiveSourceTypes()).toEqual(['file']);

    resetActiveSourceTypesCache();
    expect(getActiveSourceTypes()).toEqual(['qobuz']);
  });
});
