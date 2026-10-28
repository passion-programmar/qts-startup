import "server-only";

import { and, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { jobs } from "@/db/schema";

// Generation records nothing on a job until its files are downloaded: then the job is "completed".
// While a Chrome works on a job, the job carries only a short hold (generation_lease_expires_at and
// generation_browser_id), renewed by the Chrome's checks every few seconds, so no other Chrome
// takes it. A closed tab or Chrome, a cancel, or a failure leaves the job as it was, ready to be
// generated again; a hold nobody renews lapses by itself.

/** How long a hold lasts without a renewal. */
export const GENERATION_HOLD_MS = 5 * 60 * 1000;

export const holdUntil = (now: Date = new Date()) => new Date(now.getTime() + GENERATION_HOLD_MS);

/** A Chrome is generating the job now. */
export const generationHeld = (now: Date = new Date()) => and(
  gt(jobs.generationLeaseExpiresAt, now),
  ne(jobs.generationStatus, "completed"),
);

/** No Chrome is generating the job (never held, or the hold lapsed). */
export const generationFree = (now: Date = new Date()) => or(
  isNull(jobs.generationLeaseExpiresAt),
  lte(jobs.generationLeaseExpiresAt, now),
);

/** The same as generationHeld, for raw SQL conditions: a job being generated is not deleted. */
export const generationHeldSql = () =>
  sql`(${jobs.generationLeaseExpiresAt} > now() and ${jobs.generationStatus} <> 'completed')`;
