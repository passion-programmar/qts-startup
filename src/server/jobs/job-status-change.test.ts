import assert from "node:assert/strict";
import test from "node:test";
import { jobStatusChangeError, statusChangeCreatesBid } from "@/server/jobs/job-status-change";

const generated = { status: "todo", generationStatus: "completed", resumeLocalPath: "C:/r.pdf" };

test("a row with a bid stays Applied", () => {
  for (const status of ["todo", "pending", "failed"] as const) {
    assert.match(jobStatusChangeError(status, { hasBid: true, ...generated, status: "applied" }) ?? "", /Delete the bid/);
  }
  assert.equal(jobStatusChangeError("applied", { hasBid: true, ...generated, status: "applied" }), null);
});

test("Applied, which creates the bid, needs completed Generation", () => {
  for (const generationStatus of ["not_queued", "queued", "processing", "failed", "cancelled"]) {
    const current = { hasBid: false, status: "todo", generationStatus, resumeLocalPath: null };
    assert.match(jobStatusChangeError("applied", current) ?? "", /completed Generation/);
    assert.equal(statusChangeCreatesBid("applied", current), false);
  }
  const noResume = { hasBid: false, status: "todo", generationStatus: "completed", resumeLocalPath: null };
  assert.match(jobStatusChangeError("applied", noResume) ?? "", /completed Generation/);
  assert.equal(jobStatusChangeError("applied", { hasBid: false, ...generated }), null);
  assert.equal(statusChangeCreatesBid("applied", { hasBid: false, ...generated }), true);
  assert.equal(statusChangeCreatesBid("applied", { hasBid: true, ...generated }), false);
});

test("a row marked Applied before bids were required can still be edited", () => {
  const legacy = { hasBid: false, status: "applied", generationStatus: "not_queued", resumeLocalPath: null };
  assert.equal(jobStatusChangeError("applied", legacy), null);
  assert.equal(statusChangeCreatesBid("applied", legacy), false);
  // Once its Generation completed, saving it records the missing bid.
  assert.equal(statusChangeCreatesBid("applied", { ...legacy, generationStatus: "completed", resumeLocalPath: "C:/r.pdf" }), true);
});

test("other statuses without a bid are free to change", () => {
  for (const status of ["todo", "pending", "failed"] as const) {
    const current = { hasBid: false, status: "todo", generationStatus: "not_queued", resumeLocalPath: null };
    assert.equal(jobStatusChangeError(status, current), null);
    assert.equal(statusChangeCreatesBid(status, current), false);
  }
});
