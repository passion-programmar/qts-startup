import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { runPreflight, readReleaseMigrations } = createRequire(`${process.cwd()}/package.json`)("./scripts/generation-schema-preflight.cjs");
const previous = { folderMillis: 1793258510114, hash: "previous", sql: [] };
const current = { folderMillis: 1793260000000, hash: "current", sql: ["ALTER TABLE jobs ADD COLUMN generation_prompt_id uuid;", "ALTER TABLE jobs ADD CONSTRAINT jobs_generation_prompt_id_prompts_id_fk FOREIGN KEY (generation_prompt_id) REFERENCES prompts(id);"] };

function database({ applied = false, older = false, incompatible = false } = {}) {
  const queries: string[] = [];
  let transactionCalls = 0;
  return {
    queries,
    get transactionCalls() { return transactionCalls; },
    sql: {
      query: (query: string) => {
        queries.push(query);
        if (query.startsWith("select hash")) return Promise.resolve([{ created_at: older ? 1 : applied ? current.folderMillis : previous.folderMillis, hash: applied ? current.hash : previous.hash }]);
        if (query.startsWith("select\n")) return Promise.resolve([{ column_exists: applied || incompatible, column_ok: applied, constraint_ok: applied }]);
        return Promise.resolve([]);
      },
      transaction: async () => { transactionCalls += 1; applied = true; },
    },
  };
}

test("release preflight is read-only by default and refuses unrelated or inconsistent migrations", async () => {
  for (const options of [{}, { older: true }, { incompatible: true }]) {
    const db = database(options);
    await assert.rejects(runPreflight({ sql: db.sql, migrations: [previous, current], apply: false }));
    assert.equal(db.transactionCalls, 0);
    assert.ok(db.queries.every((query) => query.startsWith("select")));
  }
  const db = database({ older: true });
  await assert.rejects(runPreflight({ sql: db.sql, migrations: [previous, current], apply: true }), /history/);
  assert.equal(db.transactionCalls, 0);
});

test("release preflight applies only 0080 atomically and verifies the resulting schema", async () => {
  const db = database();
  assert.equal(await runPreflight({ sql: db.sql, migrations: [previous, current], apply: true }), "applied and verified");
  assert.equal(db.transactionCalls, 1);
  assert.ok(db.queries.some((query) => query.includes("pg_advisory_xact_lock")));
  assert.ok(db.queries.some((query) => query.includes("lock_timeout")));
  assert.equal(db.queries.filter((query) => query.startsWith("select\n")).length, 2);
});

test("an already recorded and verified 0080 migration performs no writes", async () => {
  const db = database({ applied: true });
  assert.equal(await runPreflight({ sql: db.sql, migrations: [previous, current], apply: true }), "already applied");
  assert.equal(db.transactionCalls, 0);
  assert.ok(db.queries.every((query) => query.startsWith("select")));
});

test("runtime schema verification needs no migration-ledger permissions", async () => {
  const db = database({ applied: true });
  assert.equal(await runPreflight({ sql: db.sql, migrations: [previous, current] }), "schema verified (read-only)");
  assert.equal(db.transactionCalls, 0);
  assert.equal(db.queries.length, 1);
  assert.ok(db.queries.every((query) => !query.includes("__drizzle_migrations")));
});

test("migration checksums retain committed LF hashes on Windows", () => {
  const migrations: { folderMillis: number; hash: string }[] = readReleaseMigrations("drizzle");
  assert.equal(migrations.find((entry) => entry.folderMillis === previous.folderMillis)?.hash,
    "3dde1c3b3263aa45eb54c94bd1bc7ae6492fa549f7c3c96915e5557890436fe7");
});
