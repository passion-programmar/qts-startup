import assert from "node:assert/strict";
import test from "node:test";
import { candidatesWithCareerTimeline } from "./candidates-with-career-timeline";

test("excludes candidates without any job title in their profile", () => {
  const role = { jobTitle: "Platform Engineer", start: "2021-03", end: null, isCurrent: true };
  const candidates = [
    { id: "one", employmentTimeline: [role] },
    { id: "two", employmentTimeline: [] },
    { id: "three", employmentTimeline: [role, { ...role, isCurrent: false }] },
  ];

  assert.deepEqual(candidatesWithCareerTimeline(candidates), [candidates[0], candidates[2]]);
});
