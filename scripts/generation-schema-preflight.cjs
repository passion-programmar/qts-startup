// Release-only schema check. --apply permits only the already-reviewed 0080 migration.
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readMigrationFiles } = require('drizzle-orm/migrator');

const schemaQuery = `select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='generation_prompt_id') as column_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='generation_prompt_id' and data_type='uuid' and is_nullable='YES') as column_ok,
  exists(select 1 from information_schema.table_constraints where table_schema='public' and table_name='jobs' and constraint_name='jobs_generation_prompt_id_prompts_id_fk' and constraint_type='FOREIGN KEY') as constraint_ok`;

async function runPreflight({ sql, migrations, apply = false }) {
  const migration = migrations.find((entry) => entry.folderMillis === 1793260000000);
  const previous = migrations.find((entry) => entry.folderMillis === 1793258510114);
  if (!migration || !previous || migration.sql.filter((statement) => statement.trim()).length !== 2) {
    throw new Error('Expected the established 0079 and 0080 migration files.');
  }
  const [state] = await sql.query(schemaQuery);
  if (!apply) {
    if (!state.column_ok || !state.constraint_ok) throw new Error('Migration 0080_generation_prompt_selection is required before this release.');
    return 'schema verified (read-only)';
  }
  const [latest] = await sql.query('select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1');
  const alreadyRecorded = Number(latest?.created_at) === migration.folderMillis && latest?.hash === migration.hash;
  if (alreadyRecorded && state.column_ok && state.constraint_ok) return 'already applied';
  if (Number(latest?.created_at) !== previous.folderMillis || latest?.hash !== previous.hash) {
    throw new Error('Migration history is not at the expected 0079 state. Refusing to run other migrations or repair inconsistent history.');
  }
  if (state.column_exists && !state.column_ok) throw new Error('Existing generation_prompt_id column has an incompatible definition.');
  const statements = migration.sql.filter((statement) => statement.trim());
  await sql.transaction([
    sql.query("set local lock_timeout = '5s'"),
    sql.query("set local statement_timeout = '30s'"),
    sql.query('select pg_advisory_xact_lock(8080)'),
    sql.query(`do $$ begin
      if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='generation_prompt_id') then
        ${statements[0]}
      end if;
      if not exists(select 1 from information_schema.table_constraints where table_schema='public' and table_name='jobs' and constraint_name='jobs_generation_prompt_id_prompts_id_fk') then
        ${statements[1]}
      end if;
    end $$`),
    sql.query('insert into drizzle.__drizzle_migrations (hash, created_at) select $1, $2 where not exists (select 1 from drizzle.__drizzle_migrations where created_at = $2)', [migration.hash, migration.folderMillis]),
  ]);
  const [verified] = await sql.query(schemaQuery);
  if (!verified.column_ok || !verified.constraint_ok) throw new Error('Migration 0080 schema verification failed.');
  return 'applied and verified';
}

module.exports = { runPreflight };

if (require.main === module) {
  (async () => {
    if (process.argv.slice(2).some((argument) => argument !== '--apply')) throw new Error('Usage: node scripts/generation-schema-preflight.cjs [--apply]');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in the intended deployment environment.');
    const target = new URL(process.env.DATABASE_URL);
    const fingerprint = createHash('sha256').update(target.hostname.replace(/-pooler(?=\.)/, '') + target.pathname).digest('hex');
    console.log(`Generation database target fingerprint: ${fingerprint}`);
    const { neon } = require('@neondatabase/serverless');
    const result = await runPreflight({
      sql: neon(process.env.DATABASE_URL),
      migrations: readMigrationFiles({ migrationsFolder: path.join(__dirname, '..', 'drizzle') }),
      apply: process.argv.includes('--apply'),
    });
    console.log(`Generation schema: ${result}.`);
  })().catch((error) => {
    console.error('Generation schema preflight failed:', error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted connection]'));
    process.exitCode = 1;
  });
}
