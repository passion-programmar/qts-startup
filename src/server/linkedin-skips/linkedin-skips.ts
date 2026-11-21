import "server-only";

import { and, lt, sql } from "drizzle-orm";
import { linkedinSkips } from "@/db/schema";
import { db } from "@/lib/db";
import { computeTitleCompanyKey } from "@/server/jobs/job-key";

// LinkedIn skip-list: the (title, company) pairs a Manager has seen on LinkedIn's job search. The
// extension keeps a copy in each Chrome and matches cards against it there, so the server is asked
// only for what changed since the Chrome's last look (one query) and gets the marks in batches.

/** Rows not touched for this long are removed by the daily clean-up; bids and jobs older are not sent. */
export const LINKEDIN_SKIP_KEEP_DAYS = 90;
// A change saved in the same moment as the last look is sent again rather than missed.
const OVERLAP_MS = 5_000;
// The first look (a new Chrome) sends at most this many recent bids and jobs each.
const SEEN_LIMIT = 20_000;
const SOURCES = ["clicked", "viewed", "saved", "applied", "manual"] as const;
type SkipSource = (typeof SOURCES)[number];
// Clicked and manual marks undo an un-skip; LinkedIn's own labels never do.
const EXPLICIT: SkipSource[] = ["clicked", "manual"];

export type SkipPair = { title: string; company: string; source: SkipSource };

/** The pairs of a request body: 1–200 { title, company, source? }, trimmed and bounded. Null: invalid. */
export function readSkipPairs(value: unknown, max = 200): SkipPair[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const pairs: SkipPair[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { title, company, source } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof company !== "string") return null;
    const cleanTitle = title.replace(/\s+/g, " ").trim().slice(0, 300);
    const cleanCompany = company.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!cleanTitle || !cleanCompany) return null;
    const cleanSource = typeof source === "string" && (SOURCES as readonly string[]).includes(source) ? source as SkipSource : "manual";
    pairs.push({ title: cleanTitle, company: cleanCompany, source: cleanSource });
  }
  return pairs;
}

export type SkipListChanges = {
  cursor: string;
  full: boolean;
  /** Marked pairs; removed ones were un-skipped (they override a bid or a saved job too). */
  skips: { key: string; removed: boolean }[];
  /** Keys of the Manager's bids (applied) and saved jobs of the last 90 days. */
  seen: string[];
};

type ChangeRow = { kind: "skip" | "seen"; key: string | null; removed: boolean; title: string | null; company: string | null };

/**
 * What changed since `since` (an ISO time from an earlier answer), or everything of the last 90
 * days when it is missing: in one query, the skip rows (un-skips too) and the keys of bids and jobs.
 */
export async function readLinkedInSkipChanges(managerId: string, since: string | null): Promise<SkipListChanges> {
  const now = new Date();
  const sinceDate = since && !Number.isNaN(Date.parse(since)) ? new Date(Date.parse(since) - OVERLAP_MS) : null;
  const floor = new Date(now.getTime() - LINKEDIN_SKIP_KEEP_DAYS * 86_400_000);
  const from = sinceDate && sinceDate > floor ? sinceDate : floor;
  const result = await db.execute<ChangeRow>(sql`
    select 'skip' as kind, skip_key as key, (removed_at is not null) as removed, null as title, null as company
      from linkedin_skips where manager_id = ${managerId} and updated_at > ${from}
    union all
    (select 'seen', title_company_key, false, job_title, company
      from bids where manager_id = ${managerId} and applied_at > ${from}
      order by applied_at desc limit ${SEEN_LIMIT})
    union all
    (select 'seen', title_company_key, false, job_title, company
      from jobs where manager_id = ${managerId} and created_at > ${from}
      order by created_at desc limit ${SEEN_LIMIT})`);
  const skips: SkipListChanges["skips"] = [];
  const seen = new Set<string>();
  for (const row of result.rows) {
    if (row.kind === "skip") {
      if (row.key) skips.push({ key: row.key, removed: row.removed === true });
      continue;
    }
    const key = row.key || computeTitleCompanyKey(row.title ?? "", row.company ?? "");
    if (key) seen.add(key);
  }
  return { cursor: now.toISOString(), full: !sinceDate, skips, seen: [...seen] };
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
  if (adds.length) {
    await db.execute(sql`
      insert into linkedin_skips (manager_id, skip_key, company, job_title, source)
      values ${sql.join(adds.map(([key, pair]) => sql`(${managerId}, ${key}, ${pair.company}, ${pair.title}, ${pair.source})`), sql`, `)}
      on conflict (manager_id, skip_key) do update set
        removed_at = case when excluded.source in (${sql.join(EXPLICIT.map((source) => sql`${source}`), sql`, `)}) then null else linkedin_skips.removed_at end,
        source = case when excluded.source in (${sql.join(EXPLICIT.map((source) => sql`${source}`), sql`, `)}) or linkedin_skips.removed_at is null then excluded.source else linkedin_skips.source end,
        updated_at = case when excluded.source in (${sql.join(EXPLICIT.map((source) => sql`${source}`), sql`, `)}) or linkedin_skips.removed_at is null then now() else linkedin_skips.updated_at end`);
  }
  if (removes.length) {
    await db.execute(sql`
      insert into linkedin_skips (manager_id, skip_key, company, job_title, source, removed_at)
      values ${sql.join(removes.map(([key, pair]) => sql`(${managerId}, ${key}, ${pair.company}, ${pair.title}, 'manual', now())`), sql`, `)}
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
