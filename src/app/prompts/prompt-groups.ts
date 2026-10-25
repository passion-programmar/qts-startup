import type { PromptVersion } from "@/app/settings/prompt-forms";

type VersionRow = {
  id: string;
  promptGroupId: string;
  name: string;
  promptTemplate: string;
  version: number;
  isActive: boolean;
  createdAt: Date;
};

/** One entry per prompt: its active version plus every saved version, oldest prompt first. */
export function groupVersions(rows: VersionRow[]) {
  const groups = new Map<string, { firstSaved: number; active?: VersionRow; versions: PromptVersion[] }>();
  for (const row of rows) {
    const group = groups.get(row.promptGroupId) ?? { firstSaved: row.createdAt.getTime(), versions: [] };
    group.firstSaved = Math.min(group.firstSaved, row.createdAt.getTime());
    if (row.isActive) group.active = row;
    group.versions.push({
      id: row.id,
      version: row.version,
      isActive: row.isActive,
      promptTemplate: row.promptTemplate,
      savedOn: row.createdAt.toISOString().slice(0, 10),
    });
    groups.set(row.promptGroupId, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.active)
    .sort(([, a], [, b]) => a.firstSaved - b.firstSaved)
    .map(([promptGroupId, group]) => ({
      promptGroupId,
      activeId: group.active!.id,
      name: group.active!.name,
      version: group.active!.version,
      promptTemplate: group.active!.promptTemplate,
      versions: group.versions,
    }));
}
