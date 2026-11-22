// LinkedIn skip-list on a copy of LinkedIn's live job-card structure (2026-11-21): hashed classes,
// componentkey "job-card-component-ref-<id>", title lines + Dismiss aria-label, company next line,
// state labels. Served at a linkedin.com address by request interception: real LinkedIn is never used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => p && fs.existsSync(p));
const root = path.join(__dirname, '..', '..');
const { computeTitleCompanyKey } = require(path.join(root, 'extension', 'shared', 'title-company-key.js'));

const card = ({ id, title, company, location = 'Poland (Remote)', state = null, verified = false, broken = false }) => `
<div data-display-contents="true"><div><div data-display-contents="true">
  <div class="cfsjj4 cfsjkl cfsjk2" componentkey="job-card-component-ref-${id}">
    <div class="cfsg3i">
      <p class="cfsa1"><span>${verified ? `${title} (Verified job)` : title}</span></p>
      ${verified
        ? `<p class="cfsa2"><span aria-hidden="true">${title}<svg width="12" height="12" aria-label="Verified"><rect width="12" height="12"></rect></svg></span></p>`
        : `<p class="cfsa2"><span aria-hidden="true">${title}</span></p>`}
      <p class="cfsa3"><span>${company}</span></p>
      <p class="cfsa4"><span>${location}</span></p>
      <ul class="cfsa5">${state ? `<li>${state}</li><li>·</li>` : '<li>Posted 1 day ago</li><li>·</li>'}<li>Promoted</li></ul>
      ${broken ? '' : `<button class="cfsb" aria-label="Dismiss ${title} job">✕</button>`}
    </div>
  </div>
</div></div></div>`;

const PAGE1 = [
  { id: '4490425819', title: 'Senior DevOps Engineer (Azure+AWS)', company: 'N-iX', state: 'Viewed', verified: true },
  { id: '4492410414', title: 'Senior Site Reliability Engineer - AI/GPU', company: 'TechShack', state: 'Applied' },
  { id: '4491500626', title: 'Site Reliability Engineer II', company: 'Akamai Technologies' }, // a QTS bid
  { id: '4492930672', title: 'Senior Kubernetes & Reliability Engineer', company: 'Verda' },
  { id: '4484283569', title: 'Staff DevOps Engineer', company: 'Bloomreach' },
  { id: '4491927331', title: 'Senior Cloud Engineer', company: 'FP Markets', location: 'Cyprus (Remote)' },
];
const PAGE2 = [
  { id: '4499000001', title: 'Senior DevOps Engineer', company: 'Bloomreach' },
  { id: '4499000002', title: 'Site Reliability Engineer II', company: 'Akamai Technologies' }, // same job, new id
  { id: '4499000003', title: 'Senior DevOps Engineer', company: 'MC Engineering', location: 'Italy (Remote)' },
];
const list = (cards) => `<main><section aria-label="results">${cards.map(card).join('')}</section><div id="detail">Job details</div></main>`;

