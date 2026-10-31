import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const fixture = { authenticated: true, skip: false, fail: false, queries: 0 };
(globalThis as Record<string, unknown>).__qtsPrecheckFixture = fixture;
const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
test.before(async () => {
const bundled = await build({
  absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
  entryPoints: [resolve("src/app/api/extension/get-jd/check/route.ts")], bundle: true, write: false,
  platform: "node", format: "cjs", packages: "external", plugins: [{
    name: "local-precheck-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "local-fixture" }));
      builder.onResolve({ filter: /^@\/lib\/(db|extension-auth)$/ }, (args) => ({ path: args.path, namespace: "local-fixture" }));
      builder.onResolve({ filter: /^@\/server\/get-jd\/precheck-ticket$/ }, (args) => ({ path: args.path, namespace: "local-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "local-fixture" }, ({ path }) => ({ contents:
        path === "server-only" ? "" : path.endsWith("/db") ? `export const db={execute:async()=>{const f=globalThis.__qtsPrecheckFixture;f.queries++;if(f.fail)throw Error('Local network failure');return {rows:[{skip:f.skip}]}}}; export const neonSql={};`
          : path.endsWith("extension-auth") ? `export const getExtensionManager=async()=>globalThis.__qtsPrecheckFixture.authenticated?{id:'local-manager'}:null;`
            : `export const getPrecheckTickets=()=>({issue:async()=> 'local-signed-ticket-fixture'});`,
      }));
    },
  }],
});
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(`${process.cwd()}/package.json`), loaded, loaded.exports);
});
const request = () => new Request("http://localhost/api/extension/get-jd/check", { method: "POST", body: JSON.stringify({ scope: "global", job: { jobUrl: "https://example.test/jobs/1" } }) });

test("global duplicate returns only skip, without another Manager's confidential details", async () => {
  fixture.skip = true; fixture.queries = 0;
  const response = await loaded.exports.POST(request());
  assert.deepEqual(await response.json(), { success: true, skip: true }); assert.equal(fixture.queries, 1);
});
test("new job returns a precheck ticket after exactly one database statement", async () => {
  fixture.skip = false; fixture.queries = 0;
  const response = await loaded.exports.POST(request());
  assert.deepEqual(await response.json(), { success: true, skip: false, precheckToken: "local-signed-ticket-fixture" }); assert.equal(fixture.queries, 1);
});
test("precheck errors fail closed with a retryable response", async () => {
  fixture.fail = true; const response = await loaded.exports.POST(request()); fixture.fail = false;
  assert.equal(response.status, 503); assert.equal((await response.json()).success, false);
});
test("unauthenticated requests never query global records", async () => {
  fixture.authenticated = false; fixture.queries = 0;
  const response = await loaded.exports.POST(request()); fixture.authenticated = true;
  assert.equal(response.status, 401); assert.equal(fixture.queries, 0);
});
