// One job of a candidate's profile, as the AI sees it: the title and when, nothing else.
// Months are "YYYY-MM"; a missing month is null.
export type CareerTimelineEntry = {
  jobTitle: string;
  start: string | null;
  end: string | null;
  isCurrent: boolean;
};

// A candidate with no job titles cannot be matched, so the AI is never asked about them.
export function candidatesWithCareerTimeline<
  T extends { employmentTimeline: CareerTimelineEntry[] },
>(candidates: T[]): T[] {
  return candidates.filter((candidate) => candidate.employmentTimeline.length > 0);
}
