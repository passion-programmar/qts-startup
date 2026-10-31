import { DOCUMENT_FORMAT_RULES } from "@/server/generation/generation-format";

export type GenerationJob = {
  jobUrl: string;
  jobTitle: string;
  company: string;
  location: string;
  employmentType: string;
  workplaceType: string;
  salary: string;
  jobDescription: string;
};

export function composeGenerationPrompt(
  promptTemplate: string,
  job: GenerationJob,
  candidateProfile: unknown = {},
): string {
  const candidateContext = JSON.stringify(candidateProfile);
  const jobContext = JSON.stringify(job);
  const template = promptTemplate
    .replace(
      /^[ \t]*(?:Candidate profile|Target job|Job description|Document requested)[ \t]*:[ \t]*\r?\n[ \t]*\{\{(?:candidate_profile|job_description|document_type)\}\}[ \t]*$/gim,
      "",
    )
    .replace(/\{\{(?:candidate_profile|job_description|document_type)\}\}/g, "")
    .trim();
  return [
    template,
    "",
    ...DOCUMENT_FORMAT_RULES,
    "Candidate profile:",
    candidateContext,
    "Job data:",
    jobContext,
  ].join("\n\n");
}
