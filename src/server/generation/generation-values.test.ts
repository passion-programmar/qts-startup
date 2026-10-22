import assert from "node:assert/strict";
import test from "node:test";
import { readGenerationJob } from "@/server/generation/generation-values";

test("generation job accepts and preserves salary and work details", () => {
  const job = readGenerationJob({
    job: {
      jobUrl: "https://example.com/jobs/123",
      jobTitle: "Senior Engineer",
      company: "Example",
      location: "Remote",
      employmentType: "Full-time",
      workplaceType: "Hybrid",
      salary: "$120,000-$150,000 per year",
      jobDescription: "Build reliable services.",
    },
  });

  assert.deepEqual(job, {
    jobUrl: "https://example.com/jobs/123",
    jobTitle: "Senior Engineer",
    company: "Example",
    location: "Remote",
    employmentType: "Full-time",
    workplaceType: "Hybrid",
    salary: "$120,000-$150,000 per year",
    jobDescription: "Build reliable services.",
  });
});
