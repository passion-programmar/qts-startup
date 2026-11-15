import "server-only";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { bids, callers, categories, interviews, profiles, settings, users } from "@/db/schema";
import { db } from "@/lib/db";
import { likePattern } from "@/server/jobs/jobs-list-query";
import { defaultInterviewSettings, interviewSettingsKey, parseInterviewSettings, type InterviewSettings } from "./interview-values";
import type { InterviewSearchField, InterviewsQuery } from "./interviews-query";
import type { InterviewStep } from "./interview-values";

// The Interviews page reads today's rounds, the calendar's rounds (or one page of the List), and the
// counts at the same time. Day bounds are moments the page works out in the Manager's zone.

const rowColumns = {
  id: interviews.id,
  trackId: interviews.trackId,
  bidId: interviews.bidId,
  candidateId: interviews.candidateId,
  firstName: profiles.firstName,
  lastName: profiles.lastName,
  candidateBlocked: users.blockedAt,
  category: interviews.category,
  appliedAt: interviews.appliedAt,
  company: interviews.company,
  jobTitle: interviews.jobTitle,
  jobUrl: interviews.jobUrl,
  interviewer: interviews.interviewer,
  callerId: interviews.callerId,
  callerName: callers.name,
  callerLabel: callers.label,
  step: interviews.step,
  result: interviews.result,
  startsAt: interviews.startsAt,
  endsAt: interviews.endsAt,
  meetingLink: interviews.meetingLink,
  comment: interviews.comment,
};
export type InterviewRow = Awaited<ReturnType<typeof readRange>>[number];

const accountName = sql`concat_ws(' ', ${profiles.firstName}, ${profiles.lastName})`;

function searchCondition(field: InterviewSearchField, words: string): SQL | undefined {
  if (!words.trim()) return undefined;
  const pattern = likePattern(words.trim());
  const byField: Record<Exclude<InterviewSearchField, "all">, SQL | undefined> = {
    account: sql`${accountName} ilike ${pattern}`,
    company: ilike(interviews.company, pattern),
    interviewer: ilike(interviews.interviewer, pattern),
    comment: ilike(interviews.comment, pattern),
  };
  return field === "all" ? or(...Object.values(byField)) : byField[field];
}

/** Rounds that overlap [from, to), in time order. */
function readRange(managerId: string, from: Date, to: Date) {
  return db.select(rowColumns).from(interviews)
    .innerJoin(profiles, eq(profiles.userId, interviews.candidateId))
    .innerJoin(users, eq(users.id, interviews.candidateId))
    .leftJoin(callers, eq(callers.id, interviews.callerId))
    .where(and(eq(interviews.managerId, managerId), lt(interviews.startsAt, to), gt(interviews.endsAt, from)))
    .orderBy(asc(interviews.startsAt), asc(interviews.createdAt));
}

export type DayBounds = { todayStart: Date; todayEnd: Date };

/** Today's rounds, and the calendar's rounds between from and to. */
export async function readCalendar(managerId: string, bounds: DayBounds, from: Date, to: Date) {
  const [todayRows, rows] = await Promise.all([
    readRange(managerId, bounds.todayStart, bounds.todayEnd),
    readRange(managerId, from, to),
  ]);
  return { todayRows, rows };
}

/** Today's rounds, one page of the List's view, and the counts for its view buttons. */
export async function readInterviewsPage(managerId: string, query: InterviewsQuery, bounds: DayBounds) {
  const filters = and(
    eq(interviews.managerId, managerId),
    query.step !== "all" ? eq(interviews.step, query.step) : undefined,
    query.candidate !== "all" ? eq(interviews.candidateId, query.candidate) : undefined,
    searchCondition(query.field, query.q),
  );
  // Upcoming starts after today (today has its own list); Past started before it; All is every day.
  const upcoming = gte(interviews.startsAt, bounds.todayEnd);
  const past = lt(interviews.startsAt, bounds.todayStart);
  const viewCondition = query.view === "upcoming" ? upcoming : query.view === "past" ? past : undefined;
  const order = query.view === "upcoming"
    ? [asc(interviews.startsAt), asc(interviews.id)]
    : [desc(interviews.startsAt), desc(interviews.id)];
  const pageRows = (page: number) => db.select(rowColumns).from(interviews)
    .innerJoin(profiles, eq(profiles.userId, interviews.candidateId))
    .innerJoin(users, eq(users.id, interviews.candidateId))
    .leftJoin(callers, eq(callers.id, interviews.callerId))
    .where(and(filters, viewCondition))
    .orderBy(...order)
    .limit(query.size)
    .offset((page - 1) * query.size);

  const [todayRows, [counts], rows] = await Promise.all([
    readRange(managerId, bounds.todayStart, bounds.todayEnd),
    db.select({
      upcoming: sql<number>`(count(*) filter (where ${upcoming}))::int`,
      past: sql<number>`(count(*) filter (where ${past}))::int`,
      all: sql<number>`count(*)::int`,
    }).from(interviews).innerJoin(profiles, eq(profiles.userId, interviews.candidateId)).where(filters),
    pageRows(query.page),
  ]);
  const viewCounts = { upcoming: counts?.upcoming ?? 0, past: counts?.past ?? 0, all: counts?.all ?? 0 };
  const total = viewCounts[query.view];
  const lastPage = Math.max(1, Math.ceil(total / query.size));
  // A page past the end (rounds deleted, or an old link) shows the last page instead.
  const page = Math.min(query.page, lastPage);
  return { todayRows, rows: page === query.page ? rows : await pageRows(page), total, page, viewCounts };
}

