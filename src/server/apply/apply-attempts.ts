import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  applyAttempts,
  bids,
  educations,
  experiences,
  extensionBrowsers,
  jobs,
  profiles,
  prompts,
  reusableAnswers,
  users,
} from "@/db/schema";
import { db } from "@/lib/db";
import { generationHeldSql } from "@/server/generation/generation-hold";
import { jobHasBid } from "@/server/jobs/job-bids";
import type { ExtensionBrowser } from "@/server/browsers/extension-browsers";
import { isPdfTemplate, pdfTemplateLabels } from "@/server/pdf/pdf-templates";
import {
  APPLY_LEASE_SECONDS,
  APPLY_PARALLEL_LIMIT,
  APPLY_REVIEW_LEASE_SECONDS,
  type AppliedAnswer,
  comparableJobUrl,
  type ApplyRun,
  coverLetterText,
  resumeFolderOf,
  resumeText,
  workTypeOf,
} from "./apply-values";
import { type ExchangeRates, loadExchangeRates } from "./exchange-rates";
import { type RememberedChoice, recordLearnedAnswers, rememberedChoices } from "./question-memory";
import { type LearnedAnswer } from "./question-memory-values";
import { decryptSiteAccountPassword } from "./site-account-password";

// Server side of Apply with Manager review (docs/architecture.md): a Chrome claims a job and fills
// it ("claimed"), the Manager reviews each step ("waiting_review"), clicks the site's Submit
// ("waiting_confirmation"), and answers Yes (the bid is made, the job is Applied) or No (Failed).
// Every Chrome step checks that the reporting Chrome owns the attempt; the Yes/No can also come
// from the Jobs page.

export type ClaimedApplication = {
  attemptId: string;
  aiMode: "chatgpt" | "gemini";
  // Apply clicks Submit itself (Super Admin's per-Manager option); the bid still waits for Yes.
  autoSubmit: boolean;
  // When Apply stops for review (Super Admin, per Manager): every step, or once before Submit.
  reviewMode: ApplyReviewMode;
  job: {
    id: string;
    url: string;
    title: string;
    company: string;
    location: string | null;
    workType: string | null;
    salary: string | null;
    description: string | null;
    // Where Generation saved the résumé and cover letter, and with which prompt and template.
    resumeFolder: string | null;
    resumeSavedOn: string | null;
    promptName: string | null;
    templateName: string | null;
    // The delivered résumé and cover letter as plain text: the AI's source, and the letter for text boxes.
    resumeText: string | null;
    coverLetterText: string | null;
  };
  candidate: Record<string, string | number | boolean | null>;
  // The candidate's experience and education, for the panel on the job page (copied by the Manager).
  profileDetails: { experiences: ProfileExperience[]; educations: ProfileEducation[] };
  // Super Admin's reusable answers, the same for every candidate.
  savedAnswers: { questionKey: string; questionText: string; answer: string; note: string | null; scope: "everyone" }[];
  // For salary questions in another currency; null when the ECB is unreachable.
  exchangeRates: ExchangeRates | null;
  // Which option a value that did not fit became on a known choice list: filled without AI.
  rememberedChoices: RememberedChoice[];
  // Super Admin's default answer prompt for the Manager's AI mode; null means Apply's built-in one.
  answerPrompt: { id: string; template: string } | null;
  // The Manager's password for the candidates' site accounts (My profile), for sign-in and
  // registration pages; null when none is saved. Never shown in the panel.
  siteAccountPassword: string | null;
};

type ProfileExperience = {
  jobTitle: string; companyName: string; location: string | null; workMode: string | null;
  startDate: string | null; endDate: string | null; isCurrent: boolean; description: string | null;
};
type ProfileEducation = {
  institution: string; degree: string | null; fieldOfStudy: string | null;
  startDate: string | null; endDate: string | null; isCurrent: boolean; description: string | null;
};

