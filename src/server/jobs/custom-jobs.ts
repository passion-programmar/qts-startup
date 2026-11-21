import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bids, extensionBrowsers, jobs, profiles, users } from "@/db/schema";
import { db } from "@/lib/db";
import { resumeFolderOf, workTypeOf } from "@/server/apply/apply-values";
import { generationHeldSql } from "@/server/generation/generation-hold";
import { insertGetJdJob } from "@/server/jobs/get-jd-jobs";
import { localResumeFiles } from "@/server/jobs/delete-jobs";
import { templateLabel } from "@/server/apply/apply-attempts";

// Custom (the extension launcher's Custom): a job the Manager pastes, with no job page to read it
// from. "easy_apply": a job board's Easy Apply, with its address. "recruiter": a recruiter's message,
// with no address. It is saved as a job pinned to the Chrome it was made in (only that Chrome
// generates it, first), and the Manager's Submitted saves the bid and removes the job.

export type CustomKind = "easy_apply" | "recruiter";
export const CUSTOM_KINDS: CustomKind[] = ["easy_apply", "recruiter"];
// A recruiter message has no address: this one never opens anything (.invalid is never a real site),
// keeps the job's own row unique, and is left out of its bid.
const RECRUITER_URL = "https://custom.qts.invalid/recruiter/";
export const isRecruiterUrl = (url: string | null | undefined) => String(url || "").startsWith(RECRUITER_URL);

export type CustomJobInput = {
  kind: CustomKind; candidateId: string; title: string; company: string; description: string; url: string; note: string;
};

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

/** The pasted job, checked: a reason when it cannot be saved. */
export function readCustomJob(raw: unknown): CustomJobInput | string {
  if (!raw || typeof raw !== "object") return "Fill in the custom job.";
  const value = raw as Record<string, unknown>;
  const kind = CUSTOM_KINDS.includes(value.kind as CustomKind) ? value.kind as CustomKind : null;
  if (!kind) return "Choose Easy Apply or Recruiter message.";
  const candidateId = typeof value.candidateId === "string" && /^[0-9a-f-]{36}$/i.test(value.candidateId) ? value.candidateId : "";
  if (!candidateId) return "Choose the candidate first.";
  const title = clean(value.title, 500), company = clean(value.company, 500);
  if (!title || !company) return "Write the job title and the company.";
  const description = clean(value.description, 100_000);
  if (description.length < 50) return "Paste the job description (at least a few lines).";
  const note = clean(value.note, 2000);
  let url = clean(value.url, 2048);
  if (kind === "easy_apply") {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      return "Paste the Easy Apply job address (https://…).";
    }
  } else url = "";
  return { kind, candidateId, title, company, description, url, note };
}

/** Saves the pasted job for one candidate, pinned to this Chrome. A duplicate says where the job already is. */
export async function createCustomJob(managerId: string, browserId: string, input: CustomJobInput) {
  const [owned] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, input.candidateId), eq(users.parentUserId, managerId), eq(users.role, "account"))).limit(1);
  if (!owned) return { ok: false as const, reason: "This candidate is not one of your accounts." };
  const saved = await insertGetJdJob({
    jobUrl: input.kind === "recruiter" ? `${RECRUITER_URL}${crypto.randomUUID()}` : input.url,
    jobTitle: input.title,
    company: input.company,
    description: input.description,
    location: null, employmentType: null, workplaceType: null, salary: null, jobReason: null,
    managerId, candidateId: input.candidateId,
    // Kind, note and this Chrome are saved with the row itself: no other Chrome can claim it first.
    custom: { kind: input.kind, note: input.note || null, pinnedBrowserId: browserId },
  });
  if (saved.status !== "saved") {
    return { ok: false as const, reason: saved.status === "applied"
      ? "This candidate already applied to this job (it is on the Bids page)."
      : "This job is already in this candidate's Jobs list." };
  }
  return { ok: true as const, jobId: saved.jobId };
}

// The Chrome a custom job was pasted in, and the one writing its résumé now.
const madeIn = alias(extensionBrowsers, "custom_made_in");
const makingIn = alias(extensionBrowsers, "custom_making_in");

/**
 * Every custom job of the Manager still waiting, for the Custom cards in each of their Chromes (all
 * on one PC, so the PDFs are in the same QTS_Resume): this Chrome's first, then the newest. Each says
 * where it was pasted ("made in") and, while its résumé is written, which Chrome is writing it.
 */
