import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { PgDialect } from "drizzle-orm/pg-core";

const managerId = "99999999-9999-4999-8999-999999999999";
const candidateId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const fixture = { authenticated: true, held: true, fail: false, writes: [] as unknown[][], queries: [] as { sql: string; params: unknown[] }[],
  record(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); } };
(globalThis as Record<string, unknown>).__qtsCheckFixture = fixture;
let POST: (request: Request) => Promise<Response>;

test.before(async () => {
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/db": `export const db={select:()=>{const q={};for(const key of ['from','innerJoin'])q[key]=()=>q;q.where=query=>{globalThis.__qtsCheckFixture.record(query);return q};q.limit=async()=>globalThis.__qtsCheckFixture.held?[{candidateId:'${candidateId}',jobId:'${jobId}'}]:[];return q;}};`,
    "@/server/apply/apply-route-auth": `import {NextResponse} from 'next/server';export const isUuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);export const authorizeApplyRequest=async()=>globalThis.__qtsCheckFixture.authenticated?{manager:{id:'${managerId}'},browser:{id:'browser'}}:NextResponse.json({success:false},{status:401});`,
    "@/server/apply/manager-answers": `export const saveManagerCorrection=async(...args)=>{const f=globalThis.__qtsCheckFixture;f.writes.push(args);if(f.fail)throw Error('Synthetic save failure');return {ok:true,scope:'candidate',answer:args[3].answer}};export const loadApplicationAnswers=async()=>[];export const makeManagerReusable=async()=>({ok:true});`,
  };
  const built = await build({ entryPoints: [resolve("src/app/api/extension/apply/check-answers/route.ts")], tsconfig: resolve("tsconfig.json"), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "check-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as { POST: typeof POST } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  POST = loaded.exports.POST;
});
test.beforeEach(() => { fixture.authenticated = true; fixture.held = true; fixture.fail = false; fixture.writes = []; fixture.queries = []; });
const request = (overrides = {}) => new Request("http://localhost/api/extension/apply/check-answers", { method: "POST", body: JSON.stringify({ attemptId, items: [{ question: "City", answer: "Bucharest" }], ...overrides }) });

test("Check saves directly using server-owned candidate/job IDs, with no approval endpoint", async () => {
  const response = await POST(request({ candidateId: "forged", managerId: "forged", jobId: "forged" }));
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.writes[0].slice(0, 3), [managerId, candidateId, jobId]);
  const query = fixture.queries[0];
  for (const column of ["manager_id", "browser_id", "parent_user_id", "blocked_at", "status", "lease_expires_at"]) assert.ok(query.sql.includes(column), column);
  assert.ok(query.params.includes("waiting_review"));
});
test("unauthenticated, expired/foreign claims and invalid bodies save nothing", async () => {
  fixture.authenticated = false; assert.equal((await POST(request())).status, 401);
  fixture.authenticated = true; fixture.held = false; assert.equal((await POST(request())).status, 409);
  assert.equal((await POST(request({ items: Array(201).fill({}) }))).status, 400);
  assert.equal(fixture.writes.length, 0);
});
test("save failure is explicit and retryable, never returned as success", async () => {
  fixture.fail = true;
  const response = await POST(request());
  assert.equal(response.status, 500);
  const body = await response.json(); assert.equal(body.success, false); assert.match(body.message, /Click Check to retry/);
});