/** The candidate's experience and education in the profile's order. */
async function profileDetailsOf(candidateId: string): Promise<ClaimedApplication["profileDetails"]> {
  const [experienceRows, educationRows] = await db.batch([
    db
      .select({
        jobTitle: experiences.jobTitle, companyName: experiences.companyName, location: experiences.location,
        workMode: experiences.workMode, startDate: experiences.startDate, endDate: experiences.endDate,
        isCurrent: experiences.isCurrent, description: experiences.description,
      })
      .from(experiences)
      .where(eq(experiences.profileUserId, candidateId))
      .orderBy(asc(experiences.sortOrder), desc(experiences.startDate)),
    db
      .select({
        institution: educations.institution, degree: educations.degree, fieldOfStudy: educations.fieldOfStudy,
        startDate: educations.startDate, endDate: educations.endDate, isCurrent: educations.isCurrent,
        description: educations.description,
      })
      .from(educations)
      .where(eq(educations.profileUserId, candidateId))
      .orderBy(asc(educations.sortOrder), desc(educations.startDate)),
  ]);
  return { experiences: experienceRows, educations: educationRows };
}

/**
 * Super Admin's default prompt for Apply answers (Settings) for the Manager's AI mode: the ChatGPT
 * one, or the Gemini one in Gemini mode; null means Apply's built-in prompt.
 */
async function defaultAnswerPrompt(aiMode: "chatgpt" | "gemini"): Promise<{ id: string; template: string } | null> {
  const [row] = await db
    .select({ id: prompts.id, template: prompts.promptTemplate })
    .from(prompts)
    .where(and(
      eq(prompts.provider, aiMode === "gemini" ? "gemini" : "openai"),
      eq(prompts.purpose, "application_answer"),
      eq(prompts.isActive, true),
      eq(prompts.isDefault, true),
      isNull(prompts.ownerManagerId),
      isNull(prompts.archivedAt),
    ))
    .limit(1);
  return row?.template.trim() ? row : null;
}

/** The delivered Generation's documents, for jobs generated before they were saved as text. */
function deliveredDocument(part: "resume" | "coverLetter") {
  return sql<unknown>`(
    select r.response_json -> ${part} from generation_runs r
     where r.job_id = ${jobs.id} and r.status = 'delivered'
     order by r.created_at desc limit 1
  )`;
}

const templateLabel = (template: string | null) =>
  template ? (isPdfTemplate(template) ? pdfTemplateLabels[template] : template) : null;

/**
 * The next application for this Chrome, or null when none is ready or this Chrome has its limit
 * open. skipJobIds (UUIDs, checked by the route): jobs this Chrome cancelled, not handed back to it.
 */
export async function claimNextApplication(
  managerId: string,
  browser: ExtensionBrowser,
  skipJobIds: string[] = [],
): Promise<ClaimedApplication | null> {
  const claim = await db.execute<{ attemptId: string | null }>(sql`
    select claim_apply_attempt(${managerId}, ${browser.id}, ${APPLY_PARALLEL_LIMIT}, ${APPLY_LEASE_SECONDS},
      ${`{${skipJobIds.join(",")}}`}::uuid[])::text as "attemptId"
  `);
  const attemptId = claim.rows[0]?.attemptId;
  return attemptId ? loadApplication(attemptId) : null;
}

