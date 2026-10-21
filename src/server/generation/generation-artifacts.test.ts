import assert from "node:assert/strict";
import test from "node:test";
import { generatedResumeLocalPath } from "@/server/generation/generation-artifacts";

test("generated resume path matches the local download filename", () => {
  assert.equal(
    generatedResumeLocalPath("Riley", "Taylor"),
    "QTS_Resume/Riley_Taylor_Resume.pdf",
  );
});

test("generated resume path safely handles missing and unsafe candidate names", () => {
  assert.equal(generatedResumeLocalPath(null, null), "QTS_Resume/Candidate_Resume.pdf");
  assert.equal(
    generatedResumeLocalPath("A/B", "Taylor."),
    "QTS_Resume/A_B_Taylor_Resume.pdf",
  );
});
