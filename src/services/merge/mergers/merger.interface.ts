export interface Merger<T> {
  merge(existingEntity: T, newEntity: T): T;
}
