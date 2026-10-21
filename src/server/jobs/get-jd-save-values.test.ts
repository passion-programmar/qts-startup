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
    },
  });

  assert.deepEqual(job, {
    jobUrl: "https://example.com/jobs/123",
    jobTitle: "Senior Engineer",
    company: "Example",
    description: "Build reliable services.",
    location: "Remote",
  });
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
