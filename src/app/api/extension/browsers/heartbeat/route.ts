import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { MIN_WORK_EXTENSION_VERSION, parseBrowserHeaders } from "@/server/apply/apply-values";
import { recordBrowserHeartbeat } from "@/server/browsers/extension-browsers";
import { isReadyKind } from "@/server/work/work-readiness";

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
  const body = await request.json().catch(() => null) as { getJdOn?: unknown; workMode?: unknown; ready?: unknown; scoped?: unknown } | null;
  const workMode = body?.workMode;
  if (typeof body?.getJdOn !== "boolean" || (workMode !== "off" && workMode !== "generation" && workMode !== "apply")) {
    return NextResponse.json(
      { success: false, message: "The Chrome modes are invalid." },
      { status: 400 },
    );
  }
  // The Chrome may ask how many jobs are ready for one mode (it then claims only when there are).
  const ready = isReadyKind(body.ready) ? { kind: body.ready, scoped: body.scoped === true } : undefined;

  try {
    // Registering the Chrome, recording its modes, reading "Stop all" and counting ready work share
    // one database trip.
    const { browser, ready: readyWork, settingsVersion, ...stopVersions } = await recordBrowserHeartbeat(manager.id, identity, { getJdOn: body.getJdOn, workMode }, ready);
    return NextResponse.json({
      success: true,
      browser: { id: browser.id, name: browser.name, canTakeWork: browser.canTakeWork },
      minWorkExtensionVersion: MIN_WORK_EXTENSION_VERSION,
      ...stopVersions,
      // Changes when a highlight, exclusion, URL rule, skip site or feature switch changes: the Chrome
      // then refreshes its copies (none are asked for every minute any more).
      ...(settingsVersion ? { settingsVersion } : {}),
      ...(ready && readyWork ? { ready: { kind: ready.kind, count: readyWork.count, key: readyWork.key } } : {}),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not record the Chrome heartbeat.", error);
    return NextResponse.json(
      { success: false, message: "QTS could not record this Chrome's status." },
      { status: 500 },
    );
  }
}
