import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { parseRelinkInput, pdfParent, recoveryContextQuery, relinkUpdateQuery } from "./apply-pdf-recovery";

const ids = { manager: "10000000-0000-4000-8000-000000000001", browser: "10000000-0000-4000-8000-000000000002",
  candidate: "10000000-0000-4000-8000-000000000003", job: "10000000-0000-4000-8000-000000000004",
  attempt: "10000000-0000-4000-8000-000000000005", run: "10000000-0000-4000-8000-000000000006" };
const owner = { managerId: ids.manager, browserId: ids.browser, authVersion: 3 };
const input = { attemptId: ids.attempt, generationId: ids.run, expectedResumePath: "QTS_Resume/Old Name.pdf",
  expectedCoverLetterPath: null, resumePath: "QTS_Resume/Old Name (1).pdf", coverLetterPath: "QTS_Resume/Letter (2).pdf" };

test("relink input preserves exact independent suffixes and requires both roles and old-path preconditions", () => {
  assert.deepEqual(parseRelinkInput(input), input);
  assert.equal(pdfParent("QTS_Resume/Manager/Old Name/Run/Name (12).pdf"), "QTS_Resume/Manager/Old Name/Run");
  for (const change of [ { resumePath: input.coverLetterPath }, { expectedCoverLetterPath: "QTS_Resume/existing.pdf" },
    { resumePath: "QTS_Resume/other/Name.pdf" }, { generationId: "bad" }, { bytes: "do not accept document bytes" } ]) {
    assert.equal(parseRelinkInput({ ...input, ...change }), null);
  }
  const partial = { ...input } as Partial<typeof input>;
  delete partial.expectedCoverLetterPath;
  assert.equal(parseRelinkInput(partial), null);
});

test("relink paths reject traversal, absolute paths, ambiguous Windows entries and oversized inputs", () => {
  for (const path of ["C:/Downloads/QTS_Resume/a.pdf", "//server/share/a.pdf", "QTS_Resume/../a.pdf", "QTS_Resume//a.pdf",
    "QTS_Resume/./a.pdf", "QTS_Resume\\a.pdf", "QTS_Resume/a.pdf:stream", "QTS_Resume/a\0.pdf",
    "QTS_Resume/a\n.pdf", "QTS_Resume/folder./a.pdf", "QTS_Resume/a.pdf ", "QTS_Resume/a.txt", `QTS_Resume/${"a".repeat(500)}.pdf`]) {
    assert.equal(pdfParent(path), null, path);
    assert.equal(parseRelinkInput({ ...input, resumePath: path }), null, path);
  }
});

// Optional in-memory PostgreSQL, never DATABASE_URL. Install only into the ignored verification
// folder: npm install --prefix .pdf-verification/task3-test-tools --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
const engine = resolve(process.env.QTS_TEST_PGLITE_PATH || ".pdf-verification/task3-test-tools/node_modules/@electric-sql/pglite/dist/index.cjs");
type Engine = { exec(sql: string): Promise<unknown>; query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void> };
const dialect = new PgDialect();

