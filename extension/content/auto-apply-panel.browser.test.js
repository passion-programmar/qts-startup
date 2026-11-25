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
    await page.waitForFunction(() => getComputedStyle(document.body).paddingRight === '384px');
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
    assert.deepEqual(actual.rect, { top: 0, right: 1280, height: 900, width: 384 });
    assert.equal(actual.padding, '384px', 'the sidebar (as wide as the QTS panel) makes room rather than covering the form');
    assert.equal(actual.answer, longAnswer); assert.equal(actual.answerMaxHeight, 'none');
    assert.equal(actual.scrollable, true); assert.equal(actual.footerFits, true);
    for (const text of ['Sample Candidate', 'DevOps/SRE', 'Staff Platform Engineer — Example', '📁 Path', 'Nothing needs you']) assert.ok(actual.text.includes(text), text);
    assert.equal(actual.text.includes('Profile, documents & reusable answers'), false, 'the old reference section is gone');
    // The top shows only the candidate, the job and the folder: no step title, Chrome name, place, link, prompt or template.
    for (const text of ['Review, then Submit', 'Test Chrome', 'Remote', 'https://jobs.example.test', 'Manager prompt', 'QTS Template 8']) assert.equal(actual.text.includes(text), false, text);
    const sizes = await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-review]').shadowRoot;
      const size = (selector) => parseFloat(getComputedStyle(root.querySelector(selector)).fontSize);
      return { name: size('.who-name'), label: size('.who-label'), title: size('.job-title'), folder: size('.folder-copy') };
    });
    assert.ok(sizes.name > sizes.title && sizes.label > sizes.title && sizes.label > sizes.folder, JSON.stringify(sizes));
    // Submitted is always there and never greyed out; no Ask AI while the AI is off.
    assert.deepEqual(actual.buttons, ['Submitted', 'Check', 'Skip', 'Later', 'Fill again', 'Save for this site']);
    assert.equal(actual.text.includes('Submitted saves the bid at any time.'), false, 'no description above the buttons');
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
    // One line under the job: Copy Resume, the folder's Copy Path, Copy Cover Letter (no long path line); the page's required
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
      const copies = [...root.querySelectorAll('.copy-row .copy-button')];
      return {
        copies: copies.map(n => n.textContent), oneLine: copies.length === 4 && copies.every(n => n.getBoundingClientRect().top === copies[0].getBoundingClientRect().top),
        noPathLine: !job.querySelector('.folder'), pathTitle: root.querySelector('.folder-copy').title,
        rows: [...root.querySelectorAll('.required-row')].map(row => [row.querySelector('.required-label').textContent, row.querySelector('.required-value').textContent, ...[...row.querySelectorAll('button')].map(b => b.disabled ? b.textContent + ' (off)' : b.textContent)]),
        buttons: [...root.querySelectorAll('.foot button')].map(n => n.textContent),
      };
    });
    assert.deepEqual(extra.copies, ['💬 Answer', '👤 Profile', '📁 Path', '⭐ Saved']);
    assert.ok(extra.oneLine, 'the four buttons on one line');
    assert.ok(extra.noPathLine, 'no long folder path line');
    assert.match(extra.pathTitle, /Sample Candidate/, 'the full path shows on hover');
    // Only the boxes still empty are listed (Email is filled on the form).
    assert.deepEqual(extra.rows, [
      ['Phone', '+40 700 000 000', 'Copy', 'Fill'],
      ['Do you need a visa?', 'Not in the profile', 'Copy (off)', 'Fill (off)'],
    ]);
    // (Ask AI is the Manager's Alt+A and in the Alt+S menu: no button.)
    assert.deepEqual(extra.buttons, ['Submitted', 'Check', 'Skip', 'Later', 'Fill again', 'Save for this site']);
    const click = (selector, text) => page.evaluate((selector, text) => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll(selector)].find(n => n.textContent === text).click(), selector, text);
    // (Letter was removed 2026-11-19; Saved took its place.)
    await click('.copy-button', '💬 Answer');
    await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.required-row')][0].querySelector('button').click());
    await page.waitForFunction(() => window.clipboard.length === 2);
    const copied = await page.evaluate(() => window.clipboard);
    assert.ok(copied[0].startsWith('Complete saved résumé.\n\n'), 'Answer: the résumé first, then the questions and the text');
    assert.deepEqual(copied.slice(1), ['+40 700 000 000']);
    await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.required-row')][0].querySelectorAll('button')[1].click());
    await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.folder-copy').click());
    await page.waitForFunction(() => window.sent.some(m => m.action === 'fill_field') && window.clipboard.length === 3);
    // The folder button copies its full path; nothing opens.
    assert.equal(await page.evaluate(() => window.clipboard[2]), String.raw`C:\Users\sample\Downloads\QTS_Resume\Sample Candidate`);
    assert.equal(await page.evaluate(() => window.sent.some(m => m.action === 'open_folder')), false);
    assert.equal(await page.evaluate(() => window.sent.find(m => m.action === 'fill_field').fieldId), 'phone');
    // Copy Path also opened the career box: each job (company, title, dates, the résumé's full
    // bullets), education, the profile links; every piece copies with one click; Hide closes it.
    await page.evaluate(state => window.__qtsApplyReview.render({ ...state, references: { ...state.references,
      profile: { firstName: 'Sample', linkedinUrl: 'https://linkedin.example/in/sample', githubUrl: 'https://github.example/sample' },
      experiences: [
        { companyName: 'Acme', jobTitle: 'SRE Lead', location: 'Bucharest, Romania', startDate: '2021-03-01', isCurrent: true, description: 'Profile text' },
        { companyName: 'Globex', jobTitle: 'DevOps Engineer', startDate: '2018-01-01', endDate: '2021-02-01', description: 'Globex profile text' },
      ],
      educations: [{ institution: 'Example University', degree: 'BSc', fieldOfStudy: 'Computer Science', startDate: '2014-09-01', endDate: '2018-06-01' }],
      resumeText: 'Sample\n\nSRE Lead · Acme · Remote · 2021 – Present\n- Cut deploy time by 60%\n- Led on-call\n\nOther Co · Somewhere\n- Not this job',
    } }), state);
    const career = await page.evaluate(() => {
      const box = document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.career');
      return box && [...box.querySelectorAll('.career-head, .career-item, .career > .career-line')].map(n => n.classList.contains('career-head') ? `# ${n.firstChild.textContent}` : [...n.querySelectorAll('.chip')].map(b => b.classList.contains('bullets') ? `Bullets[${b.title}]` : b.textContent).join(' | '));
    });
    // Each job: company, title, dates, and one small Bullets button (hover shows its bullets).
    assert.deepEqual(career, [
      '# Experience',
      'Acme | SRE Lead | 03/2021 – Present | Bucharest, Romania | Bullets[• Cut deploy time by 60%\n• Led on-call]',
      'Globex | DevOps Engineer | 01/2018 – 02/2021 | Bullets[Globex profile text]',
      '# Education',
      'Example University | BSc | Computer Science | 09/2014 – 06/2018',
      '# Profiles',
      'LinkedIn: https://www.linkedin.example/in/sample | GitHub: https://github.example/sample',
    ]);
    await click('.chip', 'SRE Lead');
    // One Bullets button per job copies all that job's bullets (the first is Acme's).
    await click('.chip', 'Bullets');
    await click('.chip', 'LinkedIn: https://www.linkedin.example/in/sample');
    await page.waitForFunction(() => window.clipboard.length === 6);
    assert.deepEqual(await page.evaluate(() => window.clipboard.slice(3)), ['SRE Lead', '• Cut deploy time by 60%\n• Led on-call', 'https://www.linkedin.example/in/sample']);
    // Copy Path is a toggle: lit while open; a click copies the path again and closes the box.
    const careerShown = () => page.evaluate(() => Boolean(document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.career')));
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.folder-copy').getAttribute('aria-pressed')), 'true');
    await click('.copy-button', '📁 Path');
    assert.equal(await careerShown(), false, 'the second click closes the box');
    await page.waitForFunction(() => window.clipboard.length === 7);
    await click('.copy-button', '📁 Path');
    assert.equal(await careerShown(), true, 'the third click opens it again');
    await click('.career-head button', 'Hide ✕');
    assert.equal(await careerShown(), false, 'Hide closes the box');
    // Each job card: company, title on the first row; dates, Bullets on the second.
    await click('.copy-button', '📁 Path');
    const rows = await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.career-item').querySelectorAll('.career-line')].map(line => [...line.querySelectorAll('.chip')].map(n => n.textContent).join(' | ')));
    assert.deepEqual(rows, ['Acme | SRE Lead', '03/2021 – Present | Bucharest, Romania | Bullets']);
    // The button line is sticky: scrolled to the bottom, it is still at the top of the panel.
    const pinned = await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-review]').shadowRoot;
      const body = root.querySelector('.body'), bar = root.querySelector('.copy-row');
      body.scrollTop = body.scrollHeight;
      return { scrolled: body.scrollTop > 50, gap: Math.round(bar.getBoundingClientRect().top - body.getBoundingClientRect().top) };
    });
    assert.ok(pinned.scrolled, 'the panel scrolled');
    assert.ok(pinned.gap >= 0 && pinned.gap <= 2, `the button line stays at the top (${pinned.gap}px)`);
    await page.evaluate(() => { document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.body').scrollTop = 0; });
    await click('.copy-button', '📁 Path');
    // Profile: a toggle; saved items in groups, one row each (label, value); a row copies only the
    // value and turns green for a moment.
    await click('.copy-button', '👤 Profile');
    const profile = await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.profile-box .profile-group, .profile-box .profile-row')].map(n => n.classList.contains('profile-group') ? `# ${n.textContent}` : `${n.querySelector('.profile-label').textContent} = ${n.querySelector('.profile-input')?.value ?? n.querySelector('.profile-value').textContent}`));
    // Files: the résumé folder's full path (added 2026-11-19), kept left-to-right with invisible marks.
    assert.deepEqual(profile.map((row) => row.replace(/\u200e/g, '')), ['# Name', '# Links', 'LinkedIn = https://www.linkedin.example/in/sample', 'GitHub = https://github.example/sample',
      '# Salary', 'Per month = 6000 EUR per month', 'Per year = 60000 - 70000 EUR per year']);
    // Name: values only (2026-11-25): the full name, then first | last (no last name here).
    assert.deepEqual(await page.evaluate(() => [...document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.profile-box .address-line')].map((line) => [...line.querySelectorAll('.address-chip')].map((n) => n.textContent))), [['Sample', ''], ['Sample']]);
    await click('.profile-box .profile-row', 'LinkedInhttps://www.linkedin.example/in/sample⧉');
    await page.waitForFunction(() => window.clipboard.at(-1) === 'https://www.linkedin.example/in/sample');
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-review]').shadowRoot.querySelectorAll('.profile-row.copied').length), 1, 'the copied row shows it');
    await click('.copy-button', '👤 Profile');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('[data-qts-apply-review]').shadowRoot.querySelector('.profile-box'))), false, 'a second click closes it');
    // Alt+S stops the filling (Alt+A, Ask AI, is Chrome's shortcut, run by the worker).
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyS'); await page.keyboard.up('Alt');
    await page.waitForFunction(() => window.sent.some(m => m.action === 'stop_filling'));
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
