// Read-only Auto Apply references in real Chrome; synthetic data and mocked clipboard/runtime only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));

test('Auto Apply reference cards copy complete saved values without filling, proposing or submitting', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form><label>Notice period<input id="notice"></label><button type="submit">Submit</button></form>');
    await page.evaluate(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
      window.sent = []; window.copied = [];
      window.chrome = { runtime: { id: 'synthetic-extension', sendMessage: async m => { window.sent.push(m); return { ok: true }; } } };
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { if (window.failCopy) throw Error('Clipboard unavailable'); window.copied.push(text); } } });
      document.execCommand = () => false;
    });
    await page.addScriptTag({ path: path.resolve(__dirname, 'apply-review.js') });
    const resume = 'Ana Test\nPython engineer — résumé\n' + 'Complete engineering detail. '.repeat(45);
    const state = { auto: true, attemptId: 'synthetic-attempt', mode: 'review', final: true, chromeName: 'Test Chrome', candidate: 'Ana Test',
      job: { title: 'Engineer', company: 'Example' }, answers: [], unresolved: [], provisional: [],
      references: { profile: { firstName: 'Ana', email: 'ana@example.com', city: 'Cluj-Napoca' },
        experiences: [{ jobTitle: 'Engineer', companyName: 'Example Labs', startDate: '2020-01', isCurrent: true, description: 'Built Python services.' }],
        educations: [{ institution: 'Example University', degree: 'BSc', fieldOfStudy: 'Computer Science', startDate: '2016-09', endDate: '2019-06' }],
        reusable: [{ question: 'Notice period?', answer: 'Immediately', note: 'Use the closest offered choice.' }, { question: 'Do you accept the terms?', answer: 'true' }],
        resumeText: resume, coverLetterText: 'Dear Manager,\nComplete letter.', jobDescription: 'Python and Kubernetes.' } };
    const render = next => page.evaluate(s => window.__qtsApplyReview.render(s), next);
    const click = (selector, text) => page.evaluate((s, t) => {
      const root = document.querySelector('[data-qts-apply-review]').shadowRoot;
      const node = [...root.querySelectorAll(s)].find(n => !t || n.textContent.includes(t));
      if (!node) throw Error(`Missing ${s}: ${t}`);
      node.click();
    }, selector, text);
    await render(state);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.references').open), false);
    await click('.references > summary'); await click('[data-reference="reusable"] > summary');
    await click('[data-reference="reusable"] .reference-item', 'Notice period?');
    await page.waitForFunction(() => window.copied.length === 1);
    assert.deepEqual(await page.evaluate(() => window.copied), ['Immediately']);
    assert.equal(await page.$eval('#notice', n => n.value), '', 'copy never overwrites the site');
    assert.deepEqual(await page.evaluate(() => window.sent), [], 'copy never proposes or submits');
    await render({ ...state, step: 2 });
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('[data-reference="reusable"]').open), true, 'rechecks preserve expanded references');
    for (const [section, label, expected] of [['profile', 'City', 'Cluj-Napoca'], ['experience', 'Engineer', 'Built Python services.'], ['education', 'Example University', 'Computer Science'], ['documents', 'Résumé', resume], ['documents', 'Cover letter', 'Complete letter.']]) {
      await click(`[data-reference="${section}"] .reference-item`, label);
      await page.waitForFunction(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.copy-status').textContent.startsWith('Copied:'));
      const copied = await page.evaluate(() => window.copied.at(-1));
      if (section === 'documents' && label === 'Résumé') assert.equal(copied, expected, 'full Unicode résumé preserved');
      else assert.ok(copied.includes(expected));
    }
    await page.evaluate(() => { window.failCopy = true; });
    await click('[data-reference="reusable"] .reference-item', 'Notice period?');
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.copy-status').textContent.includes('Could not copy'));
    assert.equal(await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('button')].some(button => button.textContent === 'Propose my changes')), false, 'Check replaces the approval proposal flow');
    await render({ ...state, references: {} });
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.reference-item').length), 0, 'new empty data cannot retain old candidate values');
    await render({ ...state, auto: false });
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.references'))), false, 'other review modes unchanged');
  } finally { await browser.close(); }
});
