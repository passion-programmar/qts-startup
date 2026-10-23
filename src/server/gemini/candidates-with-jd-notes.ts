export function candidatesWithJdNotes<
  T extends { jdMatching: string | null },
>(candidates: T[]): T[] {
  return candidates.filter(
    (candidate) => typeof candidate.jdMatching === "string" &&
      candidate.jdMatching.trim().length > 0,
  );
}
