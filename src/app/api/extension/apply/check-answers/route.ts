import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { applyAttempts, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { loadApplicationAnswers, makeManagerReusable, saveManagerCorrection } from "@/server/apply/manager-answers";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  if (!isUuid(body?.attemptId) || !Array.isArray(body?.items) || body.items.length > 200) {
    return NextResponse.json({ success: false, message: "A valid attempt and at most 200 changed answers are required." }, { status: 400 });
  }
  try {
    const [held] = await db.select({ candidateId: applyAttempts.candidateId, jobId: applyAttempts.jobId })
      .from(applyAttempts).innerJoin(users, eq(users.id, applyAttempts.candidateId))
      .innerJoin(profiles, eq(profiles.userId, applyAttempts.candidateId)).where(and(
        eq(applyAttempts.id, body.attemptId), eq(applyAttempts.managerId, auth.manager.id),
        eq(applyAttempts.browserId, auth.browser.id), eq(users.parentUserId, auth.manager.id), isNull(users.blockedAt),
        inArray(applyAttempts.status, ["claimed", "waiting_review"]), gt(applyAttempts.leaseExpiresAt, new Date()),
      )).limit(1);
    if (!held) return NextResponse.json({ success: false, message: "This application is no longer held by this Chrome." }, { status: 409 });
    if (body.reuseAnswerId !== undefined) {
      if (!isUuid(body.reuseAnswerId)) return NextResponse.json({ success: false, message: "Invalid answer ID." }, { status: 400 });
      const moved = await makeManagerReusable(auth.manager.id, body.reuseAnswerId);
      if (!moved.ok) return NextResponse.json({ success: false, message: moved.reason }, { status: 400 });
    }
    const results = [];
    for (const item of body.items) {
      results.push(await saveManagerCorrection(auth.manager.id, held.candidateId, held.jobId, item));
    }
    const answers = await loadApplicationAnswers(auth.manager.id, held.candidateId, held.jobId);
    return NextResponse.json({ success: true, results, savedAnswers: answers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not save Manager corrections.", error);
    return NextResponse.json({ success: false, message: "Some changes may not have saved. Click Check to retry; no approval is required." }, { status: 500 });
  }
}
