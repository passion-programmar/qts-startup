import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { readDailyJobCounts } from "@/server/jobs/daily-job-counts";

// Today's counts for the extension panel: new job URLs, job rows added, and applications.
export async function GET(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const counts = await readDailyJobCounts(manager.id);
    return NextResponse.json({ success: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not read today's counts.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not read today's counts." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
