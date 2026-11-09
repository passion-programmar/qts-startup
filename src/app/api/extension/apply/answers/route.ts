import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { applyAttempts, jobs, users } from "@/db/schema";
import { db } from "@/lib/db";
import { askGeminiForApplyAnswers, parseApplyGeminiTurns } from "@/server/apply/apply-gemini";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { AiJobError } from "@/server/gemini/ai-job";
import { matchesManagerCustomUrl } from "@/server/work/custom-urls";

// The AI gets up to 55 seconds (ai-job.ts); the function must outlive it to report the failure.
export const maxDuration = 60;

// Apply's answers through the server's Gemini and Groq keys: the extension sends the prompt (and,
// for a follow-up, the earlier turns); the server asks the AI and returns its reply text. Only the
// Chrome filling the application may ask, and only for a Manager Super Admin gave these keys to.
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
    .select({
      id: applyAttempts.id,
      autoApplyApi: users.autoApplyApi,
      applyAiMode: users.applyAiMode,
      customUrlGemini: matchesManagerCustomUrl(auth.manager.id, jobs.jobUrl),
    })
    .from(applyAttempts)
    .innerJoin(users, eq(users.id, applyAttempts.managerId))
    .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
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
  if (!attempt.autoApplyApi && attempt.applyAiMode !== "gemini" && !attempt.customUrlGemini) {
    return NextResponse.json({ success: false, retry: false, message: "Super Admin has not given this Manager the Gemini and Groq keys." }, { status: 403 });
  }
  try {
    return NextResponse.json({ success: true, reply: await askGeminiForApplyAnswers(turns) });
  } catch (error) {
    const code = error instanceof AiJobError ? error.code : "ai_failed";
    console.warn("Apply's AI answers failed:", code);
    // 429 is what the extension waits and retries on; retry: false says waiting will not help today.
    const status = code === "ai_busy" || code === "ai_quota_used_up" ? 429 : 502;
    const message = error instanceof AiJobError ? error.message : "The AI model did not answer.";
    return NextResponse.json({ success: false, retry: code !== "ai_quota_used_up", message }, { status });
  }
}
