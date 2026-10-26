import "server-only";

import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { applyAttempts, bids, candidateSavedAnswers, jobs, profiles, prompts, reusableAnswers, users } from "@/db/schema";
import { db } from "@/lib/db";
import { deliveredGenerationRunId, jobHasBid, markRowsWithBidApplied } from "@/server/jobs/job-bids";
import type { ExtensionBrowser } from "@/server/browsers/extension-browsers";
import {
  APPLY_LEASE_SECONDS,
  APPLY_PARALLEL_LIMIT,
  APPLY_SUBMIT_LEASE_SECONDS,
  type ApplyResultReport,
  coverLetterText,
  normalizeQuestionKey,
} from "./apply-values";
import { type ExchangeRates, loadExchangeRates } from "./exchange-rates";

// Server side of Apply (docs/architecture.md): claims across Chromes, Submit permission exactly
// once, and results that create the bid. Every step checks that the reporting Chrome owns the attempt.

const ABANDONED_AFTER_SUBMIT_REASON =
  "The Chrome stopped after Submit, before the result was known. Check the job site or the candidate's email.";

/**
 * Attempts whose Chrome vanished after Submit become "Submitted - not confirmed" with a bid, so the
 * job is never sent twice and stops counting toward the limit.
 */
async function settleAbandonedSubmissions(managerId: string): Promise<void> {
  const abandoned = await db
    .select({ id: applyAttempts.id })
    .from(applyAttempts)
    .where(and(
      eq(applyAttempts.managerId, managerId),
      eq(applyAttempts.status, "submitting"),
      lt(applyAttempts.leaseExpiresAt, new Date()),
    ));
  for (const attempt of abandoned) {
    await recordApplyResult(attempt.id, managerId, null, {
      result: "not_confirmed",
      reason: ABANDONED_AFTER_SUBMIT_REASON,
      confirmationSource: null,
      screenshotBrowserName: null,
      evidence: null,
    });
  }
}

export type ClaimedApplication = {
  attemptId: string;
  aiMode: "chatgpt" | "gemini";
  job: {
    id: string;
    url: string;
    title: string;
    company: string;
    location: string | null;
    description: string | null;
    generationRunId: string | null;
    // The résumé and cover letter content Generation delivered, so AI answers match what is uploaded.
    documentsJson: string | null;
    // The same cover letter as plain text, for forms that ask for it in a text box.
    coverLetterText: string | null;
  };
  candidate: Record<string, string | number | boolean | null>;
  // The candidate's own saved answers first, then Super Admin's reusable answers for everyone.
  savedAnswers: { questionKey: string; questionText: string; answer: string; note: string | null; scope: "candidate" | "everyone" }[];
  // For salary questions in another currency; null when the ECB is unreachable.
  exchangeRates: ExchangeRates | null;
  // Super Admin's default ChatGPT prompt for application answers; null means Apply's built-in one.
  answerPrompt: { id: string; template: string } | null;
};

/** Super Admin's default ChatGPT prompt for Apply answers (Settings), or null when none is set. */
async function defaultAnswerPrompt(): Promise<{ id: string; template: string } | null> {
  const [row] = await db
    .select({ id: prompts.id, template: prompts.promptTemplate })
    .from(prompts)
    .where(and(
      eq(prompts.provider, "openai"),
      eq(prompts.purpose, "application_answer"),
      eq(prompts.isActive, true),
      eq(prompts.isDefault, true),
      isNull(prompts.ownerManagerId),
      isNull(prompts.archivedAt),
    ))
    .limit(1);
  return row?.template.trim() ? row : null;
}

