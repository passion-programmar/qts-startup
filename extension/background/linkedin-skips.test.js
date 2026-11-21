// The worker's LinkedIn skip-list: cache, pulls, marks, un-skips and the offline outbox, with a fake
// QTS server and a fake IndexedDB store. Nothing leaves this machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'linkedin-skips.js'), 'utf8');
const LINKEDIN = { url: 'https://www.linkedin.com/jobs/search-results/', tab: { id: 7 } };

function worker({ manager = 'manager-1', server }) {
  const settings = new Map();
  const alarms = new Set();
  const requests = [];
  const sentToTabs = [];
  let listener = null;
  const context = vm.createContext({
    console, URL, setTimeout,
    workerApiRequest: async (method, url, body) => { requests.push({ method, url, body }); return server(method, url, body); },
    chrome: {
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
      alarms: { create: async (name) => alarms.add(name), clear: async (name) => alarms.delete(name), onAlarm: { addListener: () => {} } },
      tabs: { sendMessage: async (tabId, message) => sentToTabs.push([tabId, message.type]) },
    },
  });
  context.self = context;
  context.__qtsScannerDocumentStore = {
    getSetting: async (key) => (settings.has(key) ? { key, value: structuredClone(settings.get(key)) } : undefined),
    putSetting: async (key, value) => { settings.set(key, structuredClone(value)); },
  };
  context.__qtsAccountAuth = { readWorkerSessionUser: async () => (context.manager ? { id: context.manager, role: 'manager' } : null) };
  context.manager = manager;
  vm.runInContext(source, context);
  const ask = (message, sender = LINKEDIN) => new Promise((resolve) => listener(message, sender, resolve));
  return { ask, requests, alarms, settings, sentToTabs, setManager: (id) => { context.manager = id; } };
}

const k = (n) => `job ${n}|company ${n}`;
const item = (n, source) => ({ key: k(n), title: `Job ${n}`, company: `Company ${n}`, source });

test('the first look waits for the full list; bids and saved jobs count, an un-skip beats them', async () => {
  const chrome = worker({ server: (method, url) => (method === 'GET'
    ? { success: true, full: !url.includes('since='), cursor: '2026-11-21T10:00:00.000Z', skips: [{ key: k(1), removed: false }, { key: k(3), removed: true }], seen: [k(2), k(3)] }
    : { success: true }) });
  const reply = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: true, marks: [], keys: [k(1), k(2), k(3), k(4)] });
  // 1 marked, 2 a bid or saved job, 3 a bid the Manager un-skipped, 4 new.
  assert.deepEqual(JSON.parse(JSON.stringify(reply)), { ok: true, skipped: [k(1), k(2)] });
  assert.equal(chrome.requests[0].url, '/api/extension/linkedin-skips', 'first look: the full list');
});

test('later looks ask only for changes, at most once a minute, and tell the page when something changed', async () => {
  let round = 0;
  const chrome = worker({ server: (method, url) => {
    if (method !== 'GET') return { success: true };
    round += 1;
    return round === 1
      ? { success: true, full: true, cursor: 'c1', skips: [], seen: [] }
      : { success: true, full: false, cursor: 'c2', skips: [{ key: k(5), removed: false }], seen: [], url };
  } });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: true, marks: [], keys: [] });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: true, marks: [], keys: [] });
  assert.equal(chrome.requests.filter((r) => r.method === 'GET').length, 1, 'within a minute: no second pull');
});

test('LinkedIn labels never bring back an un-skipped pair; a click does; marks reach QTS in one batch', async () => {
  const posts = [];
  const chrome = worker({ server: (method, url, body) => {
    if (method === 'GET') return { success: true, full: true, cursor: 'c', skips: [{ key: k(1), removed: true }], seen: [] };
    posts.push(body); return { success: true };
  } });
  const auto = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: true, marks: [item(1, 'viewed'), item(2, 'saved')], keys: [k(1), k(2)] });
  assert.deepEqual(auto.skipped, [k(2)], 'the un-skipped pair stays un-skipped despite LinkedIn\'s "Viewed"');
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(1, 'clicked')] });
  const after = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: false, marks: [], keys: [k(1), k(2)] });
  assert.deepEqual(after.skipped, [k(1), k(2)], 'the click marks it again');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const sent = posts.flatMap((body) => body.add || []);
  assert.deepEqual(sent.map((pair) => [pair.title, pair.source]), [['Job 2', 'saved'], ['Job 1', 'clicked']]);
  assert.ok(sent.every((pair) => !('key' in pair)), 'only title, company and source are sent');
});

test('offline: marks wait in the outbox and a retry is planned; once QTS answers they are sent and cleared', async () => {
  let online = false;
  const posts = [];
  const chrome = worker({ server: (method, url, body) => {
    if (method === 'GET') return { success: true, full: true, cursor: 'c', skips: [], seen: [] };
    if (!online) return { success: false, message: 'Cannot connect to the server.' };
    posts.push(body); return { success: true };
  } });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(9, 'clicked')] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(chrome.alarms.has('qts-linkedin-skips-retry'));
  assert.equal(chrome.settings.get('linkedinSkipsOutboxV1').add.length, 1, 'kept for later');
  const stillSkipped = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: false, marks: [], keys: [k(9)] });
  assert.deepEqual(stillSkipped.skipped, [k(9)], 'highlighted while offline');
  online = true;
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: true, marks: [], keys: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(posts.flatMap((body) => body.add).map((pair) => pair.title), ['Job 9']);
  assert.equal(chrome.settings.get('linkedinSkipsOutboxV1').add.length, 0);
  assert.equal(chrome.alarms.has('qts-linkedin-skips-retry'), false);
});

test('un-skip is sent as a removal; another Manager starts from an empty list; only LinkedIn pages may ask', async () => {
  const posts = [];
  const chrome = worker({ server: (method, url, body) => {
    if (method === 'GET') return { success: true, full: true, cursor: 'c', skips: [{ key: k(1), removed: false }], seen: [] };
    posts.push(body); return { success: true };
  } });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: true, marks: [], keys: [] });
  await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_UNSKIP', items: [item(1, 'manual')] });
  assert.deepEqual((await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: false, marks: [], keys: [k(1)] })).skipped, []);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(posts.flatMap((body) => body.remove || []).map((pair) => pair.title), ['Job 1']);

  chrome.setManager('manager-2');
  const other = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: false, marks: [], keys: [k(1)] });
  assert.deepEqual(other.skipped, []);
  chrome.setManager(null);
  assert.equal((await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MATCH', refresh: true, marks: [], keys: [] })).signedOut, true);

  const outside = await chrome.ask({ type: 'QTS_LINKEDIN_SKIPS_MARK', items: [item(2, 'clicked')] }, { url: 'https://example.com/', tab: { id: 1 } });
  assert.equal(outside.ok, false);
});
