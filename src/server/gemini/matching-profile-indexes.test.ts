import assert from "node:assert/strict";
import test from "node:test";
import { mapMatchingProfileIndexes } from "./matching-profile-indexes";

test("maps Gemini's matching candidate indexes back to trusted account IDs", () => {
  assert.deepEqual(
    mapMatchingProfileIndexes([2, 0], ["account-a", "account-b", "account-c"]),
    ["account-c", "account-a"],
  );
});

test("rejects invalid, duplicate, and out-of-range candidate indexes", () => {
  const ids = ["account-a", "account-b"];
  assert.equal(mapMatchingProfileIndexes(null, ids), null);
  assert.equal(mapMatchingProfileIndexes([0, 0], ids), null);
  assert.equal(mapMatchingProfileIndexes([-1], ids), null);
  assert.equal(mapMatchingProfileIndexes([2], ids), null);
  assert.equal(mapMatchingProfileIndexes([0.5], ids), null);
  assert.equal(mapMatchingProfileIndexes([0, 1, 2], ids), null);
});
