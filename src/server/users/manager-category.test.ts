import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
const fixture = { role: "manager", queries: [] as { sql: string; params: unknown[] }[],
  statusTarget: null as { blockedAt: Date | null; deletedAt: Date | null } | null,
  statusUpdate: null as Record<string, unknown> | null,
  record(query: Parameters<PgDialect["sqlToQuery"]>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); } };
(globalThis as Record<string, unknown>).__qtsCategory = fixture;
let actions: typeof import("@/app/users/actions");
test.before(async () => {
  const mocks: Record<string, string> = {
    "server-only": "", "next/cache": "export const revalidatePath=()=>{};",
    "@/lib/session": "export const requireUser=async()=>({id:'manager-id',role:globalThis.__qtsCategory.role});",
    "@/lib/db": `const f=globalThis.__qtsCategory;const selectQuery={from(){return this},where(){return this},limit:async()=>f.statusTarget?[f.statusTarget]:[]};const updateQuery={set(value){f.statusUpdate=value;return this},where(){return this},returning:async()=>[{id:'candidate'}]};export const db={execute:async query=>{f.record(query);return {rows:[]}},select:()=>selectQuery,update:()=>updateQuery};export const neonSql={transaction:async work=>{const list=work((strings,...params)=>{f.queries.push({sql:strings.join('?'),params});return []});return list.map((_,i)=>i===0?[{user_id:'candidate'}]:[])}};`,
  };
  const built = await build({ entryPoints: [resolve("src/app/users/actions.ts")], tsconfig: resolve("tsconfig.json"), bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "category-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  actions = loaded.exports as typeof actions;
});
test.beforeEach(() => { fixture.role = "manager"; fixture.queries = []; fixture.statusTarget = null; fixture.statusUpdate = null; });
const form = (category?: string, categoryColor = "") => {
  const data = new FormData();
  for (const field of ["birthday", "phone", "headline", "linkedinUrl", "country", "city", "province", "addressLine1", "postalCode", "jdMatching"]) data.set(field, "");
  for (const [name, value] of Object.entries({ userId: "11111111-1111-4111-8111-111111111111", firstName: "Sample", lastName: "Candidate", candidateEmail: "sample@example.test", pdfTemplate: "qts-standard", categoryId: "forged-global-category", managerCategoryColor: categoryColor })) data.set(name, value);
  if (category !== undefined) data.set("managerCategory", category);
  return data;
};
test("Manager creates inactive accounts and saves arbitrary category labels and colors", async () => {
  for (const [label, color] of [[undefined, ""], ["Platform / SRE", "#2563eb"]] as const) {
    const result = await actions.createUserAction({ error: null, success: null }, form(label, color));
    assert.equal(result.error, null);
    const query = fixture.queries.at(-1)!;
    assert.match(query.sql, /manager_category/); assert.ok(query.params.includes(label || ""));
    assert.match(query.sql, /manager_category_color/); assert.ok(query.params.includes(color || null));
    assert.match(query.sql, /blocked_at, blocked_by/); assert.ok(query.params.includes("manager-id"));
    assert.ok(!query.params.includes("forged-global-category"));
  }
});
test("Manager cannot save a category color outside the preset palette", async () => {
  const result = await actions.createUserAction({ error: null, success: null }, form("Platform / SRE", "#123456"));
  assert.match(result.error!, /category color/i);
  assert.equal(fixture.queries.length, 0);
});
test("clicking Inactive reactivates a candidate, but deleted candidates cannot be reactivated", async () => {
  const data = new FormData();
  data.set("userId", "11111111-1111-4111-8111-111111111111");
  fixture.statusTarget = { blockedAt: new Date(), deletedAt: null };
  assert.equal((await actions.toggleCandidateAccountStatusAction({ error: null, success: null }, data)).error, null);
  assert.equal(fixture.statusUpdate?.blockedAt, null);
  assert.equal(fixture.statusUpdate?.blockedBy, null);

  fixture.statusUpdate = null;
  fixture.statusTarget = { blockedAt: new Date(), deletedAt: new Date() };
  assert.match((await actions.toggleCandidateAccountStatusAction({ error: null, success: null }, data)).error!, /cannot be reactivated/i);
  assert.equal(fixture.statusUpdate, null);
});
test("Manager edits only their candidate label, leaving the global category untouched", async () => {
  const result = await actions.updateCandidateProfileAction({ error: null, success: null }, form("Python / Backend", "#10b981"));
  assert.equal(result.error, null);
  const query = fixture.queries[0]; assert.match(query.sql, /set manager_category/); assert.match(query.sql, /manager_category_color/); assert.doesNotMatch(query.sql, /set category_id/);
  assert.match(query.sql, /parent_user_id/); assert.match(query.sql, /deleted_at is null/); assert.doesNotMatch(query.sql, /blocked_at is null/); assert.ok(query.params.includes("#10b981")); assert.ok(query.params.includes("manager-id"));
  fixture.role = "admin";
  assert.match((await actions.updateCandidateProfileAction({ error: null, success: null }, form("Other"))).error!, /Only Managers/);
});
