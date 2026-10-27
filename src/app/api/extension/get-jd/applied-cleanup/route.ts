import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { claimAppliedCleanupQuestion, clearAppliedJobs } from "@/server/jobs/applied-cleanup";

const noStore = { "Cache-Control": "no-store" };

// The daily "Clear applied jobs?" question at Get JD start: action "check" claims today's question
// (once across all Chromes, after 4:00 PM Romania time); action "clear" deletes the Applied job rows.
export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json({ success: false, message: "Your QTS session has ended. Sign in again." }, { status: 401, headers: noStore });
  }
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  try {
    if (body?.action === "check") {
      const question = await claimAppliedCleanupQuestion(manager.id);
      return NextResponse.json({ success: true, ...question }, { headers: noStore });
    }
    if (body?.action === "clear") {
      const deleted = await clearAppliedJobs(manager.id);
      return NextResponse.json({ success: true, deleted }, { headers: noStore });
    }
    return NextResponse.json({ success: false, message: "Unknown clean-up action." }, { status: 400, headers: noStore });
  } catch (error) {
    console.error("Could not run the applied-jobs clean-up.", error);
    return NextResponse.json({ success: false, message: "QTS could not clear the applied jobs." }, { status: 500, headers: noStore });
  }
}