/** Everything the Chrome needs to work on an attempt: the job, the candidate, the answers. */
async function loadApplication(attemptId: string): Promise<ClaimedApplication | null> {
  const [row] = await db
    .select({
      jobId: jobs.id,
      url: jobs.jobUrl,
      title: jobs.jobTitle,
      company: jobs.company,
      location: jobs.location,
      employmentType: jobs.employmentType,
      workplaceType: jobs.workplaceType,
      salary: jobs.salary,
      description: jobs.description,
      resumeLocalPath: jobs.resumeLocalPath,
      resumeSavedOn: sql<string | null>`(select b.name from extension_browsers b where b.id = ${jobs.generationBrowserId})`,
      promptName: sql<string | null>`(select p.name || ' · v' || p.version from prompts p where p.id = ${jobs.promptId})`,
      pdfTemplate: jobs.pdfTemplate,
      savedResumeText: jobs.resumeText,
      savedCoverLetterText: jobs.coverLetterText,
      deliveredResume: deliveredDocument("resume"),
      deliveredCoverLetter: deliveredDocument("coverLetter"),
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
      // Whole years from the oldest experience start month until today, as the profile page shows it.
      yearsOfExperience: sql<number | null>`(
        select floor((extract(year from age(current_date, min(e.start_date))) * 12
          + extract(month from age(current_date, min(e.start_date)))) / 12)::int
        from experiences e where e.profile_user_id = ${profiles.userId}
      )`,
      githubUrl: profiles.githubUrl,
      portfolioUrl: profiles.portfolioUrl,
      nationality: profiles.nationality,
      // YYYY-MM-DD; Apply fills birthday questions from it and never guesses one.
      birthday: profiles.birthday,
      languages: profiles.languages,
      // The candidate's own diversity answers (keys from src/lib/diversity-options.ts).
      gender: profiles.gender,
      ethnicity: profiles.ethnicity,
      veteranStatus: profiles.veteranStatus,
      disabilityStatus: profiles.disabilityStatus,
      sexualOrientation: profiles.sexualOrientation,
      pronouns: profiles.pronouns,
      aiMode: users.applyAiMode,
      autoSubmit: users.autoSubmit,
      reviewMode: users.applyReviewMode,
      siteAccountPassword: users.siteAccountPassword,
    })
    .from(applyAttempts)
    .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
    .innerJoin(profiles, eq(profiles.userId, applyAttempts.candidateId))
    .innerJoin(users, eq(users.id, applyAttempts.managerId))
    .where(eq(applyAttempts.id, attemptId))
    .limit(1);
  if (!row) return null;

  // Only Super Admin's reusable answers, the same for every candidate. Answers from earlier
  // applications are never reused: each job's questions are answered for that job.
  const savedAnswers = (await db
    .select({
      questionKey: reusableAnswers.questionKey,
      questionText: reusableAnswers.questionText,
      answer: reusableAnswers.answer,
      note: reusableAnswers.note,
    })
    .from(reusableAnswers))
    .map((entry) => ({ ...entry, scope: "everyone" as const }));

  const {
    jobId, url, title, company, location, employmentType, workplaceType, salary, description,
    resumeLocalPath, resumeSavedOn, promptName, pdfTemplate, savedResumeText, savedCoverLetterText,
    deliveredResume, deliveredCoverLetter, aiMode, autoSubmit, reviewMode, siteAccountPassword, ...candidate
  } = row;
  return {
    attemptId,
    aiMode: aiMode === "gemini" ? "gemini" : "chatgpt",
    autoSubmit,
    reviewMode: reviewModeOf(reviewMode),
    job: {
      id: jobId,
      url,
      title,
      company,
      location,
      workType: workTypeOf(employmentType, workplaceType),
      salary: salary?.trim() || null,
      description,
      resumeFolder: resumeLocalPath ? resumeFolderOf(resumeLocalPath) : null,
      resumeSavedOn,
      promptName,
      templateName: templateLabel(pdfTemplate),
      resumeText: savedResumeText ?? resumeText(deliveredResume),
      coverLetterText: savedCoverLetterText ?? coverLetterText(deliveredCoverLetter),
    },
    candidate,
    profileDetails: await profileDetailsOf(candidate.candidateId),
    savedAnswers,
    // A reusable salary answer may need converting to another currency.
    exchangeRates: await loadExchangeRates(),
    rememberedChoices: await rememberedChoices(),
    answerPrompt: await defaultAnswerPrompt(aiMode === "gemini" ? "gemini" : "chatgpt"),
    siteAccountPassword: decryptSiteAccountPassword(siteAccountPassword),
  };
}

export type ApplyReviewMode = "every_step" | "before_submit";
const reviewModeOf = (value: string | null | undefined): ApplyReviewMode => (value === "before_submit" ? "before_submit" : "every_step");

