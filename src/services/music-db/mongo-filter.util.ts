import { Logger } from '@nestjs/common';
import { FilterCondition, FilterOperator } from './mongo-filter.type';

const logger = new Logger('MongoFilter');

export type MongoMatch = Record<string, unknown>;

type FilterValue = string | number | boolean | Date;
type OperatorExpression = Record<string, unknown>;

/**
 * The slice of a Mongoose `Schema` this compiler needs.
 *
 * Structural rather than `Schema<T>` so the compiler stays decoupled from any one
 * model — `buildMatch` can be unit-tested against a bare `new Schema({...})`.
 */
export interface SchemaPathResolver {
  pathType(path: string): string;
  path(path: string): { instance?: string } | undefined;
}

/**
 * Operators whose negation is simply another operator in the set. Everything else
 * (`$regex`, `$all`) gets wrapped in `$not`; `$exists` flips its own boolean.
 */
const INVERSE_OPERATOR: Partial<Record<FilterOperator, FilterOperator>> = {
  $eq: '$ne',
  $ne: '$eq',
  $in: '$nin',
  $nin: '$in',
  $gt: '$lte',
  $lte: '$gt',
  $gte: '$lt',
  $lt: '$gte',
};

/**
 * A field must look like a plain (optionally dotted) document path. This is the first
 * gate against operator injection — a model that emits `$where` or `$expr` as a field
 * name never reaches the schema lookup.
 */
const SAFE_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * `pathType` resolves dotted paths through nested schemas and document arrays, so
 * `source.technical_info.is_high_res` is recognised while a hallucinated
 * `artists.name` comes back as `adhocOrUndefined` and gets dropped.
 */
function isKnownPath(schema: SchemaPathResolver, field: string): boolean {
  if (!SAFE_PATH.test(field)) {
    return false;
  }
  const pathType = schema.pathType(field);
  return pathType === 'real' || pathType === 'nested';
}

function toBoolean(value: FilterValue): boolean {
  if (typeof value === 'string') {
    return !['false', '0', ''].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

/**
 * `$match` inside an aggregation pipeline bypasses Mongoose casting, so values arrive
 * at the driver exactly as the model wrote them. Coercing against the declared type is
 * what stops `year: { $gte: 1990 }` from silently matching nothing — `Song.year` and
 * `Album.release_year` are strings.
 */
function coerce(schema: SchemaPathResolver, field: string, value: string | number | boolean): FilterValue {
  switch (schema.path(field)?.instance) {
    case 'String':
      return String(value);
    case 'Number': {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    case 'Boolean':
      return toBoolean(value);
    case 'Date': {
      const parsed = new Date(value as string | number);
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    default:
      return value;
  }
}

function buildExpression(schema: SchemaPathResolver, condition: FilterCondition): OperatorExpression | null {
  if (condition.value.length === 0) {
    return null;
  }
  const values = condition.value.map((value) => coerce(schema, condition.field, value));

  let operator: FilterOperator = condition.operator;
  let negated = condition.negate === true;

  // A scalar operator handed several values is a set-membership test in disguise.
  if (operator === '$eq' && values.length > 1) {
    operator = '$in';
  } else if (operator === '$ne' && values.length > 1) {
    operator = '$nin';
  }

  const inverse = negated ? INVERSE_OPERATOR[operator] : undefined;
  if (inverse) {
    operator = inverse;
    negated = false;
  }

  let expression: OperatorExpression;
  switch (operator) {
    case '$in':
    case '$nin':
    case '$all':
      expression = { [operator]: values };
      break;
    case '$regex':
      expression = { $regex: values.map(String).join('|'), $options: 'i' };
      break;
    case '$exists': {
      const exists = toBoolean(values[0]);
      expression = { $exists: negated ? !exists : exists };
      negated = false;
      break;
    }
    default:
      expression = { [operator]: values[0] };
      break;
  }

  return negated ? { $not: expression } : expression;
}

/**
 * Compiles LLM-authored filter conditions into a `$match` document.
 *
 * Conditions are ANDed. Anything the schema does not recognise is dropped rather than
 * passed through, so a hallucinated field narrows nothing instead of breaking the query.
 *
 * @returns the `$match` body, or `null` when no condition survived — callers must treat
 *   `null` as "no result" rather than running an unfiltered scan of the library.
 */
export function buildMatch(schema: SchemaPathResolver, filters: FilterCondition[]): MongoMatch | null {
  const match: MongoMatch = {};
  const collisions: MongoMatch[] = [];
  let applied = 0;

  for (const condition of filters) {
    if (!isKnownPath(schema, condition.field)) {
      logger.warn(`Discarding condition on unknown field "${condition.field}" (${condition.collection})`);
      continue;
    }

    const expression = buildExpression(schema, condition);
    if (!expression) {
      logger.warn(`Discarding condition on "${condition.field}": no value supplied`);
      continue;
    }

    applied++;
    const existing = match[condition.field];
    if (existing === undefined) {
      match[condition.field] = expression;
      continue;
    }

    // Same field twice: merge the operator keys so `year` can carry both `$gte` and
    // `$lt`. A genuine key collision goes to `$and` rather than silently overwriting.
    const merged = existing as OperatorExpression;
    if (Object.keys(expression).some((key) => key in merged)) {
      collisions.push({ [condition.field]: expression });
    } else {
      Object.assign(merged, expression);
    }
  }

  if (applied === 0) {
    return null;
  }
  if (collisions.length > 0) {
    match.$and = collisions;
  }
  return match;
}
