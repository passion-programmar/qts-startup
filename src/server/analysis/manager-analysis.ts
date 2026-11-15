import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { analysisRanges, analysisZones, windowStartOffset, type AnalysisView } from "./analysis-values";

// The Manager's Overview: bids and interview rounds per day of a week, per month or per year, the
// window before it for comparison, how the rounds went, how far jobs got (Intro → Tech → Final →
// Offer), and today's bids. Days count in the chosen zone (Japan by default); weeks start on Monday.
// Nothing after today counts: the current week, month or year runs up to the end of today, so later
// days are not shown and interviews booked after today are left out. One database trip.

export type AnalysisPoint = { start: string; bids: number; interviews: number };
export type ManagerAnalysis = {
  points: AnalysisPoint[];
  results: { waiting: number; passed: number; rejected: number; no_show: number };
  bidsWithInterview: number;
  // The same length of time just before the window, cut at the same day (this week up to today is
  // compared with last week up to the same weekday).
  previous: { bids: number; interviews: number };
  // Jobs with a round in the window, by the furthest step they reached up to today.
  steps: { intro: number; tech: number; final: number; offer: number };
  today: { bids: number; interviews: number };
};

type Row = {
  series: [string, number, number][] | null;
  results: ManagerAnalysis["results"] | null;
  bids_with_interview: number | null;
  previous: ManagerAnalysis["previous"] | null;
  steps: ManagerAnalysis["steps"] | null;
  today: ManagerAnalysis["today"] | null;
};

export async function readManagerAnalysis(managerId: string, view: AnalysisView): Promise<ManagerAnalysis> {
  const { anchor, bucket: unit, step, count } = analysisRanges[view.range];
  const tz = analysisZones[view.zone].zone;
  // The window is `count` periods in the zone's local time (a week's 7 days, or the last 12 months
  // or 5 years with the current one included), cut at the end of today. Every read goes through a
  // (manager, time) index.
  const result = await db.execute<Row>(sql`
    with start as (
      select date_trunc(${anchor}::text, now() at time zone ${tz}::text) - ${windowStartOffset(view)}::interval as first_local,
        date_trunc('day', now() at time zone ${tz}::text) as today_local,
        ${count}::int * ${step}::interval as span
    ),
    win as (
      select first_local, least(first_local + span, today_local + interval '1 day') as cut_local,
        first_local at time zone ${tz}::text as from_at,
        least(first_local + span, today_local + interval '1 day') at time zone ${tz}::text as to_at,
        (first_local - span) at time zone ${tz}::text as prev_from_at,
        (least(first_local + span, today_local + interval '1 day') - span) at time zone ${tz}::text as prev_to_at,
        today_local at time zone ${tz}::text as today_at,
        (today_local + interval '1 day') at time zone ${tz}::text as tomorrow_at
      from start
    ),
    -- Periods that have started by today; later days of this week are left off the chart.
    periods as (
      select p from win, generate_series(first_local, first_local + (${count - 1}::int * ${step}::interval), ${step}::interval) as p
      where p < cut_local
    ),
    b as (
      select date_trunc(${unit}::text, bids.applied_at at time zone ${tz}::text) as p, count(*)::int as n
      from bids, win
      where bids.manager_id = ${managerId} and bids.applied_at >= win.from_at and bids.applied_at < win.to_at
      group by 1
    ),
    rounds as (
      select interviews.starts_at, interviews.result, interviews.track_id
      from interviews, win
      where interviews.manager_id = ${managerId} and interviews.starts_at >= win.from_at and interviews.starts_at < win.to_at
    ),
    i as (
      select date_trunc(${unit}::text, starts_at at time zone ${tz}::text) as p, count(*)::int as n
      from rounds
      group by 1
    ),
    -- Each job (track) with a round in the window and the furthest step it reached: 1 Intro … 4 Offer.
    tracks as (
      select max(array_position(array['intro', 'tech', 'final', 'offer'], interviews.step::text)) as top
      from interviews
      where interviews.manager_id = ${managerId} and interviews.track_id in (select track_id from rounds)
        and interviews.starts_at < (select to_at from win)
      group by interviews.track_id
    )
    select
      (select json_agg(json_build_array(to_char(periods.p, 'YYYY-MM-DD'), coalesce(b.n, 0), coalesce(i.n, 0)) order by periods.p)
        from periods left join b on b.p = periods.p left join i on i.p = periods.p) as series,
      (select json_build_object(
          'waiting', count(*) filter (where result = 'waiting'),
          'passed', count(*) filter (where result = 'passed'),
          'rejected', count(*) filter (where result = 'rejected'),
          'no_show', count(*) filter (where result = 'no_show'))
        from rounds) as results,
      -- Bids applied in the window that have at least one round; interviews are few, so start there.
      (select count(distinct interviews.bid_id)::int
        from interviews join bids on bids.id = interviews.bid_id, win
        where interviews.manager_id = ${managerId} and bids.applied_at >= win.from_at and bids.applied_at < win.to_at) as bids_with_interview,
      (select json_build_object(
          'bids', (select count(*)::int from bids where bids.manager_id = ${managerId} and bids.applied_at >= win.prev_from_at and bids.applied_at < win.prev_to_at),
          'interviews', (select count(*)::int from interviews where interviews.manager_id = ${managerId} and interviews.starts_at >= win.prev_from_at and interviews.starts_at < win.prev_to_at))
        from win) as previous,
      (select json_build_object(
          'intro', count(*) filter (where top >= 1),
          'tech', count(*) filter (where top >= 2),
          'final', count(*) filter (where top >= 3),
          'offer', count(*) filter (where top >= 4))
        from tracks) as steps,
      (select json_build_object(
          'bids', (select count(*)::int from bids where bids.manager_id = ${managerId} and bids.applied_at >= win.today_at and bids.applied_at < win.tomorrow_at),
          'interviews', (select count(*)::int from interviews where interviews.manager_id = ${managerId} and interviews.starts_at >= win.today_at and interviews.starts_at < win.tomorrow_at))
        from win) as today
  `);
  const row = result.rows[0];
  return {
    points: (row?.series ?? []).map(([start, bids, interviews]) => ({ start, bids, interviews })),
    results: row?.results ?? { waiting: 0, passed: 0, rejected: 0, no_show: 0 },
    bidsWithInterview: row?.bids_with_interview ?? 0,
    previous: row?.previous ?? { bids: 0, interviews: 0 },
    steps: row?.steps ?? { intro: 0, tech: 0, final: 0, offer: 0 },
    today: row?.today ?? { bids: 0, interviews: 0 },
  };
}
