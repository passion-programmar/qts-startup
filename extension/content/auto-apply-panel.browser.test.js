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
        const brand = root.querySelector('.brand'), img = brand.querySelector('img'), button = brand.querySelector('button');
        const style = getComputedStyle(brand);
        return { text: brand.textContent, height: brand.getBoundingClientRect().height, background: style.backgroundColor, padding: style.padding,
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
      resumeFolder: 'QTS_Resume/Sample Candidate', promptName: 'Manager prompt', templateName: 'QTS Template 8',
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
    assert.deepEqual(actual.rect, { top: 0, right: 1280, height: 900, width: 480 });
    assert.equal(actual.padding, '480px', 'the sidebar makes room rather than covering the form');
    assert.equal(actual.answer, longAnswer); assert.equal(actual.answerMaxHeight, 'none');
    assert.equal(actual.scrollable, true); assert.equal(actual.footerFits, true);
    for (const text of ['Review, then Submit', 'Sample Candidate', 'Staff Platform Engineer', 'Nothing blocks Submit', 'Profile, documents & reusable answers']) assert.ok(actual.text.includes(text), text);
    assert.deepEqual(actual.buttons, ['I submitted it', 'Check again', 'Skip', 'Later', 'Fill again', 'Propose my changes']);
    assert.equal(actual.text.includes('Select account'), false, 'launcher menus do not populate the Auto Apply panel');
    await page.evaluate(() => {
      const body = document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.body'); body.scrollTop = 100;
    });
    await page.evaluate(state => window.__qtsApplyReview.render(state), state);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.body').scrollTop), 100);
    await page.evaluate(() => { document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.body').scrollTop = 0; });
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
