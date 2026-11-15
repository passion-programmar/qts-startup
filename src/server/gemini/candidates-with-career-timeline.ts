import { type SQL, sql } from "drizzle-orm";

// One job of a candidate's profile, as the AI sees it: the title, the company and the months
// ("YYYY-MM"). Only the current job has isCurrent (true) and no end; a previous job has its end.
// A missing company or month is left out. Matching uses job titles only, so nothing else is sent.
export type CareerTimelineEntry = {
  jobTitle: string;
  companyName?: string;
  start?: string;
  end?: string;
  isCurrent?: true;
};

/** The candidate's jobs as CareerTimelineEntry JSON, current first, then newest first. */
export function careerTimelineSql(profileUserId: SQL | unknown): SQL<CareerTimelineEntry[]> {
  return sql<CareerTimelineEntry[]>`coalesce((
    select json_agg(json_strip_nulls(json_build_object(
        'jobTitle', btrim(e.job_title),
        'companyName', nullif(btrim(e.company_name), ''),
        'start', to_char(e.start_date, 'YYYY-MM'),
        'end', case when e.is_current then null else to_char(e.end_date, 'YYYY-MM') end,
        'isCurrent', case when e.is_current then true end
      )) order by e.is_current desc, e.end_date desc nulls first, e.start_date desc nulls last, e.sort_order asc)
      from experiences e
     where e.profile_user_id = ${profileUserId} and btrim(e.job_title) <> ''
  ), '[]'::json)`;
}

// A candidate with no job titles cannot be matched, so the AI is never asked about them.
export function candidatesWithCareerTimeline<
  T extends { employmentTimeline: CareerTimelineEntry[] },
>(candidates: T[]): T[] {
  return candidates.filter((candidate) => candidate.employmentTimeline.length > 0);
}
