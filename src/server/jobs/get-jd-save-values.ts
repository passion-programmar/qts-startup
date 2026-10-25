import { isHttpUrl, normalizeJobUrl } from "@/server/jobs/job-values";

export type ExtensionSavedJob = {
  jobUrl: string;
  jobTitle: string;
  company: string;
  description: string;
  /** Plain page innerText; saved only when the job has no description. */
  pageText: string | null;
  /** Location as written, including the country (jobs keep no separate country). */
  location: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  salary: string | null;
  jobReason: string | null;
};

export function readExtensionSavedJob(value: unknown): ExtensionSavedJob | null {
  if (!isRecord(value) || !isRecord(value.job)) return null;
  const job = value.job;
  const pageText = typeof value.pageText === "string" ? value.pageText.trim() : "";
  if (
    (value.pageText !== undefined && typeof value.pageText !== "string") ||
    pageText.length > 100_000 ||
    typeof job.jobUrl !== "string" ||
    typeof job.title !== "string" ||
    typeof job.company !== "string" ||
    typeof job.description !== "string" ||
    typeof job.location !== "string" ||
    !optionalTextWithinLimit(job.country, 200) ||
    !optionalTextWithinLimit(job.employmentType, 200) ||
    !optionalTextWithinLimit(job.workplaceType, 200) ||
    !optionalTextWithinLimit(job.salary, 500) ||
    !optionalTextWithinLimit(job.reason, 1200) ||
    job.jobUrl.length > 2048 ||
    job.title.trim().length === 0 ||
    job.title.length > 500 ||
    job.company.trim().length === 0 ||
    job.company.length > 500 ||
    // A job needs a description, or page text to fall back on.
    (job.description.trim().length === 0 && !pageText) ||
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
    pageText: pageText || null,
    location: locationWithCountry(job.location, job.country),
    employmentType: optionalText(job.employmentType),
    workplaceType: optionalText(job.workplaceType),
    salary: optionalText(job.salary),
    jobReason: optionalText(job.reason),
  };
}

/** Older extensions send the country on its own; it is kept inside location. */
export function locationWithCountry(location: string, country: unknown): string | null {
  const place = location.trim();
  const countryName = typeof country === "string" ? country.trim() : "";
  if (!countryName || place.toLowerCase().includes(countryName.toLowerCase())) return place || null;
  return (place ? `${place}, ${countryName}` : countryName).slice(0, 500);
}

function optionalTextWithinLimit(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= max);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
