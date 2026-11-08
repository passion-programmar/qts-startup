import { NextResponse } from "next/server";
import { authorizeApplyRequest } from "@/server/apply/apply-route-auth";
import { parseUnanswered, recordUnanswered } from "@/server/apply/unanswered-questions";

// Normal Apply reports the questions no saved answer or profile fact answered; they go to the Manager's
// "Needs answer" list (one row per question per Manager), to be answered once on the Manager page.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) { auth.headers.set("Cache-Control", "no-store"); return auth; }
  try {
    const text = await request.text();
    if (text.length > 64000) return NextResponse.json({ success: false, message: "The request is too large." }, { status: 400 });
    const body = JSON.parse(text);
    await recordUnanswered(auth.manager.id, parseUnanswered(body?.questions));
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
    console.error("Unanswered questions were not recorded.", error);
    // Never blocks applying: the list is a convenience.
    return NextResponse.json({ success: false, message: "Not recorded." }, { status: 500 });
  }
}
