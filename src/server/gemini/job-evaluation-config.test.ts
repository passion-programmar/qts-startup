import assert from "node:assert/strict";
import test from "node:test";
import {
  geminiJobEvaluationResponseSchema,
  groqJobEvaluationJsonHint,
  isGetJdEvaluationAccepted,
} from "./job-evaluation-config";

test("Get JD response schema requires remote eligibility, page validation, job details, and candidate matches", () => {
  assert.deepEqual(geminiJobEvaluationResponseSchema.required, [
    "isJobPage",
    "isRemote",
    "job",
    "matchingProfileIndexes",
  ]);
  assert.equal("passesJobPolicy" in geminiJobEvaluationResponseSchema.properties, false);
  assert.equal("location" in geminiJobEvaluationResponseSchema.properties.job.properties, true);
  assert.equal("country" in geminiJobEvaluationResponseSchema.properties.job.properties, false);
  assert.equal("jobUrl" in geminiJobEvaluationResponseSchema.properties.job.properties, false);
  assert.equal("reason" in geminiJobEvaluationResponseSchema.properties.job.properties, true);
  // QTS saves the JD it sent, so the AI is not asked to write it back.
  assert.equal("description" in geminiJobEvaluationResponseSchema.properties.job.properties, false);
  assert.doesNotMatch(groqJobEvaluationJsonHint, /"description":\{"type"/);
  assert.deepEqual(geminiJobEvaluationResponseSchema.properties.job.required, [
    "title",
    "company",
    "location",
    "employmentType",
    "workplaceType",
    "salary",
    "reason",
  ]);
});

test("Get JD accepts only valid primary job pages that pass the saved remote policy", () => {
  assert.equal(isGetJdEvaluationAccepted({
    isJobPage: true,
    isRemote: true,
  }), true);
  assert.equal(isGetJdEvaluationAccepted({
    isJobPage: true,
    isRemote: false,
  }), false);
  assert.equal(isGetJdEvaluationAccepted({
    isJobPage: false,
    isRemote: true,
  }), false);
  assert.equal(isGetJdEvaluationAccepted({
    isJobPage: false,
    isRemote: false,
  }), false);
});