async function openSearch(browser, { cards, url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4490425819', known = [], signedIn = true, panel = false }) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (request) => (request.url().startsWith('https://www.linkedin.com/')
    ? request.respond({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>${list(cards)}</body></html>` })
    : request.abort()));
  await page.goto(url);
  await page.evaluate(({ known, signedIn, panel }) => {
    // The QTS panel's shadow root, to look inside it.
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachShadow(options) { const shadow = attach.call(this, options); if (this.hasAttribute('data-qts-page-launcher')) window.panelRoot = shadow; return shadow; };
    // A fake worker: the Manager's skip-list (bids, saved jobs, marks) and the messages sent to it.
    window.calls = [];
    window.store = { authExpiresAt: signedIn ? Date.now() + 3600000 : 0, authToken: 'test', qtsSessionUser: { id: 'manager', role: 'manager' } };
    window.skipSet = new Set(known);
    // What the fake worker knows about each pair ("seen before"), and whether QTS answers.
    window.infos = Object.fromEntries(known.map((key) => [key, { source: 'qts_applied', location: 'Cracow (Remote)', at: new Date().toISOString() }]));
    window.serverState = 'ok';
    window.listeners = { message: new Set(), storage: new Set() };
    const events = (key) => ({ addListener: (fn) => window.listeners[key].add(fn), removeListener: (fn) => window.listeners[key].delete(fn) });
    window.chrome = {
      runtime: { id: 'test', getURL: (file) => `https://extension.test/${file}`, onMessage: events('message'), sendMessage: async (message) => {
        if (panel && !String(message.type || '').startsWith('QTS_LINKEDIN_SKIPS')) {
          // The panel's own start-up questions.
          if (message.type === 'QTS_GET_LAUNCHER_STATE') return { ok: true, active: true };
          if (message.type === 'CHECK_EXTENSION_PAGE_ALLOWED') return { ok: true, excluded: false };
          if (message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, features: {} };
          if (message.type === 'QTS_DAILY_COUNTS') return { ok: true, urls: 0, jobs: 0, applied: 0 };
          return { ok: true };
        }
        window.calls.push(message);
        if (message.type === 'QTS_LINKEDIN_SKIPS_FLUSH') return { ok: true };
        if (window.serverState !== 'ok') return { ok: false, state: window.serverState };
        const note = (entry) => { window.infos[entry.key] = { source: entry.source, location: entry.location || null, at: new Date().toISOString() }; };
        if (message.type === 'QTS_LINKEDIN_SKIPS_MATCH') {
          for (const mark of message.marks) { window.skipSet.add(mark.key); note(mark); }
          return { ok: true, state: 'ok', skipped: message.keys.filter((key) => window.skipSet.has(key)) };
        }
        if (message.type === 'QTS_LINKEDIN_SKIPS_MARK') { for (const item of message.items) { window.skipSet.add(item.key); note(item); } return { ok: true, added: 1 }; }
        if (message.type === 'QTS_LINKEDIN_SKIPS_UNSKIP') { for (const item of message.items) window.skipSet.delete(item.key); return { ok: true, removed: 1 }; }
        if (message.type === 'QTS_LINKEDIN_SKIPS_INFO') return { ok: true, skipped: window.skipSet.has(message.key), info: window.skipSet.has(message.key) ? window.infos[message.key] || null : null };
        return { ok: false };
      } },
      storage: { onChanged: events('storage'), local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, window.store[key]])),
        set: async (values) => {
          Object.assign(window.store, values);
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }]));
          for (const listener of window.listeners.storage) listener(changes, 'local');
        },
      } },
    };
    window.htmlBefore = document.querySelector('main').innerHTML;
    // What is painted: the faded cards (one highlight range per card) and the struck titles.
    window.painted = () => {
      const card = (range) => range.startContainer.closest?.('[componentkey]') || range.startContainer.parentElement?.closest('[componentkey]');
      const marked = [...(CSS.highlights.get('qts-linkedin-skip') || [])].map((range) => card(range)?.getAttribute('componentkey').replace('job-card-component-ref-', '')).filter(Boolean);
      const titles = [...(CSS.highlights.get('qts-linkedin-skip-title') || [])].map((range) => range.toString());
      return { marked, titles };
    };
    window.styleRules = () => [...document.adoptedStyleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));
  }, { known, signedIn, panel });
  await page.addScriptTag({ path: path.join(root, 'extension', 'shared', 'title-company-key.js') });
  await page.addScriptTag({ path: path.join(root, 'extension', 'content', 'linkedin-skip.js') });
  if (panel) {
    await page.addScriptTag({ path: path.join(root, 'extension', 'content', 'page-launcher.js') });
    await page.waitForFunction(() => Boolean(window.__qtsPageLauncher));
  }
  await page.waitForFunction(() => window.__qtsLinkedInSkip?.status().state !== 'starting');
  return page;
}

const sorted = (values) => [...values].sort();

