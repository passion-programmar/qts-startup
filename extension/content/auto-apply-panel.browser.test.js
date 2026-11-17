// Compare the unchanged launcher header with the Auto Apply sidebar in real Chrome.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));

test('Auto Apply uses the same branding in a full-height sidebar with complete review content and controls', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
    await page.setContent('<form><label>Example question<input value="Unchanged candidate answer"></label></form>');
    const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../assets/account-logo.png')).toString('base64');
    await page.evaluate(logo => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
      const stored = { authToken: 'synthetic', authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'manager', role: 'manager' } };
      window.sent = [];
      window.chrome = { runtime: { id: 'synthetic-extension', getURL: () => logo, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async m => {
        if (m.type === 'QTS_GET_LAUNCHER_STATE') return { active: true };
        if (m.type === 'CHECK_EXTENSION_PAGE_ALLOWED') return { ok: true, excluded: false };
        if (m.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, features: {} };
        window.sent.push(m); return { ok: true };
      } }, storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, stored[k]])) }, onChanged: { addListener() {}, removeListener() {} } } };
      window.headerSnapshot = root => {
        // The Auto Apply panel's own [▴] (make it small) is beside the same hide button; the branding is compared without it.
        const brand = root.querySelector('.brand'), img = brand.querySelector('img'), button = [...brand.querySelectorAll('button')].find(n => n.textContent === '›') || brand.querySelector('button');
        const style = getComputedStyle(brand);
        return { text: brand.textContent.replace('▴', '').replace('🗑', ''), height: brand.getBoundingClientRect().height, background: style.backgroundColor, padding: style.padding,
          logo: [img.src, img.alt, img.width, img.height, getComputedStyle(img).borderRadius],
          pills: [...brand.querySelectorAll('.pill')].map(n => [n.textContent, getComputedStyle(n).color, getComputedStyle(n).fontSize]),
          subline: [brand.querySelector('.subline').textContent, getComputedStyle(brand.querySelector('.subline')).fontSize],
          arrow: [button.textContent, button.offsetWidth, button.offsetHeight] };
      };
    }, logo);
    await page.addScriptTag({ path: path.join(__dirname, 'page-launcher.js') });
    await page.waitForFunction(() => window.__qtsPageLauncher);
    await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
    const expectedHeader = await page.evaluate(() => window.headerSnapshot(document.querySelector('[data-qts-page-launcher]').shadowRoot));
    await page.addScriptTag({ path: path.join(__dirname, 'apply-review.js') });
    const longAnswer = 'Complete engineering implementation details, preserved without truncation. '.repeat(35);
    const state = { auto: true, attemptId: 'synthetic', mode: 'review', final: true, chromeName: 'Test Chrome', candidate: 'Sample Candidate',
      job: { title: 'Staff Platform Engineer', company: 'Example', url: 'https://jobs.example.test/engineering', location: 'Remote' },
      resumeFolder: 'QTS_Resume/Sample Candidate', resumeFolderPath: String.raw`C:\Users\sample\Downloads\QTS_Resume\Sample Candidate`,
      candidateName: 'Sample Candidate', candidateLabel: 'DevOps/SRE', promptName: 'Manager prompt', templateName: 'QTS Template 8',
      problems: [], unresolved: [], provisional: [],
      checklist: { items: [], totals: { verified: 12, optional_empty: 11 } },
      answers: [{ question: 'Describe your engineering work', answer: longAnswer, source: 'manager', step: 1 }],
      references: { profile: { firstName: 'Sample', city: 'Example City' }, reusable: [{ question: 'Notice period', answer: 'Immediately' }], resumeText: 'Complete saved résumé.', coverLetterText: 'Complete saved letter.' } };
    await page.evaluate(state => window.__qtsApplyReview.render(state), state);
    await page.waitForFunction(() => getComputedStyle(document.body).paddingRight === '480px');
    const actual = await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-review]').shadowRoot, panel = root.querySelector('.panel'), body = root.querySelector('.body'), answer = root.querySelector('.answer .a');
      const rect = panel.getBoundingClientRect(), head = root.querySelector('.brand').getBoundingClientRect(), foot = root.querySelector('.foot').getBoundingClientRect();
      return { header: window.headerSnapshot(root), rect: { top: rect.top, right: rect.right, height: rect.height, width: rect.width },
        text: panel.textContent, answer: answer.textContent, answerMaxHeight: getComputedStyle(answer).maxHeight,
        scrollable: body.scrollHeight > body.clientHeight, footerFits: foot.bottom <= innerHeight && foot.top >= head.bottom,
        padding: getComputedStyle(document.body).paddingRight, buttons: [...root.querySelectorAll('.foot button')].map(n => n.textContent) };
    });
    assert.deepEqual(actual.header, expectedHeader, 'the red-rectangle branding stays identical');
    assert.ok(await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.brand button')].some(n => n.textContent === '▴')), 'the panel has [▴] to make it small');
    assert.deepEqual(actual.rect, { top: 0, right: 1280, height: 900, width: 480 });
    assert.equal(actual.padding, '480px', 'the sidebar makes room rather than covering the form');
    assert.equal(actual.answer, longAnswer); assert.equal(actual.answerMaxHeight, 'none');
    assert.equal(actual.scrollable, true); assert.equal(actual.footerFits, true);
    for (const text of ['Sample Candidate', 'DevOps/SRE', 'Staff Platform Engineer — Example', String.raw`📁 C:\Users\sample\Downloads\QTS_Resume\Sample Candidate`, 'Nothing needs you', 'Profile, documents & reusable answers']) assert.ok(actual.text.includes(text), text);
    // The top shows only the candidate, the job and the folder: no step title, Chrome name, place, link, prompt or template.
    for (const text of ['Review, then Submit', 'Test Chrome', 'Remote', 'https://jobs.example.test', 'Manager prompt', 'QTS Template 8']) assert.equal(actual.text.includes(text), false, text);
    const sizes = await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-review]').shadowRoot;
      const size = (selector) => parseFloat(getComputedStyle(root.querySelector(selector)).fontSize);
      return { name: size('.who-name'), label: size('.who-label'), title: size('.job-title'), folder: size('.folder') };
    });
    assert.ok(sizes.name > sizes.title && sizes.label > sizes.title && sizes.label > sizes.folder, JSON.stringify(sizes));
    // Submitted is always there and never greyed out; no Ask AI while the AI is off.
    assert.deepEqual(actual.buttons, ['Submitted', 'Check', 'Skip', 'Later', 'Fill again']);
    assert.equal(actual.text.includes('Submitted saves the bid at any time.'), true);
    assert.equal(actual.text.includes('Select account'), false, 'launcher menus do not populate the Auto Apply panel');
    await page.evaluate(() => {
      window.__qtsApplyForm = { currentAnswers: () => [{ id: 'city', label: 'City', value: 'Example City', kind: 'text', options: [] }] };
      [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.foot button')].find(button => button.textContent === 'Check').click();
    });
    const check = await page.evaluate(() => window.sent.find(message => message.action === 'recheck'));
    assert.equal(check.manualCheck, true);
    assert.equal(check.answers[0].value, 'Example City');
    await page.evaluate(state => window.__qtsApplyReview.render({ ...state, savedChanges: [
      { id: 'saved', question: 'Additional details', answer: 'Contact me for details', scope: 'application', canReuse: true },
      { id: 'candidate', question: 'City', answer: 'Example City', scope: 'candidate' },
    ] }), state);
    const savedText = await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.textContent);
    assert.match(savedText, /Saved changes/); assert.match(savedText, /Context uncertain/); assert.match(savedText, /This candidate/);
    await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('button')].find(button => button.textContent === 'Move to my reusable answers').click());
    assert.equal(await page.evaluate(() => window.sent.find(message => message.action === 'reuse_answer').answerId), 'saved');
    await page.evaluate(state => window.__qtsApplyReview.render(state), state);
    await page.evaluate(() => {
      const body = document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.body'); body.scrollTop = 100;
    });
    await page.evaluate(state => window.__qtsApplyReview.render(state), state);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.body').scrollTop), 100);
    await page.evaluate(() => { document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.body').scrollTop = 0; });
    // Right under the folder: Copy Resume and Copy Cover Letter on one line; the page's required
    // questions with the candidate's answer, Copy and Fill; the folder button asks the worker.
    await page.evaluate(() => {
      window.clipboard = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.clipboard.push(text); } } });
      window.__qtsApplyForm = { ...window.__qtsApplyForm, isUnanswered: field => field.id !== 'email', focusField() {} };
    });
    await page.evaluate(state => window.__qtsApplyReview.render({ ...state, aiOn: true, aiName: 'Gemini', requiredRows: [
      { fieldId: 'email', label: 'Email', kind: 'text', value: 'sample@example.test' },
      { fieldId: 'phone', label: 'Phone', kind: 'text', value: '+40 700 000 000' },
      { fieldId: 'visa', label: 'Do you need a visa?', kind: 'select', value: '' },
    ] }), state);
    const extra = await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-review]').shadowRoot;
      const job = root.querySelector('.job');
      const copies = [...job.querySelectorAll('.copy-row .copy-button')];
      return {
        copies: copies.map(n => n.textContent), oneLine: copies.length === 2 && copies[0].getBoundingClientRect().top === copies[1].getBoundingClientRect().top,
        afterFolder: job.querySelector('.folder').compareDocumentPosition(job.querySelector('.copy-row')) & Node.DOCUMENT_POSITION_FOLLOWING,
        rows: [...root.querySelectorAll('.required-row')].map(row => [row.querySelector('.required-label').textContent, row.querySelector('.required-value').textContent, ...[...row.querySelectorAll('button')].map(b => b.disabled ? b.textContent + ' (off)' : b.textContent)]),
        buttons: [...root.querySelectorAll('.foot button')].map(n => n.textContent),
      };
    });
    assert.deepEqual(extra.copies, ['Copy Resume', 'Copy Cover Letter']);
    assert.ok(extra.oneLine, 'both copy buttons on one line');
    assert.ok(extra.afterFolder, 'the copy line comes after the folder');
    assert.deepEqual(extra.rows, [
      ['✓ Email', 'sample@example.test', 'Copy', 'Fill'],
      ['Phone', '+40 700 000 000', 'Copy', 'Fill'],
      ['Do you need a visa?', 'Not in the profile', 'Copy (off)', 'Fill (off)'],
    ]);
    assert.deepEqual(extra.buttons, ['Submitted', 'Ask Gemini', 'Check', 'Skip', 'Later', 'Fill again']);
    const click = (selector, text) => page.evaluate((selector, text) => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll(selector)].find(n => n.textContent === text).click(), selector, text);
    await click('.copy-button', 'Copy Resume');
    await click('.copy-button', 'Copy Cover Letter');
    await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.required-row')][1].querySelector('button').click());
    await page.waitForFunction(() => window.clipboard.length === 3);
    assert.deepEqual(await page.evaluate(() => window.clipboard), ['Complete saved résumé.', 'Complete saved letter.', '+40 700 000 000']);
    await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.required-row')][1].querySelectorAll('button')[1].click());
    await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.folder').click());
    await page.waitForFunction(() => window.sent.some(m => m.action === 'fill_field') && window.clipboard.length === 4);
    // The folder button copies its full path; nothing opens.
    assert.equal(await page.evaluate(() => window.clipboard[3]), String.raw`C:\Users\sample\Downloads\QTS_Resume\Sample Candidate`);
    assert.equal(await page.evaluate(() => window.sent.some(m => m.action === 'open_folder')), false);
    assert.equal(await page.evaluate(() => window.sent.find(m => m.action === 'fill_field').fieldId), 'phone');
    await click('.foot button', 'Ask Gemini');
    await page.waitForFunction(() => window.sent.some(m => m.action === 'ask_ai'));
    // While QTS works, Submitted is still there and sends the form's answers.
    await page.evaluate(state => window.__qtsApplyReview.render({ ...state, mode: 'working', workingText: 'Filling step 2…' }), state);
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.foot button')].map(n => [n.textContent, n.disabled])), [['Submitted', false]]);
    await click('.foot button', 'Submitted');
    await page.waitForFunction(() => window.sent.some(m => m.action === 'submitted'));
    assert.equal(await page.evaluate(() => window.sent.find(m => m.action === 'submitted').answers[0].value), 'Example City');
    await page.evaluate(state => window.__qtsApplyReview.render(state), state);
    fs.mkdirSync('.pdf-verification', { recursive: true });
    await page.screenshot({ path: '.pdf-verification/auto-apply-sidebar-preview.png' });
    await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.hide').click());
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.panel').hidden), true);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-qts-apply-docked')), false);
    await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.review-tab').click());
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.panel').hidden), false);
    assert.equal(await page.$eval('input', n => n.value), 'Unchanged candidate answer');
    await page.evaluate(() => window.__qtsApplyReview.remove());
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-auto-apply-dock]')), null);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-qts-apply-docked')), false);
  } finally { await browser.close(); }
});
