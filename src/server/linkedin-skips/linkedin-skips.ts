import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";
import { linkedinSkips, users } from "@/db/schema";
import { db } from "@/lib/db";
import { computeTitleCompanyKey } from "@/server/jobs/job-key";

// LinkedIn skip-list: the (title, company) pairs a Manager has seen on LinkedIn's job search. QTS is
// its only source of truth; each Chrome keeps a mirror to match cards quickly and asks only for
// what changed since its last look (one query, the Super Admin switch checked in it), and sends its
// marks in batches.

/** Rows not touched for this long are removed by the daily clean-up. */
export const LINKEDIN_SKIP_KEEP_DAYS = 90;
/** A Chrome's first look brings the Manager's bids and saved jobs of this many days. */
export const LINKEDIN_SKIP_FIRST_SEEN_DAYS = 30;
// A change saved in the same moment as the last look is sent again rather than missed.
const OVERLAP_MS = 5_000;
// Upper bound on bids and jobs sent in one answer each.
const SEEN_LIMIT = 20_000;
const SOURCES = ["clicked", "viewed", "saved", "applied", "manual"] as const;
type SkipSource = (typeof SOURCES)[number];
// Clicked and manual marks undo an un-skip; LinkedIn's own labels never do.
const EXPLICIT: SkipSource[] = ["clicked", "manual"];

export type SkipPair = { title: string; company: string; location: string | null; source: SkipSource };

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The pairs of a request body: up to 200 { title, company, location?, source? }. Null: invalid. */
export function readSkipPairs(value: unknown, max = 200): SkipPair[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const pairs: SkipPair[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { title, company, location, source } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof company !== "string") return null;
    const cleanTitle = clean(title, 300);
    const cleanCompany = clean(company, 200);
    if (!cleanTitle || !cleanCompany) return null;
    const cleanSource = typeof source === "string" && (SOURCES as readonly string[]).includes(source) ? source as SkipSource : "manual";
    pairs.push({ title: cleanTitle, company: cleanCompany, location: clean(location, 200) || null, source: cleanSource });
  }
  return pairs;
}

export type SkipEntry = { key: string; source: string; location: string | null; at: string };
export type SkipListChanges = {
  /** The Super Admin turned the skip-list off for this Manager: nothing else is sent. */
  disabled: boolean;
  cursor: string;
  full: boolean;
  /** Marked pairs; removed ones were un-skipped (they override a bid or a saved job too). */
  skips: (SkipEntry & { removed: boolean })[];
  /** The Manager's bids (source qts_applied) and saved jobs (qts_saved). */
  seen: SkipEntry[];
};

type ChangeRow = {
  kind: "off" | "skip" | "bid" | "job";
  key: string | null; removed: boolean; source: string | null; location: string | null;
  at: Date | string | null; title: string | null; company: string | null;
};

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : new Date().toISOString());

/**
 * What changed since \`since\` (an ISO time from an earlier answer), or the whole list when it is
 * missing (skips of the last 90 days, bids and saved jobs of the last 30): in one query, which also
 * says when the Super Admin turned the skip-list off for this Manager.
 */
