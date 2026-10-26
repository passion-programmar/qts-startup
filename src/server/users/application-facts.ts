// Candidate facts that application forms ask for (profiles columns from migration 0062). Apply
// fills them only from here and stops when a required one is missing. Pure, so it is testable.

export type ApplicationFacts = {
  workAuthorization: string | null;
  needsSponsorship: boolean | null;
  noticePeriod: "immediately" | "1_week";
  salaryExpectationAmount: number | null;
  salaryExpectationCurrency: string | null;
  salaryExpectationPeriod: "year" | "month" | "day" | "hour" | null;
  yearsOfExperience: number | null;
  willingToRelocate: boolean | null;
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

function yesNo(value: string | null | undefined): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  if (value === "yes") return true;
  if (value === "no") return false;
  return undefined;
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
  const workAuthorization = text(formData, "workAuthorization", 300);
  const needsSponsorship = yesNo(text(formData, "needsSponsorship", 3));
  const noticeChoice = text(formData, "noticePeriod", 11);
  const noticePeriod = noticeChoice === null ? "immediately" : noticeChoice;
  const salaryAmount = wholeNumber(text(formData, "salaryExpectationAmount", 12), 1, 100_000_000);
  const salaryCurrency = text(formData, "salaryExpectationCurrency", 3);
  const salaryPeriod = text(formData, "salaryExpectationPeriod", 5);
  const yearsOfExperience = wholeNumber(text(formData, "yearsOfExperience", 2), 0, 70);
  const willingToRelocate = yesNo(text(formData, "willingToRelocate", 3));
  const githubUrl = webAddress(text(formData, "githubUrl", 2048));
  const portfolioUrl = webAddress(text(formData, "portfolioUrl", 2048));
  const eeoPreference = text(formData, "eeoPreference", 20) ?? "prefer_not_to_say";

  if (workAuthorization === undefined) return "Work authorization is too long (300 characters at most).";
  if (needsSponsorship === undefined) return "Choose whether the candidate needs visa sponsorship.";
  if (noticePeriod !== "immediately" && noticePeriod !== "1_week") return "Choose a notice period: immediately or 1 week.";
  if (salaryAmount === undefined) return "Enter the salary expectation as a whole number.";
  if (salaryCurrency === undefined || (salaryCurrency && !/^[A-Za-z]{3}$/.test(salaryCurrency))) {
    return "Enter the salary currency as a 3-letter code, such as EUR or USD.";
  }
  if (salaryPeriod === undefined || (salaryPeriod && !["year", "month", "day", "hour"].includes(salaryPeriod))) {
    return "Choose whether the salary is per year, month, day, or hour.";
  }
  if (salaryAmount !== null && (!salaryCurrency || !salaryPeriod)) {
    return "Give the salary expectation's currency and period too.";
  }
  if (yearsOfExperience === undefined) return "Enter years of experience as a number from 0 to 70.";
  if (willingToRelocate === undefined) return "Choose whether the candidate is willing to relocate.";
  if (githubUrl === undefined) return "Enter a valid GitHub address.";
  if (portfolioUrl === undefined) return "Enter a valid portfolio or website address.";
  if (eeoPreference !== "prefer_not_to_say" && eeoPreference !== "answer_from_profile") {
    return "Choose how diversity questions are answered.";
  }
  return {
    workAuthorization,
    needsSponsorship,
    noticePeriod,
    salaryExpectationAmount: salaryAmount,
    salaryExpectationCurrency: salaryCurrency ? salaryCurrency.toUpperCase() : null,
    salaryExpectationPeriod: (salaryPeriod as ApplicationFacts["salaryExpectationPeriod"]) ?? null,
    yearsOfExperience,
    willingToRelocate,
    githubUrl,
    portfolioUrl,
    eeoPreference,
  };
}
