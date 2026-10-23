import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { getJdEvaluationPromptTemplate } from "./get-jd-evaluation-prompt";

test("saved Get JD prompt defines remote eligibility and extraction without requiring jobUrl", () => {
  const prompt = getJdEvaluationPromptTemplate;
  assert.match(prompt, /For a valid job, default isRemote to true/);
  assert.match(prompt, /onsite, hybrid, office-based work, or physical office attendance/);
  assert.match(prompt, /broad-region rule takes precedence over named-country rules/);
  assert.match(prompt, /accept only if Romania is included/);
  assert.match(prompt, /Preserve the full available primary job description/);
  assert.match(prompt, /Do not include `location` or `jobUrl` in the JSON response/);
  assert.doesNotMatch(prompt, /"jobUrl"/);
  assert.match(prompt, /Do not include `location` or `jobUrl` in the JSON response/);
  assert.doesNotMatch(prompt, /"location"/);
  assert.doesNotMatch(prompt, /full description, location, country/);
  assert.match(prompt, /Never invent information or use details from secondary listings/);
  assert.match(prompt, /If work arrangement is unspecified, leave workplaceType empty/);
  assert.match(prompt, /Evaluate each candidate independently using only the primary job and that candidate's own jdMatching field/);
  assert.match(prompt, /If the page is invalid or no candidates match, return an empty matchingProfileIndexes array/);
  assert.match(prompt, /Do not return a separate passesJobPolicy field/);
  assert.match(prompt, /"isRemote": true/);
  assert.match(prompt, /"matchingProfileIndexes": \[0\]/);
  assert.match(prompt, /Related or recommended job listings do not invalidate the primary posting/);
  assert.match(prompt, /Never use candidate names, categories, other candidates' notes, residency, or geographic eligibility/);
});

test("database migration installs the same Get JD evaluation prompt", () => {
  const migration = readFileSync(
    path.join(process.cwd(), "drizzle", "0042_get_jd_remove_gemini_job_url.sql"),
    "utf8",
  );
  assert.match(migration, /supplied primary webpage URL/);
  assert.match(migration, /"jobUrl"/);
  assert.match(migration, /location, country/);
  assert.match(migration, /"location"/);
  assert.match(migration, /regexp_replace/);
  assert.doesNotMatch(getJdEvaluationPromptTemplate, /"jobUrl"/);
});
