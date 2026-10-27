// Per-account Get JD states (docs/get-jd-redesign.md, section 4). Pure, so the
// panel wording and lock rules are testable without a database.

export type GetJdDuplicateKind = "applied" | "job_list";

export type GetJdDuplicate = {
  kind: GetJdDuplicateKind;
  jobStatus: string | null;
  /** The account's jobs row, when one exists. */
  rowId: string | null;
  generationStatus: string | null;
};

// "works_here": the candidate's most recent employer is this job's company, so it is never saved for them.
export type GetJdAccountState = "applied" | "generation_running" | "has_job" | "works_here" | "available";

export function getJdAccountState(duplicate: GetJdDuplicate | null | undefined): GetJdAccountState {
  if (!duplicate) return "available";
  if (duplicate.kind === "applied") return "applied";
  if (duplicate.generationStatus === "processing") return "generation_running";
  return "has_job";
}

export type GetJdAccountSummary = {
  applied: number;
  hasJob: number;
  available: number;
  text: string;
};

const candidates = (count: number) => `${count} candidate${count === 1 ? "" : "s"}`;

/** For example "Applied by 1 candidate · 2 already have this job · 3 can be added". */
export function summarizeAccountStates(states: GetJdAccountState[]): GetJdAccountSummary {
  const applied = states.filter((state) => state === "applied").length;
  const hasJob = states.filter((state) => state === "has_job" || state === "generation_running").length;
  const available = states.filter((state) => state === "available").length;
  const worksHere = states.filter((state) => state === "works_here").length;
  if (!available && (applied || hasJob) && !worksHere) {
    return { applied, hasJob, available, text: "All candidates already have this job." };
  }
  const parts = [
    applied ? `Applied by ${candidates(applied)}` : "",
    hasJob ? `${hasJob} already ${hasJob === 1 ? "has" : "have"} this job` : "",
    worksHere ? `${candidates(worksHere)} ${worksHere === 1 ? "works" : "work"} there now` : "",
    available ? `${available} can be added` : "",
  ].filter(Boolean);
  return { applied, hasJob, available, text: parts.length ? `${parts.join(" · ")}.` : "No active candidates." };
}
