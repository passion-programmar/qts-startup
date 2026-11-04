import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { applyAttempts, generationRuns, jobs } from "@/db/schema";
import { db } from "@/lib/db";
import { APPLY_DOCUMENT_STATUSES } from "./apply-values";

export type ApplyDocuments = {
  resumePath: string;
  coverLetterPath: string;
};

/**
 * The exact local PDF paths saved by Generation, from the job's latest delivered run. Null when the
 * attempt is not this Chrome's live claim or the job has no delivered local paths.
 */
export async function loadApplyDocumentPaths(
  attemptId: string,
  managerId: string,
  browserId: string,
): Promise<ApplyDocuments | null> {
  const [row] = await db
    .select({
      resumePath: jobs.resumeLocalPath,
      coverLetterPath: jobs.coverLetterLocalPath,
    })
    .from(applyAttempts)
    .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
    .innerJoin(generationRuns, and(eq(generationRuns.jobId, jobs.id), eq(generationRuns.status, "delivered")))
    .where(and(
      eq(applyAttempts.id, attemptId),
      eq(applyAttempts.managerId, managerId),
      eq(applyAttempts.browserId, browserId),
      inArray(applyAttempts.status, [...APPLY_DOCUMENT_STATUSES]),
    ))
    .orderBy(desc(generationRuns.createdAt))
    .limit(1);
  if (!row?.resumePath || !row.coverLetterPath) return null;
  return { resumePath: row.resumePath, coverLetterPath: row.coverLetterPath };
}
