import assert from "node:assert/strict";
import test from "node:test";
import { locationWithCountry, readExtensionSavedJob } from "@/server/jobs/get-jd-save-values";

test("a separately sent country is kept inside location once", () => {
  assert.equal(locationWithCountry("Bucharest", "Romania"), "Bucharest, Romania");
  assert.equal(locationWithCountry("Bucharest, Romania", "romania"), "Bucharest, Romania");
  assert.equal(locationWithCountry("", "Japan"), "Japan");
  assert.equal(locationWithCountry(" Tokyo ", undefined), "Tokyo");
  assert.equal(locationWithCountry("", ""), null);
});

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
    pageText: null,
    location: "Remote, Romania",
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

test("page text is kept, and lets a save without a description through", () => {
  const job = (description: string, pageText?: unknown) => readExtensionSavedJob({
    job: { jobUrl: "https://example.com/jobs/1", title: "Engineer", company: "Example", description, location: "" },
    ...(pageText === undefined ? {} : { pageText }),
  });
  assert.equal(job("", "  Full page text  ")?.pageText, "Full page text");
  assert.equal(job("", "  ")?.description ?? null, null);
  assert.equal(job("", undefined), null);
  assert.equal(job("Has a description")?.pageText, null);
  assert.equal(job("Has a description", 42), null);
});