/** The next application for this Chrome, or null when none is ready or the limit of 3 is reached. */
export async function claimNextApplication(
  managerId: string,
  browser: ExtensionBrowser,
): Promise<ClaimedApplication | null> {
  await settleAbandonedSubmissions(managerId);
  const claim = await db.execute<{ attemptId: string | null }>(sql`
    select claim_apply_attempt(${managerId}, ${browser.id}, ${APPLY_PARALLEL_LIMIT}, ${APPLY_LEASE_SECONDS})::text as "attemptId"
  `);
  const attemptId = claim.rows[0]?.attemptId;
  if (!attemptId) return null;

  const [row] = await db
    .select({
      jobId: jobs.id,
      url: jobs.jobUrl,
      title: jobs.jobTitle,
      company: jobs.company,
      location: jobs.location,
      description: jobs.description,
      generationRunId: sql<string | null>`(
        select r.id from generation_runs r
         where r.job_id = ${jobs.id} and r.status = 'delivered'
         order by r.created_at desc limit 1
      )`,
      documentsJson: sql<string | null>`(
        select left(r.response_json::text, 20000) from generation_runs r
         where r.job_id = ${jobs.id} and r.status = 'delivered'
         order by r.created_at desc limit 1
      )`,
      coverLetter: sql<unknown>`(
        select r.response_json -> 'coverLetter' from generation_runs r
         where r.job_id = ${jobs.id} and r.status = 'delivered'
         order by r.created_at desc limit 1
      )`,
      candidateId: profiles.userId,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      email: profiles.candidateEmail,
      phone: profiles.phone,
      headline: profiles.headline,
      linkedinUrl: profiles.linkedinUrl,
      country: profiles.country,
      city: profiles.city,
      province: profiles.province,
      addressLine1: profiles.addressLine1,
      postalCode: profiles.postalCode,
      yearsOfExperience: profiles.yearsOfExperience,
      githubUrl: profiles.githubUrl,
      portfolioUrl: profiles.portfolioUrl,
      eeoPreference: profiles.eeoPreference,
      nationality: profiles.nationality,
      languages: profiles.languages,
      aiMode: users.applyAiMode,
    })
    .from(applyAttempts)
    .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
    .innerJoin(profiles, eq(profiles.userId, applyAttempts.candidateId))
    .innerJoin(users, eq(users.id, applyAttempts.managerId))
    .where(eq(applyAttempts.id, attemptId))
    .limit(1);
  if (!row) return null;

  const [ownAnswers, sharedAnswers] = await Promise.all([
    db
      .select({
        questionKey: candidateSavedAnswers.questionKey,
        questionText: candidateSavedAnswers.questionText,
        answer: candidateSavedAnswers.answer,
      })
      .from(candidateSavedAnswers)
      .where(eq(candidateSavedAnswers.candidateId, row.candidateId)),
    db
      .select({
        questionKey: reusableAnswers.questionKey,
        questionText: reusableAnswers.questionText,
        answer: reusableAnswers.answer,
        note: reusableAnswers.note,
      })
      .from(reusableAnswers),
  ]);
  const savedAnswers = [
    ...ownAnswers.map((entry) => ({ ...entry, note: null, scope: "candidate" as const })),
    ...sharedAnswers
      .filter((entry) => !ownAnswers.some((own) => own.questionKey === entry.questionKey))
      .map((entry) => ({ ...entry, scope: "everyone" as const })),
  ];

  const { jobId, url, title, company, location, description, generationRunId, documentsJson, coverLetter, aiMode, ...candidate } = row;
  return {
    attemptId,
    aiMode: aiMode === "gemini" ? "gemini" : "chatgpt",
    job: {
      id: jobId,
      url,
      title,
      company,
      location,
      description,
      generationRunId,
      documentsJson,
      coverLetterText: coverLetterText(coverLetter),
    },
    candidate,
    savedAnswers,
    // A reusable salary answer may need converting to another currency.
    exchangeRates: await loadExchangeRates(),
    answerPrompt: await defaultAnswerPrompt(),
  };
}

function ownedBy(attemptId: string, managerId: string, browserId: string) {
  return and(
    eq(applyAttempts.id, attemptId),
    eq(applyAttempts.managerId, managerId),
    eq(applyAttempts.browserId, browserId),
  );
}

