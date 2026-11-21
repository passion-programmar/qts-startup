// The worker's LinkedIn skip-list with a fake clock, a fake QTS server and a fake IndexedDB store:
// server required, fetch rules, batched saves, immediate panel actions, the Super Admin's switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'linkedin-skips.js'), 'utf8');
const LINKEDIN = { url: 'https://www.linkedin.com/jobs/search-results/', tab: { id: 7 } };
const k = (n) => `job ${n}|company ${n}`;
const item = (n, source, location = 'Poland (Remote)') => ({ key: k(n), title: `Job ${n}`, company: `Company ${n}`, location, source });
const plain = (value) => JSON.parse(JSON.stringify(value));

function worker({ server, settings = new Map(), start = Date.parse('2026-11-21T12:00:00Z') }) {
  const requests = [];
  const timers = [];
  let listener = null;
  let clock = start;
  const context = vm.createContext({
    console, URL,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
      tabs: { query: async () => [], sendMessage: async () => {} },
    },
  });
  context.self = context;
  // Like shared/api-worker.js: every answer (or failure) is noted.
  context.workerApiRequest = async (method, url, body) => {
    requests.push({ method, url, body });
    const reply = await server(method, url, body);
    if (reply.success || reply.disabled) context.__qtsServerAnsweredAt = clock; else context.__qtsServerFailedAt = clock;
    return reply;
  };
  context.__qtsScannerDocumentStore = {
    getSetting: async (key) => (settings.has(key) ? { key, value: structuredClone(settings.get(key)) } : undefined),
    putSetting: async (key, value) => { settings.set(key, structuredClone(value)); },
  };
  context.__qtsAccountAuth = { readWorkerSessionUser: async () => ({ id: 'manager-1', role: 'manager' }) };
  vm.runInContext(source, context);
  const ask = (message, sender = LINKEDIN) => new Promise((resolve) => listener(message, sender, resolve)).then(plain);
  const advance = async (ms) => {
    clock += ms;
    for (const timer of timers) if (timer.fn && timer.at <= clock) { const fn = timer.fn; timer.fn = null; fn(); }
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { ask, requests, advance, settings, now: () => clock, gets: () => requests.filter((r) => r.method === 'GET'), posts: () => requests.filter((r) => r.method === 'POST') };
}

const fullList = { success: true, full: true, cursor: 'c1', skips: [{ key: k(1), removed: false, source: 'saved', location: 'Slovakia (Remote)', at: '2026-11-20T10:00:00.000Z' }, { key: k(3), removed: true, source: 'manual', location: null, at: '2026-11-20T10:00:00.000Z' }],
  seen: [{ key: k(2), source: 'qts_applied', location: 'Cracow (Remote)', at: '2026-11-19T10:00:00.000Z' }, { key: k(3), source: 'qts_saved', location: null, at: '2026-11-19T10:00:00.000Z' }] };
const noChanges = { success: true, full: false, cursor: 'c2', skips: [], seen: [] };
const okServer = () => (method) => (method === 'GET' ? (okServer.first ? (okServer.first = false, fullList) : noChanges) : { success: true });

test('first look fetches the full list; bids count, an un-skip beats them; "seen before" comes from the mirror', async () => {
  const chrome = worker({ server: (method, url) => (method === 'GET' ? (url.includes('since=') ? noChanges : fullList) : { success: true }) });
  const reply = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [k(1), k(2), k(3), k(4)] });
  assert.deepEqual(reply, { ok: true, state: 'ok', changed: true, skipped: [k(1), k(2)] });
  assert.equal(chrome.gets()[0].url, '/api/extension/linkedin-skips');
  assert.deepEqual(await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_INFO', key: k(2) }), { ok: true, skipped: true, info: { source: 'qts_applied', location: 'Cracow (Remote)', at: '2026-11-19T10:00:00.000Z' } });
});

test('paging never fetches; 10 minutes later it does; the panel or a return fetch if over 30 s old', async () => {
  const chrome = worker({ server: (method, url) => (method === 'GET' ? (url.includes('since=') ? noChanges : fullList) : { success: true }) });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] });
  for (let page = 0; page < 5; page += 1) { await chrome.advance(20_000); await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [] }); }
  assert.equal(chrome.gets().length, 1, 'five pages within 2 minutes: no fetch');
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'panel', marks: [], keys: [] });
  assert.equal(chrome.gets().length, 2, 'the panel opened, last fetch over 30 s old');
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'panel', marks: [], keys: [] });
  assert.equal(chrome.gets().length, 2, 'again within 30 s: no fetch');
  await chrome.advance(10 * 60_000 + 1);
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [] });
  assert.equal(chrome.gets().length, 3, '10 minutes: a fetch of changes');
  assert.match(chrome.gets()[2].url, /since=c2/);
});