/** The Manager's calendar settings (zone, second zone, default length). */
export async function readInterviewSettings(managerId: string): Promise<InterviewSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, interviewSettingsKey(managerId))).limit(1);
  return row ? parseInterviewSettings(row.value) : defaultInterviewSettings;
}

/**
 * How many rounds start today in the Manager's zone, for the sidebar: one query that reads the zone
 * from the settings as well.
 */
export async function countTodayInterviews(managerId: string): Promise<number> {
  const zone = sql`coalesce((select ${settings.value}->>'timeZone' from ${settings} where ${settings.key} = ${interviewSettingsKey(managerId)}), ${defaultInterviewSettings.timeZone})`;
  const dayStart = sql`(date_trunc('day', now() at time zone ${zone}) at time zone ${zone})`;
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(interviews)
    .where(and(
      eq(interviews.managerId, managerId),
      sql`${interviews.startsAt} >= ${dayStart}`,
      sql`${interviews.startsAt} < ${dayStart} + interval '1 day'`,
    ));
  return row?.count ?? 0;
}

export type BidChoice = {
  id: string;
  candidateId: string;
  candidateName: string;
  category: string | null;
  appliedAt: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
};

const bidChoiceColumns = {
  id: bids.id,
  candidateId: bids.candidateId,
  firstName: profiles.firstName,
  lastName: profiles.lastName,
  category: categories.name,
  appliedAt: bids.appliedAt,
  company: bids.company,
  jobTitle: bids.jobTitle,
  jobUrl: bids.jobUrl,
};

function toBidChoice(row: { id: string; candidateId: string; firstName: string | null; lastName: string | null; category: string | null; appliedAt: Date; company: string; jobTitle: string; jobUrl: string }): BidChoice {
  return {
    id: row.id,
    candidateId: row.candidateId,
    candidateName: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate",
    category: row.category,
    appliedAt: row.appliedAt.toISOString(),
    company: row.company,
    jobTitle: row.jobTitle,
    jobUrl: row.jobUrl,
  };
}

/** Up to 20 of the Manager's bids matching the words (company, job title or account), newest first. */
export async function searchBidChoices(managerId: string, words: string): Promise<BidChoice[]> {
  const pattern = likePattern(words.trim().slice(0, 200));
  const search = words.trim()
    ? or(ilike(bids.company, pattern), ilike(bids.jobTitle, pattern), sql`${accountName} ilike ${pattern}`)
    : undefined;
  const rows = await db.select(bidChoiceColumns).from(bids)
    .innerJoin(profiles, eq(profiles.userId, bids.candidateId))
    .leftJoin(categories, eq(categories.id, profiles.categoryId))
    .where(and(eq(bids.managerId, managerId), search))
    .orderBy(desc(bids.appliedAt), desc(bids.id))
    .limit(20);
  return rows.map(toBidChoice);
}

/** One of the Manager's bids, as the Add window shows it, or null. */
export async function readBidChoice(managerId: string, bidId: string): Promise<BidChoice | null> {
  const [row] = await db.select(bidChoiceColumns).from(bids)
    .innerJoin(profiles, eq(profiles.userId, bids.candidateId))
    .leftJoin(categories, eq(categories.id, profiles.categoryId))
    .where(and(eq(bids.managerId, managerId), eq(bids.id, bidId)))
    .limit(1);
  return row ? toBidChoice(row) : null;
}

/** Every round of one job's track, in time order. */
export function readTrack(managerId: string, trackId: string) {
  return db.select(rowColumns).from(interviews)
    .innerJoin(profiles, eq(profiles.userId, interviews.candidateId))
    .innerJoin(users, eq(users.id, interviews.candidateId))
    .leftJoin(callers, eq(callers.id, interviews.callerId))
    .where(and(eq(interviews.managerId, managerId), eq(interviews.trackId, trackId)))
    .orderBy(asc(interviews.startsAt), asc(interviews.createdAt));
}