/** Renews this Chrome's claim; false when the attempt is no longer its own (for example after a long sleep). */
export async function renewApplyAttempt(attemptId: string, managerId: string, browserId: string): Promise<boolean> {
  const now = Date.now();
  const updated = await db
    .update(applyAttempts)
    .set({
      leaseExpiresAt: sql`case when ${applyAttempts.status} = 'submitting'
        then ${new Date(now + APPLY_SUBMIT_LEASE_SECONDS * 1000)}
        else ${new Date(now + APPLY_LEASE_SECONDS * 1000)} end`,
      updatedAt: new Date(now),
    })
    .where(and(
      ownedBy(attemptId, managerId, browserId),
      inArray(applyAttempts.status, ["claimed", "submitting"]),
      sql`${applyAttempts.leaseExpiresAt} > now()`,
    ))
    .returning({ id: applyAttempts.id });
  return updated.length > 0;
}

/**
 * Gives a claimed job back before Submit. skip=true keeps it from being claimed again (a site Apply
 * does not support yet, or one the Manager must handle); otherwise it returns to the ready list.
 */
export async function releaseApplyAttempt(
  attemptId: string,
  managerId: string,
  browserId: string,
  reason: string,
  skip: boolean,
  dryRun = false,
): Promise<boolean> {
  // A test-mode run stopped before Submit on purpose: it leaves no trace, so it does not count
  // against the job's two returns.
  if (dryRun) {
    const removed = await db
      .delete(applyAttempts)
      .where(and(ownedBy(attemptId, managerId, browserId), eq(applyAttempts.status, "claimed")))
      .returning({ id: applyAttempts.id });
    return removed.length > 0;
  }
  const updated = await db
    .update(applyAttempts)
    .set({
      status: skip ? "skipped" : "released",
      resultReason: reason.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(ownedBy(attemptId, managerId, browserId), eq(applyAttempts.status, "claimed")))
    .returning({ id: applyAttempts.id });
  return updated.length > 0;
}

/**
 * Submit permission, granted once per job and only to the Chrome that owns a live claim on a job
 * without a bid. After this the job is never handed out again.
 */
export async function grantSubmitPermission(attemptId: string, managerId: string, browserId: string): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(applyAttempts)
    .set({
      status: "submitting",
      submitGrantedAt: now,
      leaseExpiresAt: new Date(now.getTime() + APPLY_SUBMIT_LEASE_SECONDS * 1000),
      updatedAt: now,
    })
    .where(and(
      ownedBy(attemptId, managerId, browserId),
      eq(applyAttempts.status, "claimed"),
      sql`${applyAttempts.leaseExpiresAt} > now()`,
      sql`exists (select 1 from ${jobs} where ${jobs.id} = ${applyAttempts.jobId}
        and ${jobs.status} <> 'applied' and not ${jobHasBid()})`,
    ))
    .returning({ id: applyAttempts.id });
  return updated.length > 0;
}

/**
 * Records the result of a submitted application. Confirmed and not-confirmed results create the
 * bid (marked not confirmed when unsure) so the job is Applied and never sent twice; failed ones
 * leave the job for the Manager. browserId null settles an abandoned attempt on the server.
 */
