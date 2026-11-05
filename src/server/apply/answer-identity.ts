import { sql, type SQL } from "drizzle-orm";
import semantics from "../../../extension/shared/semantic-fields.js";
import identity from "../../../extension/shared/answer-identity.js";
import { correctionKey } from "./manager-answer-values";

export const identityEnabled = () => process.env.QTS_ANSWER_IDENTITY_V1 !== "0";
export function identityMetadata(question: string) {
  const value = identityEnabled() ? identity.identity(question) : null;
  return value ? { questionText: question, identity: value } : {};
}

// Run inside a SERIALIZABLE write transaction: predicate reads protect concurrent
// equivalent creates without a new unique index or rewriting old question keys.
export function semanticWriteGuard(managerId: string, context: SQL, question: string, excludeId: string | null, knownRows: {questionText: string}[] = []) {
  const meaning = identityEnabled() ? identity.identity(question) : null;
  if (!meaning) return sql`true`;
  const aliases = semantics.recognize(question)?.definition?.aliases || [];
  const labels = [...knownRows.map((row) => row.questionText), question, ...aliases.flatMap((alias) =>
    ['', 'Your ', 'Please enter ', 'Please enter your ', 'Please provide ', 'Please provide your ', 'What is your '].map((prefix) => prefix + alias))];
  const keys = [...new Set(labels.filter((label) => identity.same(label, question)).map(correctionKey))];
  return sql`not exists(select 1 from manager_apply_answers duplicate
    where duplicate.manager_id = ${managerId}::uuid and duplicate.context_key = ${context}
      and (${excludeId}::uuid is null or duplicate.id <> ${excludeId}::uuid)
      and (duplicate.question_key in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
        or exists(select 1 from jsonb_array_elements(duplicate.variants) v where v->'identity'->>'key' = ${meaning.key})))`;
}
