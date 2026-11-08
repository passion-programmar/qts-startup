import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const manager = '11111111-1111-4111-8111-111111111111', browser = '22222222-2222-4222-8222-222222222222', attempt = '33333333-3333-4333-8333-333333333333';
const f = { extensionVersion: '1.46.0', authenticated: true, held: true, changed: true, error: '', calls: [] as { sql: string; params: unknown[] }[],
  answers: [{ scope: 'candidate', questionText: 'Phone', answer: '+40 1234' }, { scope: 'manager', questionText: 'Additional details', answer: 'Shared' }] };
(globalThis as Record<string, unknown>).__answerEditorRoute = f;
let POST: (request: Request) => Promise<Response>;
test.before(async () => {
  const mocks: Record<string, string> = {
    'server-only': '',
    '@/lib/db': `const f=globalThis.__answerEditorRoute;export const neonSql={transaction:async(queries,options)=>{if(options.isolationLevel!=='Serializable')throw Error('missing serializable');return Promise.all(queries)},query:async(sql,params)=>{f.calls.push({sql,params});if(f.error)throw Object.assign(Error('fixture'),{code:f.error});return sql.includes('changed as')?(f.changed?[{id:'saved',scope:'candidate'}]:[]):(f.held?[{candidateId:'candidate',jobId:'job'}]:[])}};`,
    '@/server/apply/apply-route-auth': `import {NextResponse} from 'next/server';export const isUuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);export const authorizeApplyRequest=async()=>globalThis.__answerEditorRoute.authenticated?{manager:{id:'${manager}',authVersion:3},browser:{id:'${browser}',extensionVersion:globalThis.__answerEditorRoute.extensionVersion}}:NextResponse.json({success:false},{status:401});`,
    '@/server/apply/manager-answers': `export const loadApplicationAnswers=async()=>globalThis.__answerEditorRoute.answers;`,
  };
  const built = await build({ entryPoints: [resolve('src/app/api/extension/apply/answer-library/route.ts')], tsconfig: resolve('tsconfig.json'), bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'answer-route-fixture', setup(b) { b.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: 'fixture' } : undefined); b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() })); } }],
  });
  const loaded = { exports: {} }; new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(resolve('package.json')), loaded, loaded.exports);
  POST = (loaded.exports as { POST: typeof POST }).POST;
});
test.beforeEach(() => { f.extensionVersion = '1.46.0'; f.authenticated = true; f.held = true; f.changed = true; f.error = ''; f.calls = []; });
const request = (body: Record<string, unknown>) => new Request('http://localhost/api/extension/apply/answer-library', { method: 'POST', body: JSON.stringify({ attemptId: attempt, ...body }) });

test('load returns editable profile corrections separately from autofill answers without writing', async () => {
  const response = await POST(request({ action: 'load' })), body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.editableAnswers.length, 2); assert.equal(body.savedAnswers.length, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].sql.includes('changed as'), false);
});
test('save uses authorized Manager/browser/attempt; a profile fact is refused and never changes the profile', async () => {
  const refused = await POST(request({ action: 'save', answer: { question: 'Phone', answer: '+40 1234', kind: 'text' } }));
  assert.equal(refused.status, 400); assert.match((await refused.json()).message, /profile fact/i);
  f.calls = [];
  const response = await POST(request({ action: 'save', managerId: 'forged', candidateId: 'forged', answer: { question: 'Are you open to relocation?', answer: 'No', kind: 'text' } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).profileUpdate, null);
  assert.ok(f.calls[1].params.includes(manager)); assert.ok(f.calls[1].params.includes(browser)); assert.ok(f.calls[1].params.includes(attempt));
  assert.equal(f.calls[1].params.includes('forged'), false);
});
test('invalid, unauthorized and lost-attempt requests cannot mutate answers', async () => {
  f.authenticated = false; assert.equal((await POST(request({ action: 'load' }))).status, 401); assert.equal(f.calls.length, 0);
  f.extensionVersion = '1.46.0'; f.authenticated = true; f.held = false; assert.equal((await POST(request({ action: 'save', answer: { question: 'Source', answer: 'LinkedIn' } }))).status, 409);
  f.held = true;
  assert.equal((await POST(request({ action: 'save', answer: { question: 'Password', answer: 'secret' } }))).status, 400);
  assert.equal((await POST(request({ action: 'delete', answer: { id: attempt } }))).status, 400);
  assert.equal(f.calls.some((call) => call.sql.includes('changed as')), false);
});
test('conflicts and lock contention are explicit, never automatically retried', async () => {
  f.changed = false;
  const response = await POST(request({ action: 'delete', answer: { id: attempt, version: '123.000001' } }));
  assert.equal(response.status, 409); assert.match((await response.json()).message, /nothing was overwritten/);
  assert.equal(f.calls.filter((call) => call.sql.includes('changed as')).length, 1);
  f.error = '55P03'; assert.equal((await POST(request({ action: 'load' }))).status, 409);
});

test('older clients may read the library but cannot mutate the new representation contract', async () => {
  f.extensionVersion = '1.45.0';
  assert.equal((await POST(request({ action: 'load' }))).status, 200);
  const before = f.calls.length;
  const response = await POST(request({ action: 'save', answer: { question: 'Phone', answer: '+40 1234' } }));
  assert.equal(response.status, 426); assert.match((await response.json()).message, /1\.46\.0/);
  assert.equal(f.calls.length, before);
});
