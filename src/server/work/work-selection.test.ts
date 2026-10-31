import assert from "node:assert/strict";
import test from "node:test";
import { readWorkSelection } from "./work-selection";

const id = "11111111-1111-4111-8111-111111111111";
test("work selection preserves explicit jobs; absent scope alone preserves the existing whole queue", () => {
  assert.equal(readWorkSelection(undefined), undefined);
  assert.deepEqual(readWorkSelection({ candidateId: id, jobIds: [id], mode: "generation" }), { candidateId: id, jobIds: [id] });
  for (const value of [null, {}, [], { candidateId: id, jobIds: [] }, { candidateId: "other", jobIds: [id] },
    { candidateId: id, jobIds: [id, id] }, { candidateId: id, jobIds: ["' OR true"] }, { candidateId: id, jobIds: Array(201).fill(id) }]) {
    assert.throws(() => readWorkSelection(value));
  }
});
