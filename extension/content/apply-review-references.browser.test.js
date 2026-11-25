// The Auto Apply panel's copy tools in real Chrome (Answer, Profile, Path, Saved); synthetic data,
// mocked clipboard, runtime and storage only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));

test('Answer copies the résumé, the empty questions and the Manager\'s text; Profile and Path copy one item each; one box at a time; nothing is filled or sent', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form><label>Notice period<input id="notice"></label><label>Why us? *<textarea id="why" required></textarea></label><label>Name<input id="name" value="Ana"></label><button type="submit">Submit</button></form>');
    await page.evaluate(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
      window.sent = []; window.copied = []; window.stored = {};
      window.chrome = { runtime: { id: 'synthetic-extension', sendMessage: async m => { window.sent.push(m); return { ok: true }; } },
        storage: { local: { get: async () => ({ ...window.stored }), set: async (values) => { Object.assign(window.stored, JSON.parse(JSON.stringify(values))); } } } };
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied.push(text); } } });
      // The page's form, as the form engine reads it: Name answered, the other two empty.
      window.__qtsApplyForm = {
        scanForm: () => [{ id: 'notice', label: 'Notice period', kind: 'text' }, { id: 'why', label: 'Why us? *', kind: 'textarea', required: true }, { id: 'name', label: 'Name', kind: 'text' }],
        isUnanswered: (field) => !document.getElementById(field.id).value,
        focusField() {},
      };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, 'apply-review.js') });
    const state = { auto: true, attemptId: 'synthetic-attempt', mode: 'review', final: true, candidate: 'Ana Test',
      job: { id: 'job-1', title: 'Engineer', company: 'Example' }, resumeFolder: 'QTS_Resume/Ana/', answers: [], unresolved: [], provisional: [],
      references: { profile: { firstName: 'Ana', lastName: 'Test', email: 'ana@example.com', city: 'Cluj-Napoca', country: 'Romania', linkedinUrl: 'linkedin.com/in/ana-test' },
        experiences: [], educations: [], reusable: [{ question: 'Notice period?', answer: 'Immediately' }],
        sitePassword: 'S3cret!pass', resumeText: 'Ana Test\nPython engineer', coverLetterText: 'Dear Manager,\nComplete letter.' } };
    const render = next => page.evaluate(s => window.__qtsApplyReview.render(s), next);
    const shadow = (fn, ...args) => page.evaluate(fn, ...args);
    const click = (selector, text) => page.evaluate((s, t) => {
      const root = document.querySelector('[data-qts-apply-review]').shadowRoot;
      const node = [...root.querySelectorAll(s)].find(n => !t || n.textContent.includes(t));
      if (!node) throw Error(`Missing ${s}: ${t}`);
      node.click();
    }, selector, text);
    const has = (selector) => shadow(s => Boolean(document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector(s)), selector);
    await render(state);
    // The old "Profile, documents & reusable answers" section is gone; the buttons: Answer, Profile, Path, Saved (Letter was removed 2026-11-19).
    assert.equal(await has('.references'), false);
    assert.deepEqual(await shadow(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.copy-row .copy-button')].map(n => n.textContent)), ['💬 Answer', '👤 Profile', '📁 Path', '⭐ Saved']);

    // Answer: one copy — the résumé, then the empty questions (optional ones too), then the text.
    const defaultText = 'this is my resume. i wanna make answer to fill for compleing job apply.\nmake answer within 3 - 4 sentences if should explain something, or simply if require simple answer.\nnot require evidence or verified information. answers must be shown high senior level enginer experience to match the job highly.';
    await click('.copy-button', '💬 Answer');
    await page.waitForFunction(() => window.copied.length === 1);
    assert.equal(await shadow(() => window.copied[0]), `Ana Test\nPython engineer\n\nNotice period:\nWhy us?:\n\n${defaultText}`);
    assert.equal(await has('.answer-box'), true, 'the box opens');
    // The Manager edits the questions (this job only) and the text (remembered); Copy again uses both.
    const typeInto = (key, value) => shadow((k, v) => { const box = document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector(`[data-keep="${k}"]`); box.value = v; box.dispatchEvent(new Event('input', { bubbles: true, composed: true })); }, key, value);
    await typeInto('answer-questions', 'Notice period:\nWhy Example?:');
    await typeInto('answer-text', 'Answer as a senior engineer.');
    await click('.answer-copy', 'Copy again');
    await page.waitForFunction(() => window.copied.length === 2);
    assert.equal(await shadow(() => window.copied[1]), 'Ana Test\nPython engineer\n\nNotice period:\nWhy Example?:\n\nAnswer as a senior engineer.');
    await page.waitForFunction(() => window.stored.qtsPanelTexts?.answerText === 'Answer as a senior engineer.');
    // A render keeps the edited questions for this job; another job reads its own page again.
    await render({ ...state, step: 2 });
    assert.equal(await shadow(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('[data-keep="answer-questions"]').value), 'Notice period:\nWhy Example?:');
    await render({ ...state, job: { ...state.job, id: 'job-2' } });
    assert.equal(await shadow(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('[data-keep="answer-questions"]').value), 'Notice period:\nWhy us?:', 'questions are never kept for another job');
    assert.equal(await shadow(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('[data-keep="answer-text"]').value), 'Answer as a senior engineer.', 'the text is remembered');

    // One box at a time: Profile closes Answer.
    await click('.copy-button', '👤 Profile');
    assert.deepEqual([await has('.answer-box'), await has('.profile-box')], [false, true]);
    const rows = await shadow(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.profile-box .profile-row')].map(n => `${n.querySelector('.profile-label').textContent} = ${n.querySelector('.profile-value, .profile-input')?.value ?? n.querySelector('.profile-value').textContent}`));
    // Name and Address: values only (no labels): the whole line, then each part on its own (no province here).
    const address = await shadow(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.profile-box .address-line')].map(line => [...line.querySelectorAll('.address-chip')].map(n => n.textContent)));
    // (Name first, the same way: full name, then first | last.)
    assert.deepEqual(address.slice(0, 4), [['Ana Test'], ['Ana', 'Test'], ['Cluj-Napoca, Romania'], ['Cluj-Napoca', 'Romania']]);
    assert.ok(rows.includes('LinkedIn = https://www.linkedin.com/in/ana-test'), 'LinkedIn with https://www.');
    assert.ok(rows.includes('Per month = 6000 EUR per month') && rows.includes('Per year = 60000 - 70000 EUR per year'), rows.join(' / '));
    await click('.address-chip', 'Cluj-Napoca, Romania');
    await click('.profile-row', 'LinkedIn');
    await page.waitForFunction(() => window.copied.length === 4);
    assert.deepEqual(await shadow(() => window.copied.slice(2)), ['Cluj-Napoca, Romania', 'https://www.linkedin.com/in/ana-test']);
    // Salary lines: edited in place, remembered, each copied by itself.
    await typeInto('salary-salaryMonth', '6500 EUR per month');
    await shadow(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.salary-row')][0].querySelector('.profile-copy-button').click());
    await click('.salary-row:nth-of-type(n) .profile-copy-button');
    await page.waitForFunction(() => window.copied.length === 6);
    assert.equal(await shadow(() => window.copied[4]), '6500 EUR per month');
    await page.waitForFunction(() => window.stored.qtsPanelTexts?.salaryMonth === '6500 EUR per month');

    // Account: the job-site password, masked on screen; a click copies it in full.
    const shown = await shadow(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.password-row').textContent);
    assert.ok(shown.startsWith('Password••••') && !shown.includes('S3cret'), shown);
    await click('.password-row');
    await page.waitForFunction(() => window.copied.at(-1) === 'S3cret!pass');
    // Path closes Profile.
    await click('.copy-button', '📁 Path');
    assert.deepEqual([await has('.profile-box'), await has('.career')], [false, true]);

    // Nothing on the form is touched; nothing is proposed or submitted.
    assert.equal(await page.$eval('#notice', n => n.value), '', 'copy never fills the site');
    assert.deepEqual(await page.evaluate(() => window.sent.filter((message) => message.action !== 'ui_state')), []);
    await render({ ...state, auto: false });
    assert.equal(await has('.copy-row'), false, 'Normal Apply unchanged');
  } finally { await browser.close(); }
});
