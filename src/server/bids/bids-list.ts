import "server-only";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { bids, categories, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { ROMANIA_TIME_ZONE } from "@/lib/romania-time";
import { likePattern } from "@/server/jobs/jobs-list-query";

// The Bids page reads one page of bids at a time, searched on the server, so it stays fast however many
// bids a Manager has. A bid's submitted answers load only when its View window opens.

export const bidSearchFields = [
  { key: "candidate", label: "Candidate" },
  { key: "source", label: "Source URL" },
  { key: "title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "created", label: "Date" },
] as const;
export type BidSearchField = "all" | (typeof bidSearchFields)[number]["key"];

const bidPageSizes = [10, 25, 50];
export const defaultBidPageSize = 25;

export type BidsQuery = { field: BidSearchField; q: string; page: number; size: number };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Reads the page address; anything unknown falls back to the default. */
export function parseBidsQuery(raw: Record<string, string | string[] | undefined>): BidsQuery {
  const field = first(raw.field);
  const page = Number.parseInt(first(raw.page), 10);
  const size = Number.parseInt(first(raw.size), 10);
  return {
    field: bidSearchFields.some((entry) => entry.key === field) ? field as BidSearchField : "all",
    q: first(raw.q).slice(0, 200),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    size: bidPageSizes.includes(size) ? size : defaultBidPageSize,
  };
}

// "2026/11/15", the date the table shows (Romania time).
const createdDay = sql`to_char(${bids.createdAt} at time zone ${ROMANIA_TIME_ZONE}, 'YYYY/MM/DD')`;

function searchCondition(query: BidsQuery): SQL | undefined {
  const words = query.q.trim();
  if (!words) return undefined;
  const pattern = likePattern(words);
  const byField: Record<Exclude<BidSearchField, "all">, SQL> = {
    candidate: sql`concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}) ilike ${pattern}`,
    source: ilike(bids.sourceSiteUrl, pattern),
    title: ilike(bids.jobTitle, pattern),
    company: ilike(bids.company, pattern),
    created: sql`${createdDay} ilike ${pattern}`,
  };
  return query.field === "all" ? or(...Object.values(byField)) : byField[query.field];
}

const listColumns = {
  id: bids.id,
  title: bids.jobTitle,
  company: bids.company,
  location: bids.location,
  workType: bids.workType,
  salary: bids.salary,
  url: bids.jobUrl,
  sourceSiteUrl: bids.sourceSiteUrl,
  appliedAt: bids.appliedAt,
  createdAt: bids.createdAt,
  resumeFolder: bids.resumeFolder,
  resumeSavedOn: bids.resumeSavedOn,
  googleDrivePath: bids.googleDrivePath,
  templateName: bids.templateName,
  promptName: bids.promptName,
  candidateId: bids.candidateId,
  firstName: profiles.firstName,
  lastName: profiles.lastName,
  candidateBlocked: users.blockedAt,
  category: categories.name,
};

/** One page of the Manager's bids, newest first, and how many there are in all and matching the search. */
export async function readBidsPage(managerId: string, query: BidsQuery) {
  const owned = eq(bids.managerId, managerId);
  const search = searchCondition(query);
  const where = search ? and(owned, search) : owned;
  const pageRows = (page: number) => db
    .select(listColumns)
    .from(bids)
    .innerJoin(profiles, eq(profiles.userId, bids.candidateId))
    .innerJoin(users, eq(users.id, bids.candidateId))
    .leftJoin(categories, eq(categories.id, profiles.categoryId))
    .where(where)
    .orderBy(desc(bids.appliedAt), desc(bids.id))
    .limit(query.size)
    .offset((page - 1) * query.size);

  // Both counts in one trip; the rows load at the same time.
  const [[counts], rows] = await Promise.all([
    db.select({
      all: sql<number>`count(*)::int`,
      matching: search ? sql<number>`(count(*) filter (where ${search}))::int` : sql<number>`count(*)::int`,
    })
      .from(bids)
      .innerJoin(profiles, eq(profiles.userId, bids.candidateId))
      .where(owned),
    pageRows(query.page),
  ]);
  const total = counts?.matching ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / query.size));
  // A page past the end (bids moved, or an old link) shows the last page instead.
  if (query.page > lastPage) return { rows: await pageRows(lastPage), total, all: counts?.all ?? 0, page: lastPage };
  return { rows, total, all: counts?.all ?? 0, page: query.page };
}
