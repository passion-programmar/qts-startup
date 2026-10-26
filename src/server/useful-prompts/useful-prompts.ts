import "server-only";

import { and, asc, desc, eq } from "drizzle-orm";
import { usefulPrompts } from "@/db/schema";
import { db } from "@/lib/db";
import { groupUsefulPrompts, type UsefulPrompt } from "./useful-prompt-values";

// A Manager's useful prompts: a private library with every version kept. Nothing else reads them.

export class UsefulPromptError extends Error {}

export async function listUsefulPrompts(managerId: string): Promise<UsefulPrompt[]> {
  const rows = await db
    .select({
      id: usefulPrompts.id,
      promptKey: usefulPrompts.promptKey,
      version: usefulPrompts.version,
      title: usefulPrompts.title,
      content: usefulPrompts.content,
      createdAt: usefulPrompts.createdAt,
    })
    .from(usefulPrompts)
    .where(eq(usefulPrompts.managerId, managerId))
    .orderBy(asc(usefulPrompts.createdAt));
  return groupUsefulPrompts(rows);
}

async function currentVersion(managerId: string, promptKey: string) {
  const [current] = await db
    .select({ version: usefulPrompts.version, title: usefulPrompts.title, content: usefulPrompts.content })
    .from(usefulPrompts)
    .where(and(eq(usefulPrompts.managerId, managerId), eq(usefulPrompts.promptKey, promptKey)))
    .orderBy(desc(usefulPrompts.version))
    .limit(1);
  return current ?? null;
}

/**
 * Adds a prompt (version 1), or a new version of one when promptKey is given. An unchanged save is
 * refused so the history holds only real changes. Returns the saved version number.
 */
export async function saveUsefulPrompt(input: {
  managerId: string;
  promptKey: string | null;
  title: string;
  content: string;
}): Promise<number> {
  const promptKey = input.promptKey ?? crypto.randomUUID();
  let version = 1;
  if (input.promptKey) {
    const current = await currentVersion(input.managerId, input.promptKey);
    if (!current) throw new UsefulPromptError("That prompt was not found. Refresh and try again.");
    if (current.title === input.title && current.content === input.content) {
      throw new UsefulPromptError("Nothing changed, so no new version was saved.");
    }
    version = current.version + 1;
  }
  try {
    await db.insert(usefulPrompts).values({
      promptKey,
      managerId: input.managerId,
      version,
      title: input.title,
      content: input.content,
    });
  } catch (error) {
    // Two saves of the same prompt at once: the unique version index lets only one through.
    if (error instanceof Error && /useful_prompts_key_version_unique/.test(`${error.message} ${String(error.cause ?? "")}`)) {
      throw new UsefulPromptError("This prompt was just changed elsewhere. Refresh and try again.");
    }
    throw error;
  }
  return version;
}

/** Puts an earlier version back as the newest one; the history keeps everything in between. */
export async function restoreUsefulPromptVersion(managerId: string, versionId: string): Promise<number> {
  const [earlier] = await db
    .select({ promptKey: usefulPrompts.promptKey, title: usefulPrompts.title, content: usefulPrompts.content })
    .from(usefulPrompts)
    .where(and(eq(usefulPrompts.managerId, managerId), eq(usefulPrompts.id, versionId)))
    .limit(1);
  if (!earlier) throw new UsefulPromptError("That version was not found. Refresh and try again.");
  return saveUsefulPrompt({ managerId, promptKey: earlier.promptKey, title: earlier.title, content: earlier.content });
}

/** Deletes a prompt with its whole history. */
export async function deleteUsefulPrompt(managerId: string, promptKey: string): Promise<boolean> {
  const removed = await db
    .delete(usefulPrompts)
    .where(and(eq(usefulPrompts.managerId, managerId), eq(usefulPrompts.promptKey, promptKey)))
    .returning({ id: usefulPrompts.id });
  return removed.length > 0;
}
