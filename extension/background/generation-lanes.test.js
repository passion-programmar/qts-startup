// Concurrent Generation: the real queue code from service-worker.js (dispatcher, lanes, send turns)
// against a fake QTS server and a fake ChatGPT. Nothing leaves this machine; no Chrome is started.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8').replace(/\r\n/g, '\n');
const between = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `source markers not found: ${from}`);
  return source.slice(start, end);
};
const laneKeys = between('// Concurrent Generation: a Chrome writes up to', 'const GENERATION_NOTICE_KEY');
const sendTurn = between('  // One lane at a time puts a prompt into ChatGPT', '  async function finishGenerationTiming(');
const queue = between('  // Concurrent Generation. The claim answer says', '  async function runScannerChatGptTask(');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Chrome with Generation on, a server queue of `jobs` jobs and the Manager's number `limit`. */
function generationChrome({ jobs, limit, writeMs = 30 }) {
  const store = { qtsExtensionStatus: 'generation' };
  const pick = (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in store).map((key) => [key, store[key]]));
  const queueIds = Array.from({ length: jobs }, (_, index) => `job-${index + 1}`);
  const held = new Set();
  const log = { claims: [], written: [], tabsByJob: {}, notices: [], writing: 0, maxWriting: 0, sending: 0, maxSending: 0, closedTabs: [] };
  let tabSeq = 100;
  const context = {
    console, crypto: { randomUUID: () => 'run-id' }, setTimeout, clearTimeout, Promise,
    ACTIVE_GENERATION_JOB_KEY: 'qtsActiveGenerationJobId',
    GENERATION_BROWSER_STATE_KEY: 'qtsGenerationBrowserState',
    EXTENSION_STATUS_KEY: 'qtsExtensionStatus',
    GENERATION_PENDING_CANCEL_KEY: 'qtsGenerationPendingCancel',
    GENERATION_QUEUE_RUN_KEY: 'qtsGenerationQueueRun',
    GENERATION_IDLE_NOTICE_KEY: 'qtsGenerationIdleNotice',
    GENERATION_JOBS_PER_CHATGPT_TAB: 10,
    generationLanesInFlight: new Set(),
    generationLaneChatTabs: new Map(),
    generationTimings: new Map(),
    generationHeartbeatOkAt: new Map(),
    chrome: {
      storage: { local: {
        get: async (keys) => pick(keys),
        set: async (values) => { Object.assign(store, values); },
        remove: async (keys) => { for (const key of [keys].flat()) delete store[key]; },
      } },
      tabs: {
        get: async (id) => ({ id }),
        remove: async (id) => { log.closedTabs.push(id); },
      },
    },
    self: {
      __qtsAccountAuth: { getWorkerAuthToken: async () => 'token' },
      __qtsIdlePacing: { noteActivity: async () => {} },
      __qtsAutoApply: { recoverStoppedRuns: async () => true },
    },
    workerApiRequest: async (_method, url, body) => {
      if (url.endsWith('/claim')) {
        log.claims.push(body);
        const parallelLimit = body.parallel === true ? limit : 1;
        if (held.size >= parallelLimit) return { success: true, job: null, processing: true, parallelLimit };
        const id = queueIds.shift();
        if (!id) return { success: true, job: null, parallelLimit };
        held.add(id);
        return { success: true, parallelLimit, job: { id, jobUrl: `https://jobs.example/${id}`, jobTitle: id } };
      }
      if (url.endsWith('/finalize')) { held.delete(body.jobId); return { success: true }; }
      return { success: true };
    },
    waitingGenerationJobIds: async () => [],
    persistGenerationQueueRun: async () => {},
    flushGenerationCancellation: async () => ({ success: true }),
    recoverInterruptedGeneration: async () => {},
    notifyGenerationManager: async (message) => log.notices.push(message),
    acquireGenerationChatGptTab: async () => ({ id: ++tabSeq, shownBefore: 1 }),
    showGenerationChatGptTab: async () => 1,
    ensureChatGptReady: async () => {},
    bringTabToFront: async () => {},
    updateGenerationBrowserState: async (values, lane = 0) => {
      const key = lane ? `qtsGenerationBrowserState:${lane}` : 'qtsGenerationBrowserState';
      store[key] = { ...(store[key] || {}), ...values };
    },
    clearGenerationBrowserState: async (_id, lane = 0) => { delete store[lane ? `qtsGenerationBrowserState:${lane}` : 'qtsGenerationBrowserState']; },
    markGeneration: () => {},
    finishGenerationTiming: async () => {},
    // ChatGPT: the prompt goes in during a send turn (one lane at a time), then the answer is written.
    runGenerationForTab: async (_jobTabId, job, chatTab) => {
      await context.inGenerationSendTurn(async () => {
        log.sending += 1;
        log.maxSending = Math.max(log.maxSending, log.sending);
        await sleep(5);
        log.sending -= 1;
      });
      log.writing += 1;
      log.maxWriting = Math.max(log.maxWriting, log.writing);
      log.tabsByJob[job.id] = chatTab.id;
      await sleep(writeMs);
      log.writing -= 1;
      log.written.push(job.id);
      return { generationId: `g-${job.id}` };
    },
    getTab: async (id) => ({ id, windowId: 1 }),
    downloadQueuedGenerationFiles: async () => ({ resume: 'r.pdf', coverLetter: 'c.pdf' }),
    reportQueuedGenerationDelivered: async () => {},
    clearGenerationRetry: async () => {},
    readQueuedGenerationStatus: async () => 'processing',
    handleQueuedGenerationFailureTab: async (chatTab) => chatTab,
    removeQueuedGenerationDownloads: async () => {},
    scheduleGenerationRetry: async () => Date.now(),
    generationRetryTime: () => 'later',
    generationCancelledError: () => Object.assign(new Error('cancelled'), { name: 'GenerationCancelledError' }),
    isGenerationCancelled: (error) => error?.name === 'GenerationCancelledError',
    showGenerationPageStatus: async () => {},
    returnToTab: async () => {},
    finishWorkCancellation: async () => {},
    sleep,
  };
  vm.createContext(context);
  vm.runInContext(`${laneKeys}\n${sendTurn}\n${queue}\nthis.inGenerationSendTurn = inGenerationSendTurn;`, context);
  const run = async () => {
    await context.processQueuedGenerationJobs();
    for (let wait = 0; context.generationLanesInFlight.size && wait < 400; wait += 1) await sleep(10);
    assert.equal(context.generationLanesInFlight.size, 0, 'every lane ended');
  };
  return { run, log, store, held, context };
}

