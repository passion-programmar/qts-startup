// Real Chrome, the Get JD panel alone with mocked extension messages: the Gemini-mode draft a
// Manager checks before anything is sent to Gemini.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

test('the draft panel shows the read job, keeps edits, and sends only on Check', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><head><link rel="icon" href="/page-icon.png"></head><body><h1>Job</h1></body></html>');
    await page.evaluate(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) { const root = attach.call(this, options); window.testRoot = root; return root; };
      window.calls = [];
      window.canBlock = false;
      window.chrome = {
        runtime: {
          id: 'test', getURL: (p) => p, onMessage: { addListener() {}, removeListener() {} },
          sendMessage: async (message) => { window.calls.push(message); return { ok: true }; },
        },
        storage: {
          local: { get: async () => ({ authExpiresAt: Date.now() + 60000, qtsGetJdOn: true, qtsCanManageJobDetectionUrlRules: window.canBlock }) },
          onChanged: { addListener() {}, removeListener() {} },
        },
      };
    });
    await page.addScriptTag({ path: path.resolve('extension/content/get-jd-review.js') });
    await page.waitForFunction(() => Boolean(window.__qtsGetJdReview));
    // The panel's own start-up requests (its page result, page access) are not draft actions.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await page.evaluate(() => { window.calls = []; });
    const draft = (extra = {}) => page.evaluate((extra) => window.__qtsGetJdReview.applyResult({
      runId: 'draft-run', pageUrl: location.href, status: 'draft', evaluationMode: 'gemini', classification: null,
      message: 'Check the job details, then send them to Gemini.',
      draftJob: { jobUrl: location.href, title: 'Software Engineer', company: 'Example', description: 'Build Python services.' },
      ...extra,
    }), extra);
    const fields = () => page.evaluate(() => Object.fromEntries([...window.testRoot.querySelectorAll('[data-draft-field]')].map((input) => [input.dataset.draftField, [input.value, input.readOnly]])));
    const button = (text) => page.evaluate((text) => [...window.testRoot.querySelectorAll('button')].find((b) => b.textContent === text && !b.closest('[hidden]') && !b.hidden), text);
    const click = (text) => page.evaluate((text) => [...window.testRoot.querySelectorAll('button')].find((b) => b.textContent === text).click(), text);
    const docked = () => page.evaluate(() => document.documentElement.getAttribute('data-qts-get-jd-docked') === 'true');

    await draft();
    await page.waitForFunction(() => window.testRoot.querySelector('.panel.draft-review'));
    assert.equal(await docked(), true, 'a draft opens the panel by itself');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-qts-manual-get-jd-review')), 'true', 'the launcher steps aside while the job is checked');
    assert.deepEqual(await fields(), {
      jobUrl: [await page.evaluate(() => location.href), true],
      description: ['Build Python services.', false],
    }, 'URL (fixed) and the full JD only: Gemini reads the title and company from the JD');
    assert.equal(await page.evaluate(() => getComputedStyle(window.testRoot.querySelector('.profiles')).display), 'none', 'no candidate list before Gemini');
    for (const text of ['Check', 'Close', 'Re-read page']) assert.ok(await button(text), text);
    assert.equal(await button('Never on this site'), undefined, 'blocking needs the Super Admin permission');
    assert.equal(await page.evaluate(() => window.calls.length), 0, 'nothing is sent by opening the panel');

    // Edits survive a re-render, and Send carries the JD only (no title or company).
    await page.evaluate(() => {
      const input = window.testRoot.querySelector('[data-draft-field="description"]');
      input.value = 'Build Python services.\n\nEdited.'; input.dispatchEvent(new Event('input'));
    });
    await draft();
    assert.equal((await fields()).description[0], 'Build Python services.\n\nEdited.');
    await click('Check');
    await page.waitForFunction(() => window.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.calls[0]), {
      type: 'QTS_GET_JD_SEND_DRAFT',
      job: { title: '', company: '', description: 'Build Python services.\n\nEdited.' },
    });

    // An empty JD is not sent.
    await draft({ runId: 'empty-run', draftJob: { jobUrl: 'x', title: '', company: '', description: '' }, message: 'No job text was found on this page.' });
    await click('Check');
    assert.match(await page.evaluate(() => window.testRoot.querySelector('.message').textContent), /Paste or keep the JD/);
    assert.equal(await page.evaluate(() => window.calls.length), 1);

    // Close asks to close the tab; where the worker keeps the tab (here: no tab closed), the panel
    // only hides and the draft and its edits come back when shown again.
    await draft({ runId: 'close-run' });
    await page.evaluate(() => {
      const input = window.testRoot.querySelector('[data-draft-field="description"]');
      input.value = 'Edited JD'; input.dispatchEvent(new Event('input'));
    });
    const sentBeforeClose = await page.evaluate(() => window.calls.length);
    await click('Close');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-qts-get-jd-docked') !== 'true');
    assert.deepEqual(await page.evaluate(() => window.calls.slice(-1).map((call) => call.type)), ['QTS_GET_JD_CLOSE_JOB_TAB']);
    assert.equal(await page.evaluate(() => window.calls.length), sentBeforeClose + 1, 'Close sends nothing to Gemini');
    assert.equal(await page.evaluate(() => window.__qtsGetJdReview.draftAvailable()), true);
    await page.evaluate(() => window.__qtsGetJdReview.openReview());
    assert.equal(await docked(), true, 'shown again on request');
    assert.equal((await fields()).description[0], 'Edited JD', 'edits are kept while the tab is open');

    // Re-read asks the worker; ‹ QTS only puts the draft aside.
    await draft({ runId: 'reread-run' });
    await click('Re-read page');
    await page.waitForFunction(() => window.calls.at(-1)?.type === 'QTS_GET_JD_REREAD_DRAFT');
    await draft({ runId: 'back-run' });
    const before = await page.evaluate(() => window.calls.length);
    await page.evaluate(() => window.testRoot.querySelector('.review-back').click());
    await page.waitForFunction(() => document.documentElement.getAttribute('data-qts-get-jd-docked') !== 'true');
    assert.equal(await page.evaluate(() => window.calls.length), before, '‹ QTS sends nothing');
    assert.equal(await page.evaluate(() => window.__qtsGetJdReview.draftAvailable()), true, 'the draft can be opened again');
    await page.evaluate(() => window.__qtsGetJdReview.openReview());
    assert.equal(await docked(), true);

    // With permission, "Never on this site" shows and asks the worker to block the site.
    await page.evaluate(() => { window.canBlock = true; });
    await draft({ runId: 'block-run' });
    await page.waitForFunction(() => [...window.testRoot.querySelectorAll('button')].some((b) => b.textContent === 'Never on this site' && !b.hidden));
    await click('Never on this site');
    await page.waitForFunction(() => window.calls.at(-1)?.type === 'QTS_GET_JD_NEVER_ON_SITE');

    // A blocked site's draft is dismissed and closes the panel.
    await page.evaluate(() => window.__qtsGetJdReview.applyResult({ runId: 'block-run', pageUrl: location.href, status: 'dismissed', evaluationMode: 'gemini' }));
    await page.waitForFunction(() => document.documentElement.getAttribute('data-qts-get-jd-docked') !== 'true');
    assert.equal(await page.evaluate(() => window.__qtsGetJdReview.draftAvailable()), false);

    // After Check: the panel follows the job (checking, then the result) and shows it again on request.
    const checked = (extra) => page.evaluate((extra) => window.__qtsGetJdReview.applyResult({
      runId: 'checked-run', pageUrl: location.href, evaluationMode: 'gemini', fromDraft: true, pageOnly: true,
      draftJob: { jobUrl: location.href, title: 'Software Engineer', company: 'Example', description: 'Build Python services.' },
      ...extra,
    }), extra);
    const headline = () => page.evaluate(() => window.testRoot.querySelector('.review-title strong').textContent);
    const visibleButtons = () => page.evaluate(() => [...window.testRoot.querySelectorAll('.actions button')].filter((b) => !b.hidden).map((b) => b.textContent));
    await draft({ runId: 'checked-run' });
    await checked({ status: 'processing', message: 'Checking this job with Gemini…' });
    assert.equal(await docked(), true, 'the panel stays open while Gemini checks');
    assert.equal(await headline(), 'Checking with Gemini…');
    assert.deepEqual(await visibleButtons(), ['Close']);
    await click('Close');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-qts-get-jd-docked') !== 'true');
    await checked({ status: 'complete', message: 'Saved.', autoSavedProfileIds: ['a'], classification: { isJobPage: true, isRemote: true, job: { title: 'Software Engineer', company: 'Example', reason: 'Remote Python role.' } },
      profiles: [{ id: 'a', name: 'Alice', autoSaved: true }, { id: 'b', name: 'Bob', autoSaved: false }] });
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-qts-get-jd-docked')), null, 'a hidden panel stays hidden when the result arrives');
    assert.equal(await page.evaluate(() => window.__qtsGetJdReview.checkedAvailable()), true);
    await page.evaluate(() => window.__qtsGetJdReview.openReview());
    assert.equal(await docked(), true, 'the result is shown again on request');
    assert.equal(await headline(), 'Saved for 1 candidate');
    const mark = () => page.evaluate(() => {
      const link = document.querySelector('link[data-qts-tab-mark]');
      return link ? [link.dataset.qtsTabMark, link.rel, /fill%3D%22(%23[0-9a-f]+)/i.exec(link.href)?.[1]] : null;
    });
    assert.deepEqual(await mark(), ['saved', 'icon', '%232563eb'], 'saved: a blue circle on the tab');
    assert.equal(await page.evaluate(() => document.querySelector('link[rel="qts-hidden-icon"]')?.dataset.qtsIconRel), 'icon', 'the page icon steps aside');
    assert.match(await page.evaluate(() => window.testRoot.querySelector('.details').textContent), /Alice/);
    assert.deepEqual(await visibleButtons(), ['Close'], 'a saved job is not checked again');
    // The worker closes the tab 5 seconds after a successful check; the panel counts down.
    await checked({ status: 'complete', closesAt: Date.now() + 5000, classification: { isJobPage: true, isRemote: true, job: {} }, profiles: [{ id: 'a', name: 'Alice', autoSaved: true }] });
    assert.match(await page.evaluate(() => window.testRoot.querySelector('.review-title span').textContent), /^Closing this tab in [45] seconds.$/);

    // A check that saved nothing can be edited and checked again.
    // Circles only on known jobs: red for a job not saved; none when the page is not a job or the
    // check failed or stopped.
    const red = ['other', 'icon', '%23dc2626'];
    await checked({ status: 'complete', classification: { isJobPage: true, isRemote: true, job: {} }, autoSavedProfileIds: [], profiles: [] });
    assert.deepEqual(await mark(), red, 'a job with no matching candidate: red');
    await checked({ status: 'error', message: 'Not eligible: on-site.', classification: { isJobPage: true, isRemote: false, job: { reason: 'On-site.' } } });
    assert.deepEqual(await mark(), red, 'a job that is not eligible: red');
    await checked({ status: 'duplicate', message: 'This job already exists in QTS Jobs or Bids. Skipped.' });
    assert.deepEqual(await mark(), red, 'a job already in QTS: red');
    await checked({ status: 'error', message: 'Gemini candidate matching failed.' });
    assert.equal(await mark(), null, 'an error says nothing about the page: no circle');
    await checked({ status: 'cancelled', message: 'Checking stopped.' });
    assert.equal(await mark(), null, 'a stopped check: no circle');
    await checked({ status: 'error', message: 'Not a valid job page: a list.', classification: { isJobPage: false, isRemote: false, job: { reason: 'A list of jobs.' } } });
    assert.equal(await headline(), 'Not a job page');
    assert.equal(await mark(), null, 'not a job page: no circle');
    assert.deepEqual(await visibleButtons(), ['Edit and check again', 'Close']);
    await click('Edit and check again');
    await page.waitForFunction(() => window.calls.at(-1)?.type === 'QTS_GET_JD_RESTORE_DRAFT');
    // Checking again: the circle goes and the page's own icon is back.
    await draft({ runId: 'checked-run', pageOnly: true });
    assert.equal(await mark(), null);
    assert.equal(await page.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute('href')), '/page-icon.png');
  } finally {
    await browser.close();
  }
});
