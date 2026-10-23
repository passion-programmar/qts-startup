import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidBirthday,
  isValidProfileEmail,
  isValidProfileMonth,
  isValidProfilePhone,
  normalizeLinkedInProfile,
  formatProfileMonth,
  profileMonthOrdinal,
  sortProfileHistoryNewestFirst,
} from "@/server/users/profile-values";

const today = new Date("2026-10-20T12:00:00.000Z");

test("birthday validation accepts real dates through today", () => {
  assert.equal(isValidBirthday("1992-02-29", today), true);
  assert.equal(isValidBirthday("2026-10-20", today), true);
});

test("birthday validation rejects impossible and future dates", () => {
  assert.equal(isValidBirthday("2025-02-29", today), false);
  assert.equal(isValidBirthday("2026-10-21", today), false);
  assert.equal(isValidBirthday("October 20, 1990", today), false);
  assert.equal(isValidBirthday("0000-01-01", today), false);
});

test("profile month validation rejects malformed and impossible months", () => {
  assert.equal(isValidProfileMonth("02/2024"), true);
  assert.equal(isValidProfileMonth("13/2024"), false);
  assert.equal(isValidProfileMonth("01/0000"), false);
  assert.equal(isValidProfileMonth("2/2024"), false);
  assert.equal(isValidProfileMonth("02/20245"), false);
  assert.equal(isValidProfileMonth("2024-02"), false);
});

test("profile months format from database values and compare chronologically", () => {
  assert.equal(formatProfileMonth("2024-02-01"), "02/2024");
  assert.equal(formatProfileMonth("2024-02"), "02/2024");
  assert.equal(formatProfileMonth(null), "");
  const january2025 = profileMonthOrdinal("01/2025");
  const december2024 = profileMonthOrdinal("12/2024");
  assert.ok(january2025 !== null && december2024 !== null);
  assert.ok(january2025 > december2024);
});

test("profile history sorts current and newest records before older ones", () => {
  const rows = [
    { startDate: "01/2018", endDate: "12/2020", isCurrent: "false", id: "old" },
    { startDate: "01/2023", endDate: "", isCurrent: "true", id: "current" },
    { startDate: "06/2021", endDate: "12/2022", isCurrent: "false", id: "recent" },
  ];
  assert.deepEqual(
    sortProfileHistoryNewestFirst(rows).map(({ id }) => id),
    ["current", "recent", "old"],
  );
});

test("profile email validation accepts standard addresses and rejects malformed addresses", () => {
  assert.equal(isValidProfileEmail("person+jobs@example.com"), true);
  assert.equal(isValidProfileEmail("first.last@sub.example.com"), true);
  assert.equal(isValidProfileEmail("person..name@example.com"), false);
  assert.equal(isValidProfileEmail("person@example"), false);
  assert.equal(isValidProfileEmail("person@-example.com"), false);
  assert.equal(isValidProfileEmail("person @example.com"), false);
});

test("profile phone validation accepts formatted international numbers", () => {
  assert.equal(isValidProfilePhone("+1 (555) 123-4567"), true);
  assert.equal(isValidProfilePhone("442071838750"), true);
  assert.equal(isValidProfilePhone("12345"), false);
  assert.equal(isValidProfilePhone("+1 555 CALL-NOW"), false);
  assert.equal(isValidProfilePhone("++15551234567"), false);
  assert.equal(isValidProfilePhone("1234567) (8"), false);
});

test("LinkedIn profile input normalizes URLs and plain-text profile paths", () => {
  assert.equal(normalizeLinkedInProfile("linkedin.com/in/jane-doe"), "linkedin.com/in/jane-doe");
  assert.equal(
    normalizeLinkedInProfile("https://www.linkedin.com/in/jane-doe/?trk=profile"),
    "linkedin.com/in/jane-doe",
  );
  assert.equal(normalizeLinkedInProfile(""), "");
  assert.equal(normalizeLinkedInProfile("example.com/in/jane-doe"), null);
  assert.equal(normalizeLinkedInProfile("linkedin.com/company/example"), null);
  assert.equal(normalizeLinkedInProfile("javascript:alert(1)"), null);
});
