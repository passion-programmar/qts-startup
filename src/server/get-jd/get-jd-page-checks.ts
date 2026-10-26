import "server-only";

import { and, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getJdPageChecks } from "@/db/schema";
import { db } from "@/lib/db";
import { pageCheckKey } from "./page-check-key";

// Get JD's "being checked" mark. When several Chromes open the same job link, the first one asks
// Gemini and the others wait for its verdict, which is replayed for 10 minutes instead of calling
// Gemini again. Try again and Send anyway bypass it.

const CHECKING_TTL_MS = 90_000;
const VERDICT_TTL_MS = 10 * 60_000;
const WAIT_FOR_VERDICT_MS = 25_000;
const POLL_INTERVAL_MS = 2_000;
type Claim = { role: "checker" } | { role: "replay"; result: unknown } | { role: "busy" };

async function claimPageCheck(managerId: string, pageKey: string): Promise<Claim> {
  const deadline = Date.now() + WAIT_FOR_VERDICT_MS;
  for (;;) {
    await db
      .delete(getJdPageChecks)
      .where(and(
        eq(getJdPageChecks.managerId, managerId),
        eq(getJdPageChecks.pageKey, pageKey),
        lt(getJdPageChecks.expiresAt, new Date()),
      ));
    const [created] = await db
      .insert(getJdPageChecks)
      .values({ managerId, pageKey, status: "checking", expiresAt: new Date(Date.now() + CHECKING_TTL_MS) })
      .onConflictDoNothing({ target: [getJdPageChecks.managerId, getJdPageChecks.pageKey] })
      .returning({ id: getJdPageChecks.id });
    if (created) return { role: "checker" };

    const [mark] = await db
      .select({ status: getJdPageChecks.status, result: getJdPageChecks.result })
      .from(getJdPageChecks)
      .where(and(eq(getJdPageChecks.managerId, managerId), eq(getJdPageChecks.pageKey, pageKey)))
      .limit(1);
    if (mark?.status === "done" && mark.result) return { role: "replay", result: mark.result };
    if (Date.now() > deadline) return { role: "busy" };
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function finishPageCheck(managerId: string, pageKey: string, result: unknown): Promise<void> {
  await db
    .update(getJdPageChecks)
    .set({ status: "done", result, expiresAt: new Date(Date.now() + VERDICT_TTL_MS) })
    .where(and(eq(getJdPageChecks.managerId, managerId), eq(getJdPageChecks.pageKey, pageKey)));
}

async function abandonPageCheck(managerId: string, pageKey: string): Promise<void> {
  await db
    .delete(getJdPageChecks)
    .where(and(eq(getJdPageChecks.managerId, managerId), eq(getJdPageChecks.pageKey, pageKey)));
}

/** Runs the Gemini evaluation once per job link across Chromes; others get its verdict. */
export async function withPageCheck(
  managerId: string,
  pageUrl: string,
  bypass: boolean,
  evaluate: () => Promise<NextResponse>,
): Promise<NextResponse> {
  if (bypass) return evaluate();
  const pageKey = pageCheckKey(pageUrl);
  const claim = await claimPageCheck(managerId, pageKey);
  if (claim.role === "replay") {
    return NextResponse.json(
      { ...(claim.result as Record<string, unknown>), replayedFromAnotherChrome: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (claim.role === "busy") {
    return NextResponse.json(
      { success: false, message: "Another Chrome is checking this job right now. Try again in a moment." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  let response: NextResponse;
  try {
    response = await evaluate();
  } catch (error) {
    await abandonPageCheck(managerId, pageKey).catch(() => {});
    throw error;
  }
  const body = response.status === 200 ? await response.clone().json().catch(() => null) : null;
  if (body && (body as { success?: unknown }).success === true) {
    await finishPageCheck(managerId, pageKey, body).catch(() => {});
  } else {
    await abandonPageCheck(managerId, pageKey).catch(() => {});
  }
  return response;
}
