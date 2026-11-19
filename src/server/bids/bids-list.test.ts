import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { PgDialect } from "drizzle-orm/pg-core";

type Query = { sql: string; params: unknown[] };
type Fixture = { results: unknown[][]; queries: Query[]; limits: number[]; offsets: number[] };
const fixture: Fixture = { results: [], queries: [], limits: [], offsets: [] };
(globalThis as Record<string, unknown>).__qtsBidsFixture = fixture;
(globalThis as Record<string, unknown>).__qtsDialect = new PgDialect();

type BidsModule = {
  parseBidsQuery: (raw: Record<string, string | string[] | undefined>) => { field: string; q: string; page: number; size: number };
  readBidsPage: (managerId: string, query: { field: string; q: string; page: number; size: number }) => Promise<{ rows: unknown[]; total: number; all: number; page: number }>;
};
let bidsList: BidsModule;

test.before(async () => {
  // Each select records its where clause, limit and offset, and answers with the next queued result.
  const db = `export const db={select:()=>{const f=globalThis.__qtsBidsFixture;const q={};
    for(const k of ['from','innerJoin','leftJoin','orderBy'])q[k]=()=>q;
    q.where=(w)=>{f.queries.push(globalThis.__qtsDialect.sqlToQuery(w));return q;};
    q.limit=(n)=>{f.limits.push(n);return q;};
    q.offset=(n)=>{f.offsets.push(n);return {then:(ok,no)=>Promise.resolve(f.results.shift()||[]).then(ok,no)};};
    q.then=(ok,no)=>Promise.resolve(f.results.shift()||[]).then(ok,no);
    return q;}};`;
  const mocks: Record<string, string> = { "server-only": "", "@/lib/db": db };
  const result = await build({
    entryPoints: [resolve("src/server/bids/bids-list.ts")], absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as BidsModule };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  bidsList = loaded.exports;
});
test.beforeEach(() => { fixture.results = []; fixture.queries = []; fixture.limits = []; fixture.offsets = []; });

test("the Bids address falls back to safe defaults", () => {
  assert.deepEqual(bidsList.parseBidsQuery({}), { field: "all", q: "", page: 1, size: 25 });
  assert.deepEqual(bidsList.parseBidsQuery({ field: "title", q: "  Acme ", page: "3", size: "50" }), { field: "title", q: "Acme", page: 3, size: 50 });
  assert.deepEqual(bidsList.parseBidsQuery({ field: "answers", page: "-2", size: "1000" }), { field: "all", q: "", page: 1, size: 25 });
});

test("one page is read with the Manager's bids only, and the search covers every listed field", async () => {
  fixture.results = [[{ all: 120, matching: 7 }], [{ id: "b1" }]];
  const page = await bidsList.readBidsPage("manager-1", { field: "all", q: "50%", page: 1, size: 25 });
  assert.deepEqual(page, { rows: [{ id: "b1" }], total: 7, all: 120, page: 1 });
  assert.deepEqual(fixture.limits, [25]);
  assert.deepEqual(fixture.offsets, [0]);
  const rowsQuery = fixture.queries.find((query) => query.sql.includes("ilike") && query.params.includes("manager-1"));
  assert.ok(rowsQuery);
  for (const column of ["first_name", "job_url", "source_site_url", "job_title", "company", "created_at"]) assert.match(rowsQuery.sql, new RegExp(column));
  // The search words are escaped, so % matches a percent sign.
  assert.ok(rowsQuery.params.includes("%50\\%%"));
  // Answers are never read by the list.
  assert.equal(fixture.queries.some((query) => query.sql.includes("answers")), false);
});

test("a page past the end shows the last page", async () => {
  fixture.results = [[{ all: 30, matching: 30 }], [], [{ id: "last" }]];
  const page = await bidsList.readBidsPage("manager-1", { field: "all", q: "", page: 9, size: 25 });
  assert.equal(page.page, 2);
  assert.deepEqual(page.rows, [{ id: "last" }]);
  assert.deepEqual(fixture.offsets, [200, 25]);
});

test("Job URL search finds a bid from a pasted link however it was copied", async () => {
  fixture.results = [[{ all: 5, matching: 1 }], [{ id: "b1" }]];
  await bidsList.readBidsPage("manager-1", { field: "url", q: "https://www.boards.greenhouse.io/acme/jobs/123/#apply", page: 1, size: 25 });
  const rowsQuery = fixture.queries.find((query) => query.sql.includes("ilike") && query.params.includes("manager-1"));
  assert.ok(rowsQuery);
  assert.match(rowsQuery.sql, /job_url/);
  assert.doesNotMatch(rowsQuery.sql, /source_site_url/);
  assert.ok(rowsQuery.params.includes("%boards.greenhouse.io/acme/jobs/123%"));
});
