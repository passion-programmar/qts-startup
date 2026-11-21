import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";

// The LinkedIn skip-list route with a fake database: what it reads and writes, in how many trips.
const managerId = "99999999-9999-4999-8999-999999999999";
const fixture = {
  authenticated: true,
  rows: [] as Record<string, unknown>[],
  queries: [] as { sql: string; params: unknown[] }[],
  record(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); },
};
(globalThis as Record<string, unknown>).__qtsSkipFixture = fixture;
type Handler = (request: Request) => Promise<Response>;
let GET: Handler, POST: Handler;

test.before(async () => {
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/extension-auth": `export const getExtensionManager=async()=>globalThis.__qtsSkipFixture.authenticated?{id:'${managerId}'}:null;`,
    "@/lib/db": "export const db={execute:async query=>{const f=globalThis.__qtsSkipFixture;f.record(query);return {rows:f.rows}},delete:()=>({where:()=>({returning:async()=>[]})})};",
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
test.beforeEach(() => { fixture.authenticated = true; fixture.rows = []; fixture.queries = []; });

const post = (body: unknown) => new Request("http://localhost/api/extension/linkedin-skips", { method: "POST", body: JSON.stringify(body) });

test("GET reads skips, bids and saved jobs in one query, only the Manager's, and keys them like the server", async () => {
  fixture.rows = [
    { kind: "skip", key: "staff devops engineer|bloomreach", removed: false, title: null, company: null },
    { kind: "skip", key: "senior devops engineer|luxoft", removed: true, title: null, company: null },
    { kind: "seen", key: "site reliability engineer ii|akamai technologies", removed: false, title: "x", company: "y" },
    { kind: "seen", key: null, removed: false, title: "Platform Engineer (m/w/d)", company: "QualityMinds GmbH" },
  ];
  const body = await (await GET(new Request("http://localhost/api/extension/linkedin-skips?since=2026-11-21T10:00:00.000Z"))).json();
  assert.equal(fixture.queries.length, 1, "one database trip");
  assert.match(fixture.queries[0].sql, /from linkedin_skips[\s\S]*union all[\s\S]*from bids[\s\S]*union all[\s\S]*from jobs/);
  assert.ok(fixture.queries[0].params.filter((param) => param === managerId).length === 3, "every part only for this Manager");
  assert.equal(body.full, false);
  assert.deepEqual(body.skips, [{ key: "staff devops engineer|bloomreach", removed: false }, { key: "senior devops engineer|luxoft", removed: true }]);
  assert.deepEqual(body.seen, ["site reliability engineer ii|akamai technologies", "platform engineer m w d|qualityminds"]);
  assert.ok(Date.parse(body.cursor) > 0);
});

test("GET without since is the full 90-day list; signed out is refused", async () => {
  assert.equal((await (await GET(new Request("http://localhost/api/extension/linkedin-skips"))).json()).full, true);
  fixture.authenticated = false;
  assert.equal((await GET(new Request("http://localhost/api/extension/linkedin-skips"))).status, 401);
});

test("POST marks and un-skips in at most two statements; LinkedIn's own labels never undo an un-skip", async () => {
  const response = await POST(post({
    add: [{ title: "Staff DevOps Engineer", company: "Bloomreach", source: "clicked" }, { title: "Senior Cloud Engineer", company: "FP Markets", source: "viewed" }],
    remove: [{ title: "Senior Devops Engineer", company: "Luxoft" }],
  }));
  assert.deepEqual(await response.json(), { success: true, added: 2, removed: 1 });
  assert.equal(fixture.queries.length, 2);
  const [adds, removes] = fixture.queries;
  assert.match(adds.sql, /on conflict \(manager_id, skip_key\) do update set\s+removed_at = case when excluded\.source in \(\$\d+, \$\d+\) then null else linkedin_skips\.removed_at end/);
  assert.ok(adds.params.includes("staff devops engineer|bloomreach") && adds.params.includes("senior cloud engineer|fp markets"));
  assert.ok(adds.params.includes("clicked") && adds.params.includes("manual"));
  assert.match(removes.sql, /'manual', now\(\)\)[\s\S]*do update set removed_at = now\(\), updated_at = now\(\)/);
  assert.ok(removes.params.includes("senior devops engineer|luxoft"));
});

test("POST refuses empty, invalid or oversized batches and writes nothing", async () => {
  for (const body of [{}, { add: [] }, { add: [{ title: "", company: "X" }] }, { add: "x" }, { add: Array.from({ length: 201 }, () => ({ title: "T", company: "C" })) }]) {
    assert.equal((await POST(post(body))).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(fixture.queries.length, 0);
});
