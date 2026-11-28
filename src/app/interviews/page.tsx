import { asc, eq } from "drizzle-orm";
import { CalendarClock, Video } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PaginatedTable } from "@/app/components/paginated-table";
import { InterviewChoicesProvider } from "@/app/interviews/interview-context";
import { InterviewCalendar } from "@/app/interviews/interview-calendar";
import { InterviewCountdown } from "@/app/interviews/interview-countdown";
import { TrackStepCell } from "@/app/interviews/interview-details";
import { lastStepIndex } from "@/app/interviews/interview-track";
import { TracksFilters } from "@/app/interviews/interview-controls";
import { summarizeTrack, toInterviewRecord, type InterviewRecord } from "@/server/interviews/interview-record";
import { AddInterviewButton, CalendarToolbar, InterviewRowActions, InterviewsFilters, TimeSettingsButton } from "@/app/interviews/interview-controls";
import { Badge } from "@/app/ui/badge";
import { PageHeader } from "@/app/ui/page-header";
import { categories, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { readCallerOptions } from "@/server/callers/callers";
import { readBidChoice, readCalendar, readInterviewSettings, readInterviewsPage, readTodayRounds, readTracksPage } from "@/server/interviews/interviews-list";
import { defaultInterviewPageSize, interviewSearchFields, interviewsFilterParams, parseInterviewsQuery, trackSearchFields, type InterviewsQuery } from "@/server/interviews/interviews-query";
import { interviewSteps, isEndedResult, resultLabel } from "@/server/interviews/interview-values";
import { markTodayRounds, stepClasses, stepLabel } from "@/server/interviews/interview-values";
import { addDays, addMonths, startOfMonth, startOfWeek, timeRange, weekdayOf, zonedDay, zonedMoment, zoneShortName } from "@/server/interviews/zone-time";

export const instant = false;

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Interview rounds of applied jobs, like Google Calendar: today's rounds first as the day's to-do
// list, then a Day / Week / Month calendar, or the List (searched and paged on the server). Times are
// shown and entered in the Manager's chosen zone (Time settings).
export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireUser();
  if (currentUser.role !== "manager") redirect("/");
  const query = parseInterviewsQuery(await searchParams);

  const [settings, candidateRows, categoryRows, startBid, callerOptions] = await Promise.all([
    readInterviewSettings(currentUser.id),
    db.select({ id: profiles.userId, firstName: profiles.firstName, lastName: profiles.lastName, blockedAt: users.blockedAt })
      .from(profiles).innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(users.parentUserId, currentUser.id))
      .orderBy(asc(profiles.firstName), asc(profiles.lastName)),
    db.select({ name: categories.name }).from(categories).orderBy(asc(categories.name)),
    query.add ? readBidChoice(currentUser.id, query.add) : Promise.resolve(null),
    readCallerOptions(currentUser.id),
  ]);
  const zone = settings.timeZone;
  const now = new Date();
  const today = zonedDay(now, zone);
  const bounds = { todayStart: zonedMoment(today, "00:00", zone), todayEnd: zonedMoment(addDays(today, 1), "00:00", zone) };
  const view = calendarView(query, query.date || today);

  const listMode = query.mode === "list";
  const jobsMode = query.mode === "jobs";
  // Today's rounds have their own tab; the other tabs do not read them.
  const todayMode = query.mode === "today";
  const [calendarRows, list, jobs, todayRounds] = await Promise.all([
    !view ? null : readCalendar(currentUser.id, zonedMoment(view.days[0] ?? today, "00:00", zone), zonedMoment(addDays(view.days.at(-1) ?? today, 1), "00:00", zone)),
    listMode ? readInterviewsPage(currentUser.id, query, bounds) : null,
    jobsMode ? readTracksPage(currentUser.id, query) : null,
    todayMode ? readTodayRounds(currentUser.id, bounds) : null,
  ]);
  const todayRows = markTodayRounds((todayRounds ?? []).map(toInterviewRecord), now);
  const left = todayRows.filter((row) => !row.done && !isEndedResult(row.result)).length;
  const candidates = candidateRows.map((row) => ({ id: row.id, name: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate", blocked: Boolean(row.blockedAt) }));
  const choices = { accounts: candidates, categories: categoryRows.map((row) => row.name), callers: callerOptions, settings, today };
  const second = settings.secondTimeZone;

  return (
    <InterviewChoicesProvider value={choices}>
      <main className="py-1">
        <PageHeader
          actions={<><TimeSettingsButton /><AddInterviewButton key={startBid?.id ?? "none"} startBid={startBid} /></>}
          title="Interviews"
        />

        <CalendarToolbar next={view?.next ?? ""} previous={view?.previous ?? ""} query={query} title={view?.title ?? ""} />

        {todayMode && (
        <section aria-labelledby="today-heading" className="mb-6 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50/70 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-900" id="today-heading">
              <CalendarClock aria-hidden="true" className="size-4" />
              Today · {weekdayNames[weekdayOf(today)]} {today}
            </h2>
            <Badge tone={left > 0 ? "primary" : "neutral"}>
              {todayRows.length === 0 ? "None" : `${left} to do · ${todayRows.length} today`}
            </Badge>
          </header>
          {todayRows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-slate-500">No interviews today.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    {["Time", "No", "Account", "Category", "Applied", "Company", "Interviewer", "Caller", "Step", "Comment", ""].map((label, index) => (
                      <th className="whitespace-nowrap px-3 py-3 sm:px-4" key={`${label}-${index}`} scope="col">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {todayRows.map((row, index) => (
                    <tr
                      aria-current={row.next ? "true" : undefined}
                      className={`align-top ${row.next ? "bg-indigo-50/60" : ""} ${row.done ? "text-slate-400" : "text-slate-700"}`}
                      key={row.id}
                    >
                      <td className={`whitespace-nowrap px-3 py-3.5 font-semibold tabular-nums sm:px-4 ${row.next ? "text-indigo-700" : ""}`}>
                        {row.next && <span aria-hidden="true">▶ </span>}{timeRange(row, zone)}
                        {second && <span className="block text-[11px] font-normal text-slate-500">{timeRange(row, second)} {zoneShortName(second, now)}</span>}
                        {/* Counts down to the start, shows the round's progress, then Done; updates itself. */}
                        <InterviewCountdown className="mt-2 font-normal" endsAt={row.endsAt} startsAt={row.startsAt} />
                      </td>
                      <td className="px-3 py-3.5 sm:px-4">{index + 1}</td>
                      {sharedCells(row, zone).map((cell, cellIndex) => <td className="px-3 py-3.5 sm:px-4" key={cellIndex}>{cell}</td>)}
                      <td className="max-w-56 px-3 py-3.5 sm:px-4"><Comment value={row.comment} /></td>
                      <td className="px-3 py-3.5 sm:px-4">
                        <div className="flex items-start gap-2">
                          {row.meetingLink && !row.done && !isEndedResult(row.result) && (
                            <a className="inline-flex h-8 items-center gap-1.5 rounded-control bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700" href={row.meetingLink} rel="noreferrer" target="_blank">
                              <Video aria-hidden="true" className="size-3.5" /> Join
                            </a>
                          )}
                          <InterviewRowActions record={row} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        )}

        {calendarRows && view && (query.mode === "day" || query.mode === "week" || query.mode === "month") && (
          <InterviewCalendar days={view.days} mode={query.mode} month={view.month} query={query} records={calendarRows.map(toInterviewRecord)} />
        )}

        {jobs && (
          <>
            <TracksFilters candidates={candidates} counts={jobs.statusCounts} query={query} />
            <PaginatedTable
              columns={[
                { label: "No", className: "w-[4%]" },
                { label: "Account", className: "w-[12%]" },
                { label: "Company", className: "w-[18%]" },
                ...interviewSteps.map((step) => ({ label: step.label, className: "w-[12%]" })),
                { label: "Status", className: "w-[18%]" },
              ]}
              emptyMessage={query.q || query.candidate !== "all" || query.status !== "all" ? "No jobs match" : "No interviews yet. Add one from an applied job."}
              searchFields={[...trackSearchFields]}
              server={{
                path: "/interviews",
                params: interviewsFilterParams(query),
                total: jobs.total,
                page: jobs.page,
                pageSize: query.size,
                defaultPageSize: defaultInterviewPageSize,
                field: query.field,
                query: query.q,
              }}
              rows={jobs.tracks.map((track, index) => {
                const rounds = track.rounds.map(toInterviewRecord);
                const { byStep, latest } = summarizeTrack(rounds);
                const lastWithRound = lastStepIndex(byStep);
                return {
                  id: track.trackId,
                  cells: [
                    (jobs.page - 1) * query.size + index + 1,
                    latest?.candidateName ?? "—",
                    latest ? (
                      <a className="font-medium text-blue-700 hover:underline" href={latest.jobUrl} key="company" rel="noreferrer" target="_blank" title={latest.jobTitle}>
                        {latest.company}
                        <span className="block text-[11px] font-normal text-slate-500">{latest.jobTitle}</span>
                      </a>
                    ) : "—",
                    ...interviewSteps.map((step, stepIndex) => <TrackStepCell count={byStep[step.key]?.count ?? 0} key={step.key} round={byStep[step.key] ?? null} skipped={stepIndex < lastWithRound} />),
                    latest ? <TrackStatus key="status" latest={latest} /> : "—",
                  ],
                };
              })}
            />
          </>
        )}

        {list && (
          <>
            <InterviewsFilters candidates={candidates} counts={list.viewCounts} query={query} />
            <PaginatedTable
              columns={[
                { label: "No", className: "w-[4%]" },
                { label: "Account", className: "w-[10%]" },
                { label: "Category", className: "w-[8%]" },
                { label: "Applied", className: "w-[8%]" },
                { label: "Company", className: "w-[12%]" },
                { label: "Interviewer", className: "w-[9%]" },
                { label: "Caller", className: "w-[8%]" },
                { label: "Step", className: "w-[6%]" },
                { label: "Date", className: "w-[8%]" },
                { label: "Time", className: "w-[8%]" },
                { label: "Comment", className: "w-[9%]" },
                { label: "Actions", className: "w-[13%]" },
              ]}
              emptyMessage={query.q || query.step !== "all" || query.candidate !== "all"
                ? "No interviews match"
                : query.view === "upcoming" ? "No upcoming interviews after today" : query.view === "past" ? "No past interviews" : "No interviews yet. Add one from an applied job."}
              searchFields={[...interviewSearchFields]}
              server={{
                path: "/interviews",
                params: interviewsFilterParams(query),
                total: list.total,
                page: list.page,
                pageSize: query.size,
                defaultPageSize: defaultInterviewPageSize,
                field: query.field,
                query: query.q,
              }}
              rows={list.rows.map((row, index) => {
                const record = toInterviewRecord(row);
                return {
                  id: row.id,
                  cells: [
                    (list.page - 1) * query.size + index + 1,
                    ...sharedCells(record, zone),
                    <span className="whitespace-nowrap tabular-nums" key="date">{zonedDay(row.startsAt, zone)}</span>,
                    <span className="whitespace-nowrap tabular-nums" key="time">
                      {timeRange(row, zone)}
                      {second && <span className="block text-[11px] text-slate-500">{timeRange(row, second)}</span>}
                    </span>,
                    <Comment key="comment" value={row.comment} />,
                    <div className="flex items-start gap-2" key="actions">
                      {row.meetingLink && row.endsAt > now && !isEndedResult(row.result) && (
                        <a aria-label="Join meeting" className="inline-flex size-8 items-center justify-center rounded-control border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" href={row.meetingLink} rel="noreferrer" target="_blank" title="Join meeting">
                          <Video aria-hidden="true" className="size-3.5" />
                        </a>
                      )}
                      <InterviewRowActions record={record} />
                    </div>,
                  ],
                };
              })}
            />
          </>
        )}
      </main>
    </InterviewChoicesProvider>
  );
}

type CalendarView = { days: string[]; month: string; title: string; previous: string; next: string };

/** The days a Day, Week or Month calendar shows around the anchor day, its title, and ‹ › targets. */
function calendarView(query: InterviewsQuery, anchor: string): CalendarView | null {
  const monthTitle = (day: string) => `${monthNames[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
  if (query.mode === "day") {
    return { days: [anchor], month: anchor.slice(0, 7), title: `${weekdayNames[weekdayOf(anchor)]}, ${Number(anchor.slice(8))} ${monthTitle(anchor)}`, previous: addDays(anchor, -1), next: addDays(anchor, 1) };
  }
  if (query.mode === "week") {
    const start = startOfWeek(anchor);
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
    const end = days[6] ?? start;
    const title = start.slice(0, 7) === end.slice(0, 7)
      ? monthTitle(start)
      : `${monthNames[Number(start.slice(5, 7)) - 1]?.slice(0, 3)} – ${monthNames[Number(end.slice(5, 7)) - 1]?.slice(0, 3)} ${end.slice(0, 4)}`;
    return { days, month: anchor.slice(0, 7), title, previous: addDays(anchor, -7), next: addDays(anchor, 7) };
  }
  if (query.mode === "month") {
    const start = startOfWeek(startOfMonth(anchor));
    return { days: Array.from({ length: 42 }, (_, index) => addDays(start, index)), month: anchor.slice(0, 7), title: monthTitle(anchor), previous: addMonths(anchor, -1), next: addMonths(anchor, 1) };
  }
  return null;
}

// Account, Category, Applied, Company, Interviewer and Step: the same in both tables.
function sharedCells(row: InterviewRecord & { candidateBlocked?: boolean }, zone: string): ReactNode[] {
  return [
    <div key="account">
      <span className="block">{row.candidateName}</span>
      {row.candidateBlocked && <Badge className="mt-1" tone="danger">Blocked</Badge>}
    </div>,
    row.category || "—",
    <span className="whitespace-nowrap text-xs" key="applied">{zonedDay(new Date(row.appliedAt), zone)}</span>,
    <a className="font-medium text-blue-700 hover:underline" href={row.jobUrl} key="company" rel="noreferrer" target="_blank" title={row.jobTitle}>
      {row.company}
      <span className="block text-[11px] font-normal text-slate-500">{row.jobTitle}</span>
    </a>,
    row.interviewer || "—",
    <CallerCell caller={row} key="caller" />,
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${stepClasses[row.step]}`} key="step">{stepLabel(row.step)}</span>,
  ];
}

function CallerCell({ caller }: { caller: Pick<InterviewRecord, "callerName" | "callerLabel"> }): ReactNode {
  if (!caller.callerName) return <span className="text-slate-400">—</span>;
  return (
    <span>
      <span className="block">{caller.callerName}</span>
      {caller.callerLabel && <Badge className="mt-1">{caller.callerLabel}</Badge>}
    </span>
  );
}

function Comment({ value }: { value: string | null }): ReactNode {
  return value ? <span className="line-clamp-3 whitespace-pre-line break-words text-xs" title={value}>{value}</span> : <span className="text-slate-400">—</span>;
}

// Where a job stands, from its latest round.
function TrackStatus({ latest }: { latest: InterviewRecord }): ReactNode {
  const ended = isEndedResult(latest.result);
  const tone = ended ? "danger" : latest.step === "offer" ? "success" : "primary";
  const label = ended ? `Ended at ${stepLabel(latest.step)}` : latest.step === "offer" ? "Offer" : `In ${stepLabel(latest.step)}`;
  return (
    <span>
      <Badge tone={tone}>{label}</Badge>
      <span className="mt-1 block text-[11px] text-slate-500">{stepLabel(latest.step)} · {resultLabel(latest.result)}</span>
    </span>
  );
}
