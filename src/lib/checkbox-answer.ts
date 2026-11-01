/** Checkbox states only; ordinary Yes/No and free-text answers remain text. */
export function checkboxAnswerValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (["true", "ticked", "checked", "☑", "☑ checked"].includes(text)) return true;
  if (["false", "not ticked", "unchecked", "☐", "☐ unchecked"].includes(text)) return false;
  return null;
}

// Existing columns are text: store the canonical JSON boolean literal without a migration.
export function normalizeCheckboxAnswer(value: unknown): unknown {
  const checked = checkboxAnswerValue(value);
  return checked === null ? value : String(checked);
}

export function displayReusableAnswer(value: string): string {
  const checked = checkboxAnswerValue(value);
  return checked === null ? value : checked ? "☑ Checked" : "☐ Unchecked";
}
