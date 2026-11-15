import type { InterviewResult, InterviewStep } from "./interview-values";

// One round as the browser gets it (moments as ISO text), shared by the page, the calendar, the
// windows and the track loader.
export type InterviewRecord = {
  id: string;
  trackId: string;
  bidId: string | null;
  candidateId: string;
  candidateName: string;
  candidateBlocked?: boolean;
  category: string | null;
  appliedAt: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
  interviewer: string | null;
  step: InterviewStep;
  result: InterviewResult;
  // Moments (ISO); shown in the Manager's zone.
  startsAt: string;
  endsAt: string;
  meetingLink: string | null;
  comment: string | null;
  callerId: string | null;
  callerName: string | null;
  callerLabel: string | null;
};

type RoundRow = Omit<InterviewRecord, "candidateName" | "candidateBlocked" | "appliedAt" | "startsAt" | "endsAt"> & {
  firstName: string | null;
  lastName: string | null;
  candidateBlocked: Date | null;
  appliedAt: Date;
  startsAt: Date;
  endsAt: Date;
};

export function toInterviewRecord(row: RoundRow): InterviewRecord {
  return {
    id: row.id,
    trackId: row.trackId,
    bidId: row.bidId,
    candidateId: row.candidateId,
    candidateName: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate",
    candidateBlocked: Boolean(row.candidateBlocked),
    category: row.category,
    appliedAt: row.appliedAt.toISOString(),
    company: row.company,
    jobTitle: row.jobTitle,
    jobUrl: row.jobUrl,
    interviewer: row.interviewer,
    step: row.step,
    result: row.result,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    meetingLink: row.meetingLink,
    comment: row.comment,
    callerId: row.callerId,
    callerName: row.callerName,
    callerLabel: row.callerLabel,
  };
}

/** The latest round of each step in a track (a step can be repeated), and the track's latest round. */
export function summarizeTrack(rounds: InterviewRecord[]): { byStep: Partial<Record<InterviewStep, InterviewRecord & { count: number }>>; latest: InterviewRecord | null } {
  const byStep: Partial<Record<InterviewStep, InterviewRecord & { count: number }>> = {};
  let latest: InterviewRecord | null = null;
  for (const round of rounds) {
    const previous = byStep[round.step];
    if (!previous || previous.startsAt <= round.startsAt) byStep[round.step] = { ...round, count: (previous?.count ?? 0) + 1 };
    else previous.count += 1;
    if (!latest || latest.startsAt <= round.startsAt) latest = round;
  }
  return { byStep, latest };
}
