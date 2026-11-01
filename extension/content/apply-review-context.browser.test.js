// Real Chrome DOM; only the extension runtime is mocked to reproduce invalidated contexts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const FILE = path.join(__dirname, 'apply-review.js');
const STATE = { attemptId: 'synthetic', auto: true, mode: 'review', final: true, chromeName: 'Test Chrome', candidate: 'Sample Candidate', job: { title: 'Engineer', company: 'Example' }, answers: [], unresolved: [], provisional: [{ id: 'answer', label: 'Question', value: 'Needs review', accepted: false, step: 1 }] };

async function fixture(run) {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<form id="application"><button id="submit" type="submit">Submit application</button></form>');
    await page.evaluate(() => {
      window.mode = 'valid'; window.messages = []; window.siteSubmits = 0; window.intervals = new Map(); window.listeners = new Map();
      const nativeSetInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
      window.setInterval = (fn, delay) => { const id = nativeSetInterval(fn, delay); window.intervals.set(id, fn); return id; };
      window.clearInterval = id => { window.intervals.delete(id); nativeClearInterval(id); };
      const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
      document.addEventListener = (type, fn, options) => { if (!window.listeners.has(type)) window.listeners.set(type, new Set()); window.listeners.get(type).add(fn); add(type, fn, options); };
      document.removeEventListener = (type, fn, options) => { window.listeners.get(type)?.delete(fn); remove(type, fn, options); };
      window.chrome = { runtime: {
        get id() { if (window.mode === 'getter') throw Error('Extension context invalidated.'); return window.mode === 'missing' ? undefined : 'synthetic-extension'; },
        sendMessage(message) {
          if (window.mode === 'sync') throw Error('Extension context invalidated.');
          if (window.mode === 'async') return Promise.reject(Error('Extension context invalidated.'));
          if (window.mode === 'transient') return Promise.reject(Error('The message port closed.'));
          window.messages.push(message); return Promise.resolve({ ok: true });
        },
      } };
      window.__qtsApplyForm = { currentAnswers: () => [{ id: 'answer', value: 'Needs review' }], isSubmitControl: node => node?.id === 'submit', focusField() {}, markProblemFields() {} };
      document.getElementById('application').onsubmit = event => { event.preventDefault(); window.siteSubmits++; };
    });
    await page.addScriptTag({ path: FILE });
    await page.evaluate(state => { window.oldPanel = window.__qtsApplyReview; window.oldPanel.render(state); }, STATE);
    await run(page, errors);
  } finally { await browser.close(); }
}

for (const mode of ['sync', 'async', 'missing', 'getter']) {
  test(`review panel disposes safely on ${mode} context invalidation and can be injected again`, { skip: !CHROME, timeout: 60000 }, () => fixture(async (page, errors) => {
    await page.click('#submit');
    assert.equal(await page.evaluate(() => window.siteSubmits), 0, 'live provisional-answer safeguard remains active');
    await page.evaluate(mode => {
      window.mode = mode;
      if (mode === 'missing' || mode === 'getter') document.getElementById('submit').click();
      else [...window.intervals.values()][0](); // The panel's actual heartbeat callback.
    }, mode);
    await page.waitForFunction(() => !window.__qtsApplyReview);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-qts-apply-review]').length), 0);
    assert.equal(await page.evaluate(() => window.intervals.size), 0, 'heartbeat stops after invalidation');
    assert.equal(await page.evaluate(() => ['click', 'submit', 'input', 'change'].reduce((n, type) => n + (window.listeners.get(type)?.size || 0), 0)), 0, 'stale page listeners removed');
    assert.equal(await page.evaluate(() => window.messages.length), 0, 'no submission or confirmation was sent');
    assert.equal(await page.evaluate(state => window.oldPanel.render(state), STATE), false, 'disposed instance cannot revive');
    const before = await page.evaluate(() => window.siteSubmits);
    await page.click('#submit');
    assert.equal(await page.evaluate(() => window.siteSubmits), before + 1, 'dead panel cannot keep intercepting the Manager on the synthetic form');
    await page.evaluate(() => { window.mode = 'valid'; window.siteSubmits = 0; });
    await page.addScriptTag({ path: FILE });
    await page.evaluate(state => window.__qtsApplyReview.render(state), STATE);
    await page.evaluate(() => window.oldPanel.remove());
    assert.equal(await page.evaluate(() => Boolean(window.__qtsApplyReview)), true, 'old cleanup cannot delete the new panel');
    assert.equal(await page.evaluate(() => window.intervals.size), 1, 'reinjection creates one heartbeat');
    await page.click('#submit');
    assert.equal(await page.evaluate(() => window.siteSubmits), 0, 'new live panel keeps normal Submit checks');
    await page.evaluate(() => window.__qtsApplyReview.remove());
    assert.equal(await page.evaluate(() => window.intervals.size), 0, 'normal removal also cleans up');
    assert.deepEqual(errors, []);
  }));
}

test('a transient worker messaging failure does not remove a live review or its Submit safeguards', { skip: !CHROME, timeout: 60000 }, () => fixture(async (page, errors) => {
  await page.evaluate(async () => { window.mode = 'transient'; [...window.intervals.values()][0](); await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(await page.evaluate(() => Boolean(window.__qtsApplyReview)), true);
  assert.equal(await page.evaluate(() => window.intervals.size), 1);
  await page.click('#submit');
  assert.equal(await page.evaluate(() => window.siteSubmits), 0);
  assert.deepEqual(errors, []);
}));
