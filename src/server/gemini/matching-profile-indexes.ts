export function mapMatchingProfileIndexes(
  value: unknown,
  candidateIds: string[],
): string[] | null {
  if (!Array.isArray(value) || value.length > candidateIds.length) return null;

  const seenIndexes = new Set<number>();
  const matchingIds: string[] = [];
  for (const index of value) {
    if (
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= candidateIds.length ||
      seenIndexes.has(index)
    ) {
      return null;
    }
    seenIndexes.add(index);
    matchingIds.push(candidateIds[index]);
  }
  return matchingIds;
}
