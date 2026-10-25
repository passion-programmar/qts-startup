import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultJobRecordTimeZone,
  isJobRecordTimeZone,
  jobRecordTimeZoneOptions,
} from "@/server/jobs/job-record-time-zones";

test("job record time zones are valid, unique and include Japan, Romania and the default", () => {
  const values = jobRecordTimeZoneOptions.map((option) => option.value);
  assert.equal(new Set(values).size, values.length);
  for (const value of values) assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: value }));
  assert.equal(isJobRecordTimeZone("Asia/Tokyo"), true);
  assert.equal(isJobRecordTimeZone("Europe/Bucharest"), true);
  assert.equal(isJobRecordTimeZone(defaultJobRecordTimeZone), true);
  assert.equal(isJobRecordTimeZone("Mars/Olympus"), false);
  assert.equal(isJobRecordTimeZone(null), false);
});