/** Whether the track has rounds of this Manager (a new round may join it). */
export async function isManagersTrack(managerId: string, trackId: string): Promise<boolean> {
  const [row] = await db.select({ id: interviews.id }).from(interviews)
    .where(and(eq(interviews.managerId, managerId), eq(interviews.trackId, trackId))).limit(1);
  return Boolean(row);
}

/** The track a bid's rounds already share, if it has any. */
export async function readBidTrack(managerId: string, bidId: string): Promise<string | null> {
  const [row] = await db.select({ trackId: interviews.trackId }).from(interviews)
    .where(and(eq(interviews.managerId, managerId), eq(interviews.bidId, bidId)))
    .orderBy(desc(interviews.startsAt)).limit(1);
  return row?.trackId ?? null;
}

/**
 * By job: one page of the Manager's tracks, latest activity first, with every round of each, and how
 * many tracks there are per status. A track's status comes from its latest round: Ended when that was
 * Rejected or No-show, Offer when it is the Offer round, otherwise In progress.
 */
export async function readTracksPage(managerId: string, query: InterviewsQuery) {
  const latest = db.selectDistinctOn([interviews.trackId], {
    trackId: interviews.trackId,
    candidateId: interviews.candidateId,
    company: interviews.company,
    step: interviews.step,
    result: interviews.result,
    startsAt: interviews.startsAt,
  }).from(interviews)
    .where(eq(interviews.managerId, managerId))
    .orderBy(interviews.trackId, desc(interviews.startsAt), desc(interviews.createdAt))
    .as("latest");
  const ended = sql`${latest.result} in ('rejected', 'no_show')`;
  const offer = sql`not (${ended}) and ${latest.step} = 'offer'`;
  const active = sql`not (${ended}) and ${latest.step} <> 'offer'`;
  const statusCondition = query.status === "ended" ? ended : query.status === "offer" ? offer : query.status === "active" ? active : undefined;
  const words = query.q.trim();
  const pattern = likePattern(words);
  const byAccount = sql`concat_ws(' ', ${profiles.firstName}, ${profiles.lastName}) ilike ${pattern}`;
  const byCompany = sql`${latest.company} ilike ${pattern}`;
  const search = words ? (query.field === "account" ? byAccount : query.field === "company" ? byCompany : or(byAccount, byCompany)) : undefined;
  const filters = and(query.candidate !== "all" ? eq(latest.candidateId, query.candidate) : undefined, search);

  const pageTracks = (page: number) => db.select({ trackId: latest.trackId }).from(latest)
    .innerJoin(profiles, eq(profiles.userId, latest.candidateId))
    .where(and(filters, statusCondition))
    .orderBy(desc(latest.startsAt), desc(latest.trackId))
    .limit(query.size)
    .offset((page - 1) * query.size);
  const [[counts], firstPage] = await Promise.all([
    db.select({
      all: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${active}))::int`,
      offer: sql<number>`(count(*) filter (where ${offer}))::int`,
      ended: sql<number>`(count(*) filter (where ${ended}))::int`,
    }).from(latest).innerJoin(profiles, eq(profiles.userId, latest.candidateId)).where(filters),
    pageTracks(query.page),
  ]);
  const statusCounts = { all: counts?.all ?? 0, active: counts?.active ?? 0, offer: counts?.offer ?? 0, ended: counts?.ended ?? 0 };
  const total = statusCounts[query.status];
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.size)));
  const trackIds = (page === query.page ? firstPage : await pageTracks(page)).map((row) => row.trackId);
  const rounds = trackIds.length
    ? await db.select(rowColumns).from(interviews)
      .innerJoin(profiles, eq(profiles.userId, interviews.candidateId))
      .innerJoin(users, eq(users.id, interviews.candidateId))
      .leftJoin(callers, eq(callers.id, interviews.callerId))
      .where(and(eq(interviews.managerId, managerId), inArray(interviews.trackId, trackIds)))
      .orderBy(asc(interviews.startsAt), asc(interviews.createdAt))
    : [];
  const tracks = trackIds.map((trackId) => ({ trackId, rounds: rounds.filter((round) => round.trackId === trackId) }));
  return { tracks, total, page, statusCounts };
}

/** Earlier rounds of the track still Waiting become Passed when a later step is added. */
export async function passEarlierRounds(managerId: string, trackId: string, step: InterviewStep): Promise<void> {
  await db.update(interviews).set({ result: "passed", updatedAt: new Date() })
    .where(and(
      eq(interviews.managerId, managerId),
      eq(interviews.trackId, trackId),
      eq(interviews.result, "waiting"),
      sql`${interviews.step} < cast(${step} as interview_step)`,
    ));
}

/** Today's rounds only (the By job view shows them above its table). */
export function readTodayRounds(managerId: string, bounds: DayBounds) {
  return readRange(managerId, bounds.todayStart, bounds.todayEnd);
}
