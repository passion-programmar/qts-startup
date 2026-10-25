import assert from "node:assert/strict";
import test from "node:test";
import { planJobRelations, type JobRelationRow } from "@/server/jobs/job-relations";

let rowNumber = 0;
const row = (overrides: Partial<JobRelationRow>): JobRelationRow => ({
  id: `row-${++rowNumber}`,
  jobUrl: "https://boards.greenhouse.io/acme/jobs/111",
  jobTitle: "Frontend Engineer",
  company: "Acme",
  candidateId: "account-1",
  managerId: "manager-1",
  relationId: null,
  ...overrides,
});

const sequentialIds = () => {
  let next = 0;
  return () => `relation-${++next}`;
};

const relationOf = (plan: ReturnType<typeof planJobRelations>, id: string) =>
  plan.updates.find((update) => update.id === id)?.relationId;

test("rows with the same URL key share one relation across accounts and Managers", () => {
  const first = row({ candidateId: "account-1" });
  const second = row({ candidateId: "account-4", jobUrl: "https://boards.greenhouse.io/acme/jobs/111?gh_src=x" });
  const otherManager = row({ candidateId: "account-8", managerId: "manager-2" });
  const plan = planJobRelations([first, second, otherManager], sequentialIds());

  assert.equal(plan.groupCount, 1);
  assert.equal(relationOf(plan, first.id), relationOf(plan, second.id));
  assert.equal(relationOf(plan, first.id), relationOf(plan, otherManager.id));
  assert.equal(plan.sharedAcrossManagersCount, 1);
  assert.deepEqual(plan.collisions, []);
});

test("a title and company match joins the same job saved from another site", () => {
  const linkedIn = row({ jobUrl: "https://www.linkedin.com/jobs/view/4012345678", candidateId: "account-1" });
  const companySite = row({ jobUrl: "https://acme.com/careers/frontend-engineer-991", jobTitle: "Frontend Engineer (Remote)", company: "Acme Inc.", candidateId: "account-2" });
  const plan = planJobRelations([linkedIn, companySite], sequentialIds());

  assert.equal(plan.groupCount, 1);
  assert.equal(relationOf(plan, linkedIn.id), relationOf(plan, companySite.id));
});

test("grouping is transitive across URL and title matches", () => {
  const a = row({ jobUrl: "https://acme.com/jobs/1001", jobTitle: "Data Analyst", candidateId: "account-1" });
  const b = row({ jobUrl: "https://acme.com/jobs/1001", jobTitle: "Data Analyst II", candidateId: "account-2" });
  const c = row({ jobUrl: "https://www.linkedin.com/jobs/view/4099999999", jobTitle: "Data Analyst II", candidateId: "account-3" });
  const plan = planJobRelations([a, b, c], sequentialIds());

  assert.equal(plan.groupCount, 1);
  assert.equal(relationOf(plan, a.id), relationOf(plan, c.id));
});

test("different jobs get different relations", () => {
  const frontend = row({});
  const backend = row({ jobUrl: "https://boards.greenhouse.io/acme/jobs/222", jobTitle: "Backend Engineer" });
  const plan = planJobRelations([frontend, backend], sequentialIds());

  assert.equal(plan.groupCount, 2);
  assert.notEqual(relationOf(plan, frontend.id), relationOf(plan, backend.id));
});

test("the same account twice in one job is reported, and an existing relation_id is kept", () => {
  const original = row({ relationId: "relation-existing", candidateId: "account-1" });
  const repeat = row({ jobUrl: "https://www.linkedin.com/jobs/view/4012345678", candidateId: "account-1" });
  const plan = planJobRelations([original, repeat], sequentialIds());

  assert.equal(relationOf(plan, repeat.id), "relation-existing");
  assert.deepEqual(plan.collisions, [{ relationId: "relation-existing", candidateId: "account-1", rowIds: [original.id, repeat.id] }]);
});
