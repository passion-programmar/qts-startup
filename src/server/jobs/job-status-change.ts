// Jobs-page status edits keep jobs.status and bids in step (src/server/jobs/job-bids.ts).
// Pure, so the rules are testable without a database.

export type JobStatus = "todo" | "pending" | "applied" | "failed";

/** Why a Jobs-page status change is refused, or null when it is allowed. */
export function jobStatusChangeError(
  status: JobStatus,
  current: { status: string; hasBid: boolean; generationStatus: string; resumeLocalPath: string | null },
): string | null {
  if (current.hasBid && status !== "applied") {
    return "This candidate applied to this job. Delete the bid on the Bids page first.";
  }
  // A bid is created only when Apply completes, and only for a job whose Generation completed.
  // Rows marked Applied before bids were required keep that status when other details are edited.
  if (
    !current.hasBid && status === "applied" && current.status !== "applied" &&
    !canCreateBid(current)
  ) {
    return "Only a job with completed Generation can be marked Applied. Run Generation for this job first.";
  }
  return null;
}

function canCreateBid(current: { generationStatus: string; resumeLocalPath: string | null }): boolean {
  return current.generationStatus === "completed" && Boolean(current.resumeLocalPath);
}

/** Applied on a row without a bid creates the bid, when its Generation completed. */
export function statusChangeCreatesBid(
  status: JobStatus,
  current: { hasBid: boolean; generationStatus: string; resumeLocalPath: string | null },
): boolean {
  return status === "applied" && !current.hasBid && canCreateBid(current);
}
