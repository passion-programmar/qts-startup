import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { PgDialect } from "drizzle-orm/pg-core";

type Query = { sql: string; params: unknown[] };
const fixture = { deleted: [] as { id: string }[], kept: [] as { generationStatus: string; hasBid: boolean }[], deletes: [] as Query[], selects: [] as Query[] };
(globalThis as Record<string, unknown>).__qtsDeleteJobsFixture = fixture;
(globalThis as Record<string, unknown>).__qtsDialect = new PgDialect();

type Result = { deleted: number; generating: number; applied: number; other: number; resumeFiles?: string[] };
type DeleteJobsModule = {
  deleteManagerJobs: (managerId: string, ids: string[]) => Promise<Result>;
  deleteJobsMessage: (result: Result) => string;
  MAX_JOBS_PER_DELETE: number;
};
let deleteJobs: DeleteJobsModule;

const manager = "99999999-9999-4999-8999-999999999999";
const jobA = "11111111-1111-4111-8111-111111111111";
const jobB = "22222222-2222-4222-8222-222222222222";
const jobC = "33333333-3333-4333-8333-333333333333";

test.before(async () => {
  // delete().where().returning() answers with fixture.deleted; select().from().where() with fixture.kept.
  const db = `const f=()=>globalThis.__qtsDeleteJobsFixture;const sqlOf=(w)=>globalThis.__qtsDialect.sqlToQuery(w);
    export const db={
      delete:()=>({where:(w)=>{f().deletes.push(sqlOf(w));return {returning:async()=>f().deleted};}}),
      select:()=>({from:()=>({where:async(w)=>{f().selects.push(sqlOf(w));return f().kept;}})}),
    };`;
  const mocks: Record<string, string> = { "server-only": "", "@/lib/db": db };
  const result = await build({
    entryPoints: [resolve("src/server/jobs/delete-jobs.ts")], absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as DeleteJobsModule };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  deleteJobs = loaded.exports;
});
test.beforeEach(() => { fixture.deleted = []; fixture.kept = []; fixture.deletes = []; fixture.selects = []; });

test("selected jobs are deleted in one statement, only the Manager's own and only those allowed", async () => {
  fixture.deleted = [{ id: jobA }, { id: jobB }];
  assert.deepEqual(await deleteJobs.deleteManagerJobs(manager, [jobA, jobB]), { deleted: 2, generating: 0, applied: 0, other: 0, resumeFiles: [] });
  assert.equal(fixture.deletes.length, 1);
  const [statement] = fixture.deletes;
  assert.match(statement.sql, /"jobs"\."id" in \(\$1, \$2\)/);
  assert.match(statement.sql, /"jobs"\."manager_id" = \$3/);
  assert.match(statement.sql, /"jobs"\."generation_status" <> \$4/);
  assert.match(statement.sql, /not exists \(\s*select 1 from "bids"/);
  assert.deepEqual(statement.params.slice(0, 4), [jobA, jobB, manager, "processing"]);
  // Everything went, so the kept jobs are never read.
  assert.equal(fixture.selects.length, 0);
});

test("jobs that stay are read once to say why: generating, applied, or not found", async () => {
  fixture.deleted = [{ id: jobA }];
  fixture.kept = [{ generationStatus: "processing", hasBid: false }];
  const result = await deleteJobs.deleteManagerJobs(manager, [jobA, jobB, jobC]);
  assert.deepEqual(result, { deleted: 1, generating: 1, applied: 0, other: 1, resumeFiles: [] });
  assert.equal(fixture.selects.length, 1);
  assert.deepEqual(fixture.selects[0].params.slice(0, 2), [jobB, jobC]);
  assert.ok(fixture.selects[0].params.includes(manager), "only the Manager's own jobs are looked up");

  fixture.deleted = [];
  fixture.kept = [{ generationStatus: "completed", hasBid: true }];
  assert.deepEqual(await deleteJobs.deleteManagerJobs(manager, [jobA]), { deleted: 0, generating: 0, applied: 1, other: 0, resumeFiles: [] });
});

test("nothing selected deletes nothing and asks nothing", async () => {
  assert.deepEqual(await deleteJobs.deleteManagerJobs(manager, []), { deleted: 0, generating: 0, applied: 0, other: 0, resumeFiles: [] });
  assert.equal(fixture.deletes.length, 0);
});

test("the message says what was deleted and why any job was kept", () => {
  assert.equal(deleteJobs.deleteJobsMessage({ deleted: 3, generating: 0, applied: 0, other: 0 }), "Deleted 3 jobs.");
  assert.equal(deleteJobs.deleteJobsMessage({ deleted: 1, generating: 0, applied: 0, other: 0 }), "Deleted 1 job.");
  assert.equal(
    deleteJobs.deleteJobsMessage({ deleted: 2, generating: 1, applied: 2, other: 1 }),
    "Deleted 2 jobs. Kept 1 job still making a résumé: cancel Generation first. Kept 2 jobs with a bid: they belong to the Bids page. 1 job could not be found: refresh the page.",
  );
  assert.equal(
    deleteJobs.deleteJobsMessage({ deleted: 0, generating: 2, applied: 0, other: 0 }),
    "No jobs were deleted. Kept 2 jobs still making a résumé: cancel Generation first.",
  );
  assert.equal(deleteJobs.MAX_JOBS_PER_DELETE, 100);
});

test("the deleted jobs' PDFs under QTS_Resume are returned for the page to delete on this PC", async () => {
  fixture.deleted = [
    { id: jobA, resumeLocalPath: String.raw`QTS_Resume\MSK\Anna\2026_Dev_Acme\Anna.pdf`, coverLetterLocalPath: "QTS_Resume/MSK/Anna/2026_Dev_Acme/Anna_Cover_Letter.pdf" },
    { id: jobB, resumeLocalPath: "C:/Windows/system.pdf", coverLetterLocalPath: "QTS_Resume/../secret.pdf" },
  ] as unknown as { id: string }[];
  const result = await deleteJobs.deleteManagerJobs(manager, [jobA, jobB]);
  assert.deepEqual(result.resumeFiles, [
    "QTS_Resume/MSK/Anna/2026_Dev_Acme/Anna.pdf",
    "QTS_Resume/MSK/Anna/2026_Dev_Acme/Anna_Cover_Letter.pdf",
  ]);
});
