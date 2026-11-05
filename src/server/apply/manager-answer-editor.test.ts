import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { answerAttemptQuery, editAnswerQuery, parseAnswerEdit, type AnswerEdit } from "./manager-answer-editor";

const ids = { manager: '11111111-1111-4111-8111-111111111111', candidate: '22222222-2222-4222-8222-222222222222', job: '33333333-3333-4333-8333-333333333333', browser: '44444444-4444-4444-8444-444444444444', attempt: '55555555-5555-4555-8555-555555555555', other: '66666666-6666-4666-8666-666666666666' };
const owner = { managerId: ids.manager, browserId: ids.browser, authVersion: 3 };
const input = (raw: Record<string, unknown>): AnswerEdit => { const parsed = parseAnswerEdit({ action: 'save', kind: 'text', question: 'Additional details', answer: 'Available for discussion', ...raw }); if (typeof parsed === 'string') assert.fail(parsed); return parsed; };

test('explicit saves share eligible answers but preserve personal/context boundaries and validate variants', () => {
  assert.equal((input({}) as Extract<AnswerEdit, { action: 'save' }>).scope, 'manager');
  for (const question of ['Phone', 'Email', 'First name']) assert.equal((input({ question, answer: question === 'Email' ? 'one@example.test' : 'Value' }) as Extract<AnswerEdit, { action: 'save' }>).scope, 'candidate');
  assert.equal((input({ question: 'Why this company?' }) as Extract<AnswerEdit, { action: 'save' }>).scope, 'application');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Password', answer: 'secret' }), 'string');
  assert.equal(typeof parseAnswerEdit({ action: 'delete', id: ids.job }), 'string');
  assert.equal(typeof parseAnswerEdit({ action: 'save', id: ids.job, version: 'bad', question: 'Source', answer: 'X' }), 'string');
  assert.equal(typeof parseAnswerEdit({ action: 'save', question: 'Source', answer: 'Other', kind: 'select', options: ['LinkedIn'] }), 'string');
  assert.equal((input({ question: 'Privacy policy', kind: 'checkbox', answer: false }) as Extract<AnswerEdit, { action: 'save' }>).answer, 'false');
});