test('seen cards are red with a struck title (with or without the verified badge), painted only by highlights; LinkedIn\'s HTML is untouched', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const known = [computeTitleCompanyKey('Site Reliability Engineer II', 'Akamai Technologies')];
    const page = await openSearch(browser, { cards: PAGE1, known });
    await page.waitForFunction(() => window.painted().marked.length === 3);
    const painted = await page.evaluate(() => window.painted());
    // Viewed (LinkedIn), Applied (LinkedIn), and the QTS bid; the three new jobs are left as they are.
    assert.deepEqual(sorted(painted.marked), sorted(['4490425819', '4492410414', '4491500626']));
    // Unique titles: a card without the verified badge has its title twice (screen-reader + visible copy).
    assert.deepEqual(sorted(new Set(painted.titles)), sorted(['Senior DevOps Engineer (Azure+AWS)', 'Senior Site Reliability Engineer - AI/GPU', 'Site Reliability Engineer II']));
    // Only highlight names are styled: no rule names LinkedIn's elements.
    const rules = await page.evaluate(() => window.styleRules());
    assert.ok(rules.length === 2 && rules.every((rule) => rule.startsWith('::highlight(qts-linkedin-skip')), rules.join(' | '));
    // On screen: the struck title's background is red.
    const box = await page.evaluate(() => {
      const range = [...CSS.highlights.get('qts-linkedin-skip-title')][0];
      const rect = range.getBoundingClientRect();
      return { x: rect.x + 2, y: rect.y + 2, width: 2, height: 2 };
    });
    const { data } = await require('sharp')(await page.screenshot({ clip: box })).raw().toBuffer({ resolveWithObject: true });
    assert.ok([0xdc, 0x26, 0x26].every((value, index) => Math.abs(data[index] - value) <= 8), `title background ${[...data.slice(0, 3)]}`);
    // LinkedIn's own labels were sent as marks with their source.
    const marks = await page.evaluate(() => window.calls.filter((call) => call.type === 'QTS_LINKEDIN_SKIPS_MATCH').flatMap((call) => call.marks));
    assert.deepEqual(marks.map((mark) => [mark.title, mark.source]).sort(), [['Senior DevOps Engineer (Azure+AWS)', 'viewed'], ['Senior Site Reliability Engineer - AI/GPU', 'applied']]);
    assert.equal(await page.evaluate(() => document.querySelector('main').innerHTML === window.htmlBefore), true, 'page HTML unchanged');
    assert.deepEqual(await page.evaluate(() => window.__qtsLinkedInSkip.status()), { state: 'ok', total: 6, readable: 6, seen: 3 });

    // A click on a new card: marked at once, sent as "clicked".
    await page.click('[componentkey="job-card-component-ref-4492930672"] p');
    await page.waitForFunction(() => window.painted().marked.includes('4492930672'));
    const clicked = await page.evaluate(() => window.calls.filter((call) => call.type === 'QTS_LINKEDIN_SKIPS_MARK').map((call) => call.items[0]));
    assert.deepEqual(clicked.map(({ title, company, source }) => [title, company, source]), [['Senior Kubernetes & Reliability Engineer', 'Verda', 'clicked']]);

    // Next page: LinkedIn changes the address and redraws the list. The same job under a new id is
    // still recognised (title + company), and different jobs with the same title stay apart.
    await page.evaluate((html) => {
      history.pushState({}, '', '/jobs/search-results/?currentJobId=4499000001&start=25');
      document.querySelector('section').innerHTML = html;
    }, PAGE2.map(card).join(''));
    await page.waitForFunction(() => window.__qtsLinkedInSkip.status().total === 3 && window.painted().marked.length === 1);
    assert.deepEqual((await page.evaluate(() => window.painted())).marked, ['4499000002']);

    // Skip, then un-skip, the selected job (currentJobId).
    assert.equal((await page.evaluate(() => window.__qtsLinkedInSkip.skipSelected())).ok, true);
    await page.waitForFunction(() => window.painted().marked.includes('4499000001'));
    assert.equal((await page.evaluate(() => window.__qtsLinkedInSkip.unskipSelected())).ok, true);
    await page.waitForFunction(() => !window.painted().marked.includes('4499000001'));
    assert.deepEqual(await page.evaluate(() => window.__qtsLinkedInSkip.selected()), { title: 'Senior DevOps Engineer', company: 'Bloomreach', location: 'Poland (Remote)', skipped: false });
  } finally { await browser.close(); }
});

test('a layout QTS cannot read pauses the feature; signed out paints nothing', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const broken = PAGE1.map((item, index) => ({ ...item, broken: index > 0 }));
    const paused = await openSearch(browser, { cards: broken });
    await paused.waitForFunction(() => window.__qtsLinkedInSkip.status().state === 'paused');
    assert.deepEqual(await paused.evaluate(() => window.painted()), { marked: [], titles: [] });
    assert.deepEqual(await paused.evaluate(() => window.__qtsLinkedInSkip.status()), { state: 'paused', total: 6, readable: 1, seen: 0 });

    const signedOut = await openSearch(browser, { cards: PAGE1, signedIn: false });
    await signedOut.waitForFunction(() => window.__qtsLinkedInSkip.status().state === 'signed-out');
    assert.deepEqual(await signedOut.evaluate(() => window.painted()), { marked: [], titles: [] });
    assert.equal(await signedOut.evaluate(() => window.calls.length), 0, 'nothing asked while signed out');

    const elsewhere = await openSearch(browser, { cards: PAGE1, url: 'https://www.linkedin.com/jobs/view/4490425819/' });
    await elsewhere.waitForFunction(() => window.__qtsLinkedInSkip.status().state === 'not-search');
    assert.equal(await elsewhere.evaluate(() => window.calls.length), 0, 'only search pages are read');
  } finally { await browser.close(); }
});

