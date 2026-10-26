// The candidate's static facts application forms ask for (profiles columns from migrations 0062 and
// 0064). Years of experience is calculated from the experience history. Salary, notice,
// sponsorship, right to work, relocation, job preferences, and diversity answers are the same for
// every candidate and live in Super Admin's reusable answers; their old profile columns are kept but
// no longer edited or used. Pure, so it is testable.

export type ApplicationFacts = {
  nationality: string | null;
  languages: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
};

/** The form section's marker; a form opened before the section existed leaves the facts unchanged. */
export const APPLICATION_FACTS_MARKER = "applicationFacts";

function text(formData: FormData, name: string, maxLength: number): string | null | undefined {
  const value = formData.get(name);
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value.replace(/\s+/g, " ").trim() || null;
}

function webAddress(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The facts from the candidate profile form: null when the form has no facts section, a string
 * naming the first invalid field, or the parsed facts.
 */
export function readApplicationFacts(formData: FormData): ApplicationFacts | string | null {
  if (formData.get(APPLICATION_FACTS_MARKER) !== "1") return null;
  const nationality = text(formData, "nationality", 100);
  const languages = text(formData, "languages", 300);
  const githubUrl = webAddress(text(formData, "githubUrl", 2048));
  const portfolioUrl = webAddress(text(formData, "portfolioUrl", 2048));

  if (nationality === undefined) return "Nationality is too long (100 characters at most).";
  if (languages === undefined) return "Languages are too long (300 characters at most).";
  if (githubUrl === undefined) return "Enter a valid GitHub address.";
  if (portfolioUrl === undefined) return "Enter a valid portfolio or website address.";
  return { nationality, languages, githubUrl, portfolioUrl };
}