test('Concurrent Generation: a limit of 3 writes three jobs at once, each once, in its own ChatGPT tab', async () => {
  const { run, log, store, held } = generationChrome({ jobs: 5, limit: 3 });
  await run();
  assert.deepEqual([...log.written].sort(), ['job-1', 'job-2', 'job-3', 'job-4', 'job-5'], 'every job written exactly once');
  assert.equal(log.maxWriting, 3, 'three jobs written at the same time, never more');
  assert.equal(log.maxSending, 1, 'prompts are sent one lane at a time');
  assert.equal(new Set(Object.values(log.tabsByJob)).size, 3, 'one ChatGPT tab per lane, reused for its next job');
  assert.ok(log.claims.every((body) => body.parallel === true), 'every claim says the extension runs several');
  assert.deepEqual(log.notices, ['Generation finished 5 job(s). It stays on and takes new jobs as they are saved.'], 'one notice for the whole run');
  assert.equal(held.size, 0);
  assert.deepEqual(Object.keys(store).filter((key) => /^qts(ActiveGenerationJobId|GenerationBrowserState)/.test(key)), [], 'no lane leaves a job or state behind');
  assert.equal(log.closedTabs.length, 3, 'each lane closes its own ChatGPT tab when the run ends');
});

test('Concurrent Generation: the default of 1 is the old loop, one job at a time in lane 0', async () => {
  const { run, log, context } = generationChrome({ jobs: 3, limit: 1 });
  const laneKeysSeen = new Set();
  const set = context.chrome.storage.local.set;
  context.chrome.storage.local.set = async (values) => { Object.keys(values).forEach((key) => laneKeysSeen.add(key)); return set(values); };
  await run();
  assert.deepEqual(log.written, ['job-1', 'job-2', 'job-3'], 'oldest first, one after another');
  assert.equal(log.maxWriting, 1);
  assert.equal(new Set(Object.values(log.tabsByJob)).size, 1, 'one ChatGPT tab for the whole run');
  assert.ok(laneKeysSeen.has('qtsActiveGenerationJobId'), 'lane 0 keeps the original key');
  assert.equal([...laneKeysSeen].some((key) => key.includes(':')), false, 'no extra lane key is ever written');
});

test('Concurrent Generation: send turns run one at a time, in order, and a failed send does not block the next', async () => {
  const context = vm.createContext({ Promise });
  vm.runInContext(`const generationTimings = new Map();\n${sendTurn}\nthis.turn = inGenerationSendTurn;`, context);
  const order = [];
  let inside = 0;
  let most = 0;
  const work = (name, fail = false) => context.turn(async () => {
    inside += 1; most = Math.max(most, inside);
    await sleep(5);
    order.push(name);
    inside -= 1;
    if (fail) throw new Error(`${name} failed`);
  });
  const results = await Promise.allSettled([work('a'), work('b', true), work('c')]);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(most, 1);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected', 'fulfilled']);
});