test("actual PostgreSQL relink statements enforce authorization, lifecycle, CAS and idempotence", {
  skip: !existsSync(engine) && "Install the isolated PGlite test engine or set QTS_TEST_PGLITE_PATH (no production connection)",
}, async (t) => {
  const { PGlite } = createRequire(__filename)(engine) as { PGlite: new () => Engine };
  const pg = new PGlite();
  const run = async <T>(query: ReturnType<typeof recoveryContextQuery>) => {
    const compiled = dialect.sqlToQuery(query);
    return (await pg.query<T>(compiled.sql, compiled.params)).rows;
  };
  await pg.exec(`
    create table users (id uuid primary key, role text, blocked_at timestamptz, auth_version int, can_use_apply boolean);
    create table profiles (user_id uuid primary key, first_name text, last_name text);
    create table extension_browsers (id uuid primary key, manager_id uuid);
    create table jobs (id uuid primary key, manager_id uuid, candidate_id uuid, job_title text, company text,
      resume_local_path text, cover_letter_local_path text, generation_status text, status text,
      generation_lease_expires_at timestamptz, job_url text, title_company_key text, updated_at timestamptz);
    create table generation_runs (id uuid primary key, job_id uuid, manager_id uuid, status text, created_at timestamptz);
    create table apply_attempts (id uuid primary key, job_id uuid, candidate_id uuid, manager_id uuid, browser_id uuid,
      status text, lease_expires_at timestamptz, submit_granted_at timestamptz, finished_at timestamptz);
    create table bids (manager_id uuid, candidate_id uuid, job_url text, title_company_key text);
    insert into users values ('${ids.manager}', 'manager', null, 3, true), ('${ids.candidate}', 'account', null, 1, false);
    insert into profiles values ('${ids.candidate}', 'Old', 'Name');
    insert into extension_browsers values ('${ids.browser}', '${ids.manager}');
    insert into jobs values ('${ids.job}', '${ids.manager}', '${ids.candidate}', 'Developer', 'Company',
      'QTS_Resume/Old Name.pdf', null, 'completed', 'todo', null, 'https://example.test/job', 'developer_company', now());
    insert into generation_runs values ('${ids.run}', '${ids.job}', '${ids.manager}', 'delivered', now());
    insert into apply_attempts values ('${ids.attempt}', '${ids.job}', '${ids.candidate}', '${ids.manager}', '${ids.browser}',
      'waiting_review', now() + interval '10 minutes', null, null);
  `);
  try {
    await t.test("live context is read-only; one atomic update and identical replay causes no second update", async () => {
      const before = (await pg.query<Record<string, unknown>>("select * from jobs")).rows[0];
      const context = await run<{ resumePath: string }>(recoveryContextQuery(owner, ids.attempt));
      assert.equal(context[0].resumePath, input.expectedResumePath);
      await pg.exec("begin isolation level serializable");
      await run(recoveryContextQuery(owner, ids.attempt, true));
      assert.deepEqual(await run(relinkUpdateQuery(owner, input)), [{ outcome: "saved" }]);
      await pg.exec("commit");
      const after = (await pg.query<Record<string, unknown>>("select * from jobs")).rows[0];
      assert.deepEqual({ ...after, resume_local_path: before.resume_local_path, cover_letter_local_path: before.cover_letter_local_path, updated_at: before.updated_at }, before);
      assert.deepEqual(await run(relinkUpdateQuery(owner, input)), [{ outcome: "unchanged" }]);
      assert.deepEqual((await pg.query("select * from jobs")).rows[0], after);
      assert.deepEqual(await run(relinkUpdateQuery(owner, { ...input, coverLetterPath: "QTS_Resume/Other.pdf" })), []);
      assert.deepEqual(await run(relinkUpdateQuery(owner, { ...input, generationId: ids.candidate })), []);
      await pg.exec("update jobs set resume_local_path = 'QTS_Resume/Old Name.pdf', cover_letter_local_path = null");
    });
    const refuses: Array<[string, string]> = [
      ["foreign attempt manager", `update apply_attempts set manager_id = '${ids.candidate}'`],
      ["foreign browser", `update apply_attempts set browser_id = '${ids.candidate}'`],
      ["foreign job owner", `update jobs set manager_id = '${ids.candidate}'`],
      ["changed candidate", `update jobs set candidate_id = '${ids.manager}'`],
      ["browser owner changed", `update extension_browsers set manager_id = '${ids.candidate}'`],
      ["Apply revoked", "update users set can_use_apply = false"],
      ["Manager blocked", `update users set blocked_at = now() where id = '${ids.manager}'`],
      ["candidate blocked", `update users set blocked_at = now() where id = '${ids.candidate}'`],
      ["auth version changed", "update users set auth_version = 4"],
      ["expired lease", "update apply_attempts set lease_expires_at = now() - interval '1 second'"],
      ["no lease", "update apply_attempts set lease_expires_at = null"],
      ...["claimed", "submitting", "waiting_confirmation", "released", "failed", "confirmed", "not_confirmed", "skipped", "cleared"]
        .map((status): [string, string] => [status, `update apply_attempts set status = '${status}'`]),
      ["submission started", "update apply_attempts set submit_granted_at = now()"],
      ["finished", "update apply_attempts set finished_at = now()"],
      ["applied", "update jobs set status = 'applied'"],
      ["not completed", "update jobs set generation_status = 'processing'"],
      ["Generation lease", "update jobs set generation_lease_expires_at = now() + interval '1 minute'"],
      ["foreign delivered run", `update generation_runs set manager_id = '${ids.candidate}'`],
      ["no delivered run", "delete from generation_runs"],
      ["new undelivered run", `insert into generation_runs values ('${ids.candidate}', '${ids.job}', '${ids.manager}', 'pending', now())`],
      ["bid", `insert into bids values ('${ids.manager}', '${ids.candidate}', 'https://example.test/job/', 'another_title')`],
    ];
    for (const [label, mutation] of refuses) await t.test(`${label}: no context or write`, async () => {
      await pg.exec("begin");
      try {
        await pg.exec(mutation);
        assert.deepEqual(await run(recoveryContextQuery(owner, ids.attempt)), []);
        assert.deepEqual(await run(relinkUpdateQuery(owner, input)), []);
      } finally { await pg.exec("rollback"); }
    });
    for (const [label, mutation] of [
      ["changed resume", "update jobs set resume_local_path = 'QTS_Resume/Newer.pdf'"],
      ["changed cover", "update jobs set cover_letter_local_path = 'QTS_Resume/Newer.pdf'"],
      ["new delivered run", `insert into generation_runs values ('${ids.candidate}', '${ids.job}', '${ids.manager}', 'delivered', now() + interval '1 second')`],
    ]) await t.test(`${label}: stale save conflicts`, async () => {
      await pg.exec("begin");
      try { await pg.exec(mutation); assert.deepEqual(await run(relinkUpdateQuery(owner, input)), []); }
      finally { await pg.exec("rollback"); }
    });
  } finally { await pg.close(); }
});
