import { sql } from "drizzle-orm";
import { jobs } from "@/db/schema";

// A job's description is description when present, otherwise the plain page_text
// saved when no description was available (docs/get-jd-redesign.md, section 2).
export function effectiveJobDescription() {
  return sql<string | null>`coalesce(nullif(btrim(${jobs.description}), ''), ${jobs.pageText})`;
}

export function hasEffectiveJobDescription() {
  return sql<boolean>`length(btrim(coalesce(nullif(btrim(${jobs.description}), ''), ${jobs.pageText}, ''))) > 0`;
}
