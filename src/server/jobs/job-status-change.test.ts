import assert from "node:assert/strict";
import test from "node:test";
import { jobStatusChangeError } from "@/server/jobs/job-status-change";

test("Applied cannot be set by hand; only the Manager's Yes in Apply sets it", () => {
  for (const current of ["todo", "pending", "failed"]) {
    assert.match(jobStatusChangeError("applied", { status: current }) ?? "", /Only Apply marks a job Applied/);
  }
});

test("an Applied job keeps its status while other details are edited", () => {
  assert.equal(jobStatusChangeError("applied", { status: "applied" }), null);
});

test("other statuses are free to change", () => {
  for (const status of ["todo", "pending", "failed"] as const) {
    for (const current of ["todo", "pending", "applied", "failed"]) {
      assert.equal(jobStatusChangeError(status, { status: current }), null);
    }
  }
});
