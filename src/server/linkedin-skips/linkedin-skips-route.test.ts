import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";

// The LinkedIn skip-list route with a fake database: what it reads and writes, in how many trips,
// and the Super Admin's switch.
const managerId = "99999999-9999-4999-8999-999999999999";
const fixture = {
  authenticated: true,
  allowed: true,
  rows: [] as Record<string, unknown>[],
  queries: [] as { sql: string; params: unknown[] }[],
  selects: 0,
  record(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); },
};
(globalThis as Record<string, unknown>).__qtsSkipFixture = fixture;
type Handler = (request: Request) => Promise<Response>;
let GET: Handler, POST: Handler;

test.before(async () => {
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/extension-auth": `export const getExtensionManager=async()=>globalThis.__qtsSkipFixture.authenticated?{id:'${managerId}'}:null;`,
    "@/lib/db": `export const db={
      execute:async query=>{const f=globalThis.__qtsSkipFixture;f.record(query);return {rows:f.rows}},
      select:()=>({from:()=>({where:()=>({limit:async()=>{const f=globalThis.__qtsSkipFixture;f.selects++;return [{on:f.allowed}]}})})}),
      delete:()=>({where:()=>({returning:async()=>[]})}),
    };`,
  };
  const result = await build({
    entryPoints: [resolve("src/app/api/extension/linkedin-skips/route.ts")], absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "skip-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => (path in mocks ? { path, namespace: "fixture" } : undefined));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as Record<string, Handler> };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  ({ GET, POST } = loaded.exports);
});
test.beforeEach(() => { fixture.authenticated = true; fixture.allowed = true; fixture.rows = []; fixture.queries = []; fixture.selects = 0; });

const post = (body: unknown) => new Request("http://localhost/api/extension/linkedin-skips", { method: "POST", body: JSON.stringify(body) });
const at = "2026-11-21T10:00:00.000Z";

test("GET reads the switch, skips, bids and saved jobs in one query, only the Manager's, with source and location", async () => {
  fixture.rows = [
    { kind: "skip", key: "staff devops engineer|bloomreach", removed: false, source: "saved", location: "Slovakia (Remote)", at, title: null, company: null },
    { kind: "skip", key: "senior devops engineer|luxoft", removed: true, source: "manual", location: null, at, title: null, company: null },
    { kind: "job", key: "site reliability engineer ii|akamai technologies", removed: false, source: null, location: "Cracow (Remote)", at, title: "x", company: "y" },
    { kind: "bid", key: "site reliability engineer ii|akamai technologies", removed: false, source: null, location: "Cracow (Remote)", at, title: "x", company: "y" },
    { kind: "job", key: null, removed: false, source: null, location: null, at, title: "Platform Engineer (m/w/d)", company: "QualityMinds GmbH" },
  ];
  const body = await (await GET(new Request(`http://localhost/api/extension/linkedin-skips?since=${at}`))).json();
  assert.equal(fixture.queries.length, 1, "one database trip, the switch included");
  assert.match(fixture.queries[0].sql, /not can_use_linkedin_skips[\s\S]*from linkedin_skips[\s\S]*union all[\s\S]*from bids[\s\S]*union all[\s\S]*from jobs/);
  assert.ok(fixture.queries[0].params.every((param) => typeof param !== "string" || param === managerId || /^\d{4}-/.test(param) || param.length < 40), "no other Manager's id");
  assert.equal(body.full, false);
  assert.deepEqual(body.skips, [
    { key: "staff devops engineer|bloomreach", removed: false, source: "saved", location: "Slovakia (Remote)", at },
    { key: "senior devops engineer|luxoft", removed: true, source: "manual", location: null, at },
  ]);
  assert.deepEqual(body.seen, [
    { key: "site reliability engineer ii|akamai technologies", source: "qts_applied", location: "Cracow (Remote)", at },
    { key: "platform engineer m w d|qualityminds", source: "qts_saved", location: null, at },
  ]);
});

test("GET says when the Super Admin turned it off, and sends nothing else; signed out is refused", async () => {
  fixture.rows = [{ kind: "off", key: null, removed: false, source: null, location: null, at: null, title: null, company: null }];
  const off = await GET(new Request("http://localhost/api/extension/linkedin-skips"));
  assert.equal(off.status, 403);
  const body = await off.json();
  assert.equal(body.disabled, true);
  assert.equal(body.skips, undefined);
  fixture.authenticated = false;
  assert.equal((await GET(new Request("http://localhost/api/extension/linkedin-skips"))).status, 401);
});

test("POST checks the switch, then marks and un-skips in at most two statements; LinkedIn's labels never undo an un-skip", async () => {
  const response = await POST(post({
    add: [{ title: "Staff DevOps Engineer", company: "Bloomreach", location: "Slovakia (Remote)", source: "clicked" }, { title: "Senior Cloud Engineer", company: "FP Markets", source: "viewed" }],
    remove: [{ title: "Senior Devops Engineer", company: "Luxoft" }],
  }));
  assert.deepEqual(await response.json(), { success: true, added: 2, removed: 1 });
  assert.equal(fixture.selects, 1, "the switch: one small read");
  assert.equal(fixture.queries.length, 2);
  const [adds, removes] = fixture.queries;
  assert.match(adds.sql, /on conflict \(manager_id, skip_key\) do update set\s+removed_at = case when excluded\.source in \(\$\d+, \$\d+\) then null else linkedin_skips\.removed_at end/);
  assert.ok(adds.params.includes("staff devops engineer|bloomreach") && adds.params.includes("Slovakia (Remote)"));
  assert.match(removes.sql, /'manual', now\(\)\)[\s\S]*do update set removed_at = now\(\), updated_at = now\(\)/);
  assert.ok(removes.params.includes("senior devops engineer|luxoft"));
});

test("POST is refused when the switch is off, and for empty, invalid or oversized batches", async () => {
  fixture.allowed = false;
  const off = await POST(post({ add: [{ title: "T", company: "C" }] }));
  assert.equal(off.status, 403);
  assert.equal((await off.json()).disabled, true);
  fixture.allowed = true;
  for (const body of [{}, { add: [] }, { add: [{ title: "", company: "X" }] }, { add: "x" }, { add: Array.from({ length: 201 }, () => ({ title: "T", company: "C" })) }]) {
    assert.equal((await POST(post(body))).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(fixture.queries.length, 0);
});
