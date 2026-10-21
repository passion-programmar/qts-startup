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
