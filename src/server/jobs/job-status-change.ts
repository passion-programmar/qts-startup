// Jobs-page status edits. Pure, so the rule is testable without a database.

export type JobStatus = "todo" | "pending" | "applied" | "failed";

/**
 * Why a Jobs-page status change is refused, or null when it is allowed. Applied comes only from
 * Apply, when the Manager answers Yes after Submit (that also makes the bid); a job already Applied
 * may keep that status while other details are edited.
 */
export function jobStatusChangeError(status: JobStatus, current: { status: string }): string | null {
  if (status === "applied" && current.status !== "applied") {
    return "Only Apply marks a job Applied, when you answer Yes after Submit.";
  }
  return null;
}
