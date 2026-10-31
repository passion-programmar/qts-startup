import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { globalJobPrecheckQuery, readGetJdIdentity } from "./global-precheck";
import { createPrecheckTickets } from "./precheck-ticket";

const identity = { jobUrl: "https://example.test/jobs/1?utm_source=board", jobTitle: "Engineer", company: "Example" };
test("precheck accepts URL-only identity without inventing missing title/company", () => {
  assert.deepEqual(readGetJdIdentity({ job: { jobUrl: identity.jobUrl } }), { jobUrl: identity.jobUrl, jobTitle: "", company: "" });
  for (const url of ["file:///a", "https://user:pass@example.test", "invalid"]) assert.equal(readGetJdIdentity({ job: { jobUrl: url } }), null);
});
test("one global boolean SQL statement uses actual Jobs/Bids columns without owner/candidate filters", () => {
  const query = new PgDialect().sqlToQuery(globalJobPrecheckQuery(identity));
  assert.match(query.sql, /exists\(select 1 from "jobs"/);
  assert.match(query.sql, /exists\(select 1 from "bids"/);
  assert.doesNotMatch(query.sql, /"bids"\."job_key"|manager_id|candidate_id/);
  assert.match(query.sql, /as skip$/);
  assert.ok(query.params.includes("https://example.test/jobs/1"));
  assert.ok(query.params.includes("engineer|example"));
});
test("blank title/company never become a meaningful global title match", () => {
  const query = new PgDialect().sqlToQuery(globalJobPrecheckQuery({ ...identity, jobTitle: "", company: "" }));
  assert.ok(query.params.includes(false));
});
test("Bids URL patterns recognize supported platform IDs across tracking/route variants", () => {
  const cases = [
    ["https://www.linkedin.com/jobs/view/4012345678?trk=x", "https://www.linkedin.com/jobs/search/?currentJobId=4012345678&x=y"],
    ["https://indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b", "https://uk.indeed.com/jobs?vjk=1a2b3c4d5e6f7a8b"],
    ["https://boards.greenhouse.io/acme/jobs/7781234", "https://acme.test/careers?gh_jid=7781234"],
    ["https://jobs.lever.co/acme/5ac21346-8e0c-4494-8e7a-3eb92ff77902", "https://jobs.lever.co/acme/5ac21346-8e0c-4494-8e7a-3eb92ff77902/apply"],
  ];
  for (const [jobUrl, storedUrl] of cases) {
    const query = new PgDialect().sqlToQuery(globalJobPrecheckQuery({ ...identity, jobUrl }));
    const regexes = query.params.filter((p): p is string => typeof p === "string" && (p.startsWith("^https?") || p.startsWith("[?&]")));
    assert.ok(regexes.some((pattern) => new RegExp(pattern, "i").test(storedUrl)), storedUrl);
  }
});
test("precheck tickets are signed, Manager-bound and job-bound", async () => {
  const tickets = createPrecheckTickets(new TextEncoder().encode("local-synthetic-secret-32-characters-only"));
  const token = await tickets.issue("manager-a", identity);
  assert.deepEqual(await tickets.verify(token, "manager-a", "https://example.test/jobs/1"), identity);
  assert.equal(await tickets.verify(token, "manager-b", identity.jobUrl), null);
  assert.equal(await tickets.verify(token, "manager-a", "https://example.test/jobs/2"), null);
  assert.equal(await tickets.verify(token + "tampered", "manager-a", identity.jobUrl), null);
});
