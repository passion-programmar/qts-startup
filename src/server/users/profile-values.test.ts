import assert from "node:assert/strict";
import test from "node:test";
import { isValidBirthday } from "@/server/users/profile-values";

const today = new Date("2026-10-20T12:00:00.000Z");

test("birthday validation accepts real dates through today", () => {
  assert.equal(isValidBirthday("1992-02-29", today), true);
  assert.equal(isValidBirthday("2026-10-20", today), true);
});

test("birthday validation rejects impossible and future dates", () => {
  assert.equal(isValidBirthday("2025-02-29", today), false);
  assert.equal(isValidBirthday("2026-10-21", today), false);
  assert.equal(isValidBirthday("October 20, 1990", today), false);
});
