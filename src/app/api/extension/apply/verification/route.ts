import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { applyAttempts, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { authorizeApplyRequest, isUuid } from "@/server/apply/apply-route-auth";
import { siteTokens } from "@/server/apply/verification-mail-extract";
import { mailboxLogin, waitForVerificationMail } from "@/server/apply/verification-mailbox";

// One wait (up to 40 s) for the verification code or link a job site mailed to the application's
// candidate, read from the Manager's verification mailbox. The extension asks at most a few times
// per code page. Nothing is stored; the mail used is marked read in the mailbox.
export const maxDuration = 60;

const WAIT_MS = 40_000;
// Mails a little older than the code page count (the PC's clock and the mail server's differ).
const CLOCK_MARGIN_MS = 60_000;
const OLDEST_MS = 15 * 60_000;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authorizeApplyRequest(request);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { attemptId?: unknown; since?: unknown; pageUrl?: unknown; exclude?: unknown } | null;
  if (!isUuid(body?.attemptId)) {
    return NextResponse.json({ success: false, message: "A valid attempt ID is required." }, { status: 400 });
  }
  const now = Date.now();
  const sinceMs = typeof body.since === "number" && Number.isFinite(body.since) ? Math.min(Math.max(body.since, now - OLDEST_MS), now) : now;
  const pageUrl = typeof body.pageUrl === "string" && /^https?:\/\//i.test(body.pageUrl) ? body.pageUrl.slice(0, 2000) : "";
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((value): value is string => typeof value === "string").map((value) => value.slice(0, 2000)).slice(0, 20) : [];

  try {
    const [row] = await db
      .select({
        candidateEmail: profiles.candidateEmail,
        jobUrl: jobs.jobUrl,
        company: jobs.company,
        address: users.verificationMailAddress,
        host: users.verificationMailHost,
        password: users.verificationMailPassword,
      })
      .from(applyAttempts)
      .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
      .innerJoin(profiles, eq(profiles.userId, applyAttempts.candidateId))
      .innerJoin(users, eq(users.id, applyAttempts.managerId))
      .where(and(
        eq(applyAttempts.id, body.attemptId),
        eq(applyAttempts.managerId, auth.manager.id),
        eq(applyAttempts.browserId, auth.browser.id),
        inArray(applyAttempts.status, ["claimed", "waiting_review"]),
      ))
      .limit(1);
    if (!row) {
      return NextResponse.json({ success: false, message: "This application is no longer held by this Chrome." }, { status: 409 });
    }
    const login = mailboxLogin(row);
    if (!login) return NextResponse.json({ success: true, status: "no_mailbox" });
    if (!row.candidateEmail) return NextResponse.json({ success: true, status: "no_candidate_email" });

    const result = await waitForVerificationMail(login, {
      candidateEmail: row.candidateEmail,
      tokens: siteTokens([row.jobUrl, pageUrl].filter(Boolean), row.company),
      since: new Date(sinceMs - CLOCK_MARGIN_MS),
      waitMs: WAIT_MS,
      exclude,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Could not read the verification mailbox.", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ success: false, message: "QTS could not read the verification mailbox. Try again." }, { status: 500 });
  }
}
