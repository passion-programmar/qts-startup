import assert from "node:assert/strict";
import test from "node:test";
import { readExtensionSavedJob } from "@/server/jobs/get-jd-save-values";

test("extension job saves preserve the extracted description", () => {
  const job = readExtensionSavedJob({
    job: {
      jobUrl: "https://example.com/jobs/123/#apply",
      title: "Senior Engineer",
      company: "Example",
      description: "Build reliable services.",
      location: "Remote",
      country: "Romania",
      employmentType: "Full-time",
      workplaceType: "Hybrid",
      salary: "$120,000-$150,000 per year",
      reason: "The posting requires hybrid work.",
    },
  });

  assert.deepEqual(job, {
    jobUrl: "https://example.com/jobs/123",
    jobTitle: "Senior Engineer",
    company: "Example",
    description: "Build reliable services.",
    location: "Remote",
    country: "Romania",
    employmentType: "Full-time",
    workplaceType: "Hybrid",
    salary: "$120,000-$150,000 per year",
    jobReason: "The posting requires hybrid work.",
  });
});

test("extension job saves default optional job details to null", () => {
  const job = readExtensionSavedJob({
    job: {
      jobUrl: "https://example.com/jobs/123",
      title: "Senior Engineer",
      company: "Example",
      description: "Build reliable services.",
      location: "",
    },
  });

  assert.equal(job?.employmentType, null);
  assert.equal(job?.workplaceType, null);
  assert.equal(job?.salary, null);
  assert.equal(job?.country, null);
  assert.equal(job?.jobReason, null);
});

test("extension job saves reject an oversized Gemini eligibility reason", () => {
  assert.equal(readExtensionSavedJob({
    job: {
      jobUrl: "https://example.com/jobs/123",
      title: "Senior Engineer",
      company: "Example",
      description: "Build reliable services.",
      location: "",
      reason: "x".repeat(1201),
    },
  }), null);
});

test("extension job saves reject a missing or oversized description", () => {
  const base = {
    jobUrl: "https://example.com/jobs/123",
    title: "Senior Engineer",
    company: "Example",
    location: "",
  };
  assert.equal(readExtensionSavedJob({ job: base }), null);
  assert.equal(
    readExtensionSavedJob({ job: { ...base, description: "x".repeat(100_001) } }),
    null,
  );
});
