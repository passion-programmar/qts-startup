import type { PdfPackage } from "@/app/pdf/document-data";

export type GenerationOutputFacts = {
  candidate: {
    fullName: string;
    email: string;
    phone: string;
    linkedinUrl: string;
    location: string;
  };
  job: {
    title: string;
    company: string;
  };
};

// Identity and target consistency only; content is controlled by the Manager prompt.
export function generationOutputIssue(
  documents: PdfPackage,
  facts: GenerationOutputFacts,
): string | null {
  const { resume, coverLetter } = documents;
  const candidateCopies = [resume.candidate, coverLetter.candidate];
  for (const candidate of candidateCopies) {
    if (
      !sameText(candidate.fullName, facts.candidate.fullName)
      || candidate.email.trim().toLowerCase() !== facts.candidate.email.trim().toLowerCase()
    ) {
      return "The generated documents must use the candidate's saved name and email.";
    }
    if (
      !samePhone(candidate.phone, facts.candidate.phone)
      || !sameLinkedIn(candidate.linkedinUrl, facts.candidate.linkedinUrl)
      || !sameText(candidate.location, facts.candidate.location)
    ) {
      return "The generated documents must preserve the candidate's saved contact details.";
    }
  }
  if (coverLetter.signatureName && !sameText(coverLetter.signatureName, facts.candidate.fullName)) {
    return "The cover-letter signature must use the candidate's saved name.";
  }

  if (
    !sameText(resume.targetRole, facts.job.title)
    || !sameText(coverLetter.targetRole, facts.job.title)
  ) {
    return "The résumé and cover letter must use the saved job title.";
  }
  if (
    !sameText(resume.targetCompany, facts.job.company)
    || !sameText(coverLetter.targetCompany, facts.job.company)
    || (coverLetter.recipient?.company && !sameText(coverLetter.recipient.company, facts.job.company))
  ) {
    return "The résumé and cover letter must use the saved company name.";
  }

  return null;
}

function sameText(value: string | undefined, expected: string): boolean {
  return normalizeText(value) === normalizeText(expected);
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function samePhone(value: string | undefined, expected: string): boolean {
  const digits = (entry: string | undefined) => (entry ?? "").replace(/\D/g, "");
  return expected.trim() ? Boolean(digits(expected)) && digits(value) === digits(expected) : !(value ?? "").trim();
}

function sameLinkedIn(value: string | undefined, expected: string): boolean {
  const canonical = (entry: string | undefined) =>
    (entry ?? "").trim().toLocaleLowerCase("en")
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/+$/, "");
  return canonical(value) === canonical(expected);
}