test('server required: QTS unreachable pauses everything; nothing is matched or kept', async () => {
  let up = true;
  const chrome = worker({ server: (method, url) => (!up ? { success: false, message: 'Cannot connect to the server.' } : method === 'GET' ? (url.includes('since=') ? noChanges : fullList) : { success: true }) });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] });
  up = false;
  await chrome.advance(3 * 60_000); // QTS last answered over 2 minutes ago
  assert.deepEqual(await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [item(9, 'viewed')], keys: [k(1)] }), { ok: false, state: 'server-down' });
  assert.deepEqual(await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(9, 'clicked')] }), { ok: false, state: 'server-down' });
  up = true;
  await chrome.advance(61_000); // the next check comes a minute after the failed one
  const back = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [k(1), k(9)] });
  assert.deepEqual(back.skipped, [k(1)], 'resumes; the mark made while down was never kept');
});

test('clicks and labels are saved in one batch (10 s, 25 marks, or on leaving); known jobs are not sent again', async () => {
  const chrome = worker({ server: (method, url) => (method === 'GET' ? (url.includes('since=') ? noChanges : fullList) : { success: true }) });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [item(1, 'saved'), item(5, 'viewed')], keys: [k(5)] });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(6, 'clicked')] });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(7, 'clicked')] });
  assert.equal(chrome.posts().length, 0, 'nothing sent yet');
  const shown = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [k(5), k(6), k(7)] });
  assert.deepEqual(shown.skipped, [k(5), k(6), k(7)], 'shown at once');
  await chrome.advance(10_000);
  assert.equal(chrome.posts().length, 1, 'one batch after 10 s');
  assert.deepEqual(plain(chrome.posts()[0].body.add.map((pair) => [pair.title, pair.source, pair.location])), [['Job 5', 'viewed', 'Poland (Remote)'], ['Job 6', 'clicked', 'Poland (Remote)'], ['Job 7', 'clicked', 'Poland (Remote)']]);
  // Leaving the tab sends what waits at once; 25 marks do too.
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(8, 'clicked')] });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_FLUSH' });
  assert.equal(chrome.posts().length, 2);
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: Array.from({ length: 25 }, (_, n) => item(100 + n, 'viewed')), keys: [] });
  await chrome.advance(1);
  assert.equal(chrome.posts().length, 3, '25 marks: sent without waiting');
});

test('a batch QTS does not take is dropped: its cards go back to normal and the skip-list pauses', async () => {
  let accept = true;
  const chrome = worker({ server: (method, url) => (method === 'GET' ? (url.includes('since=') ? noChanges : fullList) : accept ? { success: true } : { success: false, message: 'Server error', _httpStatus: 500 }) });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] });
  accept = false;
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(6, 'clicked')] });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_FLUSH' });
  const after = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [k(6)] });
  // The failed save also counts as QTS not answering: paused until it answers again (a fetch succeeds).
  assert.ok(after.state === 'server-down' || (after.ok && after.skipped.length === 0), JSON.stringify(after));
  accept = true;
  const resumed = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'panel', marks: [], keys: [k(6)] });
  assert.deepEqual(resumed.skipped, [], 'the dropped mark is not kept');
});

test('the panel\'s Skip and Un-skip are saved at once; a refusal changes nothing', async () => {
  let accept = true;
  const chrome = worker({ server: (method, url) => (method === 'GET' ? (url.includes('since=') ? noChanges : fullList) : accept ? { success: true } : { success: false, message: 'Server error', _httpStatus: 500 }) });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] });
  assert.deepEqual(await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', immediate: true, items: [item(4, 'manual')] }), { ok: true, added: 1 });
  assert.equal(chrome.posts().length, 1, 'sent at once');
  assert.deepEqual(await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_UNSKIP', items: [item(2, 'manual')] }), { ok: true, removed: 1 });
  assert.deepEqual(plain(chrome.posts()[1].body.remove.map((pair) => pair.title)), ['Job 2']);
  assert.deepEqual((await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [k(2), k(4)] })).skipped, [k(4)], 'a bid can be un-skipped');
  accept = false;
  const refused = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_UNSKIP', items: [item(4, 'manual')] });
  assert.equal(refused.ok, false);
});

