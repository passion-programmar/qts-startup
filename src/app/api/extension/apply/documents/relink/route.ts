import { NextResponse } from "next/server";
import { authorizeApplyRequest } from "@/server/apply/apply-route-auth";
import { parseRelinkInput } from "@/server/apply/apply-pdf-recovery";
import { relinkPdfPaths } from "@/server/apply/apply-pdf-recovery-store";

const reply = (status: number, message: string, success = false) =>
  NextResponse.json({ success, message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) { auth.headers.set("Cache-Control", "no-store"); return auth; }
  try {
    const text = await request.text();
    if (text.length > 4096) return reply(400, "The PDF link request is too large.");
    let input;
    try { input = parseRelinkInput(JSON.parse(text)); } catch { /* Invalid JSON is refused below. */ }
    if (!input) return reply(400, "Select two distinct PDFs in the recorded job folder and confirm their original paths.");
    const saved = await relinkPdfPaths({ managerId: auth.manager.id, browserId: auth.browser.id, authVersion: auth.manager.authVersion }, input);
    if (!saved) return reply(409, "The application access, claim, Generation run, or saved PDF paths changed. Reload recovery and review both files again; no links were overwritten.");
    console.info("Relinked existing Apply PDFs", { attemptId: input.attemptId, generationId: input.generationId, managerId: auth.manager.id, browserId: auth.browser.id });
    return reply(200, "PDF links saved. Return to the application and choose Retry autofill when ready.", true);
  } catch (error) {
    console.error("Could not relink existing Apply PDFs.", error);
    return reply(500, "QTS could not confirm the PDF links. Keep Apply paused; explicitly retry the same selection or reload recovery.");
  }
}