export async function recordApplyResult(
  attemptId: string,
  managerId: string,
  browserId: string | null,
  report: ApplyResultReport,
): Promise<boolean> {
  const [attempt] = await db
    .select({
      jobId: applyAttempts.jobId,
      candidateId: applyAttempts.candidateId,
      jobUrl: jobs.jobUrl,
      jobTitle: jobs.jobTitle,
      company: jobs.company,
      titleCompanyKey: jobs.titleCompanyKey,
      location: jobs.location,
      employmentType: jobs.employmentType,
      workplaceType: jobs.workplaceType,
      salary: jobs.salary,
      resumeLocalPath: jobs.resumeLocalPath,
      googleDrivePath: jobs.googleDrivePath,
      promptId: jobs.promptId,
      pdfTemplate: jobs.pdfTemplate,
    })
    .from(applyAttempts)
    .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
    .where(and(
      eq(applyAttempts.id, attemptId),
      eq(applyAttempts.managerId, managerId),
      eq(applyAttempts.status, "submitting"),
      ...(browserId ? [eq(applyAttempts.browserId, browserId)] : []),
    ))
    .limit(1);
  if (!attempt) return false;

  const now = new Date();
  const settled = db
    .update(applyAttempts)
    .set({
      status: report.result,
      resultReason: report.reason,
      confirmationSource: report.confirmationSource,
      screenshotBrowserName: report.screenshotBrowserName,
      evidence: report.evidence,
      finishedAt: now,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(eq(applyAttempts.id, attemptId), eq(applyAttempts.status, "submitting")))
    .returning({ id: applyAttempts.id });

  if (report.result === "failed" || !attempt.resumeLocalPath) {
    const [done] = await settled;
    return Boolean(done);
  }

  const [[done]] = await db.batch([
    settled,
    db.insert(bids).values({
      sourceJobId: attempt.jobId,
      managerId,
      candidateId: attempt.candidateId,
      jobUrl: attempt.jobUrl,
      jobTitle: attempt.jobTitle,
      company: attempt.company,
      titleCompanyKey: attempt.titleCompanyKey,
      location: attempt.location,
      employmentType: attempt.employmentType,
      workplaceType: attempt.workplaceType,
      salary: attempt.salary,
      resumeLocalPath: attempt.resumeLocalPath,
      googleDrivePath: attempt.googleDrivePath,
      generationRunId: deliveredGenerationRunId(attempt.jobId),
      promptId: attempt.promptId,
      pdfTemplate: attempt.pdfTemplate,
      confirmationStatus: report.result === "confirmed" ? "confirmed" : "not_confirmed",
      confirmationSource: report.confirmationSource,
      applyAttemptId: attemptId,
      applyEvidence: report.evidence,
      screenshotBrowserName: report.screenshotBrowserName,
    }).onConflictDoNothing({ target: bids.sourceJobId }),
    markRowsWithBidApplied(managerId, attempt.candidateId),
  ]);
  return Boolean(done);
}

/** A confirmation that arrived after the result was recorded (a late email) upgrades the bid. */
export async function confirmLateApplication(
  attemptId: string,
  managerId: string,
  source: "page" | "email",
): Promise<boolean> {
  const now = new Date();
  const [[attempt]] = await db.batch([
    db
      .update(applyAttempts)
      .set({ status: "confirmed", confirmationSource: source, updatedAt: now })
      .where(and(
        eq(applyAttempts.id, attemptId),
        eq(applyAttempts.managerId, managerId),
        eq(applyAttempts.status, "not_confirmed"),
      ))
      .returning({ id: applyAttempts.id }),
    db
      .update(bids)
      .set({ confirmationStatus: "confirmed", confirmationSource: source, updatedAt: now })
      .where(and(
        eq(bids.applyAttemptId, attemptId),
        eq(bids.managerId, managerId),
        eq(bids.confirmationStatus, "not_confirmed"),
      )),
  ]);
  return Boolean(attempt);
}

const MAX_SAVED_ANSWER_LENGTH = 5000;

/** Saves the answers a submitted application used, so the next form asking the same question needs no AI. */
export async function saveCandidateAnswers(
  managerId: string,
  attemptId: string,
  answers: { question: string; answer: string; source: "manager" | "ai" }[],
): Promise<number> {
  const [attempt] = await db
    .select({ candidateId: applyAttempts.candidateId })
    .from(applyAttempts)
    .where(and(
      eq(applyAttempts.id, attemptId),
      eq(applyAttempts.managerId, managerId),
      inArray(applyAttempts.status, ["confirmed", "not_confirmed"]),
    ))
    .limit(1);
  if (!attempt) return 0;
  const rows = answers
    .map((entry) => ({
      candidateId: attempt.candidateId,
      questionKey: normalizeQuestionKey(entry.question),
      questionText: entry.question.replace(/\s+/g, " ").trim().slice(0, 500),
      answer: entry.answer.trim().slice(0, MAX_SAVED_ANSWER_LENGTH),
      source: entry.source,
    }))
    .filter((row) => row.questionKey && row.answer);
  if (!rows.length) return 0;
  await db
    .insert(candidateSavedAnswers)
    .values(rows)
    .onConflictDoUpdate({
      target: [candidateSavedAnswers.candidateId, candidateSavedAnswers.questionKey],
      set: {
        questionText: sql`excluded.question_text`,
        answer: sql`excluded.answer`,
        source: sql`excluded.source`,
        updatedAt: new Date(),
      },
    });
  return rows.length;
}
