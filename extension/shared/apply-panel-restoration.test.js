const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../background/apply-runner.js'), 'utf8');
const start = source.indexOf('/** The tabs an application lives');
const end = source.indexOf('/**\n * One application with the Manager', start);
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const events = {}, renders = [], state = { mounted: false, pokes: 0, removals: 0, closed: [], decisions: [], pageType: 'application_form', tabs: new Map() };
  const event = (name) => ({ addListener: (fn) => { events[name] = fn; } });
  const review = { attemptId: 'owned', assist: true, tabId: 1, tabIds: new Set([1]), panel: { assist: true, attemptId: 'owned', mode: 'assist' }, assistant: { poke: () => { state.pokes++; } } };
  const reviews = new Map([['owned', review]]);
  const context = { activeReviews: reviews, EXTENSION_STATUS_KEY: 'status', isApplyOn: async () => state.applyOn !== false,
    chrome: { tabs: { onUpdated: event('updated'), onRemoved: event('removed'), onCreated: event('created'), onActivated: event('activated'), remove: async (id) => { state.closed.push(id); events.removed(id); } },
      storage: { onChanged: event('storage') }, scripting: { executeScript: async () => { if (state.gate) await state.gate; return [{ result: state.mounted }]; } } },
    showReviewPanel: async (tabId, panel) => { renders.push({ tabId, panel }); if (state.renderGate) await state.renderGate; state.mounted = true; },
    removeReviewPanel: async () => { state.mounted = false; state.removals++; },
    getTab: async (id) => { if (state.tabGate) await state.tabGate; return state.tabs.get(id); },
    inForm: async () => ({ type: state.pageType }),
    tabOwnership: { markTab: async () => {} }, rememberApplySession: async () => {}, answerManager: (...args) => state.decisions.push(args), publishApplyState() {},
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.openPanel = openOwnedAssistPanel;`, context);
  return { state, events, renders, review, reviews, open: (tabId = 1) => context.openPanel(tabId) };
}

test('an already-loaded child application tab gets its owned panel without waiting for another load event', async () => {
  const f = fixture(); f.events.created({ id: 2, openerTabId: 1, status: 'complete', url: 'https://employer.test/apply' }); await settle();
  assert.equal(f.review.tabIds.has(2), true); assert.equal(f.renders.length, 1); assert.equal(f.renders[0].tabId, 2);
  assert.equal(f.state.pokes, 0, 'panel restoration alone must not restart autofill');
});

test('activating an owned tab restores a missing panel but preserves healthy panels and ignores unrelated tabs', async () => {
  const f = fixture(); f.events.activated({ tabId: 99 }); await settle(); assert.equal(f.renders.length, 0);
  f.events.activated({ tabId: 1 }); await settle(); assert.equal(f.renders.length, 1);
  f.events.activated({ tabId: 1 }); await settle(); assert.equal(f.renders.length, 1, 'no redraw of healthy or intentionally hidden panels');
  assert.equal(f.state.pokes, 0);
});

test('Cancel during a panel probe cannot restore an ended application', async () => {
  const f = fixture(); let release; f.state.gate = new Promise((resolve) => { release = resolve; });
  f.events.activated({ tabId: 1 }); f.reviews.delete('owned'); release(); await settle();
  assert.equal(f.renders.length, 0);
});

test('Cancel during injection cleans up a late panel without restarting autofill', async () => {
  const f = fixture(); let release; f.state.renderGate = new Promise((resolve) => { release = resolve; });
  f.events.activated({ tabId: 1 }); await settle(); assert.equal(f.renders.length, 1);
  f.reviews.delete('owned'); release(); await settle();
  assert.equal(f.state.mounted, false); assert.equal(f.state.removals, 1); assert.equal(f.state.pokes, 0);
});

test('the toolbar explicitly opens only an owned running Apply panel without autofill or unrelated tab adoption', async () => {
  const f = fixture(); assert.equal(await f.open(99), false);
  assert.equal(await f.open(), true); assert.equal(f.renders.length, 1);
  assert.equal(f.state.pokes, 0);
  f.state.applyOn = false; assert.equal(await f.open(), false);
  f.state.applyOn = true; f.review.assistant.stopped = true; assert.equal(await f.open(), false);
});

test('a late old injection cannot replace the panel of a newly owned application in the same tab', async () => {
  const f = fixture(); let release; f.state.renderGate = new Promise((resolve) => { release = resolve; });
  f.events.activated({ tabId: 1 }); await settle();
  f.reviews.delete('owned');
  const next = { attemptId: 'next', tabIds: new Set([1]), panel: { assist: true, attemptId: 'next' } };
  f.reviews.set('next', next); release(); await settle();
  assert.equal(f.renders.at(-1).panel, next.panel); assert.equal(f.state.removals, 0);
});

test('a loaded continuation replaces its parent while two unfinished applications keep both slots', async () => {
  const f = fixture();
  f.reviews.set('second', { attemptId: 'second', assist: true, tabId: 9, tabIds: new Set([9]), panel: {}, assistant: {} });
  f.state.tabs.set(2, { id: 2, status: 'complete', url: 'https://employer.test/application' });
  f.events.created({ ...f.state.tabs.get(2), openerTabId: 1 }); await settle(); await settle();
  assert.deepEqual(f.state.closed, [1]);
  assert.deepEqual([...f.review.tabIds], [2]);
  assert.equal(f.review.tabId, 2);
  assert.equal(f.reviews.size, 2);
  assert.equal(f.state.decisions.length, 0, 'handoff cannot finish a review or free its queue slot');
  assert.ok(f.renders.some((render) => render.tabId === 2));
});

test('loading, blank and unrelated child pages do not close the original application', async () => {
  for (const [status, url, pageType] of [['loading', 'about:blank', 'application_form'], ['complete', 'https://employer.test/privacy', 'unknown']]) {
    const f = fixture(); f.state.pageType = pageType;
    f.state.tabs.set(2, { id: 2, status, url });
    f.events.created({ ...f.state.tabs.get(2), openerTabId: 1 }); await settle();
    assert.equal(f.state.closed.length, 0);
    f.state.tabs.set(2, { id: 2, status: 'complete', url: 'https://employer.test/application' }); f.state.pageType = 'application_form';
    f.events.updated(2, { status: 'complete' }); await settle(); await settle();
    assert.deepEqual(f.state.closed, [1]);
    assert.equal(f.state.decisions.length, 0);
  }
});

test('Cancel or a closed continuation during the handoff keeps the original tab', async () => {
  for (const cancelled of [true, false]) {
    const f = fixture(); let release;
    f.state.tabGate = new Promise((resolve) => { release = resolve; });
    f.state.tabs.set(2, { id: 2, status: 'complete', url: 'https://employer.test/application' });
    f.events.created({ ...f.state.tabs.get(2), openerTabId: 1 });
    if (cancelled) f.reviews.delete('owned'); else f.events.removed(2);
    release(); await settle(); await settle();
    assert.equal(f.state.closed.length, 0);
  }
});

test('a delayed opener discovered on completion attaches the child before closing its parent', async () => {
  const f = fixture();
  f.events.created({ id: 2, status: 'loading', url: 'about:blank' });
  assert.equal(f.review.tabIds.has(2), false);
  f.state.tabs.set(2, { id: 2, openerTabId: 1, status: 'complete', url: 'https://employer.test/application' });
  await f.events.updated(2, { status: 'complete' }); await settle(); await settle();
  assert.deepEqual(f.state.closed, [1]);
  assert.deepEqual([...f.review.tabIds], [2]);
  assert.equal(f.state.decisions.length, 0);
});

test('an original page stops its navigation before another Apply click after a continuation appears', async () => {
  let continued = false, clicks = 0;
  const context = {
    APPLY_START_STEPS: 3, sleep: async () => {},
    ApplyStop: class extends Error { constructor(message, options) { super(message); Object.assign(this, options); } },
    chrome: { tabs: { query: async () => [] } },
    inForm: async (_id, fn) => {
      if (fn.toString().includes('clickStart')) clicks++;
      if (fn.toString().includes('classifyPage')) { continued = true; return { type: 'job_page' }; }
      return false;
    },
  };
  const reach = source.slice(source.indexOf('async function reachApplicationForm('), source.indexOf('async function pageStop('));
  vm.runInNewContext(reach, context);
  await assert.rejects(context.reachApplicationForm({ id: 1 }, () => {}, {}, { handleAccountSteps: false, stop: () => continued }), (error) => error.keepTab === false);
  assert.equal(clicks, 0);
});
