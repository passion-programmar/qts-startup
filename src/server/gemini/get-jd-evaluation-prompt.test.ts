import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getJdEvaluationPromptTemplate } from "./get-jd-evaluation-prompt";

test("saved Get JD prompt defines remote eligibility, extraction, and an explanation reason", () => {
  const prompt = getJdEvaluationPromptTemplate;
  assert.match(prompt, /For a valid job, default isRemote to true/);
  assert.match(prompt, /onsite, hybrid, office-based work, or physical office attendance/);
  assert.match(prompt, /broad-region rule takes precedence over named-country rules/);
  assert.match(prompt, /Accept eligibility limited to multiple specifically named countries/);
  assert.doesNotMatch(prompt, /only if Romania is included/);
  assert.match(prompt, /Preserve the full available primary job description/);
  assert.match(prompt, /Set jobUrl to the supplied primary page URL/);
  assert.match(prompt, /"location": "Example location"/);
  assert.match(prompt, /"jobUrl": "https:\/\/example\.com\/jobs\/123"/);
  assert.match(prompt, /"reason": "The posting allows remote work/);
  assert.match(prompt, /job\.reason must contain 1–2 clear sentences/);
  assert.match(prompt, /Never invent information or use details from secondary listings/);
  assert.match(prompt, /If work arrangement is unspecified, leave workplaceType empty/);
  assert.match(prompt, /Evaluate each candidate independently using only the primary job and that candidate's own jdMatching field/);
  assert.match(prompt, /If the page is invalid or no candidates match, return an empty matchingProfileIndexes array/);
  assert.match(prompt, /Do not return a separate passesJobPolicy field/);
  assert.match(prompt, /"isRemote": true/);
  assert.match(prompt, /"matchingProfileIndexes": \[0\]/);
  assert.match(prompt, /Related or recommended job listings do not invalidate the primary posting/);
  assert.match(prompt, /Never use candidate names, categories, other candidates' notes, residency, or geographic eligibility/);
  assert.match(prompt, /Put the result explanation only in job\.reason/);
});

test("database migrations replace stale URL handling and install the result reason prompt", () => {
  const urlMigration = readFileSync(
    path.join(process.cwd(), "drizzle", "0042_get_jd_remove_gemini_job_url.sql"),
    "utf8",
  );
  assert.match(urlMigration, /supplied primary webpage URL/);
  assert.match(urlMigration, /"jobUrl"/);
  assert.match(urlMigration, /location, country/);
  assert.match(urlMigration, /"location"/);
  assert.match(urlMigration, /regexp_replace/);
  const reasonMigration = readFileSync(
    path.join(process.cwd(), "drizzle", "0043_get_jd_result_reason.sql"),
    "utf8",
  );
  assert.match(reasonMigration, /"reason": "The posting allows remote work/);
  assert.match(reasonMigration, /"location": "Example location"/);
  assert.match(reasonMigration, /"jobUrl": "https:\/\/example\.com\/jobs\/123"/);
  assert.match(reasonMigration, /job\.reason must contain 1–2 clear sentences/);
  assert.match(reasonMigration, /Accept eligibility limited to multiple specifically named countries/);
  assert.doesNotMatch(getJdEvaluationPromptTemplate, /Do not include `location` or `jobUrl`/);
});
