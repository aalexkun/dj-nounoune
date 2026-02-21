// utils/array.utils.ts
export function* chunkArray<T>(array: T[], size: number): Generator<T[]> {
  for (let i = 0; i < array.length; i += size) {
    yield array.slice(i, i + size);
  }
}

export function getInclusivePaginationRanges(totalItems: number, pageSize: number): [number, number][] {
  if (pageSize <= 0 || totalItems <= 0) return [];

  const ranges: [number, number][] = [];

  for (let i = 0; i < totalItems; i += pageSize) {
    const startIndex = i;
    // Subtract 1 to make the end index inclusive, capping it at the final item's index
    const endIndex = Math.min(i + pageSize - 1, totalItems - 1);
    ranges.push([startIndex, endIndex]);
  }

  return ranges;
}
