import { NextResponse } from "next/server";
import { getExtensionManager } from "@/lib/extension-auth";
import { resolveExtensionBrowser } from "@/server/browsers/extension-browsers";
import { createCustomJob, listCustomJobs, readCustomJob, removeCustomJob, submitCustomJob } from "@/server/jobs/custom-jobs";

const reply = (status: number, message: string) => NextResponse.json({ success: false, message }, { status, headers: { "Cache-Control": "no-store" } });
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/**
 * The launcher's Custom: list this Chrome's custom jobs, create one (a pasted JD, pinned to this
 * Chrome), Submitted (the bid; the job removed), or give it back (the job removed).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const manager = await getExtensionManager(request);
  if (!manager) return reply(401, "Your QTS session has ended. Sign in again.");
  const browser = await resolveExtensionBrowser(manager.id, request);
  if (!browser) return reply(400, "This extension did not identify its Chrome. Update the QTS extension.");
  const text = await request.text().catch(() => "");
  if (text.length > 200_000) return reply(400, "The job description is too long.");
  let body: Record<string, unknown>;
  try { body = JSON.parse(text || "{}"); } catch { return reply(400, "Invalid request."); }
  try {
    if (body.action === "list") {
      return NextResponse.json({ success: true, jobs: await listCustomJobs(manager.id, browser.id) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "create") {
      const input = readCustomJob(body.job);
      if (typeof input === "string") return reply(400, input);
      const created = await createCustomJob(manager.id, browser.id, input);
      if (!created.ok) return reply(409, created.reason);
      return NextResponse.json({ success: true, jobId: created.jobId, jobs: await listCustomJobs(manager.id, browser.id) });
    }
    if (body.action === "submitted" || body.action === "remove") {
      if (!isUuid(body.jobId)) return reply(400, "A valid job is required.");
      const done = body.action === "submitted" ? await submitCustomJob(manager.id, body.jobId) : await removeCustomJob(manager.id, body.jobId);
      if (!done.ok) return reply(409, done.reason);
      return NextResponse.json({ success: true, ...("resumeFiles" in done ? { resumeFiles: done.resumeFiles } : {}), jobs: await listCustomJobs(manager.id, browser.id) });
    }
    return reply(400, "Unknown Custom action.");
  } catch (error) {
    console.error("Custom job request failed.", error instanceof Error ? error.name : "unknown");
    return reply(500, "QTS could not complete this. Try again.");
  }
}
