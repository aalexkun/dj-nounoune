import { Logger } from '@nestjs/common';
import { SOURCE_TYPES, SourceType } from '../schemas/source.schema';

const logger = new Logger('ActiveSource');

export const ACTIVE_SOURCE_TYPES_ENV = 'ACTIVE_SOURCE_TYPES';

/**
 * Sources whose subscription is currently live, as declared by `ACTIVE_SOURCE_TYPES`.
 *
 * `null` means "no restriction" — the variable is unset or empty, and every read behaves
 * exactly as it did before this flag existed. Only the agentic read path honours this;
 * the CLI, the importers, the mergers and the dedup pipeline keep seeing the whole library
 * so that data is never lost while a subscription is dormant.
 */
let resolved: SourceType[] | null | undefined;

const isSourceType = (value: string): value is SourceType => (SOURCE_TYPES as readonly string[]).includes(value);

function resolveActiveSourceTypes(): SourceType[] | null {
  const raw = process.env[ACTIVE_SOURCE_TYPES_ENV];

  if (!raw || raw.trim().length === 0) {
    logger.log(`${ACTIVE_SOURCE_TYPES_ENV} is not set - every source type is active`);
    return null;
  }

  const requested = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const active: SourceType[] = [];
  for (const value of requested) {
    if (isSourceType(value)) {
      if (!active.includes(value)) {
        active.push(value);
      }
    } else {
      logger.warn(`${ACTIVE_SOURCE_TYPES_ENV} contains unknown source type "${value}" - ignoring it`);
    }
  }

  if (active.length === 0) {
    logger.warn(`${ACTIVE_SOURCE_TYPES_ENV} resolved to no known source type - every source type is active`);
    return null;
  }

  logger.log(`Active source types: ${active.join(', ')}`);
  return active;
}

/**
 * @returns the active source types, or `null` when no restriction is configured.
 *   Resolved once and memoised — the environment is not expected to change at runtime.
 */
export function getActiveSourceTypes(): SourceType[] | null {
  if (resolved === undefined) {
    resolved = resolveActiveSourceTypes();
  }
  return resolved;
}

/** Test seam: forces the next {@link getActiveSourceTypes} call to re-read the environment. */
export function resetActiveSourceTypesCache(): void {
  resolved = undefined;
}

export function isSourceActive(name: string): boolean {
  const active = getActiveSourceTypes();
  return active === null || (active as readonly string[]).includes(name);
}

/** Drops the sources the platform cannot currently play. Identity when unrestricted. */
export function filterActiveSources<T extends { name: string }>(sources: T[]): T[] {
  const active = getActiveSourceTypes();
  if (active === null) {
    return sources;
  }
  return sources.filter((source) => (active as readonly string[]).includes(source.name));
}

/**
 * The Mongo fragment matching songs that are playable on at least one active source.
 *
 * @returns `null` when unrestricted, so callers can skip adding a `$match` stage entirely
 *   rather than emitting a no-op one.
 */
export function buildActiveSourceMatch(): Record<string, unknown> | null {
  const active = getActiveSourceTypes();
  if (active === null) {
    return null;
  }
  return { source: { $elemMatch: { name: { $in: active } } } };
}
