import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { applyAttempts } from "@/db/schema";
import { db } from "@/lib/db";
import { askGeminiForApplyAnswers, parseApplyGeminiTurns } from "@/server/apply/apply-gemini";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { AiJobError } from "@/server/gemini/ai-job";

// Apply's answers in Gemini mode: the extension sends the same prompt it would give ChatGPT (and,
// for a follow-up, the earlier turns); the server asks Gemini and returns its reply text. Only the
// Chrome filling the application may ask.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; turns?: unknown } | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  const turns = parseApplyGeminiTurns(body.turns);
  if (typeof turns === "string") return NextResponse.json({ success: false, message: turns }, { status: 400 });
  const [attempt] = await db
    .select({ id: applyAttempts.id })
    .from(applyAttempts)
    .where(and(
      eq(applyAttempts.id, body.attemptId),
      eq(applyAttempts.managerId, auth.manager.id),
      eq(applyAttempts.browserId, auth.browser.id),
      inArray(applyAttempts.status, ["claimed", "waiting_review"]),
    ))
    .limit(1);
  if (!attempt) {
    return NextResponse.json({ success: false, message: "This application is no longer held by this Chrome." }, { status: 409 });
  }
  try {
    return NextResponse.json({ success: true, reply: await askGeminiForApplyAnswers(turns) });
  } catch (error) {
    const code = error instanceof AiJobError ? error.code : "ai_failed";
    console.warn("Apply's AI answers failed:", code);
    // 429 is what the extension waits and retries on.
    const status = code === "ai_busy" || code === "ai_quota_used_up" ? 429 : 502;
    const message = error instanceof AiJobError ? error.message : "The AI model did not answer.";
    return NextResponse.json({ success: false, message }, { status });
  }
}
