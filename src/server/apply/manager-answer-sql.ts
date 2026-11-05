import { sql } from "drizzle-orm";
import { managerApplyAnswers } from "@/db/schema";
import { answerMeaning, type AnswerVariant } from "./manager-answer-values";

/** Merge against the locked row, retaining only variants with the same known meaning. */
export function variantUpdate(next: AnswerVariant, authoritativeAnswer = next.answer, appendOnly = false, normalOnly = false) {
  const normalized = sql`lower(regexp_replace(btrim(${managerApplyAnswers.answer}), '\\s+', ' ', 'g'))`;
  const meaning = sql`case when ${normalized} in ('linkedin', 'linkedin job post', 'linkedin job posting', 'linkedin job board') then 'linkedin job post' else ${normalized} end`;
  return sql<AnswerVariant[]>`(
    select coalesce(jsonb_agg(kept.value order by kept.ord), '[]'::jsonb)
    from (
      select saved.value, saved.ord
      from jsonb_array_elements(case when ${appendOnly} or ${meaning} = ${answerMeaning(authoritativeAnswer)} then ${managerApplyAnswers.variants} else '[]'::jsonb end)
        with ordinality as saved(value, ord)
      where not ((coalesce(saved.value->'normalVariation', saved.value)->>'kind') = ${next.kind}
        and ${normalOnly} = (saved.value ? 'normalVariation')
        and coalesce(coalesce(saved.value->'normalVariation', saved.value)->>'questionText', '') = ${next.questionText || ''}
        and coalesce(coalesce(saved.value->'normalVariation', saved.value)->'representation', 'null'::jsonb) = ${JSON.stringify(next.representation || null)}::jsonb
        and coalesce(coalesce(saved.value->'normalVariation', saved.value)->>'policyContext', '') = ${next.policyContext || ''}
        and (coalesce(saved.value->'normalVariation', saved.value)->'options') @> ${JSON.stringify(next.options)}::jsonb
        and ${JSON.stringify(next.options)}::jsonb @> (coalesce(saved.value->'normalVariation', saved.value)->'options'))
        and (not (saved.value ? 'identity') or saved.value->'identity'->>'key' = ${next.identity?.key || ''})
      order by saved.ord desc limit 29
    ) as kept
  ) || ${normalOnly ? sql`jsonb_build_array(jsonb_build_object('kind', 'normal-variation', 'options', '[]'::jsonb,
    'answer', ${managerApplyAnswers.answer}, 'identity', ${JSON.stringify(next.identity)}::jsonb, 'normalVariation', ${JSON.stringify(next)}::jsonb))` : sql`${JSON.stringify([next])}::jsonb`}`;
}
