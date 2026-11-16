const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The retry helpers from the service worker, run against an in-memory chrome.storage.local.
function loadRetryHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
  const start = source.indexOf("const GENERATION_RETRIES_KEY = 'qtsGenerationRetries';");
  const end = source.indexOf('function generationRetryTime(at)', start);
  assert.ok(start >= 0 && end > start, 'retry helpers found');
  const store = {};
  const writes = [];
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: store[key] === undefined ? undefined : structuredClone(store[key]) }),
          set: async (values) => { writes.push(Object.keys(values)); Object.assign(store, structuredClone(values)); },
        },
      },
    },
    Date,
  });
  vm.runInContext(`${source.slice(start, end)}
    globalThis.helpers = { readGenerationRetries, waitingGenerationJobIds, scheduleGenerationRetry, clearGenerationRetry };`, context);
  return { ...context.helpers, store, writes };
}

const JOB = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MIN = 60_000;

test('a failed job waits 10 min, 30 min, 1 h, then every 2 h before it is tried again', async () => {
  const { scheduleGenerationRetry } = loadRetryHelpers();
  const now = 1_000_000_000_000;
  const waits = [];
  for (let i = 0; i < 5; i += 1) waits.push((await scheduleGenerationRetry(JOB, 'ChatGPT error', now)) - now);
  assert.deepEqual(waits, [10 * MIN, 30 * MIN, 60 * MIN, 120 * MIN, 120 * MIN]);
});

test('only jobs still waiting are skipped by the claim; a due job is taken again', async () => {
  const { scheduleGenerationRetry, waitingGenerationJobIds } = loadRetryHelpers();
  const now = 1_000_000_000_000;
  await scheduleGenerationRetry(JOB, 'Missing company', now);
  await scheduleGenerationRetry(OTHER, 'Busy', now - 20 * MIN); // its 10 minutes are over
  assert.deepEqual([...await waitingGenerationJobIds(now)], [JOB]);
  assert.deepEqual([...await waitingGenerationJobIds(now + 11 * MIN)], [], 'after its wait, the job is claimed again');
});

test('a delivered job is forgotten, and a delivery with no failure writes nothing', async () => {
  const { scheduleGenerationRetry, clearGenerationRetry, readGenerationRetries, writes } = loadRetryHelpers();
  await clearGenerationRetry(JOB);
  assert.equal(writes.length, 0, 'no storage write when the job never failed');
  await scheduleGenerationRetry(JOB, 'Busy');
  await clearGenerationRetry(JOB);
  assert.deepEqual(Object.keys(await readGenerationRetries()), []);
});

test('entries not seen for 7 days are dropped, and reasons are kept short', async () => {
  const { scheduleGenerationRetry, readGenerationRetries } = loadRetryHelpers();
  const now = 1_000_000_000_000;
  await scheduleGenerationRetry(OTHER, 'Old', now - 8 * 24 * 60 * MIN);
  await scheduleGenerationRetry(JOB, 'x'.repeat(1000), now);
  const retries = await readGenerationRetries();
  assert.deepEqual(Object.keys(retries), [JOB]);
  assert.equal(retries[JOB].reason.length, 300);
  assert.equal(retries[JOB].attempts, 1);
});
