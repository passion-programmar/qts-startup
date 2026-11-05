import { sql } from "drizzle-orm";
import { managerApplyAnswers } from "@/db/schema";
import { answerMeaning, type AnswerVariant } from "./manager-answer-values";

/** Merge against the locked row, retaining only variants with the same known meaning. */
export function variantUpdate(next: AnswerVariant) {
  const normalized = sql`lower(regexp_replace(btrim(${managerApplyAnswers.answer}), '\\s+', ' ', 'g'))`;
  const meaning = sql`case when ${normalized} in ('linkedin', 'linkedin job post', 'linkedin job posting', 'linkedin job board') then 'linkedin job post' else ${normalized} end`;
  return sql<AnswerVariant[]>`(
    select coalesce(jsonb_agg(kept.value order by kept.ord), '[]'::jsonb)
    from (
      select saved.value, saved.ord
      from jsonb_array_elements(case when ${meaning} = ${answerMeaning(next.answer)} then ${managerApplyAnswers.variants} else '[]'::jsonb end)
        with ordinality as saved(value, ord)
      where not ((saved.value->>'kind') = ${next.kind}
        and (saved.value->'options') @> ${JSON.stringify(next.options)}::jsonb
        and ${JSON.stringify(next.options)}::jsonb @> (saved.value->'options'))
      order by saved.ord desc limit 29
    ) as kept
  ) || ${JSON.stringify([next])}::jsonb`;
}
