import type { GenerationJob } from "@/server/generation/manager-prompt";

const limits = {
  jobUrl: 2048,
  jobTitle: 500,
  company: 500,
  location: 1000,
  employmentType: 200,
  workplaceType: 200,
  salary: 500,
  jobDescription: 100_000,
} as const;

export function readGenerationJob(value: unknown): GenerationJob | null {
  if (!isRecord(value) || !isRecord(value.job)) return null;
  const job = value.job;
  const result = Object.fromEntries(
    Object.entries(limits).map(([key, max]) => [key, readText(job[key], max)]),
  ) as GenerationJob;
  if (!result.jobUrl || !isHttpUrl(result.jobUrl) || !result.jobTitle || !result.company || !result.jobDescription) {
    return null;
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
