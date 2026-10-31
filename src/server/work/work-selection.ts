export type WorkSelection = { candidateId: string; jobIds: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isWorkId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

// Undefined preserves the existing whole-queue action. Invalid/empty scope must never mean all jobs.
export function readWorkSelection(value: unknown): WorkSelection | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Select an account and at least one job.");
  const { candidateId, jobIds } = value as Record<string, unknown>;
  if (!isWorkId(candidateId) || !Array.isArray(jobIds) || !jobIds.length || jobIds.length > 200
    || !jobIds.every(isWorkId) || new Set(jobIds).size !== jobIds.length) {
    throw new Error("Select a valid account and between 1 and 200 distinct jobs.");
  }
  return { candidateId, jobIds };
}
