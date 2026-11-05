import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";

const fixture = { rows: [] as unknown[][], globals: [] as unknown[], globalReads: 0, writes: [] as { table: string; values?: Record<string, unknown>; set?: Record<string, unknown> }[], changed: true, conflict: false, queries: [] as { sql: string; params: unknown[] }[],
  record(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); } };
(globalThis as Record<string, unknown>).__qtsManagerAnswers = fixture;
type Library = typeof import("./manager-answers");
let library: Library;
test.before(async () => {
  const mocks: Record<string, string> = {
    "server-only": "",
    "./reusable-answers": `export const loadApprovedReusableAnswers=async()=>{globalThis.__qtsManagerAnswers.globalReads++;return globalThis.__qtsManagerAnswers.globals;};`,
    "@/lib/db": `import {getTableName} from 'drizzle-orm';const f=globalThis.__qtsManagerAnswers;export const neonSql={query:async(sql,params)=>{f.queries.push({sql,params});return f.changed?[{id:'local'}]:[]},transaction:async(queries,options)=>{if(options.isolationLevel!=='Serializable')throw Error('missing serializable');return Promise.all(queries)}};export const db={
      select:()=>{const q={};for(const key of ['from','leftJoin'])q[key]=()=>q;q.where=query=>{f.record(query);return q};q.limit=async()=>f.rows.shift()||[];q.orderBy=async()=>f.rows.shift()||[];return q},
      insert:table=>{const q={},w={table:getTableName(table)};q.values=values=>{w.values=values;return q};q.onConflictDoUpdate=options=>{w.set=options.set;f.writes.push(w);return q};q.returning=async()=>[{id:'saved-id',...w.values}];q.then=(ok,fail)=>Promise.resolve([]).then(ok,fail);return q},
      update:table=>({set:values=>({where:query=>{f.record(query);f.writes.push({table:getTableName(table),values});return Promise.resolve([])}})}),
      delete:table=>({where:query=>{f.record(query);f.writes.push({table:getTableName(table)});return Promise.resolve([])}}),
      execute:async query=>{f.record(query);if(f.conflict)throw Object.assign(Error('conflict'),{code:'23505'});return {rows:f.changed?[{id:'local'}]:[]}},batch:queries=>Promise.all(queries)};`,
  };
  const built = await build({ entryPoints: [resolve("src/server/apply/manager-answers.ts")], tsconfig: resolve("tsconfig.json"), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "manager-answer-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  library = loaded.exports as Library;
});
test.beforeEach(() => { fixture.changed = true; fixture.conflict = false; fixture.rows = []; fixture.globals = []; fixture.globalReads = 0; fixture.writes = []; fixture.queries = []; });

test("application loading keeps application, candidate, Manager priority and never queries global answers", async () => {
  fixture.globals = [{ questionText: "How did you hear about us?", answer: "Indeed" }];
  fixture.rows = [[{ scope: "manager", questionText: "Source", answer: "LinkedIn" }, { scope: "candidate", questionText: "When can you start?", answer: "Immediately" }, { scope: "candidate", questionText: "City", answer: "Old City" }, { scope: "application", questionText: "When can you start?", answer: "After this project ends" }]];
  const answers = await library.loadApplicationAnswers("manager", "candidate", "job");
  assert.deepEqual(answers.map((entry) => entry.scope), ["application", "candidate", "manager"]);
  assert.equal(fixture.globalReads, 0);
  assert.equal(answers.some((entry) => entry.answer === "Indeed" || entry.answer === "Old City"), false);
  const query = fixture.queries[0];
  assert.match(query.sql, /manager_id/); assert.match(query.sql, /candidate_id/); assert.match(query.sql, /job_id/);
  for (const id of ["manager", "candidate", "job"]) assert.ok(query.params.includes(id));
});
test("candidate city is saved with a profile update in one batch; global rows are never written", async () => {
  const result = await library.saveManagerCorrection("manager", "candidate", "job", { question: "Location (City)*", answer: "Bucharest", kind: "text" });
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.writes.map((entry) => entry.table), ["manager_apply_answers", "profiles"]);
  assert.equal(fixture.writes[0].values?.scope, "candidate");
  assert.equal(fixture.writes[1].values?.city, "Bucharest");
  assert.match(fixture.queries.at(-1)!.sql, /parent_user_id/);
});
test("a matching legacy global question cannot downgrade a Manager shared correction to an application exception", async () => {
  fixture.globals = [{ questionText: "How did you hear about this position?", answer: "Indeed" }];
  const result = await library.saveManagerCorrection("manager", "candidate", "job", { question: "How did you hear about us?", answer: "LinkedIn", kind: "text" });
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.scope, "manager"); assert.equal(result.globalOverride, false); }
  assert.equal(fixture.globalReads, 0);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].values?.jobId, null);
  assert.equal(fixture.writes[0].values?.candidateId, null);
  assert.equal(fixture.writes[0].values?.managerId, "manager");
  assert.equal(fixture.writes[0].table, "manager_apply_answers");
});

test("an empty Manager library has no global fallback or implicit copies", async () => {
  fixture.globals = [{ questionText: "Source", answer: "Indeed" }];
  fixture.rows = [[]];
  assert.deepEqual(await library.loadApplicationAnswers("manager", "candidate", "job"), []);
  assert.equal(fixture.globalReads, 0);
  assert.equal(fixture.writes.length, 0);
});
test("Managers can immediately reuse uncertain shared answers, but cannot broaden personal facts or another owner's rows", async () => {
  fixture.rows = [[{ id: "local", scope: "application", questionKey: "additional details", questionText: "Additional details", answer: "Available for discussion", variants: [] }]];
  assert.equal((await library.makeManagerReusable("manager", "local", "123.000001")).ok, true);
  assert.match(fixture.queries.at(-1)!.sql, /update manager_apply_answers/);
  assert.match(fixture.queries.at(-1)!.sql, /extract\(epoch/);
  fixture.rows = [[{ id: "personal", scope: "candidate", questionText: "City" }]];
  assert.equal((await library.makeManagerReusable("manager", "personal")).ok, false);
  fixture.rows = [[]]; assert.equal((await library.makeManagerReusable("manager", "foreign")).ok, false);
  assert.ok(fixture.queries.at(-1)!.params.includes("manager"));
});

test('sharing rejects missing versions, stale sources and occupied destinations without deleting answers', async () => {
  assert.equal((await library.makeManagerReusable('manager', 'local')).ok, false);
  for (const conflict of [false, true]) {
    fixture.rows = [[{ id: 'local', scope: 'application', questionText: 'Additional details' }]];
    fixture.changed = false; fixture.conflict = conflict;
    assert.equal((await library.makeManagerReusable('manager', 'local', '123.000001')).ok, false);
    assert.equal(fixture.writes.length, 0);
    assert.doesNotMatch(fixture.queries.at(-1)!.sql, /delete|on conflict/i);
  }
});
