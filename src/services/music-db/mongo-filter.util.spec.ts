import { Schema } from 'mongoose';
import { buildMatch, SchemaPathResolver } from './mongo-filter.util';
import { FilterCondition } from './mongo-filter.type';

/** Mirrors the shape of `Song` that matters here: a string `year` and a nested source array. */
const songSchema = new Schema({
  title: String,
  genre: String,
  year: String,
  pace: String,
  track_number: Number,
  source: [
    new Schema({
      name: String,
      technical_info: new Schema({ is_high_res: Boolean, bitrate: Number }),
    }),
  ],
}) as unknown as SchemaPathResolver;

const artistSchema = new Schema({ artist: String }) as unknown as SchemaPathResolver;

const songCondition = (condition: Omit<FilterCondition, 'collection'>): FilterCondition => ({ collection: 'songs', ...condition });

describe('buildMatch', () => {
  it('compiles a known field into a $match expression', () => {
    const match = buildMatch(songSchema, [songCondition({ field: 'pace', operator: '$in', value: ['fast', 'ultra fast'] })]);

    expect(match).toEqual({ pace: { $in: ['fast', 'ultra fast'] } });
  });

  it('resolves dotted paths through document arrays', () => {
    const match = buildMatch(songSchema, [songCondition({ field: 'source.technical_info.is_high_res', operator: '$eq', value: [true] })]);

    expect(match).toEqual({ 'source.technical_info.is_high_res': { $eq: true } });
  });

  it('discards a hallucinated field', () => {
    // The Artist name field is `artist`, not `name`.
    const match = buildMatch(artistSchema, [
      { collection: 'artists', field: 'name', operator: '$eq', value: ['Sheena Ringo'] },
      { collection: 'artists', field: 'artist', operator: '$eq', value: ['Sheena Ringo'] },
    ]);

    expect(match).toEqual({ artist: { $eq: 'Sheena Ringo' } });
  });

  it('returns null when no condition survives', () => {
    const match = buildMatch(songSchema, [
      songCondition({ field: 'bogus', operator: '$eq', value: ['x'] }),
      songCondition({ field: 'genre', operator: '$in', value: [] }),
    ]);

    expect(match).toBeNull();
  });

  it('rejects operator injection dressed up as a field name', () => {
    expect(buildMatch(songSchema, [songCondition({ field: '$where', operator: '$eq', value: ['1 == 1'] })])).toBeNull();
  });

  it('coerces values to the declared path type', () => {
    // `year` is a string in the schema; a numeric comparison would otherwise match nothing.
    const match = buildMatch(songSchema, [songCondition({ field: 'year', operator: '$gte', value: [1990] })]);

    expect(match).toEqual({ year: { $gte: '1990' } });
  });

  it('coerces numeric paths from string values', () => {
    const match = buildMatch(songSchema, [songCondition({ field: 'track_number', operator: '$lte', value: ['5'] })]);

    expect(match).toEqual({ track_number: { $lte: 5 } });
  });

  it('promotes a multi-value $eq to $in and $ne to $nin', () => {
    expect(buildMatch(songSchema, [songCondition({ field: 'genre', operator: '$eq', value: ['Techno', 'Trance'] })])).toEqual({
      genre: { $in: ['Techno', 'Trance'] },
    });
    expect(buildMatch(songSchema, [songCondition({ field: 'genre', operator: '$ne', value: ['Techno', 'Trance'] })])).toEqual({
      genre: { $nin: ['Techno', 'Trance'] },
    });
  });

  it('inverts negated operators that have an opposite', () => {
    const match = buildMatch(songSchema, [songCondition({ field: 'pace', operator: '$in', value: ['slow'], negate: true })]);

    expect(match).toEqual({ pace: { $nin: ['slow'] } });
  });

  it('wraps a negated $regex in $not', () => {
    const match = buildMatch(songSchema, [songCondition({ field: 'genre', operator: '$regex', value: ['ambient'], negate: true })]);

    expect(match).toEqual({ genre: { $not: { $regex: 'ambient', $options: 'i' } } });
  });

  it('joins multiple regex values into an alternation', () => {
    const match = buildMatch(songSchema, [songCondition({ field: 'genre', operator: '$regex', value: ['ambient', 'drone'] })]);

    expect(match).toEqual({ genre: { $regex: 'ambient|drone', $options: 'i' } });
  });

  it('flips $exists rather than wrapping it', () => {
    const match = buildMatch(songSchema, [songCondition({ field: 'genre', operator: '$exists', value: [true], negate: true })]);

    expect(match).toEqual({ genre: { $exists: false } });
  });

  it('merges two conditions on the same field into one expression', () => {
    const match = buildMatch(songSchema, [
      songCondition({ field: 'year', operator: '$gte', value: ['1990'] }),
      songCondition({ field: 'year', operator: '$lt', value: ['2000'] }),
    ]);

    expect(match).toEqual({ year: { $gte: '1990', $lt: '2000' } });
  });

  it('pushes a colliding operator on the same field to $and instead of overwriting', () => {
    const match = buildMatch(songSchema, [
      songCondition({ field: 'genre', operator: '$in', value: ['Techno'] }),
      songCondition({ field: 'genre', operator: '$in', value: ['Trance'] }),
    ]);

    expect(match).toEqual({
      genre: { $in: ['Techno'] },
      $and: [{ genre: { $in: ['Trance'] } }],
    });
  });
});
