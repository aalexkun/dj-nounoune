import { identitySimilarity, normalizeForMatch, similarity } from '../../utils/text-match.utils';

/**
 * The deterministic half of deduplication: given two songs, how sure can code alone be that they
 * are the same recording, and when should it stop guessing and ask.
 *
 * The search query only recalls candidates; nothing it returns is trusted on its own. Everything
 * that decides a merge is here, in pure functions over the two documents, so the rules can be
 * read in one place and tested without a cluster. The bias is stated in the tiers: a merge that
 * should not have happened deletes a document and re-points an album, so `auto` is reserved for
 * what is beyond doubt, and everything plausible-but-uncertain is handed to the review tier.
 */

/** What the scorer knows about one song. Built from the populated document by the service. */
export interface SongIdentity {
  id: string;
  title: string;
  artist: string;
  albumArtist?: string;
  album: string;
  /**
   * The artist and album *documents* the song hangs off. A song is never alone: it is one corner
   * of an artist–album–song triangle, and two songs on the same album document share the record
   * by construction, whatever their titles spell.
   */
  artistId?: string;
  albumId?: string;
  /** Seconds, from the technical info of any source that has one. */
  duration?: number;
  /** Every ISRC any of the song's sources reports. */
  isrcs: string[];
  trackNumber?: number;
  discNumber?: number;
  year?: string;
}

export type DuplicateTier = 'auto' | 'review' | 'reject';

/** The signal breakdown stored on the group, so a merge can be explained after the fact. */
export interface DuplicateSignals {
  title: number;
  artist: number;
  album: number;
  /** Whether the two album titles name the same edition of the same record. */
  albumEdition: 'same' | 'different' | 'unknown';
  recordingMarkersA: string[];
  recordingMarkersB: string[];
  masteringMarkersA: string[];
  masteringMarkersB: string[];
  /** Seconds, when both durations are known. */
  durationDelta?: number;
  isrcShared: boolean;
  trackNumberConflict: boolean;
}

export interface DuplicateVerdict {
  tier: DuplicateTier;
  /** 0..1, for ordering review work. Not a probability. */
  confidence: number;
  signals: DuplicateSignals;
  reasons: string[];
}

/* -------------------------------------------------------------------------- */
/* Title and album parsing                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Qualifiers that name a *different recording*. Two titles that disagree on any of these are
 * never the same song, whatever the rest of the text says.
 */
const RECORDING_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\blive\b/i, 'live'],
  [/\bremix(?:ed)?\b|\brmx\b/i, 'remix'],
  [/\bacoustic\b|\bunplugged\b/i, 'acoustic'],
  [/\binstrumental\b/i, 'instrumental'],
  [/\bkaraoke\b/i, 'karaoke'],
  [/\bdemo\b/i, 'demo'],
  [/\bradio\s*(?:edit|version|mix)\b|\bsingle\s*(?:edit|version|mix)\b/i, 'radio edit'],
  [/\bextended\b|\b12"\b|\b12 inch\b/i, 'extended'],
  [/\bedit\b/i, 'edit'],
  [/\bdub\b/i, 'dub'],
  [/\borchestral\b|\bsymphonic\b/i, 'orchestral'],
  [/\breprise\b/i, 'reprise'],
  [/\balternate\b|\balt\.?\s*(?:take|version|mix)\b|\btake\s*\d+\b/i, 'alternate'],
  [/\bcover\b/i, 'cover'],
  [/\bsession\b/i, 'session'],
  [/\bmono\b/i, 'mono'],
  [/\bstereo\b/i, 'stereo'],
  [/\bsped\s*up\b|\bslowed\b|\bnightcore\b/i, 'tempo'],
  [/\bbacking\s*track\b|\boff\s*vocal\b|\binst\.?(?:\s|$)/i, 'instrumental'],
  // Japanese releases write the same qualifiers in katakana, and often without brackets.
  [/カラオケ|インスト|オフボーカル/, 'instrumental'],
  [/ライ[ブヴ]/, 'live'],
  [/リミックス/, 'remix'],
  [/アコースティック/, 'acoustic'],
  [/[ヴバ]ァ?ージョン/, 'version'],
  // A bare "mix" or "version" after the above were tried: "Club Mix", "Piano Version".
  [/\bmix\b/i, 'mix'],
  [/\bversion\b/i, 'version'],
];

