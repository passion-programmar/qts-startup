// Candidate facts that application forms ask for (profiles columns from migrations 0062 and 0064).
// Apply fills what fits from here and ChatGPT answers the rest from them. Pure, so it is testable.

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
  nationality: string | null;
  workCountries: string | null;
  workPermitExpiry: string | null;
  languages: string | null;
  contractType: "employment" | "b2b" | "either" | null;
  workHours: "full_time" | "part_time" | "either" | null;
  workMode: "remote" | "hybrid" | "onsite" | "any" | null;
  applicationNotes: string | null;
};

const CONTRACT_TYPES = ["employment", "b2b", "either"];
const WORK_HOURS = ["full_time", "part_time", "either"];
const WORK_MODES = ["remote", "hybrid", "onsite", "any"];

/** A choice from a fixed list: null when empty, undefined when not one of them. */
function choice(value: string | null | undefined, allowed: string[]): string | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  return allowed.includes(value) ? value : undefined;
}

/** Free text that keeps its line breaks (the notes for ChatGPT). */
function notes(formData: FormData, name: string, maxLength: number): string | null | undefined {
  const value = formData.get(name);
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() || null;
}

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
  const nationality = text(formData, "nationality", 100);
  const workCountries = text(formData, "workCountries", 300);
  const workPermitExpiry = text(formData, "workPermitExpiry", 10);
  const languages = text(formData, "languages", 300);
  const contractType = choice(text(formData, "contractType", 10), CONTRACT_TYPES);
  const workHours = choice(text(formData, "workHours", 10), WORK_HOURS);
  const workMode = choice(text(formData, "workMode", 10), WORK_MODES);
  const applicationNotes = notes(formData, "applicationNotes", 2000);

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
  if (nationality === undefined) return "Nationality is too long (100 characters at most).";
  if (workCountries === undefined) return "The countries the candidate may work in are too long (300 characters at most).";
  if (workPermitExpiry === undefined || (workPermitExpiry && !validDate(workPermitExpiry))) {
    return "Enter the work permit expiry as a date.";
  }
  if (languages === undefined) return "Languages are too long (300 characters at most).";
  if (contractType === undefined) return "Choose the contract type.";
  if (workHours === undefined) return "Choose the working hours.";
  if (workMode === undefined) return "Choose the work mode.";
  if (applicationNotes === undefined) return "The notes for applications are too long (2000 characters at most).";
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
    nationality,
    workCountries,
    workPermitExpiry,
    languages,
    contractType: contractType as ApplicationFacts["contractType"],
    workHours: workHours as ApplicationFacts["workHours"],
    workMode: workMode as ApplicationFacts["workMode"],
    applicationNotes,
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
