import "server-only";

import { neonSql } from "@/lib/db";
import { DOCUMENT_FORMAT_RULES } from "@/server/generation/generation-format";
import { isPdfTemplate, pdfTemplateValues, type PdfTemplate } from "@/server/pdf/pdf-templates";

export class MissingDocumentPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingDocumentPromptError";
  }
}

export type GenerationSetup = {
  promptTemplate: string;
  pdfTemplate: PdfTemplate;
  // The prompt version used: one of the Manager's own, or Super Admin's default.
  promptId: string;
};

/**
 * Picks the prompt and PDF template for one Generation, one by one in rotation.
 *
 * The prompt is the Manager's own prompt they used longest ago (a new one first), or Super
 * Admin's default prompt when they have none. The template rotates the same way through all
 * templates. Both are read from the Manager's past Generation runs, which record what each used.
 */
export async function getManagerGenerationSetup(managerId: string): Promise<GenerationSetup> {
  const ownRows = await neonSql`
    select prompt.id, prompt.prompt_template
    from prompts prompt
    where prompt.owner_manager_id = ${managerId}::uuid
      and prompt.provider = 'openai'
      and prompt.purpose = 'document_generation'
      and prompt.is_active
      and prompt.archived_at is null
    order by (
        select max(run.created_at)
        from generation_runs run
        join prompts used on used.id = run.prompt_id
        where run.manager_id = ${managerId}::uuid
          and used.prompt_group_id = prompt.prompt_group_id
      ) asc nulls first,
      (select min(first.created_at) from prompts first where first.prompt_group_id = prompt.prompt_group_id) asc
    limit 1
  `;
  const promptRows = ownRows.length > 0 ? ownRows : await neonSql`
    select id, prompt_template
    from prompts
    where owner_manager_id is null
      and provider = 'openai'
      and purpose = 'document_generation'
      and is_active
      and is_default
      and archived_at is null
    limit 1
  `;
  const promptId = String(promptRows[0]?.id ?? "");
  const promptTemplate = String(promptRows[0]?.prompt_template ?? "").trim();
  if (!promptId || !promptTemplate) {
    throw new MissingDocumentPromptError(
      "You have no prompts and there is no default prompt. Add a prompt on the My AI prompt page, or ask your Super Admin to set a default.",
    );
  }

  const templateRows = await neonSql`
    select template
    from unnest(${[...pdfTemplateValues]}::text[]) with ordinality as rotation(template, position)
    order by (
        select max(run.created_at)
        from generation_runs run
        where run.manager_id = ${managerId}::uuid
          and run.pdf_template = rotation.template
      ) asc nulls first,
      rotation.position asc
    limit 1
  `;
  const rotated = String(templateRows[0]?.template ?? "");
  return {
    promptTemplate,
    pdfTemplate: isPdfTemplate(rotated) ? rotated : "qts-standard",
    promptId,
  };
}

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
    .replaceAll("{{candidate_profile}}", candidateContext)
    .replaceAll("{{job_description}}", job.jobDescription)
    .replaceAll("{{document_type}}", "resume and cover letter");
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