export async function readLinkedInSkipChanges(managerId: string, since: string | null): Promise<SkipListChanges> {
  const now = new Date();
  const sinceDate = since && !Number.isNaN(Date.parse(since)) ? new Date(Date.parse(since) - OVERLAP_MS) : null;
  const keepFloor = new Date(now.getTime() - LINKEDIN_SKIP_KEEP_DAYS * 86_400_000);
  const seenFloor = new Date(now.getTime() - LINKEDIN_SKIP_FIRST_SEEN_DAYS * 86_400_000);
  const skipsFrom = sinceDate && sinceDate > keepFloor ? sinceDate : keepFloor;
  const seenFrom = sinceDate && sinceDate > seenFloor ? sinceDate : seenFloor;
  const on = sql`exists (select 1 from users where id = ${managerId} and can_use_linkedin_skips)`;
  const result = await db.execute<ChangeRow>(sql`
    select 'off' as kind, null as key, false as removed, null as source, null as location, null as at, null as title, null as company
      from users where id = ${managerId} and not can_use_linkedin_skips
    union all
    select 'skip', skip_key, (removed_at is not null), source, location, updated_at, null, null
      from linkedin_skips where manager_id = ${managerId} and updated_at > ${skipsFrom} and ${on}
    union all
    (select 'bid', title_company_key, false, null, location, applied_at, job_title, company
      from bids where manager_id = ${managerId} and applied_at > ${seenFrom} and ${on}
      order by applied_at desc limit ${SEEN_LIMIT})
    union all
    (select 'job', title_company_key, false, null, location, created_at, job_title, company
      from jobs where manager_id = ${managerId} and created_at > ${seenFrom} and ${on}
      order by created_at desc limit ${SEEN_LIMIT})`);
  const cursor = now.toISOString();
  if (result.rows.some((row) => row.kind === "off")) return { disabled: true, cursor, full: !sinceDate, skips: [], seen: [] };
  const skips: SkipListChanges["skips"] = [];
  const seen = new Map<string, SkipEntry>();
  for (const row of result.rows) {
    if (row.kind === "skip") {
      if (row.key) skips.push({ key: row.key, removed: row.removed === true, source: row.source ?? "manual", location: row.location, at: iso(row.at) });
      continue;
    }
    const key = row.key || computeTitleCompanyKey(row.title ?? "", row.company ?? "");
    // A bid wins over a saved job of the same pair.
    if (key && (!seen.has(key) || row.kind === "bid")) {
      seen.set(key, { key, source: row.kind === "bid" ? "qts_applied" : "qts_saved", location: row.location, at: iso(row.at) });
    }
  }
  return { disabled: false, cursor, full: !sinceDate, skips, seen: [...seen.values()] };
}

/** The Super Admin's switch for this Manager (one small read, before a batch of marks is saved). */
export async function linkedInSkipsAllowed(managerId: string): Promise<boolean> {
  const [row] = await db.select({ on: users.canUseLinkedInSkips }).from(users).where(eq(users.id, managerId)).limit(1);
  return row?.on === true;
}

/**
 * Marks and un-skips from one Chrome, in at most two statements. A mark from LinkedIn's own labels
 * (viewed, saved, applied) never brings back a pair the Manager un-skipped; a click or a manual mark
 * does. An un-skip is kept as a row with removed_at, so it reaches every Chrome.
 */
export async function writeLinkedInSkips(managerId: string, add: SkipPair[], remove: SkipPair[]): Promise<{ added: number; removed: number }> {
  const keyed = (pairs: SkipPair[]) => {
    const byKey = new Map<string, SkipPair>();
    for (const pair of pairs) {
      const key = computeTitleCompanyKey(pair.title, pair.company);
      if (key && key.length <= 600) byKey.set(key, pair);
    }
    return [...byKey];
  };
  const adds = keyed(add);
  const removes = keyed(remove);
  const explicit = sql.join(EXPLICIT.map((source) => sql`${source}`), sql`, `);
  if (adds.length) {
    await db.execute(sql`
      insert into linkedin_skips (manager_id, skip_key, company, job_title, location, source)
      values ${sql.join(adds.map(([key, pair]) => sql`(${managerId}, ${key}, ${pair.company}, ${pair.title}, ${pair.location}, ${pair.source})`), sql`, `)}
      on conflict (manager_id, skip_key) do update set
        removed_at = case when excluded.source in (${explicit}) then null else linkedin_skips.removed_at end,
        source = case when excluded.source in (${explicit}) or linkedin_skips.removed_at is null then excluded.source else linkedin_skips.source end,
        location = coalesce(excluded.location, linkedin_skips.location),
        updated_at = case when excluded.source in (${explicit}) or linkedin_skips.removed_at is null then now() else linkedin_skips.updated_at end`);
  }
  if (removes.length) {
    await db.execute(sql`
      insert into linkedin_skips (manager_id, skip_key, company, job_title, location, source, removed_at)
      values ${sql.join(removes.map(([key, pair]) => sql`(${managerId}, ${key}, ${pair.company}, ${pair.title}, ${pair.location}, 'manual', now())`), sql`, `)}
      on conflict (manager_id, skip_key) do update set removed_at = now(), updated_at = now()`);
  }
  return { added: adds.length, removed: removes.length };
}

/** The daily clean-up's part: skip rows nobody touched for 90 days. */
export async function removeOldLinkedInSkips(): Promise<number> {
  const removed = await db.delete(linkedinSkips)
    .where(and(lt(linkedinSkips.updatedAt, sql`now() - make_interval(days => ${LINKEDIN_SKIP_KEEP_DAYS})`)))
    .returning({ id: linkedinSkips.id });
  return removed.length;
}
