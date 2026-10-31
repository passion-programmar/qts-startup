import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { PgDialect } from "drizzle-orm/pg-core";

const managerId = "99999999-9999-4999-8999-999999999999";
const candidateId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const fixture = { authenticated: true, rows: [] as unknown[][], queries: [] as { sql: string; params: unknown[] }[], claims: [] as unknown[][],
  claimedAttempt: null as string | null, deletes: 0,
  record(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); } };
(globalThis as Record<string, unknown>).__qtsWorkFixture = fixture;
type Handler = (request: Request) => Promise<Response>;
let GET: Handler, generation: Handler, apply: Handler;
let scopedApply: (manager: string, browser: { id: string }, skip: string[], selection: unknown) => Promise<unknown>;
async function bundle(entry: string, extra: Record<string, string> = {}) {
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/extension-auth": `export const getExtensionManager=async()=>globalThis.__qtsWorkFixture.authenticated?{id:'${managerId}'}:null;`,
    "@/lib/db": `export const db={execute:async query=>{const f=globalThis.__qtsWorkFixture;f.record(query);return {rows:[{attemptId:f.claimedAttempt}]}},delete:()=>({where:async query=>{const f=globalThis.__qtsWorkFixture;f.record(query);f.deletes++;}}),select:()=>{const f=globalThis.__qtsWorkFixture;const q={};for(const k of ['from','innerJoin','leftJoin','orderBy'])q[k]=()=>q;q.where=query=>{f.record(query);return q};q.limit=async()=>f.rows.shift()||[];return q;}};`,
    "@/server/browsers/extension-browsers": `export const resolveExtensionBrowser=async()=>({id:'browser',canTakeWork:true});`,
    "@/server/database/database-usage": `export const scheduleDailyCleanup=()=>{};`,
    ...extra,
  };
  const result = await build({ entryPoints: [resolve(entry)], absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "local-work-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as Record<string, Handler> };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  return loaded.exports;
}
test.before(async () => {
  GET = (await bundle("src/app/api/extension/work-items/route.ts")).GET;
  generation = (await bundle("src/app/api/extension/generation/claim/route.ts")).POST;
  apply = (await bundle("src/app/api/extension/apply/claim/route.ts", {
    "@/server/apply/apply-route-auth": `import {NextResponse} from 'next/server';export const isUuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);export const authorizeApplyRequest=async()=>globalThis.__qtsWorkFixture.authenticated?{manager:{id:'${managerId}'},browser:{id:'browser'}}:NextResponse.json({success:false},{status:401});`,
    "@/server/apply/apply-attempts": `export const claimNextApplication=async(...args)=>{globalThis.__qtsWorkFixture.claims.push(args);return null;};`,
  })).POST;
  scopedApply = (await bundle("src/server/apply/apply-attempts.ts")).claimNextApplication as unknown as typeof scopedApply;
});
test.beforeEach(() => { fixture.authenticated = true; fixture.rows = []; fixture.queries = []; fixture.claims = []; fixture.claimedAttempt = null; fixture.deletes = 0; });
const request = (query = "") => new Request("http://localhost/api/extension/work-items?mode=generation" + query);
const claim = (selection?: unknown) => new Request("http://localhost/api/extension/claim", { method: "POST", body: JSON.stringify({ selection }) });

test("account choices require owned, unblocked accounts with nonblank matching notes; notes are not disclosed", async () => {
  fixture.rows = [[{ id: candidateId, firstName: "Jordan", lastName: "Taylor" }]];
  const response = await GET(request()); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, accounts: [{ id: candidateId, name: "Jordan Taylor" }] });
  assert.match(fixture.queries[0].sql, /length\(regexp_replace\(coalesce\("profiles"\."jd_matching"/);
  assert.ok(fixture.queries[0].params.includes("\\s"), 'blank lines and tabs must not count as matching notes');
  assert.match(fixture.queries[0].sql, /parent_user_id/); assert.match(fixture.queries[0].sql, /blocked_at/);
  assert.ok(fixture.queries[0].params.includes(managerId)); assert.ok(fixture.queries[0].params.includes("account"));
});
test("job lists enforce ownership and existing Generation eligibility, return full source URLs", async () => {
  const job = { id: jobId, title: "Engineer", company: "Example", url: "https://example.test/jobs/1?original=full" };
  fixture.rows = [[{ id: candidateId }], [job]];
  assert.deepEqual(await (await GET(request("&candidateId=" + candidateId))).json(), { success: true, jobs: [job], hasMore: false });
  const query = fixture.queries[1];
  for (const field of ["generation_status", "resume_local_path", "generation_lease_expires_at", "jd_matching"]) assert.ok(query.sql.includes(field));
  assert.ok(query.params.includes(managerId)); assert.ok(query.params.includes(candidateId));
});
test("Auto Apply job list excludes bids, active attempts and exhausted returned jobs", async () => {
  fixture.rows = [[{ id: candidateId }], []];
  await GET(new Request(`http://localhost/api/extension/work-items?mode=auto_apply&candidateId=${candidateId}`));
  const query = fixture.queries[1].sql;
  for (const text of ["bids", "apply_attempts", "waiting_confirmation", "lease_expires_at", "released"]) assert.ok(query.includes(text));
});
test("unowned/missing-note account, invalid input and unauthenticated requests cannot expose job lists", async () => {
  assert.equal((await GET(request("&candidateId=" + candidateId))).status, 403); assert.equal(fixture.queries.length, 1);
  fixture.queries = []; assert.equal((await GET(request("&candidateId=invalid"))).status, 400);
  fixture.authenticated = false; assert.equal((await GET(request())).status, 401); assert.equal(fixture.queries.length, 0);
});
test("Generation claim keeps selected candidate/job filters alongside existing eligibility", async () => {
  const response = await generation(claim({ candidateId, jobIds: [jobId] })); assert.equal(response.status, 200);
  const query = fixture.queries.find(q => q.params.includes(jobId)); assert.ok(query);
  assert.ok(query.params.includes(candidateId)); assert.ok(query.params.includes(managerId));
  assert.match(query.sql, /jd_matching/); assert.match(query.sql, /blocked_at/); assert.match(query.sql, /resume_local_path/);
});
test("both claim routes reject invalid/empty selections rather than using the whole queue", async () => {
  for (const handler of [generation, apply]) {
    assert.equal((await handler(claim({ candidateId, jobIds: [] }))).status, 400);
    assert.equal((await handler(claim(null))).status, 400);
  }
  assert.equal(fixture.queries.length, 0); assert.equal(fixture.claims.length, 0);
});
test("Apply forwards exact selection to the existing claim helper and preserves unscoped actions", async () => {
  const scope = { candidateId, jobIds: [jobId] };
  assert.equal((await apply(claim(scope))).status, 200); assert.deepEqual(fixture.claims[0][3], scope);
  await apply(claim()); assert.equal(fixture.claims[1][3], undefined);
});
test("selected Apply retains the locked claim function and excludes jobs outside the account and batch", async () => {
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], { candidateId, jobIds: [jobId] }), null);
  const query = fixture.queries[0];
  assert.match(query.sql, /claim_apply_attempt/); assert.match(query.sql, /j.candidate_id <>/);
  assert.match(query.sql, /not \(j.id = any/); assert.match(query.sql, /jd_matching/);
  assert.ok(query.params.includes(candidateId)); assert.ok(query.params.includes(`{${jobId}}`));
});
test("a concurrent claim outside the selection is released before any application is loaded or returned", async () => {
  fixture.claimedAttempt = "33333333-3333-4333-8333-333333333333";
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], { candidateId, jobIds: [jobId] }), null);
  assert.equal(fixture.deletes, 1);
  assert.ok(fixture.queries[1].params.includes(candidateId)); assert.ok(fixture.queries[1].params.includes(jobId));
});
