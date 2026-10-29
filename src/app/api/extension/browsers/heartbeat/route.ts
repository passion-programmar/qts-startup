import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { MIN_WORK_EXTENSION_VERSION, parseBrowserHeaders } from "@/server/apply/apply-values";
import { recordBrowserHeartbeat } from "@/server/browsers/extension-browsers";

// Each Chrome reports its modes every 30 seconds and learns whether "Stop all" was pressed.
export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) {
    return NextResponse.json(
      { success: false, message: "Your QTS session has ended. Sign in again." },
      { status: 401 },
    );
  }
  const identity = parseBrowserHeaders(request.headers);
  if (!identity) {
    return NextResponse.json(
      { success: false, message: "This extension did not identify its Chrome. Update the QTS extension." },
      { status: 400 },
    );
  }
  const body = await request.json().catch(() => null) as { getJdOn?: unknown; workMode?: unknown } | null;
  const workMode = body?.workMode;
  if (typeof body?.getJdOn !== "boolean" || (workMode !== "off" && workMode !== "generation" && workMode !== "apply")) {
    return NextResponse.json(
      { success: false, message: "The Chrome modes are invalid." },
      { status: 400 },
    );
  }

  try {
    // Registering the Chrome, recording its modes and reading "Stop all" share one database trip.
    const { browser, ...stopVersions } = await recordBrowserHeartbeat(manager.id, identity, { getJdOn: body.getJdOn, workMode });
    return NextResponse.json({
      success: true,
      browser: { id: browser.id, name: browser.name, canTakeWork: browser.canTakeWork },
      minWorkExtensionVersion: MIN_WORK_EXTENSION_VERSION,
      ...stopVersions,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not record the Chrome heartbeat.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not record this Chrome's status." },
      { status: 500 },
    );
  }
}