test('the Super Admin\'s switch turns it off; only LinkedIn pages may ask', async () => {
  const chrome = worker({ server: (method) => (method === 'GET' ? { success: false, disabled: true, message: 'Turned off' } : { success: true }) });
  assert.deepEqual(await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [item(1, 'viewed')], keys: [k(1)] }), { ok: false, state: 'admin-off' });
  assert.equal(chrome.posts().length, 0);
  const outside = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(2, 'clicked')] }, { url: 'https://example.com/', tab: { id: 1 } });
  assert.equal(outside.ok, false);
});

const server = (state) => (method, url) => {
  if (state.down) return { success: false, message: 'Cannot connect to the server.' };
  if (state.disabled && method === 'GET') return { success: false, disabled: true, message: 'Turned off' };
  if (method === 'GET') return url.includes('since=') ? noChanges : fullList;
  return state.refusePosts ? { success: false, message: 'Server error', _httpStatus: 500 } : { success: true };
};

test('QTS down: at most one check a minute, however often LinkedIn changes its page', async () => {
  const state = { down: false };
  const chrome = worker({ server: server(state) });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] });
  state.down = true;
  await chrome.advance(3 * 60_000);
  for (let look = 0; look < 100; look += 1) { await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [] }); await chrome.advance(500); }
  // 100 looks over 50 seconds: one failed check, then quiet.
  assert.equal(chrome.gets().length, 2);
  await chrome.advance(11_000);
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [] });
  assert.equal(chrome.gets().length, 3, 'after a minute: one more check');
});

test('a restarted worker remembers that QTS answered: no extra fetch while reading a job', async () => {
  const state = {};
  const first = worker({ server: server(state) });
  await first.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] });
  // Chrome stops the idle worker; a new one starts 40 s later with the same IndexedDB.
  const second = worker({ server: server(state), settings: first.settings, start: first.now() + 40_000 });
  const reply = await second.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [k(1)] });
  assert.deepEqual(reply.skipped, [k(1)]);
  assert.equal(second.gets().length, 0, 'no fetch after the restart');
});

test('a batch cut off by closing Chrome is finished on the next start, or dropped when QTS refuses it', async () => {
  for (const refuse of [false, true]) {
    const state = {};
    const before = worker({ server: server(state) });
    await before.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] });
    await before.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(6, 'clicked')] });
    assert.equal(before.posts().length, 0, 'Chrome closes before the 10 s batch');
    state.refusePosts = refuse;
    const after = worker({ server: server(state), settings: before.settings, start: before.now() + 3_600_000 });
    await after.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [k(6)] });
    await after.advance(10_000);
    assert.deepEqual(plain(after.posts().map((post) => post.body.add.map((pair) => pair.title))), [['Job 6']], 'sent once on the next start');
    state.refusePosts = false;
    await after.advance(61_000);
    const shown = await after.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'panel', marks: [], keys: [k(6)] });
    assert.deepEqual(shown.skipped, refuse ? [] : [k(6)], refuse ? 'refused: dropped from this Chrome too' : 'confirmed');
    assert.equal(after.settings.get('linkedinSkipsMirrorV2').unconfirmed.length, 0, 'nothing left unconfirmed');
  }
});

test('turned off by the Super Admin: re-checked every 10 minutes, or from the panel after 30 s', async () => {
  const state = { disabled: true };
  const chrome = worker({ server: server(state) });
  assert.equal((await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'load', marks: [], keys: [] })).state, 'admin-off');
  for (let minute = 0; minute < 5; minute += 1) { await chrome.advance(60_000); await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [] }); }
  assert.equal(chrome.gets().length, 1, 'five minutes on LinkedIn: no re-check');
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', reason: 'panel', marks: [], keys: [] });
  assert.equal(chrome.gets().length, 2, 'the panel re-checks');
  state.disabled = false;
  await chrome.advance(10 * 60_000 + 1);
  const on = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', marks: [], keys: [k(1)] });
  assert.deepEqual(on.skipped, [k(1)], 'turned back on: within 10 minutes');
});
