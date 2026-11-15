// One job of a candidate's profile, as the AI sees it. Months are "YYYY-MM"; a missing month or
// an empty text is null. The description is cut to keep the request small.
export type CareerTimelineEntry = {
  jobTitle: string;
  companyName?: string | null;
  location?: string | null;
  start: string | null;
  end: string | null;
  isCurrent: boolean;
  description?: string | null;
};

// A candidate with no job titles cannot be matched, so the AI is never asked about them.
export function candidatesWithCareerTimeline<
  T extends { employmentTimeline: CareerTimelineEntry[] },
>(candidates: T[]): T[] {
  return candidates.filter((candidate) => candidate.employmentTimeline.length > 0);
}