const engine = resolve(process.env.QTS_TEST_PGLITE_PATH || '.pdf-verification/task3-test-tools/node_modules/@electric-sql/pglite/dist/index.cjs');
test('actual PostgreSQL answer CRUD enforces ownership, live attempts, atomic profile changes and conflicts', { skip: !existsSync(engine) && 'Isolated PGlite engine is unavailable' }, async (t) => {
  type Engine = { exec: (sql: string) => Promise<unknown>; query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; close: () => Promise<void> };
  const { PGlite } = createRequire(__filename)(engine) as { PGlite: new () => Engine };
  const pg = new PGlite(), dialect = new PgDialect();
  const run = async (query: ReturnType<typeof editAnswerQuery>) => { const q = dialect.sqlToQuery(query); return (await pg.query(q.sql, q.params)).rows; };
  try {
    await pg.exec(`create table users(id uuid primary key, parent_user_id uuid, role text, blocked_at timestamptz, can_use_apply boolean, auth_version int, email text);
      create table profiles(user_id uuid primary key, first_name text, last_name text, candidate_email text, phone text, city text, linkedin_url text, updated_at timestamptz);
      create table jobs(id uuid primary key, manager_id uuid, candidate_id uuid);
      create table extension_browsers(id uuid primary key, manager_id uuid);
      create table apply_attempts(id uuid primary key, candidate_id uuid, job_id uuid, manager_id uuid, browser_id uuid, status text, lease_expires_at timestamptz);
      create table manager_apply_answers(id uuid primary key default gen_random_uuid(), manager_id uuid, candidate_id uuid, job_id uuid, scope text, context_key text, question_key text, question_text text, answer text, variants jsonb, updated_at timestamptz default clock_timestamp(), unique(manager_id,context_key,question_key));
      insert into users(id,parent_user_id,role,blocked_at,can_use_apply,auth_version) values ('${ids.manager}',null,'manager',null,true,3), ('${ids.candidate}','${ids.manager}','account',null,false,0);
      insert into profiles(user_id,phone) values ('${ids.candidate}','old phone');
      insert into jobs values ('${ids.job}','${ids.manager}','${ids.candidate}');
      insert into extension_browsers values ('${ids.browser}','${ids.manager}');
      insert into apply_attempts values ('${ids.attempt}','${ids.candidate}','${ids.job}','${ids.manager}','${ids.browser}','waiting_review',now()+interval '1 hour');`);
    const scenario = async (name: string, fn: () => Promise<void>) => t.test(name, async () => { await pg.exec('begin'); try { await fn(); } finally { await pg.exec('rollback'); } });
    const row = async () => (await pg.query('select *, extract(epoch from updated_at)::text as version from manager_apply_answers')).rows[0];
    await scenario('create, edit and delete use exact version preconditions; duplicate creates cannot overwrite', async () => {
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, input({})))).length, 1);
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, input({ answer: 'Overwrite' })))).length, 0);
      const before = await row(); assert.equal(before.scope, 'manager'); assert.equal(before.candidate_id, null);
      const edited = input({ id: before.id, version: before.version, answer: 'Updated' });
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, edited))).length, 1);
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, edited))).length, 0);
      assert.equal((await row()).answer, 'Updated');
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, { action: 'delete', id: String(before.id), version: String(before.version) }))).length, 0);
      const latest = await row();
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, { action: 'delete', id: String(latest.id), version: String(latest.version) }))).length, 1);
    });
    await scenario('candidate profile and saved correction change together; stale edit changes neither', async () => {
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, input({ question: 'Phone', answer: '+40 4686441' })))).length, 1);
      const before = await row(); assert.equal(before.scope, 'candidate');
      assert.equal((await pg.query('select phone from profiles')).rows[0].phone, '+40 4686441');
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, input({ id: before.id, version: '1.000000', question: 'Phone', answer: 'wrong' })))).length, 0);
      assert.equal((await pg.query('select phone from profiles')).rows[0].phone, '+40 4686441');
    });
    await scenario('explicit edits preserve equivalent approved variants and discard a different meaning', async () => {
      await run(editAnswerQuery(owner, ids.attempt, input({ question: 'How did you hear about us?', answer: 'LinkedIn' })));
      const before = await row();
      await run(editAnswerQuery(owner, ids.attempt, input({ id: before.id, version: before.version, question: 'How did you hear about us?', answer: 'LinkedIn Job Post', kind: 'select', options: ['LinkedIn Job Post', 'Indeed'] })));
      const next = await row(); assert.equal((next.variants as unknown[]).length, 2);
      await run(editAnswerQuery(owner, ids.attempt, input({ id: next.id, version: next.version, question: 'How did you hear about us?', answer: 'Indeed', kind: 'select', options: ['LinkedIn Job Post', 'Indeed'] })));
      assert.equal(((await row()).variants as unknown[]).length, 1);
    });
    await scenario('other Managers and foreign candidate/application rows are inaccessible', async () => {
      assert.deepEqual(await run(answerAttemptQuery({ ...owner, managerId: ids.other }, ids.attempt)), []);
      await pg.exec(`insert into manager_apply_answers(manager_id,candidate_id,job_id,scope,context_key,question_key,question_text,answer,variants) values ('${ids.manager}','${ids.other}',null,'candidate','candidate:other','additional details','Additional details','private','[]')`);
      const before = await row();
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, input({ id: before.id, version: before.version })))).length, 0);
      assert.equal((await run(editAnswerQuery(owner, ids.attempt, { action: 'delete', id: String(before.id), version: String(before.version) }))).length, 0);
    });
    for (const [name, mutation] of [
      ['expired lease', "update apply_attempts set lease_expires_at=now()-interval '1 second'"],
      ['ended attempt', "update apply_attempts set status='confirmed'"],
      ['Apply revoked', `update users set can_use_apply=false where id='${ids.manager}'`],
      ['session changed', `update users set auth_version=4 where id='${ids.manager}'`],
      ['foreign browser', `update extension_browsers set manager_id='${ids.other}'`],
      ['ownership changed', `update users set parent_user_id='${ids.other}' where id='${ids.candidate}'`],
      ['blocked candidate', `update users set blocked_at=now() where id='${ids.candidate}'`],
    ]) await scenario(name, async () => { await pg.exec(mutation); assert.deepEqual(await run(editAnswerQuery(owner, ids.attempt, input({}))), []); });
  } finally { await pg.close(); }
});
