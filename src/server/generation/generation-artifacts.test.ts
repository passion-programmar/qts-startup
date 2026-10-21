import assert from "node:assert/strict";
import test from "node:test";
import {
  generatedResumeLocalPath,
  generationDownloadPaths,
} from "@/server/generation/generation-artifacts";

test("generated resume path matches the local download filename", () => {
  assert.equal(
    generatedResumeLocalPath("Riley", "Taylor"),
    "QTS_Resume/Riley_Taylor_Resume.pdf",
  );
});

test("application files use the manager, candidate, job, and company folder path", () => {
  assert.deepEqual(
    generationDownloadPaths({
      managerName: "MSK",
      candidateName: "Jordan Taylor",
      jobTitle: "Program/Coordinator",
      company: "Example: Company",
      createdAt: new Date("2026-10-21T19:34:56.000Z"),
    }),
    {
      resume: "QTS_Resume/MSK/Jordan Taylor/2026-10-21_12-34-56_Program_Coordinator_Example_ Company/Jordan Taylor.pdf",
      coverLetter: "QTS_Resume/MSK/Jordan Taylor/2026-10-21_12-34-56_Program_Coordinator_Example_ Company/Jordan Taylor_Cover_Letter.pdf",
      jobDescription: "QTS_Resume/MSK/Jordan Taylor/2026-10-21_12-34-56_Program_Coordinator_Example_ Company/JD.txt",
    },
  );
});

test("generated resume path safely handles missing and unsafe candidate names", () => {
  assert.equal(generatedResumeLocalPath(null, null), "QTS_Resume/Candidate_Resume.pdf");
  assert.equal(
    generatedResumeLocalPath("A/B", "Taylor."),
    "QTS_Resume/A_B_Taylor_Resume.pdf",
  );
});
