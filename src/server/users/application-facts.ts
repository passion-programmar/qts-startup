// The candidate's static facts application forms ask for (profiles columns from migrations 0062 and
// 0064). Salary, notice, sponsorship, right to work, relocation, and job preferences are the same for
// every candidate and live in Super Admin's reusable answers; their old profile columns are kept but
// no longer edited or used. Pure, so it is testable.

export type ApplicationFacts = {
  nationality: string | null;
  languages: string | null;
  yearsOfExperience: number | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  eeoPreference: "prefer_not_to_say" | "answer_from_profile";
};

/** The form section's marker; a form opened before the section existed leaves the facts unchanged. */
export const APPLICATION_FACTS_MARKER = "applicationFacts";

function text(formData: FormData, name: string, maxLength: number): string | null | undefined {
  const value = formData.get(name);
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value.replace(/\s+/g, " ").trim() || null;
}

function wholeNumber(value: string | null | undefined, min: number, max: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return number >= min && number <= max ? number : undefined;
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
  const yearsOfExperience = wholeNumber(text(formData, "yearsOfExperience", 2), 0, 70);
  const githubUrl = webAddress(text(formData, "githubUrl", 2048));
  const portfolioUrl = webAddress(text(formData, "portfolioUrl", 2048));
  const eeoPreference = text(formData, "eeoPreference", 20) ?? "prefer_not_to_say";

  if (nationality === undefined) return "Nationality is too long (100 characters at most).";
  if (languages === undefined) return "Languages are too long (300 characters at most).";
  if (yearsOfExperience === undefined) return "Enter years of experience as a number from 0 to 70.";
  if (githubUrl === undefined) return "Enter a valid GitHub address.";
  if (portfolioUrl === undefined) return "Enter a valid portfolio or website address.";
  if (eeoPreference !== "prefer_not_to_say" && eeoPreference !== "answer_from_profile") {
    return "Choose how diversity questions are answered.";
  }
  return { nationality, languages, yearsOfExperience, githubUrl, portfolioUrl, eeoPreference };
}
