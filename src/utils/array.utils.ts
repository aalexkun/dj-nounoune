// utils/array.utils.ts
export function* chunkArray<T>(array: T[], size: number): Generator<T[]> {
  for (let i = 0; i < 5000; i += size) {
    yield array.slice(i, i + size);
  }
}
