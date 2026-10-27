import assert from "node:assert/strict";
import test from "node:test";
import { getJdAccountState, summarizeAccountStates } from "@/server/jobs/get-jd-account-states";

const row = (overrides: Partial<{ kind: "applied" | "job_list"; jobStatus: string; generationStatus: string }>) => ({
  kind: "job_list" as const,
  jobStatus: "todo",
  rowId: "row-1",
  generationStatus: "not_queued",
  ...overrides,
});

test("account states lock applied and running accounts and mark saved ones", () => {
  assert.equal(getJdAccountState(null), "available");
  assert.equal(getJdAccountState(row({ kind: "applied" })), "applied");
  assert.equal(getJdAccountState(row({ generationStatus: "processing" })), "generation_running");
  assert.equal(getJdAccountState(row({})), "has_job");
});

test("the summary counts each state and says when nothing is left to add", () => {
  assert.equal(
    summarizeAccountStates(["applied", "has_job", "generation_running", "available", "available", "available"]).text,
    "Applied by 1 candidate · 2 already have this job · 3 can be added.",
  );
  assert.equal(summarizeAccountStates(["has_job", "available"]).text, "1 already has this job · 1 can be added.");
  assert.equal(summarizeAccountStates(["applied", "has_job"]).text, "All candidates already have this job.");
  assert.equal(summarizeAccountStates([]).text, "No active candidates.");
});

test("a candidate who works at the company now is counted apart", () => {
  assert.equal(summarizeAccountStates(["works_here", "available"]).text, "1 candidate works there now · 1 can be added.");
  assert.equal(summarizeAccountStates(["has_job", "works_here"]).text, "1 already has this job · 1 candidate works there now.");
});