/**
 * Qualifiers that name the same recording *presented differently*: a remaster, a clean edit for
 * radio, the album cut. Disagreement here is not a different song, but it is not nothing either,
 * so it caps the tier at review.
 */
const MASTERING_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/\bremaster(?:ed)?\b/i, 'remaster'],
  [/\bexplicit\b/i, 'explicit'],
  [/\bclean\b/i, 'clean'],
  [/\bbonus\s*track\b/i, 'bonus'],
  [/\balbum\s*version\b|\boriginal\s*(?:version|mix)?\b/i, 'album'],
  [/\bdigital\b|\bhd\b|\bhi-?res\b/i, 'digital'],
  [/\b(?:19|20)\d{2}\b/, 'year'],
];

/** The words that make a bracket group a featured credit rather than part of the title. */
const FEATURED = /^(?:feat(?:uring)?\.?|ft\.?|with|w\/)\s+(.+)$/i;

/** Edition qualifiers on an album title. The record is the same; the tracklist may not be. */
const EDITION_WORDS =
  /\b(?:deluxe|expanded|extended|remaster(?:ed)?|anniversary|edition|special|collector'?s?|bonus|reissue|re-?issue|legacy|complete|definitive|platinum|gold|super|ultimate|version|explicit|clean|disc\s*\d+|cd\s*\d+|vol(?:ume)?\.?\s*\d+|mono|stereo)\b/i;

/**
 * A bracket group anywhere in a title, with its delimiters: ASCII brackets, angle brackets, and
 * the full-width and corner brackets Japanese and Chinese releases use.
 */
const BRACKET_GROUP = /\s*[([{<（［【〈《「『]([^([{<（［【〈《「『)\]}>）］】〉》」』]*)[)\]}>）］】〉》」』]/g;

/** A ` - qualifier` tail, the way Spotify writes `Title - Remastered 2009` and `Title - Live`. */
const DASH_TAIL = /\s+[-–—]\s+([^-–—]+)$/;

export interface ParsedTitle {
  /** The name of the song with every qualifier and credit removed. */
  core: string;
  /** Recording qualifiers found, normalised and sorted. */
  recordingMarkers: string[];
  /** Presentation qualifiers found, normalised and sorted. */
  masteringMarkers: string[];
  /** Names pulled out of `(feat. …)` groups. */
  featured: string[];
}

function classify(content: string): { recording: string[]; mastering: string[]; matched: boolean } {
  const recording = RECORDING_MARKERS.filter(([pattern]) => pattern.test(content)).map(([, name]) => name);
  const mastering = MASTERING_MARKERS.filter(([pattern]) => pattern.test(content)).map(([, name]) => name);

  return { recording, mastering, matched: recording.length > 0 || mastering.length > 0 };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Splits a title into its name and its qualifiers.
 *
 * Bracket groups and ` - ` tails are inspected one by one. A group that names a variant becomes a
 * marker; a featured credit becomes a name; anything else — `(Part 2)`, `(From "Scarface")` — is
 * part of the song's name and stays in the core. Nothing outside a group or a tail is touched:
 * `Live and Let Die` is a title, not a live recording.
 */
export function parseTitle(rawTitle: string): ParsedTitle {
  let core = (rawTitle ?? '').trim();
  const recording: string[] = [];
  const mastering: string[] = [];
  const featured: string[] = [];

  core = core.replace(BRACKET_GROUP, (whole, content: string) => {
    const text = content.trim();
    const credit = FEATURED.exec(text);

    if (credit) {
      featured.push(...splitNames(credit[1]));
      return '';
    }

    const found = classify(text);

    if (found.matched) {
      recording.push(...found.recording);
      mastering.push(...found.mastering);
      return '';
    }

    return whole;
  });

  // Peel dash tails while they name a qualifier. `Title - Remastered 2009 - Live` peels twice;
  // `Jay-Z - Title` is not a tail (the separator needs spaces) and `Title - Part 2` stays.
  for (;;) {
    const tail = DASH_TAIL.exec(core);

    if (!tail) break;

    const text = tail[1].trim();
    const credit = FEATURED.exec(text);

    if (credit) {
      featured.push(...splitNames(credit[1]));
      core = core.slice(0, tail.index).trim();
      continue;
    }

    const found = classify(text);

    if (!found.matched) break;

    recording.push(...found.recording);
    mastering.push(...found.mastering);
    core = core.slice(0, tail.index).trim();
  }

  // Inline credits with no brackets: `Title feat. Someone`.
  const inlineCredit = /\s+(?:feat(?:uring)?\.?|ft\.?)\s+(.+)$/i.exec(core);

  if (inlineCredit) {
    featured.push(...splitNames(inlineCredit[1]));
    core = core.slice(0, inlineCredit.index).trim();
  }

  return {
    core: core.replace(/\s{2,}/g, ' ').trim() || (rawTitle ?? '').trim(),
    recordingMarkers: unique(recording),
    masteringMarkers: unique(mastering),
    featured: unique(featured),
  };
}

function splitNames(credit: string): string[] {
  return credit
    .split(/\s*(?:,|&|\band\b|\bx\b|\/)\s*/i)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

export interface ParsedAlbum {
  /** The record's name with edition qualifiers removed. */
  core: string;
  /** Edition qualifiers, normalised and sorted. Empty for a plain release. */
  edition: string[];
  /** Recording qualifiers on the album itself, e.g. a live album. */
  recordingMarkers: string[];
  /** The disc of a set the title names (`[Disc 3]`, `CD2`, `Vol. 1`), when it names one. */
  disc?: number;
}

/** A disc, CD or volume number inside an album title. */
const DISC_NUMBER = /\b(?:disc|disk|cd|vol(?:ume)?\.?)\s*(\d+)\b/i;

/**
 * Splits an album title into the record and its edition.
 *
 * `Album (Deluxe Edition)`, `Album [Remastered]` and `Album - 20th Anniversary Edition` all name
 * the same record; whether their tracklists hold the same recording is exactly the question the
 * review tier exists for, so the edition is kept apart rather than dropped.
 */
export function parseAlbum(rawAlbum: string): ParsedAlbum {
  let core = (rawAlbum ?? '').trim();
  const edition: string[] = [];
  const recording: string[] = [];

  core = core.replace(BRACKET_GROUP, (whole, content: string) => {
    const text = content.trim();
    const found = classify(text);

    if (found.recording.length > 0) {
      recording.push(...found.recording);
      return '';
    }

    if (EDITION_WORDS.test(text) || found.mastering.length > 0) {
      edition.push(normalizeForMatch(text));
      return '';
    }

    return whole;
  });

  for (;;) {
    const tail = DASH_TAIL.exec(core);

    if (!tail) break;

    const text = tail[1].trim();
    const found = classify(text);

    if (found.recording.length > 0) {
      recording.push(...found.recording);
    } else if (EDITION_WORDS.test(text) || found.mastering.length > 0) {
      edition.push(normalizeForMatch(text));
    } else {
      break;
    }

    core = core.slice(0, tail.index).trim();
  }

  const disc = DISC_NUMBER.exec(rawAlbum ?? '');

  return {
    core: core.replace(/\s{2,}/g, ' ').trim() || (rawAlbum ?? '').trim(),
    edition: unique(edition),
    recordingMarkers: unique(recording),
    disc: disc ? parseInt(disc[1], 10) : undefined,
  };
}

/** The numbers a title carries — `Page 8`, `2-2`, `Op. 57` — which a different track rarely shares. */
function numericTokens(text: string): string[] {
  return unique(
    normalizeForMatch(text)
      .split(' ')
      .filter((token) => /^\d+$/.test(token)),
  );
}

/** The artist name the recall query should carry: the primary credit alone. */
export function parseArtistForRecall(rawArtist: string): string {
  return parseArtist(rawArtist).primary;
}

/** The artist string without a trailing featured credit, and the names that credit held. */
function parseArtist(rawArtist: string): { primary: string; featured: string[] } {
  const artist = (rawArtist ?? '').trim();
  const credit = /\s+(?:feat(?:uring)?\.?|ft\.?)\s+(.+)$/i.exec(artist);

  if (!credit) {
    return { primary: artist.replace(LEADING_ARTICLE, ''), featured: [] };
  }

  return { primary: artist.slice(0, credit.index).trim().replace(LEADING_ARTICLE, ''), featured: splitNames(credit[1]) };
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Below these the pair is not worth a second look, whatever the other signals say.
 *
 * The artist floor sits above the catalog matchers' 0.6 on purpose: they verify a hit against a
 * provider's artist id afterwards, and there is no id here. `Spice` against `Spice Girls` scores
 * 0.67 on the identity comparison, and that pair must never reach the review tier, let alone a
 * merge. A shared ISRC bypasses the title and artist floors — it proves the recording — but
 * never the version markers or the duration check.
 */
const REJECT_FLOOR = { title: 0.5, artist: 0.7, album: 0.5 } as const;

/** Leading articles are dropped before artists are compared: `The Beatles` is `Beatles`. */
const LEADING_ARTICLE = /^(?:the|a|an|le|la|les|los|las|el|die|der|das)\s+/i;

/** At or above these, with nothing contradicting, code alone may merge. */
const AUTO_FLOOR = { title: 0.9, artist: 0.9, album: 0.9 } as const;

/**
 * Duration agreement, in seconds. Within the first the recordings agree; past the second they
 * do not; in between it is a question for the review tier. The tolerances are wide on purpose:
 * a local mp3 and the same recording on Qobuz or Spotify can differ by a few seconds of silence
 * or fade, and a duration is a supporting signal here, never the deciding one.
 */
const DURATION_AUTO_TOLERANCE = 3;
const DURATION_REJECT_TOLERANCE = 15;

const WEIGHTS = { title: 0.45, artist: 0.3, album: 0.25 } as const;

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Case and whitespace folded, `&` read as `and`, nothing else: the symbols stay. The ampersand
 * is the one symbol that is spelling rather than identity — `Kimya Dawson & Antsy Pants` and
 * `Kimya Dawson and Antsy Pants` are one credit — and the index folds it the same way.
 */
function foldExact(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Character-level similarity in [0, 1] on the tokenised forms: one minus the edit distance over
 * the longer length. Where the token-set comparison sees `Tree Huger` and `Tree Hugger` as half
 * alike, this sees one letter. Used only where something else already vouches for the pair —
 * the same slot on the same record — because on its own it would also call `Bad Girl` and
 * `Bad Girls` the same song.
 */
export function charSimilarity(left: string, right: string): number {
  const a = normalizeForMatch(foldExact(left));
  const b = normalizeForMatch(foldExact(right));

  if (a.length < 2 || b.length < 2) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }

    previous = current;
  }

  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

/**
 * Whether two titles differ by nothing more than one misspelt word.
 *
 * The character-level ratio alone cannot say this: `Concerto for cello and orchestra in D Major`
 * and `Concerto for violin and orchestra in G Major` are 86% alike letter for letter and are two
 * different works. So the titles are compared word by word, and only an identical word set, or
 * one word on each side that is itself a near-spelling of the other (`Huger` for `Hugger`,
 * `Finha` for `Tinha`), counts as a typo. A changed content word is a different title.
 */
export function differsByTypoOnly(left: string, right: string): boolean {
  const tokensLeft = normalizeForMatch(foldExact(left)).split(' ').filter(Boolean);
  const tokensRight = normalizeForMatch(foldExact(right)).split(' ').filter(Boolean);

  if (tokensLeft.length === 0 || tokensRight.length === 0) {
    return false;
  }

  const onlyLeft = tokensLeft.filter((token) => !tokensRight.includes(token));
  const onlyRight = tokensRight.filter((token) => !tokensLeft.includes(token));

  if (onlyLeft.length === 0 && onlyRight.length === 0) {
    return true;
  }

  if (onlyLeft.length !== 1 || onlyRight.length !== 1) {
    return false;
  }

  // A number is never a typo of another number: `Page 8` is not a misspelling of `Page 21`.
  if (/^\d+$/.test(onlyLeft[0]) || /^\d+$/.test(onlyRight[0])) {
    return false;
  }

  return charSimilarity(onlyLeft[0], onlyRight[0]) >= 0.75;
}

/** Whole-string equality with the symbols intact: `bbno$` is `bbno$`, `M.I.A.` is not `Mia`. */
export function exactEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  const foldedLeft = foldExact(left);

  return foldedLeft.length > 0 && foldedLeft === foldExact(right);
}

/**
 * Compares two names with the exact layer first and the tokenised comparison as the fallback.
 *
 * Tokenising strips symbols, and for some names the symbols are the name: M.I.A.'s album
 * `/\/\/\ Y /\` tokenises to `y`, `bbno$` to `bbno`. So an exact, symbol-preserving match wins
 * outright, and when either side tokenises to next to nothing the tokenised comparison is not
 * trusted at all — the exact layer was the only meaningful one, and it already said no.
 */
export function compareNames(left: string, right: string, compare: (left: string, right: string) => number): number {
  if (exactEqual(left, right)) {
    return 1;
  }

  const foldedLeft = foldExact(left);
  const foldedRight = foldExact(right);

  if (normalizeForMatch(foldedLeft).length < 2 || normalizeForMatch(foldedRight).length < 2) {
    return 0;
  }

  return compare(foldedLeft, foldedRight);
}

function normalizedIsrcs(identity: SongIdentity): Set<string> {
  return new Set(identity.isrcs.map((isrc) => isrc.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).filter((isrc) => isrc.length === 12));
}

/**
 * Scores one candidate against the primary and places it in a tier.
 *
 * Hard rejections come first, because no amount of textual agreement overrides a recording that
 * is plainly a different one: a live tag on one side only, durations far apart, an album that is
 * not the same record. Then `auto` has to clear every floor at once. Everything in between is a
 * question, and the answer is `review`.
 */
export function scoreDuplicate(primary: SongIdentity, candidate: SongIdentity): DuplicateVerdict {
  const titleA = parseTitle(primary.title);
  const titleB = parseTitle(candidate.title);
  const albumA = parseAlbum(primary.album);
  const albumB = parseAlbum(candidate.album);
  const artistA = parseArtist(primary.artist);
  const artistB = parseArtist(candidate.artist);

  const reasons: string[] = [];

  // Exact and symbol-preserving first, tokenised second — see `compareNames`. The raw title is
  // tried as well as the parsed core, so a title the parser mangles still matches itself.
  const title = Math.max(compareNames(titleA.core, titleB.core, similarity), exactEqual(primary.title, candidate.title) ? 1 : 0);

  // The song's artist and album are documents, not just strings. Two songs on the same artist
  // document are the same artist however the name is spelled; same for the album.
  const sameArtistDocument = !!primary.artistId && primary.artistId === candidate.artistId;
  const sameAlbumDocument = !!primary.albumId && primary.albumId === candidate.albumId;

  // The artist is scored primary-to-primary first; a match through a featured credit or the
  // album artist is a weaker claim and is marked as such below.
  const primaryArtist = sameArtistDocument ? 1 : compareNames(artistA.primary, artistB.primary, identitySimilarity);
  const candidateNames = [artistB.primary, candidate.albumArtist, ...artistB.featured, ...titleB.featured].filter((name): name is string => !!name);
  const primaryNames = [artistA.primary, primary.albumArtist, ...artistA.featured, ...titleA.featured].filter((name): name is string => !!name);
  const crossArtist = Math.max(0, ...primaryNames.flatMap((left) => candidateNames.map((right) => compareNames(left, right, identitySimilarity))));
  const artist = Math.max(primaryArtist, crossArtist);

  const album = sameAlbumDocument ? 1 : compareNames(albumA.core, albumB.core, identitySimilarity);
  const albumEdition: DuplicateSignals['albumEdition'] =
    sameAlbumDocument || exactEqual(primary.album, candidate.album)
      ? 'same'
      : album < REJECT_FLOOR.album
        ? 'unknown'
        : sameSet(albumA.edition, albumB.edition)
          ? 'same'
          : 'different';

  const durationDelta =
    primary.duration && candidate.duration && primary.duration > 0 && candidate.duration > 0
      ? Math.abs(primary.duration - candidate.duration)
      : undefined;

  const isrcsA = normalizedIsrcs(primary);
  const isrcShared = [...normalizedIsrcs(candidate)].some((isrc) => isrcsA.has(isrc));

  // The same record, in the same edition: either literally the same album document, or two
  // documents whose titles agree down to the edition. Only there does a track number mean the
  // same thing on both sides.
  const onSameRecord = sameAlbumDocument || (album >= AUTO_FLOOR.album && albumEdition === 'same');
  const bothTracksKnown = !!primary.trackNumber && !!candidate.trackNumber;
  const bothDiscsKnown = !!primary.discNumber && !!candidate.discNumber;
  const discConflict = onSameRecord && bothDiscsKnown && primary.discNumber !== candidate.discNumber;
  const trackNumberConflict = onSameRecord && bothTracksKnown && primary.trackNumber !== candidate.trackNumber;
  // The same slot on the same record — same disc, same track number — is the same song
  // however the title is spelled, short of a duplicate tag that copied the number too.
  const sameSlot =
    onSameRecord && bothTracksKnown && primary.trackNumber === candidate.trackNumber && (primary.discNumber ?? 1) === (candidate.discNumber ?? 1);

  const recordingMarkersA = unique([...titleA.recordingMarkers, ...albumA.recordingMarkers]);
  const recordingMarkersB = unique([...titleB.recordingMarkers, ...albumB.recordingMarkers]);

  const signals: DuplicateSignals = {
    title,
    artist,
    album,
    albumEdition,
    recordingMarkersA,
    recordingMarkersB,
    masteringMarkersA: titleA.masteringMarkers,
    masteringMarkersB: titleB.masteringMarkers,
    durationDelta,
    isrcShared,
    trackNumberConflict,
  };

  let confidence = WEIGHTS.title * title + WEIGHTS.artist * artist + WEIGHTS.album * album;

  /* ---- hard rejections ------------------------------------------------ */

  if (!sameSet(recordingMarkersA, recordingMarkersB)) {
    reasons.push(`different recording: [${recordingMarkersA.join(', ') || 'studio'}] vs [${recordingMarkersB.join(', ') || 'studio'}]`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  if (durationDelta !== undefined && durationDelta > DURATION_REJECT_TOLERANCE) {
    reasons.push(`durations ${durationDelta.toFixed(0)}s apart`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  // Sibling tracks are the bulk of what recall brings back — `Page 8` and `Page 21`, movement I
  // and movement II, disc 3 and disc 4 of a box set — and they share most of their words. Three
  // things tell them apart that token overlap does not: the numbers in the title, the disc of the
  // set, and a different track number under a title that is not all but identical.
  if (!isrcShared && !sameSet(numericTokens(titleA.core), numericTokens(titleB.core))) {
    reasons.push(`titles differ by number ([${numericTokens(titleA.core).join(', ')}] vs [${numericTokens(titleB.core).join(', ')}])`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  if (!isrcShared && albumA.disc !== undefined && albumB.disc !== undefined && albumA.disc !== albumB.disc) {
    reasons.push(`different discs of the set (${albumA.disc} vs ${albumB.disc})`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  // On the same record in the same edition, the slot is the identity: two different track
  // numbers, or two different discs, are two different songs however alike the titles read.
  if (!isrcShared && discConflict) {
    reasons.push(`different discs of the same record (${primary.discNumber} vs ${candidate.discNumber})`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  if (!isrcShared && trackNumberConflict) {
    reasons.push(`different tracks on the same record (${primary.trackNumber} vs ${candidate.trackNumber})`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  if (!isrcShared && title < REJECT_FLOOR.title) {
    reasons.push(`title similarity ${title.toFixed(2)} below ${REJECT_FLOOR.title}`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  // An artist name can be entirely different and still be the same person: a stage name against
  // a birth name, `Khalil Fong` against `方大同`, which no transliteration bridges. The other two
  // corners of the triangle can vouch for the pair when they agree to the letter — identical
  // title, identical album, and the same slot on it — but only as far as review. Without the
  // slot the same title on an album of the same name is not enough: `Spice` and `Spice Girls`
  // could each have a `Bad Girl` on a record called `10`.
  const triangleVouches = exactEqual(primary.title, candidate.title) && exactEqual(primary.album, candidate.album) && sameSlot;

  if (!isrcShared && artist < REJECT_FLOOR.artist && !triangleVouches) {
    reasons.push(`artist similarity ${artist.toFixed(2)} below ${REJECT_FLOOR.artist}`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  // A different record is a different song here, by policy: the library keeps one album per song
  // document, and folding a compilation copy into the original would lose the compilation. The
  // one exception is a shared ISRC, which proves the recording and only leaves the album open.
  if (album < REJECT_FLOOR.album && !isrcShared) {
    reasons.push(`album "${albumA.core}" is not "${albumB.core}"`);
    return { tier: 'reject', confidence: Math.min(confidence, 0.4), signals, reasons };
  }

  /* ---- certainty ------------------------------------------------------ */

  if (isrcShared) {
    confidence = Math.min(1, confidence + 0.1);
    reasons.push('same ISRC');
  }

  const caps: string[] = [];

  if (albumEdition === 'different')
    caps.push(`album edition differs ([${albumA.edition.join(', ') || 'plain'}] vs [${albumB.edition.join(', ') || 'plain'}])`);
  if (!sameSet(titleA.masteringMarkers, titleB.masteringMarkers)) {
    caps.push(`mastering differs ([${titleA.masteringMarkers.join(', ') || 'none'}] vs [${titleB.masteringMarkers.join(', ') || 'none'}])`);
  }
  if (durationDelta !== undefined && durationDelta > DURATION_AUTO_TOLERANCE) caps.push(`durations ${durationDelta.toFixed(0)}s apart`);
  if (!isrcShared && artist >= AUTO_FLOOR.artist && primaryArtist < AUTO_FLOOR.artist)
    caps.push('artist matched through a featured or album credit only');
  if (!isrcShared && artist < REJECT_FLOOR.artist)
    caps.push(`artist names differ entirely ("${artistA.primary}" vs "${artistB.primary}"); title, album and slot are identical`);
  if (album < AUTO_FLOOR.album) caps.push(`album similarity ${album.toFixed(2)} below ${AUTO_FLOOR.album}`);

  if (isrcShared && album >= AUTO_FLOOR.album && caps.length === 0) {
    return { tier: 'auto', confidence, signals, reasons };
  }

  const textCertain = title >= AUTO_FLOOR.title && artist >= AUTO_FLOOR.artist && album >= AUTO_FLOOR.album;

  if (textCertain && caps.length === 0) {
    reasons.push(durationDelta === undefined ? 'title, artist and album agree; duration unknown' : 'title, artist and album agree; durations agree');
    return { tier: 'auto', confidence, signals, reasons };
  }

  // The same slot on the same record carries the title a little: a tag typo does not make a
  // second song out of track 7 of the same album. Only a genuine typo, though — one misspelt
  // word, judged by `differsByTypoOnly` — because two movements of a suite can share a slot in a
  // badly tagged rip, and a changed content word is then the whole difference.
  if (sameSlot && artist >= AUTO_FLOOR.artist && caps.length === 0 && (title >= AUTO_FLOOR.title || differsByTypoOnly(titleA.core, titleB.core))) {
    reasons.push(`same slot on the same record (disc ${primary.discNumber ?? 1}, track ${primary.trackNumber}); title differs by a typo at most`);
    return { tier: 'auto', confidence: Math.min(1, confidence + 0.05), signals, reasons };
  }

  if (!textCertain) {
    caps.push(`text similarity title ${title.toFixed(2)}, artist ${artist.toFixed(2)}, album ${album.toFixed(2)}`);
  }

  reasons.push(...caps);

  return { tier: 'review', confidence: Math.max(0, confidence - 0.05 * caps.length), signals, reasons };
}

/**
 * Whether two entity names — two artists, two albums — are the same name, for the merge cascade.
 * Stricter than the song verdict on purpose: a wrong artist merge re-points a whole discography.
 */
export function isSameEntityName(left: string, right: string, kind: 'artist' | 'album'): boolean {
  if (kind === 'album') {
    return compareNames(parseAlbum(left).core, parseAlbum(right).core, identitySimilarity) >= 0.85;
  }

  return compareNames(parseArtist(left).primary, parseArtist(right).primary, identitySimilarity) >= 0.85;
}
