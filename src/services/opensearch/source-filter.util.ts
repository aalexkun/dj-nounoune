/**
 * The active-source filter shared by every query on the agentic path.
 *
 * Documents indexed incrementally by the importers carry no `source` array at all - only the
 * full reindex writes it. Excluding them would hide most of the recent library, so they are let
 * through and the caller re-checks them against Mongo, which is the authority. Applied as a
 * `filter` clause, so it is score-neutral.
 *
 * @param activeSources - source types the client may play, or `null` for no restriction.
 */
export function buildActiveSourceFilter(activeSources: string[] | null): Record<string, unknown>[] {
  if (!activeSources || activeSources.length === 0) {
    return [];
  }

  return [
    {
      bool: {
        should: [
          { terms: { 'source.name': activeSources } },
          { bool: { must_not: { exists: { field: 'source.name' } } } },
        ],
        minimum_should_match: 1,
      },
    },
  ];
}
