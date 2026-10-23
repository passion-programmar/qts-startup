import assert from "node:assert/strict";
import test from "node:test";
import {
  geminiJobEvaluationResponseSchema,
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
  assert.equal("jobUrl" in geminiJobEvaluationResponseSchema.properties.job.properties, true);
  assert.equal("reason" in geminiJobEvaluationResponseSchema.properties.job.properties, true);
  assert.deepEqual(geminiJobEvaluationResponseSchema.properties.job.required, [
    "title",
    "company",
    "description",
    "location",
    "country",
    "employmentType",
    "workplaceType",
    "salary",
    "jobUrl",
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