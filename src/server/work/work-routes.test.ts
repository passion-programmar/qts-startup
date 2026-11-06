import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { PgDialect } from "drizzle-orm/pg-core";

const managerId = "99999999-9999-4999-8999-999999999999";
const candidateId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const fixture = { authenticated: true, geminiAssigned: true, rows: [] as unknown[][], queries: [] as { sql: string; params: unknown[] }[], joins: [] as string[], selects: [] as unknown[], claims: [] as unknown[][],
  claimedAttempt: null as string | null, deletes: 0,
  record(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); },
  recordJoin(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.joins.push(new PgDialect().sqlToQuery(query).sql); } };
(globalThis as Record<string, unknown>).__qtsWorkFixture = fixture;
type Handler = (request: Request) => Promise<Response>;
let GET: Handler, generation: Handler, apply: Handler;
let scopedApply: (manager: string, browser: { id: string }, skip: string[], selection: unknown, options?: { autoApply?: boolean; requireMatchingNote?: boolean }) => Promise<unknown>;
async function bundle(entry: string, extra: Record<string, string> = {}) {
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/extension-auth": `export const getExtensionManager=async()=>globalThis.__qtsWorkFixture.authenticated?{id:'${managerId}'}:null;`,
    "@/lib/db": `export const neonSql={query:()=>{throw Error('Unexpected answer mutation in work fixture')},transaction:()=>{throw Error('Unexpected answer transaction in work fixture')}};export const db={execute:async query=>{const f=globalThis.__qtsWorkFixture;f.record(query);return {rows:[{attemptId:f.claimedAttempt}]}},delete:()=>({where:async query=>{const f=globalThis.__qtsWorkFixture;f.record(query);f.deletes++;}}),select:fields=>{const f=globalThis.__qtsWorkFixture;f.selects.push(fields);const q={};for(const k of ['from','innerJoin','groupBy','orderBy'])q[k]=()=>q;q.leftJoin=(_table,join)=>{f.recordJoin(join);return q};q.where=query=>{f.record(query);return q};q.limit=async()=>f.rows.shift()||[];return q;}};`,
    "@/server/browsers/extension-browsers": `export const resolveExtensionBrowser=async()=>({id:'browser',canTakeWork:true});`,
    "@/server/database/database-usage": `export const scheduleDailyCleanup=()=>{};`,
    "@/server/jobs/get-jd-mode": `export const getGetJdMatchingMode=async()=>globalThis.__qtsWorkFixture.geminiAssigned?'gemini':'manual';`,
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
test.beforeEach(() => { fixture.authenticated = true; fixture.geminiAssigned = true; fixture.rows = []; fixture.queries = []; fixture.joins = []; fixture.selects = []; fixture.claims = []; fixture.claimedAttempt = null; fixture.deletes = 0; });
const request = (query = "") => new Request("http://localhost/api/extension/work-items?mode=generation" + query);
const claim = (selection?: unknown, mode?: string) => new Request("http://localhost/api/extension/claim", { method: "POST", body: JSON.stringify({ selection, mode }) });

test("Gemini-matching account choices require nonblank matching notes; notes are not disclosed", async () => {
  fixture.rows = [[{ useGeminiMatching: true }], [{ id: candidateId, firstName: "Jordan", lastName: "Taylor", category: "DevOps", categoryColor: "#2563eb", categoryName: "Engineering", eligibleJobCount: 8 }]];
  const response = await GET(request()); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, accounts: [{ id: candidateId, name: "Jordan Taylor", category: "DevOps", categoryColor: "#2563eb", categoryName: "Engineering", eligibleJobCount: 8 }] });
  assert.match(fixture.queries[1].sql, /length\(regexp_replace\(coalesce\("profiles"\."jd_matching"/);
  assert.ok(fixture.queries[1].params.includes("\\s"), 'blank lines and tabs must not count as matching notes');
  assert.match(fixture.queries[1].sql, /parent_user_id/); assert.match(fixture.queries[1].sql, /blocked_at/);
  assert.match(fixture.joins[0], /generation_lease_expires_at/);
  assert.match(fixture.joins[0], /jd_matching/);
  assert.ok(fixture.queries[1].params.includes(managerId)); assert.ok(fixture.queries[1].params.includes("account"));
});
test("non-Gemini Generation does not require a matching note", async () => {
  fixture.rows = [[{ useGeminiMatching: false }], [{ id: candidateId, firstName: "Jordan", lastName: "Taylor", categoryColor: null, eligibleJobCount: 0 }]];
  const response = await GET(request());
  assert.deepEqual(await response.json(), { success: true, accounts: [{ id: candidateId, name: "Jordan Taylor", category: "", categoryColor: null, categoryName: "Global", eligibleJobCount: 0 }] });
  assert.doesNotMatch(fixture.queries[1].sql, /jd_matching/);
});
test("Gemini-assigned Auto Apply accounts require matching notes and Auto Apply job eligibility", async () => {
  fixture.rows = [[{ useGeminiMatching: true }], [{ id: candidateId, firstName: "Jordan", lastName: "Taylor", category: "DevOps", categoryColor: "#2563eb", eligibleJobCount: 6 }]];
  const response = await GET(new Request("http://localhost/api/extension/work-items?mode=auto_apply"));
  assert.deepEqual(await response.json(), {
    success: true,
    accounts: [{ id: candidateId, name: "Jordan Taylor", category: "DevOps", categoryColor: "#2563eb", categoryName: "Global", eligibleJobCount: 6 }],
  });
  assert.match(fixture.queries[1].sql, /jd_matching/);
  assert.ok(fixture.queries[1].params.includes("\\s"));
  assert.match(fixture.joins[0], /resume_local_path/);
  assert.match(fixture.joins[0], /bids/);
});
test("general-manager Auto Apply does not require matching notes", async () => {
  fixture.geminiAssigned = false;
  fixture.rows = [[{ useGeminiMatching: false }], [{ id: candidateId, firstName: "Jordan", lastName: "Taylor", eligibleJobCount: 1 }]];
  await GET(new Request("http://localhost/api/extension/work-items?mode=auto_apply"));
  assert.doesNotMatch(fixture.queries[1].sql, /jd_matching/);
});
test("job lists enforce ownership and existing Generation eligibility, return full source URLs", async () => {
  const job = { id: jobId, title: "Engineer", company: "Example", url: "https://example.test/jobs/1?original=full" };
  fixture.rows = [[{ useGeminiMatching: true }], [{ id: candidateId }], [job]];
  assert.deepEqual(await (await GET(request("&candidateId=" + candidateId))).json(), { success: true, jobs: [job], hasMore: false });
  const query = fixture.queries[2];
  for (const field of ["generation_status", "resume_local_path", "generation_lease_expires_at", "jd_matching"]) assert.ok(query.sql.includes(field));
  assert.ok(query.params.includes(managerId)); assert.ok(query.params.includes(candidateId));
});
test("Auto Apply shows live claims disabled and has no prior-attempt exclusions", async () => {
  const job = { id: jobId, title: "Engineer", company: "Example", url: "https://example.test/jobs/1", customUrl: true, busy: true };
  fixture.rows = [[{ useGeminiMatching: true }], [{ id: candidateId }], [job]];
  const body = await (await GET(new Request(`http://localhost/api/extension/work-items?mode=auto_apply&candidateId=${candidateId}`))).json();
  assert.deepEqual(body.jobs, [{ ...job, selectable: false }]);
  const query = fixture.queries[2].sql;
  assert.match(query, /resume_local_path/);
  assert.match(query, /bids/);
  assert.match(query, /jd_matching/);
  assert.doesNotMatch(query, /released|failed|skipped|waiting_confirmation/);
  const customUrl = (fixture.selects[2] as Record<string, Parameters<PgDialect["sqlToQuery"]>[0]>).customUrl;
  const customUrlQuery = new PgDialect().sqlToQuery(customUrl);
  assert.match(customUrlQuery.sql, /auto_apply_custom_urls/);
  assert.match(customUrlQuery.sql, /url_prefix/);
});
test("unowned/missing-note account, invalid input and unauthenticated requests cannot expose job lists", async () => {
  fixture.rows = [[{ useGeminiMatching: true }], []];
  assert.equal((await GET(request("&candidateId=" + candidateId))).status, 403); assert.equal(fixture.queries.length, 2);
  fixture.queries = []; fixture.rows = [];
  assert.equal((await GET(request("&candidateId=invalid"))).status, 400);
  fixture.authenticated = false; assert.equal((await GET(request())).status, 401); assert.equal(fixture.queries.length, 0);
});
test("Generation claim keeps selected candidate/job filters alongside existing eligibility", async () => {
  fixture.rows = [[{ useGeminiMatching: true }]];
  const response = await generation(claim({ candidateId, jobIds: [jobId] })); assert.equal(response.status, 200);
  const query = fixture.queries.find(q => q.params.includes(jobId)); assert.ok(query);
  assert.ok(query.params.includes(candidateId)); assert.ok(query.params.includes(managerId));
  assert.match(query.sql, /jd_matching/); assert.match(query.sql, /blocked_at/); assert.match(query.sql, /resume_local_path/);
});
test("non-Gemini Generation claims do not require a matching note", async () => {
  fixture.rows = [[{ useGeminiMatching: false }]];
  await generation(claim());
  const query = fixture.queries.find(q => q.params.includes(managerId) && q.sql.includes("experiences"));
  assert.ok(query);
  assert.doesNotMatch(query.sql, /jd_matching/);
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
  assert.equal((await apply(claim(scope, "auto_apply"))).status, 200); assert.deepEqual(fixture.claims[0][3], scope);
  assert.deepEqual(fixture.claims[0][4], { autoApply: true, requireMatchingNote: true });
  await apply(claim()); assert.equal(fixture.claims[1][3], undefined);
  assert.deepEqual(fixture.claims[1][4], { autoApply: false, requireMatchingNote: false });
  // Manual Apply takes the panel's shared candidate too.
  assert.equal((await apply(claim(scope, "apply"))).status, 200); assert.deepEqual(fixture.claims[2][3], scope);
  assert.deepEqual(fixture.claims[2][4], { autoApply: false, requireMatchingNote: false });
});
test("the shared candidate list returns each account once with every mode's ready count", async () => {
  fixture.rows = [[{ useGeminiMatching: true }], [
    { id: candidateId, firstName: "Jordan", lastName: "Taylor", category: "Platform", categoryColor: "#2563eb", categoryName: "Engineering", qualified: true, generation: 3, apply: 2, autoApply: 1 },
    { id: jobId, firstName: "Casey", lastName: null, category: null, categoryColor: null, categoryName: null, qualified: false, generation: 4, apply: 5, autoApply: 6 },
  ]];
  const body = await (await GET(new Request("http://localhost/api/extension/work-items?mode=all"))).json();
  assert.deepEqual(body, { success: true, accounts: [
    { id: candidateId, name: "Jordan Taylor", category: "Platform", categoryColor: "#2563eb", categoryName: "Engineering", counts: { generation: 3, apply: 2, auto_apply: 1 } },
    // Without enough experience (or a matching note) only manual Apply counts.
    { id: jobId, name: "Casey", category: "", categoryColor: null, categoryName: "Global", counts: { generation: 0, apply: 5, auto_apply: 0 } },
  ] });
  const query = fixture.queries[1].sql;
  assert.match(query, /parent_user_id/); assert.match(query, /blocked_at/);
  assert.equal(fixture.joins.length, 1, "one account query for all three modes");
  const counts = fixture.selects[1] as Record<string, Parameters<PgDialect["sqlToQuery"]>[0]>;
  const sqlOf = (field: string) => new PgDialect().sqlToQuery(counts[field]).sql;
  assert.match(sqlOf("generation"), /generation_lease_expires_at/);
  assert.match(sqlOf("apply"), /released/); assert.match(sqlOf("apply"), /bids/); assert.match(sqlOf("apply"), /generation_status/);
  assert.match(sqlOf("autoApply"), /bids/); assert.doesNotMatch(sqlOf("autoApply"), /released/);
  assert.match(sqlOf("qualified"), /jd_matching/); assert.match(sqlOf("qualified"), /experiences/);
  assert.equal((await GET(new Request(`http://localhost/api/extension/work-items?mode=all&candidateId=${candidateId}`))).status, 400);
});
test("Apply job lists use manual Apply eligibility without the experience or note gates", async () => {
  const job = { id: jobId, title: "Engineer", company: "Example", url: "https://example.test/jobs/1", customUrl: true };
  fixture.rows = [[{ useGeminiMatching: true }], [{ id: candidateId }], [job]];
  const body = await (await GET(new Request(`http://localhost/api/extension/work-items?mode=apply&candidateId=${candidateId}`))).json();
  assert.deepEqual(body, { success: true, jobs: [job], hasMore: false });
  const query = fixture.queries[2].sql;
  assert.match(query, /generation_status/); assert.match(query, /released/); assert.match(query, /bids/);
  assert.doesNotMatch(query, /jd_matching/); assert.doesNotMatch(query, /experiences/);
  const customUrl = (fixture.selects[2] as Record<string, Parameters<PgDialect["sqlToQuery"]>[0]>).customUrl;
  const customUrlQuery = new PgDialect().sqlToQuery(customUrl);
  assert.match(customUrlQuery.sql, /auto_apply_custom_urls/);
  assert.match(customUrlQuery.sql, /url_prefix/);
  assert.equal((await GET(new Request("http://localhost/api/extension/work-items?mode=apply"))).status, 400, "Apply has no per-mode account list");
});
test("selected Auto Apply runs one job at a time and enforces assigned-manager gates", async () => {
  fixture.rows = [[{ parallelLimit: 4 }]];
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], { candidateId, jobIds: [jobId] }, { autoApply: true, requireMatchingNote: true }), null);
  const query = fixture.queries[1];
  assert.match(query.sql, /claim_apply_attempt/); assert.match(query.sql, /j.candidate_id <>/);
  assert.match(query.sql, /not \(j.id = any/); assert.match(query.sql, /regexp_replace/);
  assert.ok(query.params.includes(true));
  assert.ok(query.params.includes(1), "an explicit profile selection forces the claim limit to one");
  assert.ok(query.params.includes(candidateId)); assert.ok(query.params.includes(`{${jobId}}`));
});
test("unselected Auto Apply uses the Manager's configured open-job limit", async () => {
  fixture.rows = [[{ parallelLimit: 4 }]];
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], undefined, { autoApply: true }), null);
  assert.ok(fixture.queries[1].params.includes(4));
  assert.match(fixture.queries[1].sql, /auto_apply_custom_urls/);
  assert.match(fixture.queries[1].sql, /url_prefix/);
  assert.match(fixture.queries[1].sql, /like \('%\.'/);
});
test("unselected Normal Apply skips the Manager's Custom URL domains", async () => {
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], undefined, { autoApply: false }), null);
  assert.match(fixture.queries[0].sql, /auto_apply_custom_urls/);
  assert.match(fixture.queries[0].sql, /url_prefix/);
  assert.match(fixture.queries[0].sql, /like \('%\.'/);
  assert.ok(fixture.queries[0].params.includes(false), "the skipped URLs do not change the run into Auto Apply");
});
test("explicitly selected Normal Apply jobs are not filtered by Custom URL domains", async () => {
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], { candidateId, jobIds: [jobId] }, { autoApply: false }), null);
  assert.doesNotMatch(fixture.queries[0].sql, /auto_apply_custom_urls/);
  assert.ok(fixture.queries[0].params.includes(candidateId));
  assert.ok(fixture.queries[0].params.includes(`{${jobId}}`));
});
test("selected Auto Apply includes the Custom URL domain check for its Gemini override", async () => {
  const attemptId = "33333333-3333-4333-8333-333333333333";
  fixture.claimedAttempt = attemptId;
  fixture.rows = [[{ parallelLimit: 2 }], [{ id: attemptId, customUrlGemini: true }], []];
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], { candidateId, jobIds: [jobId] }, { autoApply: true }), null);
  const customUrlGemini = (fixture.selects[1] as Record<string, Parameters<PgDialect["sqlToQuery"]>[0]>).customUrlGemini;
  const customUrlQuery = new PgDialect().sqlToQuery(customUrlGemini);
  assert.match(customUrlQuery.sql, /auto_apply_custom_urls/);
  assert.match(customUrlQuery.sql, /url_prefix/);
});
test("a concurrent claim outside the selection is released before any application is loaded or returned", async () => {
  fixture.rows = [[{ parallelLimit: 2 }]];
  fixture.claimedAttempt = "33333333-3333-4333-8333-333333333333";
  assert.equal(await scopedApply(managerId, { id: "browser" }, [], { candidateId, jobIds: [jobId] }, { autoApply: true, requireMatchingNote: true }), null);
  assert.equal(fixture.deletes, 1);
  assert.ok(fixture.queries[2].params.includes(candidateId)); assert.ok(fixture.queries[2].params.includes(jobId));
});
