import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";

export type ExtensionSavedJob = {
  jobUrl: string;
  jobTitle: string;
  company: string;
  description: string;
  location: string | null;
};

export function readExtensionSavedJob(value: unknown): ExtensionSavedJob | null {
  if (!isRecord(value) || !isRecord(value.job)) return null;
  const job = value.job;
  if (
    typeof job.jobUrl !== "string" ||
    typeof job.title !== "string" ||
    typeof job.company !== "string" ||
    typeof job.description !== "string" ||
    typeof job.location !== "string" ||
    job.jobUrl.length > 2048 ||
    job.title.trim().length === 0 ||
    job.title.length > 500 ||
    job.company.trim().length === 0 ||
    job.company.length > 500 ||
    job.description.trim().length === 0 ||
    job.description.length > 100_000 ||
    job.location.length > 500 ||
    !isHttpUrl(job.jobUrl)
  ) {
    return null;
  }
  return {
    jobUrl: normalizeJobUrl(job.jobUrl),
    jobTitle: job.title.trim(),
    company: job.company.trim(),
    description: job.description.trim(),
    location: job.location.trim() || null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
