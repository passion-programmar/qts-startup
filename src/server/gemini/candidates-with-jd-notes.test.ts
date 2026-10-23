import assert from "node:assert/strict";
import test from "node:test";
import { candidatesWithJdNotes } from "./candidates-with-jd-notes";

test("excludes candidates without a non-empty JD-matching note", () => {
  const candidates = [
    { id: "one", jdMatching: "Platform and DevOps roles" },
    { id: "two", jdMatching: null },
    { id: "three", jdMatching: " \n\t " },
    { id: "four", jdMatching: "Data engineering roles" },
  ];

  assert.deepEqual(candidatesWithJdNotes(candidates), [candidates[0], candidates[3]]);
});