/** The Manager's Submit settings now, so a change by Super Admin takes effect at the next step. */
export async function applySubmitSettings(managerId: string): Promise<{ reviewMode: ApplyReviewMode; autoSubmit: boolean }> {
  const [row] = await db
    .select({ reviewMode: users.applyReviewMode, autoSubmit: users.autoSubmit })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1);
  return { reviewMode: reviewModeOf(row?.reviewMode), autoSubmit: row?.autoSubmit === true };
}

function ownedBy(attemptId: string, managerId: string, browserId: string) {
  return and(
    eq(applyAttempts.id, attemptId),
    eq(applyAttempts.managerId, managerId),
    eq(applyAttempts.browserId, browserId),
  );
}

const leaseFor = (seconds: number) => new Date(Date.now() + seconds * 1000);

/**
 * A job page this Chrome still has open after its extension restarted (reloaded, updated, woken
 * up): its application, held for the Manager again. When its hold ran out meanwhile and the attempt
 * is gone, the same job is taken again for this Chrome, unless another Chrome holds it or it has a
 * bid. Null when neither works; the Chrome then lets the page go.
 */
export async function resumeApplication(
  managerId: string,
  browserId: string,
  attemptId: string,
  jobId: string,
): Promise<ClaimedApplication | null> {
  const [held] = await db
    .update(applyAttempts)
    .set({ status: "waiting_review", leaseExpiresAt: leaseFor(APPLY_REVIEW_LEASE_SECONDS), updatedAt: new Date() })
    .where(and(ownedBy(attemptId, managerId, browserId), inArray(applyAttempts.status, ["claimed", "waiting_review"])))
    .returning({ id: applyAttempts.id });
  if (held) return loadApplication(held.id);
  return claimJobForBrowser(managerId, browserId, jobId);
}

/**
 * One chosen job taken for this Chrome, held for the Manager: generated, no bid, and no Chrome
 * holding it (its one-live-attempt index refuses a second). Null when it cannot be taken.
 */
export async function claimJobForBrowser(managerId: string, browserId: string, jobId: string): Promise<ClaimedApplication | null> {
  const taken = await db.execute<{ id: string }>(sql`
    insert into apply_attempts (job_id, manager_id, candidate_id, browser_id, status, lease_expires_at)
    select jobs.id, jobs.manager_id, jobs.candidate_id, ${browserId}, 'waiting_review',
      now() + make_interval(secs => ${APPLY_REVIEW_LEASE_SECONDS})
    from jobs
    where jobs.id = ${jobId} and jobs.manager_id = ${managerId}
      and jobs.generation_status = 'completed' and jobs.resume_local_path is not null and jobs.status <> 'applied'
      and not ${jobHasBid()}
    on conflict do nothing
    returning id::text as id
  `);
  const id = taken.rows[0]?.id;
  return id ? loadApplication(id) : null;
}

export type PageApplicationState = "ready" | "not_generated" | "generating" | "applied" | "open";
export type PageApplication = { jobId: string; candidateName: string; title: string; company: string; state: PageApplicationState };

const comparableJobUrlSql = sql`regexp_replace(split_part(btrim(${jobs.jobUrl}), '#', 1), '/+$', '')`;

/**
 * The Manager's saved jobs for a page address, one per account, with whether each can be applied
 * to now: ready (generated, no bid, not open in any Chrome), not generated, generating, applied
 * (it has a bid), or open (a Chrome holds it). The address matches as saved, or without its query
 * when the saved one has none (tracking parameters on the page).
 */