test('the QTS panel on LinkedIn shows the count, Skip / Un-skip for the selected job, and the switch', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const known = [computeTitleCompanyKey('Site Reliability Engineer II', 'Akamai Technologies')];
    const page = await openSearch(browser, { cards: PAGE1, known, panel: true });
    await page.waitForFunction(() => window.painted().marked.length === 3);
    await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
    const section = () => page.evaluate(() => {
      const root = window.panelRoot;
      const box = root.querySelector('.li-skip');
      return {
        shown: Boolean(box) && !box.hidden,
        count: root.querySelector('.li-skip-count')?.textContent,
        selected: root.querySelector('.li-skip-selected')?.hidden ? null : root.querySelector('.li-skip-selected')?.textContent,
        action: root.querySelector('.li-skip-action')?.hidden ? null : root.querySelector('.li-skip-action')?.textContent,
        on: root.querySelector('.li-skip-switch')?.getAttribute('aria-checked'),
      };
    });
    await page.waitForFunction(() => window.panelRoot?.querySelector('.li-skip') && !window.panelRoot.querySelector('.li-skip').hidden);
    assert.deepEqual(await section(), { shown: true, count: '3 of 6 here already seen', selected: 'Senior DevOps Engineer (Azure+AWS) · N-iX', action: 'Un-skip this job', on: 'true' });
    // How it was seen before: LinkedIn's "Viewed" label, where, when.
    await page.waitForFunction(() => !window.panelRoot.querySelector('.li-skip-before').hidden);
    assert.equal(await page.evaluate(() => window.panelRoot.querySelector('.li-skip-before').textContent), 'Seen before · Viewed on LinkedIn · Poland (Remote) · 1 min ago');

    // Un-skip the selected job from the panel: its outline goes, the button turns into Skip.
    await page.evaluate(() => window.panelRoot.querySelector('.li-skip-action').click());
    await page.waitForFunction(() => !window.painted().marked.includes('4490425819'));
    await page.waitForFunction(() => window.panelRoot.querySelector('.li-skip-action').textContent === 'Skip this job');
    assert.equal(await page.evaluate(() => window.calls.filter((call) => call.type === 'QTS_LINKEDIN_SKIPS_UNSKIP').length), 1);

    // The switch: off removes every outline, on brings them back.
    await page.evaluate(() => window.panelRoot.querySelector('.li-skip-switch').click());
    await page.waitForFunction(() => window.painted().marked.length === 0 && window.panelRoot.querySelector('.li-skip-count').textContent === 'Off');
    await page.evaluate(() => window.panelRoot.querySelector('.li-skip-switch').click());
    await page.waitForFunction(() => window.painted().marked.length === 2);
  } finally { await browser.close(); }
});

test('server required: QTS not reachable or turned off by the Super Admin leaves LinkedIn as usual, and it resumes by itself', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const known = [computeTitleCompanyKey('Site Reliability Engineer II', 'Akamai Technologies')];
    const page = await openSearch(browser, { cards: PAGE1, known, panel: true });
    await page.waitForFunction(() => window.painted().marked.length === 3);
    for (const [state, text] of [['server-down', 'QTS server not reachable – paused'], ['admin-off', 'Turned off by your Super Admin']]) {
      await page.evaluate((state) => { window.serverState = state; return window.__qtsLinkedInSkip.refresh('panel'); }, state);
      await page.waitForFunction((state) => window.__qtsLinkedInSkip.status().state === state, {}, state);
      assert.deepEqual(await page.evaluate(() => window.painted()), { marked: [], titles: [] }, `${state}: nothing painted`);
      await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
      await page.waitForFunction((text) => window.panelRoot.querySelector('.li-skip-count').textContent === text, {}, text);
      // A click while paused marks nothing.
      await page.click('[componentkey="job-card-component-ref-4492930672"] p');
      assert.equal(await page.evaluate(() => window.calls.filter((call) => call.type === 'QTS_LINKEDIN_SKIPS_MARK').length), 0);
    }
    await page.evaluate(() => { window.serverState = 'ok'; return window.__qtsLinkedInSkip.refresh('panel'); });
    await page.waitForFunction(() => window.painted().marked.length === 3);
    // Leaving the tab sends the waiting marks.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.ok(await page.evaluate(() => window.calls.some((call) => call.type === 'QTS_LINKEDIN_SKIPS_FLUSH')));
  } finally { await browser.close(); }
});