export async function listCustomJobs(managerId: string, browserId: string) {
  const rows = await db.select({
    id: jobs.id, kind: jobs.customKind, note: jobs.customNote, url: jobs.jobUrl, title: jobs.jobTitle, company: jobs.company,
    candidateId: jobs.candidateId, firstName: profiles.firstName, lastName: profiles.lastName,
    generationStatus: jobs.generationStatus, generationError: jobs.generationError,
    resumeLocalPath: jobs.resumeLocalPath, coverLetterText: jobs.coverLetterText, createdAt: jobs.createdAt,
    pinnedBrowserId: jobs.pinnedBrowserId, madeInName: madeIn.name,
    making: generationHeldSql(), makingInName: makingIn.name,
  }).from(jobs)
    .innerJoin(profiles, eq(profiles.userId, jobs.candidateId))
    .leftJoin(madeIn, eq(madeIn.id, jobs.pinnedBrowserId))
    .leftJoin(makingIn, eq(makingIn.id, jobs.generationBrowserId))
    .where(and(eq(jobs.managerId, managerId), isNotNull(jobs.customKind)))
    .orderBy(sql`(${jobs.pinnedBrowserId} = ${browserId}) desc nulls last`, desc(jobs.createdAt))
    .limit(50);
  return rows.map(({ pinnedBrowserId, making, makingInName, madeInName, ...row }) => {
    const here = pinnedBrowserId === browserId;
    return {
      ...row,
      url: isRecruiterUrl(row.url) ? "" : row.url,
      candidate: [row.firstName, row.lastName].filter(Boolean).join(" ") || "Candidate",
      ready: Boolean(row.resumeLocalPath),
      resumeFolder: row.resumeLocalPath ? resumeFolderOf(row.resumeLocalPath) : "",
      // This Chrome pasted it (it starts Generation for it when free); else the Chrome that did.
      here,
      madeIn: here ? "" : madeInName || "another Chrome",
      // While a résumé is being written: the Chrome writing it ("" when none is).
      makingIn: !row.resumeLocalPath && making ? makingInName || "a Chrome" : "",
    };
  });
}

/**
 * Submitted: the bid (the job's copy, with its kind and note; a recruiter message keeps no address),
 * and the job removed. Only once the résumé is ready; false when the job is not this Manager's.
 */
export async function submitCustomJob(managerId: string, jobId: string) {
  const [job] = await db.select({
    candidateId: jobs.candidateId, jobUrl: jobs.jobUrl, jobTitle: jobs.jobTitle, company: jobs.company, titleCompanyKey: jobs.titleCompanyKey,
    location: jobs.location, employmentType: jobs.employmentType, workplaceType: jobs.workplaceType, salary: jobs.salary,
    resumeLocalPath: jobs.resumeLocalPath, googleDrivePath: jobs.googleDrivePath, sourceSiteUrl: jobs.sourceSiteUrl, pdfTemplate: jobs.pdfTemplate,
    promptName: sql<string | null>`(select p.name || ' · v' || p.version from prompts p where p.id = ${jobs.promptId})`,
    resumeSavedOn: extensionBrowsers.name, customKind: jobs.customKind, customNote: jobs.customNote,
  }).from(jobs)
    .leftJoin(extensionBrowsers, eq(extensionBrowsers.id, jobs.generationBrowserId))
    .where(and(eq(jobs.id, jobId), eq(jobs.managerId, managerId), isNotNull(jobs.customKind)))
    .limit(1);
  if (!job) return { ok: false as const, reason: "This custom job is gone (it may be saved as a bid already)." };
  if (!job.resumeLocalPath) return { ok: false as const, reason: "The résumé is not ready yet." };
  await db.batch([
    db.insert(bids).values({
      managerId, candidateId: job.candidateId,
      jobUrl: isRecruiterUrl(job.jobUrl) ? "" : job.jobUrl,
      jobTitle: job.jobTitle, company: job.company, titleCompanyKey: job.titleCompanyKey,
      location: job.location?.trim() || null, workType: workTypeOf(job.employmentType, job.workplaceType), salary: job.salary?.trim() || null,
      resumeFolder: resumeFolderOf(job.resumeLocalPath), resumeSavedOn: job.resumeSavedOn, googleDrivePath: job.googleDrivePath,
      sourceSiteUrl: job.sourceSiteUrl, templateName: templateLabel(job.pdfTemplate), promptName: job.promptName,
      answers: [], appliedAt: new Date(), customKind: job.customKind, customNote: job.customNote,
    }).onConflictDoNothing(),
    db.delete(jobs).where(and(eq(jobs.id, jobId), eq(jobs.managerId, managerId), sql`not ${generationHeldSql()}`)),
  ]);
  return { ok: true as const };
}

/** Give back: the job removed (never while its résumé is being made); its PDFs for this PC to delete. */
export async function removeCustomJob(managerId: string, jobId: string) {
  const removed = await db.delete(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.managerId, managerId), isNotNull(jobs.customKind), sql`not ${generationHeldSql()}`))
    .returning({ resumeLocalPath: jobs.resumeLocalPath, coverLetterLocalPath: jobs.coverLetterLocalPath });
  if (!removed.length) return { ok: false as const, reason: "This job is gone, or its résumé is being made right now: try again in a moment." };
  return { ok: true as const, resumeFiles: localResumeFiles(removed) };
}