export async function findPageApplications(managerId: string, pageUrl: string): Promise<PageApplication[]> {
  const full = comparableJobUrl(pageUrl);
  const bare = comparableJobUrl(full.split("?")[0]);
  const rows = await db
    .select({
      jobId: jobs.id,
      title: jobs.jobTitle,
      company: jobs.company,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      generationStatus: jobs.generationStatus,
      hasResume: sql<boolean>`${jobs.resumeLocalPath} is not null`,
      generating: generationHeldSql(),
      hasBid: jobHasBid(),
      open: sql<boolean>`exists (select 1 from apply_attempts x where x.job_id = ${jobs.id}
        and x.status in ('claimed', 'waiting_review', 'waiting_confirmation', 'submitting'))`,
    })
    .from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .innerJoin(users, and(eq(users.id, jobs.candidateId), isNull(users.blockedAt)))
    .where(and(
      eq(jobs.managerId, managerId),
      sql`(${comparableJobUrlSql} = ${full} or (${comparableJobUrlSql} = ${bare} and position('?' in ${jobs.jobUrl}) = 0))`,
    ))
    .orderBy(asc(profiles.firstName), asc(profiles.lastName))
    .limit(50);
  return rows.map((row) => ({
    jobId: row.jobId,
    candidateName: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate",
    title: row.title,
    company: row.company,
    state: row.hasBid ? "applied"
      : row.open ? "open"
        : row.generating ? "generating"
          : row.generationStatus === "completed" && row.hasResume ? "ready" : "not_generated",
  }));
}

/**
 * Renews this Chrome's hold; false when the attempt is no longer its own (for example after a long
 * sleep). Filling is held for 2 minutes between heartbeats, waiting for the Manager for 10.
 */
/** Renews this Chrome's hold; the seconds it now lasts (longer while the Manager reviews), or null when it is not its own. */
export async function renewApplyAttempt(attemptId: string, managerId: string, browserId: string): Promise<number | null> {
  const updated = await db
    .update(applyAttempts)
    .set({
      leaseExpiresAt: sql`case when ${applyAttempts.status} = 'claimed'
        then ${leaseFor(APPLY_LEASE_SECONDS)}
        else ${leaseFor(APPLY_REVIEW_LEASE_SECONDS)} end`,
      updatedAt: new Date(),
    })
    .where(and(
      ownedBy(attemptId, managerId, browserId),
      inArray(applyAttempts.status, ["claimed", "waiting_review", "waiting_confirmation"]),
      // An application waiting for the Manager's Yes/No stays answerable after its Chrome is gone.
      sql`(${applyAttempts.leaseExpiresAt} > now() or ${applyAttempts.status} = 'waiting_confirmation')`,
    ))
    .returning({ status: applyAttempts.status });
  if (!updated.length) return null;
  return updated[0].status === "claimed" ? APPLY_LEASE_SECONDS : APPLY_REVIEW_LEASE_SECONDS;
}

/**
 * Keeps one Apply run on its job row, newest first, at most 10: when, how it ended, and the answers
 * it used with their sources, for the Jobs page.
 */
async function recordApplyRun(jobId: string, outcome: string, reason: string | null, answers: AppliedAnswer[]): Promise<void> {
  const run: ApplyRun = {
    at: new Date().toISOString(),
    outcome,
    reason: reason ? reason.replace(/\s+/g, " ").trim().slice(0, 500) || null : null,
    answers,
  };
  await db
    .update(jobs)
    .set({
      applyAnswers: sql`jsonb_path_query_array(
        jsonb_build_array(${JSON.stringify(run)}::jsonb) || coalesce(${jobs.applyAnswers}, '[]'::jsonb),
        '$[0 to 9]'
      )`,
    })
    .where(eq(jobs.id, jobId));
}

/**
 * How a claimed job ends before Submit:
 * - "error": something stopped it (page not loading, ...); it returns to the list (twice at most).
 * - "skip": the Manager skipped it, or the site needs a person; it is never offered again.
 * - "later": the Manager will come back to it; it returns to the list without counting as a return.
 * - "test": test mode stopped before Submit on purpose; like "later".
 * - "drop": the assistant's page ended without a bid (Cancel, a closed page, Apply turned off, an
 *   error): nothing is recorded; the job is exactly as it was before it was opened.
 * - "remove": the panel's Remove: the job row is deleted (its attempts with it); never while
 *   Generation still writes it.
 */
export type ReleaseMode = "error" | "skip" | "later" | "test" | "drop" | "remove";

