import "server-only";

import { randomUUID } from "node:crypto";
import { neonSql } from "@/lib/db";

// Prompts are versioned per prompt group: saving adds a version and makes it the active one,
// and no version is ever deleted. Library prompts have no owner; a Manager's own prompts carry
// owner_manager_id, and every lookup here is scoped to that owner so no one reaches another's.

type PromptProvider = "openai" | "gemini";
type PromptPurpose = "document_generation" | "job_description_evaluation" | "application_answer";

export class PromptVersionError extends Error {}

export async function savePromptVersion(input: {
  promptGroupId: string | null;
  ownerManagerId: string | null;
  provider: PromptProvider;
  purpose: PromptPurpose;
  name: string;
  promptTemplate: string;
  makeDefault: boolean;
  actorId: string;
}): Promise<{ version: number }> {
  const { provider, purpose, ownerManagerId } = input;
  let wasDefault = false;
  if (input.promptGroupId) {
    const [group] = await neonSql`
      select bool_or(is_default) as was_default
      from prompts
      where prompt_group_id = ${input.promptGroupId}::uuid
        and provider = ${provider}::prompt_provider
        and purpose = ${purpose}::prompt_purpose
        and owner_manager_id is not distinct from ${ownerManagerId}::uuid
        and archived_at is null
      having count(*) > 0
    `;
    if (!group) throw new PromptVersionError("That prompt was not found. Refresh and try again.");
    wasDefault = group.was_default === true;
  }
  const promptGroupId = input.promptGroupId ?? randomUUID();
  // Only library prompts can be the default; a Manager's own prompts never are.
  const isDefault = ownerManagerId === null && (input.makeDefault || wasDefault);

  const results = await neonSql.transaction((tx) => [
    tx`select pg_advisory_xact_lock(hashtext(${provider}), hashtext(${purpose}))`,
    ...(isDefault && !wasDefault
      ? [tx`
          update prompts set is_default = false, updated_at = now()
          where provider = ${provider}::prompt_provider
            and purpose = ${purpose}::prompt_purpose
            and is_default
        `]
      : []),
    tx`
      update prompts set is_active = false, is_default = false, updated_at = now()
      where prompt_group_id = ${promptGroupId}::uuid and (is_active or is_default)
    `,
    tx`
      insert into prompts (
        prompt_group_id, provider, purpose, owner_manager_id, name, prompt_template, version,
        is_active, is_default, created_by_user_id
      )
      select
        ${promptGroupId}::uuid,
        ${provider}::prompt_provider,
        ${purpose}::prompt_purpose,
        ${ownerManagerId}::uuid,
        ${input.name},
        ${input.promptTemplate},
        coalesce(max(version), 0) + 1,
        true,
        ${isDefault},
        ${input.actorId}::uuid
      from prompts
      where prompt_group_id = ${promptGroupId}::uuid
      returning version
    `,
  ]);
  const inserted = results[results.length - 1];
  if (!inserted || inserted.length !== 1) {
    throw new PromptVersionError("The prompt could not be saved.");
  }
  return { version: Number(inserted[0].version) };
}

/** Puts an earlier version back in use. Nothing is deleted; only the active version moves. */
export async function activatePromptVersion(input: {
  promptId: string;
  ownerManagerId: string | null;
}): Promise<{ version: number }> {
  const [target] = await neonSql`
    select prompt_group_id, provider, purpose, version, is_active,
      (select bool_or(g.is_default) from prompts g where g.prompt_group_id = p.prompt_group_id) as was_default
    from prompts p
    where id = ${input.promptId}::uuid
      and provider = 'openai'
      and purpose = 'document_generation'
      and owner_manager_id is not distinct from ${input.ownerManagerId}::uuid
      and archived_at is null
  `;
  if (!target) throw new PromptVersionError("That version was not found. Refresh and try again.");
  const version = Number(target.version);
  if (target.is_active) throw new PromptVersionError(`Version ${version} is already in use.`);

  await neonSql.transaction((tx) => [
    tx`select pg_advisory_xact_lock(hashtext('openai'), hashtext('document_generation'))`,
    tx`
      update prompts set is_active = false, is_default = false, updated_at = now()
      where prompt_group_id = ${target.prompt_group_id}::uuid and (is_active or is_default)
    `,
    tx`
      update prompts set is_active = true, is_default = ${target.was_default === true}, updated_at = now()
      where id = ${input.promptId}::uuid
    `,
  ]);
  return { version };
}

/** Deleting a Manager's prompt archives all its versions, so Jobs and Bids keep their history. */
export async function archiveManagerPrompt(input: {
  promptGroupId: string;
  ownerManagerId: string;
}): Promise<boolean> {
  const archived = await neonSql`
    update prompts set archived_at = now(), updated_at = now()
    where prompt_group_id = ${input.promptGroupId}::uuid
      and owner_manager_id = ${input.ownerManagerId}::uuid
      and archived_at is null
    returning id
  `;
  return archived.length > 0;
}
