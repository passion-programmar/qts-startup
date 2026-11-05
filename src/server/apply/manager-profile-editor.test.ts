import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';

const id = '11111111-1111-4111-8111-111111111111', managerId = '22222222-2222-4222-8222-222222222222';
const f = { role: 'manager', changed: true, current: { scope: 'candidate', candidateId: id, variants: [] } as object | null,
  queries: [] as { sql: string; params: unknown[] }[], revalidated: 0,
  record(query: Parameters<PgDialect['sqlToQuery']>[0]) { this.queries.push(new PgDialect().sqlToQuery(query)); } };
(globalThis as Record<string, unknown>).__profileEditor = f;
let manage: (state: { message: string }, form: FormData) => Promise<{ message: string }>;
test.before(async () => {
  const mocks: Record<string, string> = {
    'server-only': '', 'next/cache': `export const revalidatePath=()=>globalThis.__profileEditor.revalidated++;`,
    '@/lib/session': `export const requireUser=async()=>({id:'${managerId}',role:globalThis.__profileEditor.role});`,
    '@/server/apply/apply-route-auth': `export const isUuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);`,
    '@/server/apply/manager-answers': `export const makeManagerReusable=async()=>({ok:true});`,
    '@/lib/db': `const f=globalThis.__profileEditor;export const neonSql={query:async(sql,params)=>{f.queries.push({sql,params});return f.changed?[{id:'saved'}]:[]},transaction:async(queries,options)=>{if(options.isolationLevel!=='Serializable')throw Error('missing serializable');return Promise.all(queries)}};export const db={
      select:()=>({from:()=>({where:q=>{f.record(q);return {limit:async()=>f.current?[f.current]:[],then:fn=>Promise.resolve([]).then(fn)}}})}),
      execute:async q=>{f.record(q);return {rows:f.changed?[{id:'saved'}]:[]}},
      delete:()=>({where:q=>{f.record(q);return {returning:async()=>f.changed?[{id:'saved'}]:[]}}}),
      insert:()=>({values:()=>({onConflictDoNothing:()=>({returning:async()=>f.changed?[{id:'saved'}]:[]})})})};`,
  };
  const built = await build({ entryPoints: [resolve('src/app/profile/manager-answer-actions.ts')], tsconfig: resolve('tsconfig.json'), bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'profile-editor-fixture', setup(b) { b.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: 'fixture' } : undefined); b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() })); } }],
  });
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(resolve('package.json')), loaded, loaded.exports);
  manage = (loaded.exports as { manageAnswer: typeof manage }).manageAnswer;
});
test.beforeEach(() => { f.role = 'manager'; f.changed = true; f.current = { scope: 'candidate', candidateId: id, variants: [] }; f.queries = []; f.revalidated = 0; });
const form = (extra: Record<string, string> = {}) => { const value = new FormData(); for (const [key, text] of Object.entries({ action: 'save', id, version: '123.000001', question: 'Phone', answer: '+40 1234', ...extra })) value.set(key, text); return value; };

test('Profile changes require Manager identity and exact version preconditions', async () => {
  f.role = 'account'; assert.match((await manage({ message: '' }, form())).message, /Only Managers/); assert.equal(f.queries.length, 0);
  f.role = 'manager'; assert.match((await manage({ message: '' }, form({ version: '' }))).message, /Reload Profile/);
  f.current = null; assert.match((await manage({ message: '' }, form())).message, /changed or was deleted/);
  assert.ok(f.queries[0].params.includes(managerId)); assert.ok(f.queries[0].params.includes('123.000001'));
});
test('Profile personal edit uses a conditional atomic profile update and detects a raced edit', async () => {
  assert.match((await manage({ message: '' }, form())).message, /Saved/);
  assert.match(f.queries[1].sql, /with changed as/); assert.match(f.queries[1].sql, /exists\(select 1 from changed/);
  f.changed = false; assert.match((await manage({ message: '' }, form())).message, /nothing was overwritten/);
});
test('stale deletes and duplicate additions report conflicts rather than success', async () => {
  f.changed = false;
  assert.match((await manage({ message: '' }, form({ action: 'delete' }))).message, /nothing was overwritten/);
  assert.match((await manage({ message: '' }, form({ id: '', version: '', question: 'Additional details' }))).message, /already has a saved answer/);
  assert.equal(f.revalidated, 0);
});

test('explicit variation removal uses owner/version/index and never changes canonical value or profile', async () => {
  assert.match((await manage({ message: '' }, form({ action: 'variation-delete:0' }))).message, /Saved/);
  assert.equal(f.queries.length, 1);
  assert.match(f.queries[0].sql, /jsonb_array_length/);
  assert.ok(f.queries[0].params.includes(managerId)); assert.ok(f.queries[0].params.includes('123.000001'));
  assert.doesNotMatch(f.queries[0].sql, /update "profiles"|set answer/);
  f.changed = false;
  assert.match((await manage({ message: '' }, form({ action: 'variation-delete:0' }))).message, /nothing was overwritten/);
});