export async function releaseApplyAttempt(
  attemptId: string,
  managerId: string,
  browserId: string,
  mode: ReleaseMode,
  reason: string,
  answers: AppliedAnswer[] = [],
): Promise<boolean> {
  const before = and(ownedBy(attemptId, managerId, browserId), inArray(applyAttempts.status, ["claimed", "waiting_review"]));
  if (mode === "drop") {
    const removed = await db.delete(applyAttempts).where(before).returning({ id: applyAttempts.id });
    return removed.length > 0;
  }
  if (mode === "remove") {
    const removed = await db.delete(jobs).where(and(
      eq(jobs.managerId, managerId),
      sql`not ${generationHeldSql()}`,
      sql`${jobs.id} = (select ${applyAttempts.jobId} from ${applyAttempts} where ${before})`,
    )).returning({ id: jobs.id });
    return removed.length > 0;
  }
  if (mode === "later" || mode === "test") {
    const removed = await db
      .delete(applyAttempts)
      .where(before)
      .returning({ id: applyAttempts.id, jobId: applyAttempts.jobId });
    if (removed[0]) await recordApplyRun(removed[0].jobId, mode, reason, answers);
    return removed.length > 0;
  }
  const updated = await db
    .update(applyAttempts)
    .set({
      status: mode === "skip" ? "skipped" : "released",
      resultReason: reason.replace(/\s+/g, " ").trim().slice(0, 500) || null,
      finishedAt: new Date(),
      leaseExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(before)
    .returning({ id: applyAttempts.id, jobId: applyAttempts.jobId });
  if (updated[0]) await recordApplyRun(updated[0].jobId, mode === "skip" ? "skipped" : "stopped", reason, answers);
  return updated.length > 0;
}

/**
 * A step is filled and waits for the Manager (review), or the Manager clicked Continue and Apply is
 * filling the next step. The answers so far travel with it.
 */
export async function setApplyReviewState(
  attemptId: string,
  managerId: string,
  browserId: string,
  review: boolean,
  answers: AppliedAnswer[],
): Promise<boolean> {
  const updated = await db
    .update(applyAttempts)
    .set({
      status: review ? "waiting_review" : "claimed",
      leaseExpiresAt: leaseFor(review ? APPLY_REVIEW_LEASE_SECONDS : APPLY_LEASE_SECONDS),
      evidence: { answers },
      updatedAt: new Date(),
    })
    .where(and(ownedBy(attemptId, managerId, browserId), inArray(applyAttempts.status, ["claimed", "waiting_review"])))
    .returning({ id: applyAttempts.id });
  return updated.length > 0;
}

/**
 * The Manager clicked the site's Submit (or Apply did, with automatic Submit). From now on the job is
 * never handed out again; it waits for the Manager's Yes/No, with what the form held at Submit.
 */
export async function markApplicationSubmitted(
  attemptId: string,
  managerId: string,
  browserId: string,
  answers: AppliedAnswer[],
  learned: LearnedAnswer[] = [],
): Promise<boolean> {
  const now = new Date();
  const updated = await db
    .update(applyAttempts)
    .set({
      status: "waiting_confirmation",
      submitGrantedAt: now,
      leaseExpiresAt: leaseFor(APPLY_REVIEW_LEASE_SECONDS),
      // What to learn from is kept until the Manager's answer: only a Yes teaches.
      evidence: { answers, learned },
      updatedAt: now,
    })
    .where(and(ownedBy(attemptId, managerId, browserId), inArray(applyAttempts.status, ["claimed", "waiting_review"])))
    .returning({ id: applyAttempts.id });
  return updated.length > 0;
}

/** "Not submitted — back to review": the site did not send it (a field error), so review goes on. */
export async function returnApplicationToReview(attemptId: string, managerId: string, browserId: string): Promise<boolean> {
  const updated = await db
    .update(applyAttempts)
    .set({
      status: "waiting_review",
      submitGrantedAt: null,
      leaseExpiresAt: leaseFor(APPLY_REVIEW_LEASE_SECONDS),
      updatedAt: new Date(),
    })
    .where(and(ownedBy(attemptId, managerId, browserId), eq(applyAttempts.status, "waiting_confirmation")))
    .returning({ id: applyAttempts.id });
  return updated.length > 0;
}

function learnedOf(evidence: unknown): LearnedAnswer[] {
  const learned = evidence && typeof evidence === "object" ? (evidence as { learned?: unknown }).learned : null;
  return Array.isArray(learned) ? learned as LearnedAnswer[] : [];
}

function answersOf(evidence: unknown): AppliedAnswer[] {
  const answers = evidence && typeof evidence === "object" ? (evidence as { answers?: unknown }).answers : null;
  return Array.isArray(answers) ? answers as AppliedAnswer[] : [];
}

/** The job's fields a bid copies (with its prompt and the Chrome that saved its résumé). */
const jobBidFields = {
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
  sourceSiteUrl: jobs.sourceSiteUrl,
  pdfTemplate: jobs.pdfTemplate,
  promptName: sql<string | null>`(select p.name || ' · v' || p.version from prompts p where p.id = ${jobs.promptId})`,
  resumeSavedOn: extensionBrowsers.name,
};
type JobBidFields = {
  jobUrl: string; jobTitle: string; company: string; titleCompanyKey: string | null; location: string | null;
  employmentType: string | null; workplaceType: string | null; salary: string | null; resumeLocalPath: string | null;
  googleDrivePath: string | null; sourceSiteUrl: string | null; pdfTemplate: string | null; promptName: string | null;
  resumeSavedOn: string | null;
};

/** A bid: an independent copy of the job, its documents, and the answers given. */
function bidOf(job: JobBidFields, managerId: string, candidateId: string, answers: AppliedAnswer[], appliedAt: Date) {
  return {
    managerId,
    candidateId,
    jobUrl: job.jobUrl,
    jobTitle: job.jobTitle,
    company: job.company,
    titleCompanyKey: job.titleCompanyKey,
    location: job.location?.trim() || null,
    workType: workTypeOf(job.employmentType, job.workplaceType),
    salary: job.salary?.trim() || null,
    resumeFolder: job.resumeLocalPath ? resumeFolderOf(job.resumeLocalPath) : "",
    resumeSavedOn: job.resumeSavedOn,
    googleDrivePath: job.googleDrivePath,
    sourceSiteUrl: job.sourceSiteUrl,
    templateName: templateLabel(job.pdfTemplate),
    promptName: job.promptName,
    answers,
    appliedAt,
  };
}

/**
 * Submitted on a job page whose application record is gone (its hold ran out while the Chrome was
 * away): the bid is saved from the job itself, once per candidate and job, and the job row is
 * deleted, as Submitted does. False when the job is not this Manager's or no longer exists.
 */
export async function saveBidForJob(managerId: string, jobId: string, answers: AppliedAnswer[]): Promise<boolean> {
  const [job] = await db
    .select({ ...jobBidFields, candidateId: jobs.candidateId })
    .from(jobs)
    .leftJoin(extensionBrowsers, eq(extensionBrowsers.id, jobs.generationBrowserId))
    .where(and(eq(jobs.id, jobId), eq(jobs.managerId, managerId)))
    .limit(1);
  if (!job) return false;
  await db.batch([
    db.insert(bids).values(bidOf(job, managerId, job.candidateId, answers, new Date())).onConflictDoNothing(),
    // Its attempts go with it (cascade), so no Chrome offers it again.
    db.delete(jobs).where(and(eq(jobs.id, jobId), eq(jobs.managerId, managerId), sql`not ${generationHeldSql()}`)),
  ]);
  return true;
}

/**
 * The Manager's answer to "Submitted successfully?", from the Chrome (browserId) or the Jobs page
 * (browserId null). Yes makes the bid, an independent copy of the job, its documents and the
 * answers, and the job becomes Applied; No makes the job Failed. Null when nothing was waiting.
 */
export async function answerApplication(input: {
  attemptId: string;
  managerId: string;
  browserId: string | null;
  submitted: boolean;
  answers?: AppliedAnswer[];
  // Yes from the job page's panel: the job row is deleted instead of becoming Applied.
  removeJob?: boolean;
}): Promise<"confirmed" | "failed" | null> {
  const { attemptId, managerId, browserId, submitted } = input;
  const [attempt] = await db
    .select({
      jobId: applyAttempts.jobId,
      candidateId: applyAttempts.candidateId,
      evidence: applyAttempts.evidence,
      ...jobBidFields,
    })
    .from(applyAttempts)
    .innerJoin(jobs, eq(jobs.id, applyAttempts.jobId))
    .leftJoin(extensionBrowsers, eq(extensionBrowsers.id, jobs.generationBrowserId))
    .where(and(
      eq(applyAttempts.id, attemptId),
      eq(applyAttempts.managerId, managerId),
      inArray(applyAttempts.status, ["waiting_confirmation", "submitting"]),
      ...(browserId ? [eq(applyAttempts.browserId, browserId)] : []),
    ))
    .limit(1);
  if (!attempt) return null;
  const answers = input.answers?.length ? input.answers : answersOf(attempt.evidence);
  const now = new Date();
  const settle = (status: "confirmed" | "failed") => db
    .update(applyAttempts)
    .set({
      status,
      resultReason: status === "failed" ? "The Manager answered No: not submitted successfully." : null,
      evidence: { answers, learned: learnedOf(attempt.evidence) },
      finishedAt: now,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(eq(applyAttempts.id, attemptId), inArray(applyAttempts.status, ["waiting_confirmation", "submitting"])))
    .returning({ id: applyAttempts.id });

  if (!submitted) {
    const [[done]] = await db.batch([
      settle("failed"),
      db.update(jobs)
        .set({ status: "failed", failureReason: "Not submitted successfully (the Manager answered No).", updatedAt: now })
        .where(eq(jobs.id, attempt.jobId)),
    ]);
    if (!done) return null;
    await recordApplyRun(attempt.jobId, "failed", "The Manager answered No.", answers);
    return "failed";
  }

  const [[done]] = await db.batch([
    settle("confirmed"),
    db.insert(bids).values(bidOf(attempt, managerId, attempt.candidateId, answers, now)).onConflictDoNothing(),
    // The panel's Submitted: the job row goes at once (its Apply history with it); the bid stays.
    input.removeJob
      ? db.delete(jobs).where(and(eq(jobs.id, attempt.jobId), sql`not ${generationHeldSql()}`))
      : db.update(jobs).set({ status: "applied", failureReason: null, updatedAt: now }).where(eq(jobs.id, attempt.jobId)),
  ]);
  if (!done) return null;
  if (!input.removeJob) await recordApplyRun(attempt.jobId, "confirmed", null, answers);
  // A confirmed application teaches Apply's question memory (suggestions, remembered choices,
  // and safe reusable answers added by themselves).
  await recordLearnedAnswers(attempt.candidateId, learnedOf(attempt.evidence)).catch((error) => {
    console.error("Could not learn from the application's answers.", error);
  });
  return "confirmed";
}

/**
 * "Apply again" on the Jobs page: a Failed job (or one returned twice, or skipped) is offered to
 * Apply once more, filled from the start with the same résumé. Its earlier attempts stay as history.
 */
export async function applyJobAgain(jobId: string, managerId: string): Promise<boolean> {
  const now = new Date();
  const [cleared] = await db.batch([
    db
      .update(applyAttempts)
      .set({ status: "cleared", leaseExpiresAt: null, updatedAt: now })
      .where(and(
        eq(applyAttempts.jobId, jobId),
        eq(applyAttempts.managerId, managerId),
        inArray(applyAttempts.status, ["failed", "released", "skipped"]),
      ))
      .returning({ id: applyAttempts.id }),
    db
      .update(jobs)
      .set({ status: "todo", failureReason: null, updatedAt: now })
      .where(and(eq(jobs.id, jobId), eq(jobs.managerId, managerId), eq(jobs.status, "failed"), sql`not ${jobHasBid()}`)),
  ]);
  return cleared.length > 0;
}
