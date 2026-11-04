import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";

const attemptId = "11111111-1111-4111-8111-111111111111";
const generationId = "22222222-2222-4222-8222-222222222222";
const body = { attemptId, generationId, expectedResumePath: "QTS_Resume/A.pdf", expectedCoverLetterPath: null,
  resumePath: "QTS_Resume/A (1).pdf", coverLetterPath: "QTS_Resume/B (2).pdf" };
const fixture = { status: 200, context: null as unknown, documents: null as unknown, saved: true,
  writes: [] as unknown[], reads: 0, transactions: [] as unknown[], code: "" };
(globalThis as Record<string, unknown>).__qtsRelinkFixture = fixture;
type Route = { GET(request: Request): Promise<Response>; POST(request: Request): Promise<Response> };
let get: Route["GET"], post: Route["POST"], store: { relinkPdfPaths(owner: unknown, input: unknown): Promise<boolean> };

async function load(entry: string, mocks: Record<string, string>) {
  const built = await build({ entryPoints: [resolve(entry)], tsconfig: resolve("tsconfig.json"), bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", plugins: [{ name: "relink-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }] });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  return loaded.exports;
}

test.before(async () => {
  const mocks = {
    "server-only": "",
    "@/server/apply/apply-route-auth": `import {NextResponse} from 'next/server';export const isUuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);export const authorizeApplyRequest=async()=>globalThis.__qtsRelinkFixture.status===200?{manager:{id:'manager',authVersion:7},browser:{id:'browser'}}:NextResponse.json({success:false},{status:globalThis.__qtsRelinkFixture.status});`,
    "@/server/apply/apply-documents": `export const loadApplyDocumentPaths=async()=>globalThis.__qtsRelinkFixture.documents;`,
    "@/server/apply/apply-pdf-recovery-store": `export const loadPdfRecoveryContext=async()=>{const f=globalThis.__qtsRelinkFixture;f.reads++;return f.context};export const relinkPdfPaths=async(...args)=>{const f=globalThis.__qtsRelinkFixture;f.writes.push(args);return f.saved};`,
  };
  get = (await load("src/app/api/extension/apply/documents/route.ts", mocks) as Route).GET;
  post = (await load("src/app/api/extension/apply/documents/relink/route.ts", mocks) as Route).POST;
  store = await load("src/server/apply/apply-pdf-recovery-store.ts", { "server-only": "", "@/lib/db": `export const neonSql={query:(sql,params)=>({sql,params}),transaction:async(queries,options)=>{const f=globalThis.__qtsRelinkFixture;f.transactions.push({queries,options});if(f.code)throw Object.assign(Error('test transaction'),{code:f.code});return [[],[{outcome:'saved'}]]}};` }) as typeof store;
});
test.beforeEach(() => Object.assign(fixture, { status: 200, context: null, documents: null, saved: true, writes: [], reads: 0, transactions: [], code: "" }));
const request = (value: unknown = body) => new Request("https://qts.test/api/extension/apply/documents/relink", { method: "POST", body: JSON.stringify(value) });

test("all route authorization refusals precede recovery reads/writes; malformed/content payloads cannot save", async () => {
  for (const status of [401, 403, 400, 426]) {
    fixture.status = status;
    assert.equal((await post(request())).status, status);
    assert.equal((await get(new Request(`https://qts.test/api/extension/apply/documents?attemptId=${attemptId}&recovery=1`))).status, status);
  }
  fixture.status = 200;
  for (const value of [{ ...body, bytes: "%PDF-" }, { ...body, attemptId: "bad" }, { ...body, coverLetterPath: "QTS_Resume/../B.pdf" }, "x".repeat(5000)]) {
    assert.equal((await post(request(value))).status, 400);
  }
  assert.equal((await post(new Request("https://qts.test/relink", { method: "POST", body: "{" }))).status, 400);
  assert.equal(fixture.reads, 0); assert.equal(fixture.writes.length, 0);
});

test("recovery details are opt-in and no-store; generic missing documents cannot enable relinking", async () => {
  const url = `https://qts.test/api/extension/apply/documents?attemptId=${attemptId}`;
  const missing = await get(new Request(url));
  assert.equal(missing.status, 404); assert.equal((await missing.json()).code, undefined);
  fixture.context = { jobId: "owned", resumePath: body.expectedResumePath };
  const normal = await get(new Request(url));
  const error = await normal.json();
  assert.equal(error.code, "PDF_RELINK_REQUIRED"); assert.equal(error.recovery, undefined);
  const context = await get(new Request(`${url}&recovery=1`));
  assert.deepEqual((await context.json()).recovery, fixture.context);
  assert.equal(context.headers.get("cache-control"), "no-store");
  assert.equal(fixture.writes.length, 0);
});

test("metadata save uses server identity and reports conflicts without retrying or returning document content", async () => {
  const saved = await post(request());
  assert.equal(saved.status, 200); assert.equal(saved.headers.get("cache-control"), "no-store");
  assert.deepEqual(fixture.writes[0], [{ managerId: "manager", browserId: "browser", authVersion: 7 }, body]);
  fixture.saved = false;
  const conflict = await post(request());
  assert.equal(conflict.status, 409); assert.match((await conflict.json()).message, /Reload recovery/);
  assert.equal(fixture.writes.length, 2);
});

test("the HTTP driver receives one serializable transaction with locks before update and never auto-retries conflicts", async () => {
  const owner = { managerId: "manager", browserId: "browser", authVersion: 7 };
  assert.equal(await store.relinkPdfPaths(owner, body), true);
  const tx = fixture.transactions[0] as { queries: { sql: string }[]; options: unknown };
  assert.deepEqual(tx.options, { isolationLevel: "Serializable" });
  assert.equal(tx.queries.length, 2); assert.match(tx.queries[0].sql, /for update of/);
  assert.match(tx.queries[1].sql, /update "jobs" set resume_local_path/);
  for (const code of ["40001", "40P01", "55P03"]) { fixture.code = code; assert.equal(await store.relinkPdfPaths(owner, body), false); }
  assert.equal(fixture.transactions.length, 4);
  fixture.code = "unexpected"; await assert.rejects(store.relinkPdfPaths(owner, body));
});
