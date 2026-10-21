export function generatedResumeLocalPath(
  firstName: string | null,
  lastName: string | null,
): string {
  const candidateName = [firstName, lastName].filter(Boolean).join(" ") || "Candidate";
  const fileStem = candidateName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .replace(/\s+/g, "_") || "Candidate";
  return `QTS_Resume/${fileStem}_Resume.pdf`;
}

export function generationDownloadPaths(input: {
  managerName: string;
  candidateName: string;
  jobTitle: string;
  company: string;
  createdAt: Date;
}): { resume: string; coverLetter: string; jobDescription: string } {
  const manager = safePathPart(input.managerName, "Manager");
  const candidate = safePathPart(input.candidateName, "Candidate");
  const job = safePathPart(input.jobTitle, "Job");
  const company = safePathPart(input.company, "Company");
  const folder = `QTS_Resume/${manager}/${candidate}/${pacificTimestamp(input.createdAt)}_${job}_${company}`;
  return {
    resume: `${folder}/${candidate}.pdf`,
    coverLetter: `${folder}/${candidate}_Cover_Letter.pdf`,
    jobDescription: `${folder}/JD.txt`,
  };
}

function safePathPart(value: string, fallback: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function pacificTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}_${value("hour")}-${value("minute")}-${value("second")}`;
}
