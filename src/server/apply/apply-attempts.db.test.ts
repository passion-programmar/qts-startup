import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { applyAttempts, extensionBrowsers, jobs, profiles, users } from "@/db/schema";
import { APPLY_LEASE_SECONDS, APPLY_REVIEW_LEASE_SECONDS } from "./apply-values";

// renewApplyAttempt against a real Postgres: the lease is a CASE over two dates, which Postgres
// rejected (42804, text into a timestamp) until the dates were cast. Runs only with
// QTS_TEST_DATABASE_URL, an isolated test database (never production); it adds one job with its
// attempts and deletes them again.
const testDatabaseUrl = process.env.QTS_TEST_DATABASE_URL;

async function loadRenewal() {
  process.env.DATABASE_URL = testDatabaseUrl;
  // Next resolves "server-only" to an empty module for server code; do the same here.
  const require = Module.createRequire(__filename);
  const serverOnly = require.resolve("server-only");
  require.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as NodeJS.Module;
  const [{ db }, { renewApplyAttempt }] = await Promise.all([import("@/lib/db"), import("./apply-attempts")]);
  return { db, renewApplyAttempt };
}

test("a heartbeat moves only a live, own claim's lease forward", { skip: !testDatabaseUrl && "QTS_TEST_DATABASE_URL is not set" }, async () => {
  const { db, renewApplyAttempt } = await loadRenewal();
  const [manager] = await db.select({ id: users.id }).from(users).where(eq(users.role, "manager")).limit(1);
  const [browser] = await db.select({ id: extensionBrowsers.id }).from(extensionBrowsers)
    .where(eq(extensionBrowsers.managerId, manager.id)).limit(1);
  const [candidate] = await db.select({ id: profiles.userId }).from(profiles).limit(1);
  assert.ok(manager && browser && candidate, "the test database needs a manager, one of their Chromes and a candidate");

  const marker = randomUUID();
  const [job] = await db.insert(jobs).values({
    managerId: manager.id,
    candidateId: candidate.id,
    jobUrl: `https://example.test/heartbeat/${marker}`,
    jobTitle: `Heartbeat test ${marker}`,
    company: "QTS test",
    date: new Date().toISOString().slice(0, 10),
  }).returning({ id: jobs.id });

  const secondsFromNow = (seconds: number) => new Date(Date.now() + seconds * 1000);
  // One attempt at a time: the job allows a single live attempt.
  async function heartbeat(
    status: string,
    leaseExpiresAt: Date,
    owner: { managerId?: string; browserId?: string } = {},
  ): Promise<{ result: number | null; before: Date; after: Date }> {
    const [attempt] = await db.insert(applyAttempts).values({
      jobId: job.id,
      managerId: manager.id,
      candidateId: candidate.id,
      browserId: browser.id,
      status,
      leaseExpiresAt,
      submitGrantedAt: ["waiting_confirmation", "submitting", "confirmed", "not_confirmed"].includes(status) ? new Date() : null,
    }).returning({ id: applyAttempts.id });
    try {
      const result = await renewApplyAttempt(attempt.id, owner.managerId ?? manager.id, owner.browserId ?? browser.id);
      const [row] = await db.select({ leaseExpiresAt: applyAttempts.leaseExpiresAt }).from(applyAttempts)
        .where(eq(applyAttempts.id, attempt.id));
      return { result, before: leaseExpiresAt, after: row.leaseExpiresAt! };
    } finally {
      await db.delete(applyAttempts).where(and(eq(applyAttempts.id, attempt.id), eq(applyAttempts.jobId, job.id)));
    }
  }
  // Within a few seconds of the expected lease, allowing for the round trips.
  const near = (actual: Date, seconds: number) =>
    Math.abs(actual.getTime() - Date.now() - seconds * 1000) < 15_000;

  try {
    const claimed = await heartbeat("claimed", secondsFromNow(30));
    assert.equal(claimed.result, APPLY_LEASE_SECONDS);
    assert.ok(claimed.after > claimed.before, "an active claim's lease moves forward");
    assert.ok(near(claimed.after, APPLY_LEASE_SECONDS));

    const review = await heartbeat("waiting_review", secondsFromNow(30));
    assert.equal(review.result, APPLY_REVIEW_LEASE_SECONDS);
    assert.ok(near(review.after, APPLY_REVIEW_LEASE_SECONDS), "waiting for the Manager holds longer");

    // Waiting for the Manager's Yes/No stays answerable after its hold ran out (existing rule).
    const confirmation = await heartbeat("waiting_confirmation", secondsFromNow(-60));
    assert.equal(confirmation.result, APPLY_REVIEW_LEASE_SECONDS);

    const refused: Array<[string, () => ReturnType<typeof heartbeat>]> = [
      ["expired claim", () => heartbeat("claimed", secondsFromNow(-10))],
      ["expired review", () => heartbeat("waiting_review", secondsFromNow(-10))],
      ...["released", "skipped", "cleared", "failed", "confirmed", "not_confirmed", "submitting"]
        .map((status): [string, () => ReturnType<typeof heartbeat>] => [status, () => heartbeat(status, secondsFromNow(30))]),
      ["another Manager", () => heartbeat("claimed", secondsFromNow(30), { managerId: randomUUID() })],
      ["another Chrome", () => heartbeat("claimed", secondsFromNow(30), { browserId: randomUUID() })],
    ];
    for (const [label, run] of refused) {
      const outcome = await run();
      assert.equal(outcome.result, null, `${label}: not renewed`);
      assert.equal(outcome.after.getTime(), outcome.before.getTime(), `${label}: lease unchanged`);
    }
  } finally {
    await db.delete(jobs).where(eq(jobs.id, job.id));
  }
});
