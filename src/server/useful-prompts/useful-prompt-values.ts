// Rules for a Manager's useful prompts. Pure, so they are testable without a database.

export const USEFUL_PROMPT_TITLE_MAX = 200;
export const USEFUL_PROMPT_CONTENT_MAX = 50000;

export type UsefulPromptVersion = { id: string; version: number; title: string; content: string; savedAt: string };
// One prompt: its current version first, then every earlier one, newest first.
export type UsefulPrompt = {
  promptKey: string;
  title: string;
  content: string;
  version: number;
  updatedAt: string;
  createdAt: string;
  versions: UsefulPromptVersion[];
};

/** A title and content, trimmed and checked; a string is the reason it is refused. */
export function parseUsefulPrompt(input: { title: unknown; content: unknown }): { title: string; content: string } | string {
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
  const content = typeof input.content === "string" ? input.content.replace(/\r\n/g, "\n").trim() : "";
  if (!title) return "Enter a title.";
  if (title.length > USEFUL_PROMPT_TITLE_MAX) return `The title is too long (${USEFUL_PROMPT_TITLE_MAX} characters at most).`;
  if (!content) return "Enter the prompt text.";
  if (content.length > USEFUL_PROMPT_CONTENT_MAX) {
    return `The prompt is too long (${USEFUL_PROMPT_CONTENT_MAX.toLocaleString("en-US")} characters at most).`;
  }
  return { title, content };
}

/** Saved rows grouped by prompt, the most recently changed prompt first. */
export function groupUsefulPrompts(
  rows: { id: string; promptKey: string; version: number; title: string; content: string; createdAt: Date }[],
): UsefulPrompt[] {
  const byKey = new Map<string, UsefulPromptVersion[]>();
  for (const row of rows) {
    const versions = byKey.get(row.promptKey) ?? [];
    versions.push({ id: row.id, version: row.version, title: row.title, content: row.content, savedAt: row.createdAt.toISOString() });
    byKey.set(row.promptKey, versions);
  }
  return [...byKey.entries()]
    .map(([promptKey, versions]) => {
      versions.sort((a, b) => b.version - a.version);
      const [current] = versions;
      return {
        promptKey,
        title: current.title,
        content: current.content,
        version: current.version,
        updatedAt: current.savedAt,
        createdAt: versions[versions.length - 1].savedAt,
        versions,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
