import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { applyAttempts } from "@/db/schema";
import { db } from "@/lib/db";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { parseReusableAnswer } from "@/server/apply/apply-values";
import { isPerCandidateQuestion } from "@/server/apply/question-memory-values";
import { proposeReusableAnswer } from "@/server/apply/reusable-answers";

const MAX_ITEMS = 10;

// Auto Apply's "Propose my changes": answers the Manager corrected on an application this Chrome
// holds, proposed to Super Admin as draft reusable answers (never approved here). A personal or
// per-candidate question (name, location, experience, motivation...) is never proposed for everyone.
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; items?: unknown } | null;
  if (!isUuid(body?.attemptId) || !Array.isArray(body?.items) || !body.items.length || body.items.length > MAX_ITEMS) {
    return NextResponse.json({ success: false, message: `An attempt ID and 1 to ${MAX_ITEMS} answers are required.` }, { status: 400 });
  }
  try {
    const [held] = await db.select({ id: applyAttempts.id }).from(applyAttempts).where(and(
      eq(applyAttempts.id, body.attemptId),
      eq(applyAttempts.managerId, auth.manager.id),
      eq(applyAttempts.browserId, auth.browser.id),
    )).limit(1);
    if (!held) {
      return NextResponse.json({ success: false, message: "This application is no longer held by this Chrome." }, { status: 409 });
    }
    const results = [];
    for (const item of body.items as { question?: unknown; answer?: unknown }[]) {
      const question = typeof item?.question === "string" ? item.question.replace(/\s*\*\s*$/, "").trim() : "";
      const parsed = parseReusableAnswer({ question, answer: item?.answer, note: "" });
      if (typeof parsed === "string") {
        results.push({ question: question.slice(0, 120), ok: false, reason: parsed });
        continue;
      }
      if (isPerCandidateQuestion(parsed.questionText)) {
        results.push({ question: parsed.questionText.slice(0, 120), ok: false, reason: "a personal or per-candidate question" });
        continue;
      }
      const outcome = await proposeReusableAnswer(auth.manager.id, parsed);
      results.push(outcome.ok
        ? { question: parsed.questionText.slice(0, 120), ok: true }
        : { question: parsed.questionText.slice(0, 120), ok: false, reason: outcome.error });
    }
    return NextResponse.json({ success: true, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not propose the corrected answers.", error);
    return NextResponse.json({ success: false, message: "QTS could not send the proposals." }, { status: 500 });
  }
}
