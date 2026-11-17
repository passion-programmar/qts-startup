import { NextResponse } from "next/server";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { deleteManagerJobs } from "@/server/jobs/delete-jobs";

// Auto Apply panel's Remove on a job page whose application is no longer held (its hold ran out, or
// another stop ended it): the job row is deleted by its id, with the Jobs page's rules: only this
// Manager's own job, never one still making its résumé, never one with a bid. The PDFs stay on disk.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
  if (!isUuid(body?.jobId)) {
    return NextResponse.json({ success: false, message: "A valid job ID is required." }, { status: 400 });
  }
  try {
    const result = await deleteManagerJobs(auth.manager.id, [body.jobId]);
    if (result.deleted === 1) return NextResponse.json({ success: true });
    const message = result.generating
      ? "QTS is still making this job's résumé: cancel Generation first, then remove it."
      : result.applied
        ? "This job has a bid, so it is not removed: it belongs to the Bids page."
        : "This job is no longer in your Jobs list.";
    return NextResponse.json({ success: false, message }, { status: 409 });
  } catch (error) {
    console.error("Could not remove the job.", error);
    return NextResponse.json({ success: false, message: "QTS could not remove the job. Try again." }, { status: 500 });
  }
}
