// Apply's assistant panel (apply-assist.js) in a real Chrome, on small local pages: what it shows,
// what its copy buttons and items copy, and what it tells the worker (Submitted, Cancel, the site's
// own Submit, Yes / No). The panel's shadow root is opened for the test, the extension messaging and
// the clipboard are stand-ins. Skipped when Chrome is not installed (set QTS_CHROME to its path).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FORM_FILE = path.join(__dirname, 'apply-form.js');
const PANEL_FILE = path.join(__dirname, 'apply-assist.js');
const CHROME = [
  process.env.QTS_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => candidate && fs.existsSync(candidate));

let browser = null;
const skip = CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run these tests).';

test.before(async () => {
  if (skip) return;
  const puppeteer = require('puppeteer-core');
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});
test.after(async () => browser?.close());

const STATE = {
  assist: true,
  attemptId: 'a1',
  jobId: 'j1',
  mode: 'assist',
  chromeName: 'Chrome 2',
  candidate: 'Ana Pop',
  job: { title: 'Data Engineer', company: 'Acme', location: 'Remote', workType: 'Full-time · Remote', salary: null, url: 'https://jobs.example/1', description: 'We need Spark and Airflow.' },
  resumeText: 'ANA POP\nData engineer with 7 years of Spark.',
  resumeFolder: 'QTS_Resume/MSK/Ana Pop/Acme',
  profile: { firstName: 'Ana', lastName: 'Pop', email: 'ana@example.com', phone: '+40 711 222 333', city: 'Cluj-Napoca', country: 'Romania', linkedinUrl: 'https://linkedin.com/in/ana', yearsOfExperience: 7, gender: 'prefer_not_to_say' },
  experiences: [{ jobTitle: 'Senior Data Engineer', companyName: 'Initech', location: 'Cluj', workMode: 'remote', startDate: '2021-03-01', endDate: null, isCurrent: true, description: 'Built Spark pipelines.' }],
  educations: [{ institution: 'UBB', degree: 'BSc', fieldOfStudy: 'Computer Science', startDate: '2012-10-01', endDate: '2015-07-01', isCurrent: false, description: null }],
  reusable: [{ question: 'Notice period', answer: 'Immediately', note: null }],
  problems: [],
};

test('a site rebuilding the document restores the existing panel without losing hidden state or resurrecting it after Cancel', { skip }, async () => {
  await withPanel('<main><label>Name<input></label></main>', STATE, async (page) => {
    page.on('pageerror', (error) => console.error('[panel restoration]', error.message));
    await page.evaluate(() => {
      window.originalPanel = document.querySelector('[data-qts-apply-assist]');
      document.querySelector('[data-qts-apply-assist]').remove();
      document.querySelector('[data-qts-apply-dock]').remove();
    });
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]') === window.originalPanel && document.querySelector('[data-qts-apply-dock]'), { timeout: 10000 }).catch(async (error) => {
      console.error('[panel restoration]', await page.evaluate(() => ({ panelConnected: window.originalPanel.isConnected, panels: document.querySelectorAll('[data-qts-apply-assist]').length, docks: document.querySelectorAll('[data-qts-apply-dock]').length, api: typeof globalThis.__qtsApplyAssist, sent: window.__sent })));
      throw error;
    });
    await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.hide').click());
    await page.evaluate(() => {
      document.documentElement.innerHTML = '<head></head><body><main>Next application step<input></main></body>';
    });
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]') === window.originalPanel && document.querySelector('[data-qts-apply-dock]'), { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.panel').hidden), true);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.tab').hidden), false);
    await page.evaluate(() => {
      globalThis.__qtsApplyAssist.remove();
      document.body.appendChild(document.createElement('input'));
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(await page.$('[data-qts-apply-assist]'), null);
    assert.equal(await page.$('[data-qts-apply-dock]'), null);
  });
});

/** A page with html, the form engine and the panel (shown with state); returns helpers to look at it. */
async function withPanel(html, state, run) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1366, height: 900 });
    await page.evaluateOnNewDocument(() => {
      window.__sent = [];
      window.__copied = [];
      window.chrome = { runtime: { id: 'test', getURL: (file) => file, sendMessage: async (message) => { window.__sent.push(message); return { ok: true }; } } };
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function attachOpen(options) { return attach.call(this, { ...options, mode: 'open' }); };
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied.push(text); } } });
    });
    await page.goto('about:blank');
    await page.setContent(html);
    await page.addScriptTag({ path: FORM_FILE });
    await page.addScriptTag({ path: PANEL_FILE });
    await page.evaluate((next) => globalThis.__qtsApplyAssist.render(next), state);
    const panel = {
      text: () => page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.panel').innerText),
      click: (selector, text) => page.evaluate((s, t) => {
        const nodes = [...document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelectorAll(s)];
        const node = t ? nodes.find((entry) => entry.textContent.includes(t)) : nodes[0];
        if (!node) throw new Error(`no ${s} ${t || ''}`);
        node.click();
      }, selector, text),
      sent: () => page.evaluate(() => window.__sent.filter((message) => message.action !== 'ping')),
      copied: () => page.evaluate(() => window.__copied),
    };
    return await run(page, panel);
  } finally {
    await page.close();
  }
}

const FORM = `<form onsubmit="event.preventDefault(); window.siteSubmitted = true;">
  <label for="fn">First name *</label><input id="fn" required>
  <label for="em">Email *</label><input id="em" type="email" required value="ana@example.com">
  <button type="submit">Submit application</button></form>`;

test('normal Apply exposes Pause and Resume, explains stopping, and keeps Cancel available', { skip }, async () => {
  await withPanel(FORM, { ...STATE, filling: true }, async (page, panel) => {
    await panel.click('.pause-fill');
    assert.equal((await panel.sent()).some((message) => message.action === 'pause_fill'), true);
    await page.evaluate((state) => globalThis.__qtsApplyAssist.render(state), { ...STATE, manualPaused: true, pauseStopping: true });
    assert.match(await panel.text(), /Pausing autofill/);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.pause-fill').disabled), true);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.cancel').disabled), false);
    await page.evaluate((state) => globalThis.__qtsApplyAssist.render(state), { ...STATE, manualPaused: true, pauseStopping: false });
    assert.match(await panel.text(), /Review and edit the form freely/);
    await panel.click('.pause-fill');
    assert.equal((await panel.sent()).some((message) => message.action === 'resume_fill'), true);
  });
});

test('answer editor saves and deletes explicitly while preserving the employer form and Manager pause', { skip }, async () => {
  await withPanel(FORM, { ...STATE, manualPaused: true }, async (page, panel) => {
    await page.evaluate(() => {
      document.querySelector('#fn').value = 'Manager edit';
      window.editorRows = [];
      window.chrome.runtime.sendMessage = async (message) => {
        window.__sent.push(message);
        if (message.action === 'save_answer') window.editorRows = [{ id: 'saved', version: '123.000001', questionText: message.input.question, answer: message.input.answer, scope: 'candidate' }];
        if (message.action === 'delete_answer') window.editorRows = [];
        return { ok: true, answers: window.editorRows, fields: [{ id: 'name-field', label: 'First name', value: 'Manager edit', kind: 'text', options: [] }] };
      };
    });
    await panel.click('[data-card="reusable"] .card-head');
    await panel.click('.answer-editor-open');
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-select')?.options.length === 3);
    await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-assist]').shadowRoot;
      const select = root.querySelector('.answer-editor-select'); select.value = 'field:name-field'; select.dispatchEvent(new Event('change'));
      const input = root.querySelector('.answer-editor-value'); input.value = 'Saved name'; input.dispatchEvent(new Event('input'));
    });
    assert.equal((await panel.sent()).some((message) => message.action === 'save_answer'), false, 'typing never saves');
    await panel.click('.answer-editor-save');
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-message')?.textContent.includes('Saved explicitly'));
    const save = (await panel.sent()).find((message) => message.action === 'save_answer');
    assert.equal(save.input.confirmShared, false, 'new personal answers are not implicitly shared');
    assert.equal(save.input.answer, 'Saved name'); assert.equal(save.input.fieldId, 'name-field');
    assert.equal(await page.$eval('#fn', (node) => node.value), 'Manager edit');
    await page.evaluate(() => { const select = document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-select'); select.value = 'saved:saved'; select.dispatchEvent(new Event('change')); });
    await panel.click('.answer-editor-delete');
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-message')?.textContent.includes('Deleted from the library'));
    const removed = (await panel.sent()).find((message) => message.action === 'delete_answer');
    assert.equal(removed.input.version, '123.000001');
    assert.equal(await page.$eval('#fn', (node) => node.value), 'Manager edit');
    assert.equal((await panel.sent()).some((message) => ['resume_fill', 'retry_fill', 'submitted'].includes(message.action)), false);
    await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-assist]').shadowRoot;
      const select = root.querySelector('.answer-editor-select'); select.value = 'new'; select.dispatchEvent(new Event('change'));
      for (const [selector, value] of [['.answer-editor-question', 'Additional details'], ['.answer-editor-value', 'Discuss with recruiter']]) {
        const input = root.querySelector(selector); input.value = value; input.dispatchEvent(new Event('input'));
      }
      root.querySelector('.answer-editor-share').checked = true;
    });
    await panel.click('.answer-editor-save');
    assert.equal((await panel.sent()).filter((message) => message.action === 'save_answer').at(-1).input.confirmShared, true);
  });
});

test('a field variation requires explicit confirmation and never resumes or rewrites the employer form', { skip }, async () => {
  await withPanel(FORM, { ...STATE, manualPaused: true }, async (page, panel) => {
    await page.evaluate(() => {
      window.chrome.runtime.sendMessage = async (message) => {
        window.__sent.push(message);
        return { ok: true, answers: [], fields: [{ id: 'format', label: 'Preferred interview channel', value: 'Online', kind: 'select', options: ['Online', 'In person'], compatibleAnswers: [{ id: 'source', version: '123.000001', scope: 'candidate', questionText: 'Preferred interview format', answer: 'Video' }] }] };
      };
    });
    await panel.click('[data-card="reusable"] .card-head'); await panel.click('.answer-editor-open');
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-select'));
    await page.evaluate(() => { const root = document.querySelector('[data-qts-apply-assist]').shadowRoot;
      const field = root.querySelector('.answer-editor-select'); field.value = 'field:format'; field.dispatchEvent(new Event('change'));
      const source = root.querySelector('.answer-editor-variation-source'); source.value = 'source'; source.dispatchEvent(new Event('change'));
    });
    await panel.click('.answer-editor-save');
    assert.equal((await panel.sent()).some((message) => message.action === 'save_answer'), false);
    await page.evaluate(() => { document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-confirm-variation').checked = true; });
    await panel.click('.answer-editor-save');
    const save = (await panel.sent()).find((message) => message.action === 'save_answer');
    assert.equal(save.input.confirmVariation, true); assert.equal(save.input.question, 'Preferred interview format');
    assert.equal(save.input.fieldQuestion, 'Preferred interview channel'); assert.equal(save.input.answer, 'Online'); assert.equal(save.input.version, '123.000001');
    assert.equal((await panel.sent()).some((message) => ['resume_fill', 'retry_fill', 'submitted'].includes(message.action)), false);
  });
});

test('answer conflicts retain the draft and editor mutations stay disabled until Manager pause', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await page.evaluate(() => { window.chrome.runtime.sendMessage = async (message) => {
      window.__sent.push(message);
      return message.action === 'load_answers' ? { ok: true, answers: [], fields: [] } : { ok: false, error: 'Answer changed. Reload answers.' };
    }; });
    await panel.click('[data-card="reusable"] .card-head'); await panel.click('.answer-editor-open');
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-select'));
    await page.evaluate(() => { const root = document.querySelector('[data-qts-apply-assist]').shadowRoot;
      const select = root.querySelector('.answer-editor-select'); select.value = 'new'; select.dispatchEvent(new Event('change'));
      for (const [selector, value] of [['.answer-editor-question', 'Additional details'], ['.answer-editor-value', 'My draft']]) { const input = root.querySelector(selector); input.value = value; input.dispatchEvent(new Event('input')); }
    });
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-save').disabled), true);
    await page.evaluate((state) => globalThis.__qtsApplyAssist.render(state), { ...STATE, manualPaused: true });
    await panel.click('.answer-editor-save');
    await page.waitForFunction(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-message')?.textContent.includes('Reload answers'));
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.answer-editor-value').value), 'My draft');
    assert.equal((await panel.sent()).filter((message) => message.action === 'save_answer').length, 1, 'a conflict never retries itself');
  });
});

test('an explicit toolbar reveal reopens a hidden Apply panel without sending an autofill or submission action', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await panel.click('.hide');
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.panel').hidden), true);
    assert.equal(await page.evaluate(() => globalThis.__qtsApplyAssist.reveal()), true);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.panel').hidden), false);
    assert.deepEqual(await panel.sent(), []);
  });
});

test('the panel shows the account, the job, two copy buttons, the profile cards, and Submitted / Cancel', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    const text = await panel.text();
    for (const shown of ['Ana Pop', 'Chrome 2', 'ACCOUNT', 'Data Engineer', 'Acme', 'Remote · Full-time · Remote', 'jobs.example', 'Copy résumé + JD', 'Copy résumé + JD + profile',
      'Ana Pop\\Acme', 'RESUME FOLDER AFTER MSK', 'PROFILE', 'EXPERIENCE', 'EDUCATION', 'REUSABLE ANSWERS', 'ana@example.com',
      'QTS fills only saved documents, profile facts, and reusable answers on visible application forms.', 'Submitted', 'Cancel']) {
      assert.ok(text.includes(shown), `shows "${shown}"`);
    }
    assert.ok(!text.includes('QTS filled'));
    assert.ok(text.includes('Fill again'));
    await panel.click('.fill-again', 'Fill again');
    assert.deepEqual((await panel.sent()).filter((m) => m.action !== 'fields_changed').map((m) => m.action), ['fill_again']);
    // Experience, education and reusable answers start closed; the page moves aside for the panel.
    assert.ok(!text.includes('Initech'));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.qtsApplyDocked), 'true');
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).paddingRight), '0px');
    await panel.click('.card-head', 'Experience');
    await panel.click('.card-head', 'Education');
    await panel.click('.card-head', 'Reusable answers');
    const opened = await panel.text();
    for (const shown of ['Senior Data Engineer', 'Initech', 'Mar 2021', 'Present', 'UBB', 'Computer Science', 'Notice period', 'Immediately']) {
      assert.ok(opened.includes(shown), `shows "${shown}"`);
    }
  });
});

test('a paused PDF error stays actionable and offers an explicit Retry autofill without removing manual controls', { skip }, async () => {
  const reason = 'The saved PDF paths are unavailable. Cancel and ask your QTS administrator to check the existing PDF paths.';
  await withPanel(FORM, { ...STATE, retryFill: true, status: 'Autofill paused. Resolve the issue below, then choose Retry autofill.', problems: [{ message: reason, fieldId: null }] }, async (page, panel) => {
    assert.ok((await panel.text()).includes(reason));
    assert.match(await panel.text(), /Autofill paused.*Retry autofill/s);
    await panel.click('.retry-fill');
    const actions = (await panel.sent()).filter((m) => m.action !== 'fields_changed');
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, 'retry_fill');
    assert.equal(actions[0].assist, true);
    assert.equal(actions[0].attemptId, STATE.attemptId);
    await panel.click('.retry-fill');
    assert.equal((await panel.sent()).filter((m) => m.action === 'retry_fill').length, 1, 'double click cannot queue another retry');
    await page.evaluate((next) => globalThis.__qtsApplyAssist.render(next), STATE);
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.retry-fill')), null);
    assert.match(await panel.text(), /Submitted.*Cancel/s);
  });
});

test('"Questions on this page" lists every question with status and source; a click scrolls to the box', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    const ids = await page.evaluate(() => globalThis.__qtsApplyForm.panelQuestions().map((entry) => ({ id: entry.id, label: entry.label })));
    assert.ok(ids.length >= 2, 'the page has questions');
    const questions = [
      { id: ids[0].id, label: ids[0].label, kind: 'text', required: true, value: 'Radu Star', status: 'filled', source: 'profile' },
      { id: ids[1].id, label: ids[1].label, kind: 'text', required: true, value: '', status: 'need', reason: 'QTS has an answer but the box is empty: copy it, or use Fill again.', suggestion: 'ana@example.com' },
    ];
    await page.evaluate((next) => globalThis.__qtsApplyAssist.render(next), { ...STATE, questions });
    const text = await panel.text();
    assert.match(text, /Questions on this page/i);
    assert.match(text, /✓ 1 filled/); assert.match(text, /! 1 need you/);
    assert.match(text, /Radu Star/); assert.match(text, /profile/); assert.match(text, /QTS has an answer but the box is empty/); assert.match(text, /Copy: ana@example.com/);
    // "Needs you" shows only the empty required one.
    await panel.click('.question-filters button', 'Needs you');
    assert.doesNotMatch(await panel.text(), /Radu Star/);
    // A click on a row scrolls the page to that box and outlines it.
    await panel.click('.question', ids[1].label);
    const outlined = await page.evaluate((id) => {
      const box = document.querySelector(`[data-qts-apply-field="${id}"]`);
      const holder = box.closest('label, fieldset, [class*="field" i], [class*="question" i]') || box;
      return holder.style.outline;
    }, ids[1].id);
    assert.match(outlined, /3px/);
    // Copy gives what QTS knows for the empty box, without jumping to it.
    await panel.click('.q-copy', 'Copy');
    assert.deepEqual(await panel.copied(), ['ana@example.com']);
    // Save answer in the row: the editor starts with what QTS knows; the Manager picks the level and saves.
    await panel.click('.q-copy', 'Save answer');
    const shadow = () => 'document.querySelector("[data-qts-apply-assist]").shadowRoot';
    assert.equal(await page.evaluate(`${shadow()}.querySelector('.q-editor textarea').value`), 'ana@example.com');
    await page.evaluate(`(() => { const root = ${shadow()};
      const text = root.querySelector('.q-editor textarea'); text.value = 'radu@example.com'; text.dispatchEvent(new Event('input'));
      const level = root.querySelectorAll('.q-editor select')[0]; level.value = 'candidate'; level.dispatchEvent(new Event('change')); })()`);
    await panel.click('.q-save', 'Save and fill');
    const saved = (await panel.sent()).find((message) => message.action === 'save_question_answer');
    // The row says it was saved, and where.
    assert.match(await panel.text(), /Saved for This candidate and filled/);
    assert.deepEqual({ fieldId: saved.fieldId, question: saved.question, answer: saved.answer, level: saved.level, kind: saved.kind },
      { fieldId: ids[1].id, question: ids[1].label.replace(/\s*\*\s*$/, '').replace(/:\s*$/, ''), answer: 'radu@example.com', level: 'candidate', kind: 'text' });
  });
});

test('a box the Manager changed: the panel opens, shows the change and saves it at the chosen level only on click', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    const ids = await page.evaluate(() => globalThis.__qtsApplyForm.panelQuestions().map((entry) => ({ id: entry.id, label: entry.label })));
    // The Manager hid the panel, then changed a box on the site.
    await panel.click('.hide');
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.panel').hidden), true);
    const questions = [{ id: ids[1].id, label: ids[1].label, kind: 'text', required: true, value: 'Masters', status: 'page',
      edit: { before: '', levels: ['manager', 'candidate', 'application'] } }];
    await page.evaluate((next) => globalThis.__qtsApplyAssist.render(next), { ...STATE, questions, questionsPrompt: { id: ids[1].id, at: Date.now() } });
    const shown = await page.evaluate(() => {
      const root = document.querySelector('[data-qts-apply-assist]').shadowRoot;
      return { hidden: root.querySelector('.panel').hidden, flashed: Boolean(root.querySelector('.question.flash')) };
    });
    assert.deepEqual(shown, { hidden: false, flashed: true }, 'the panel opened at the changed question');
    const text = await panel.text();
    assert.match(text, /You entered: Masters\s+\(was empty\)/);
    assert.match(text, /1 change not saved yet/);
    // Nothing is sent until a level is clicked.
    assert.equal((await panel.sent()).filter((message) => message.action === 'save_question_answer').length, 0);
    await panel.click('.q-level', 'This candidate');
    const saved = (await panel.sent()).find((message) => message.action === 'save_question_answer');
    assert.deepEqual({ answer: saved.answer, level: saved.level, fieldId: saved.fieldId }, { answer: 'Masters', level: 'candidate', fieldId: ids[1].id });
    assert.match(await panel.text(), /Saved for This candidate/);
  });
});

test('answers that differ from the Manager defaults are listed with both values; none means no box', { skip }, async () => {
  const differences = [
    { question: 'Are you open to relocation?', used: 'Yes', managerDefault: 'No', level: 'candidate' },
    { question: 'Notice period', used: '2 months', managerDefault: '1 month', level: 'application' },
  ];
  await withPanel(FORM, { ...STATE, differences }, async (page, panel) => {
    const text = await panel.text();
    assert.match(text, /Different from your defaults \(2\)/);
    assert.match(text, /Are you open to relocation\?: used "Yes" \(this candidate\) · your default "No"/);
    assert.match(text, /Notice period: used "2 months" \(this job\) · your default "1 month"/);
    await page.evaluate((next) => globalThis.__qtsApplyAssist.render(next), STATE);
    assert.doesNotMatch(await panel.text(), /Different from your defaults/);
  });
});

test('the copy buttons copy the résumé and job, and each card item copies its own value', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await panel.click('.copy-all', 'Copy résumé + JD');
    await panel.click('.copy-all', '+ profile');
    await panel.click('.item', 'Phone');
    await panel.click('.card-head', 'Experience');
    await panel.click('.item', 'Company');
    const [resumeAndJob, withProfile, phone, company] = await panel.copied();
    assert.match(resumeAndJob, /^Résumé:\nANA POP\nData engineer with 7 years of Spark\.\n\nJob: Data Engineer at Acme \(Remote\)\nLink: https:\/\/jobs\.example\/1\n\nJob description:\nWe need Spark and Airflow\.$/);
    assert.ok(withProfile.startsWith(resumeAndJob));
    for (const part of ['Candidate profile', 'Full name: Ana Pop', 'Email: ana@example.com', 'Years of experience: 7', 'Gender: Prefer not to say',
      '- Senior Data Engineer, Initech (Cluj, Remote) · Mar 2021 – Present', 'Built Spark pipelines.', '- BSc, Computer Science — UBB · Oct 2012 – Jul 2015']) {
      assert.ok(withProfile.includes(part), `the profile copy has "${part}"`);
    }
    assert.equal(phone, '+40 711 222 333');
    assert.equal(company, 'Initech');
    assert.deepEqual(await panel.sent(), []);
  });
});

test('experience and education values share rows but remain independently copyable', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await panel.click('.card-head', 'Experience');
    await panel.click('[data-card="experience"] .item-row .item', 'Company');
    await panel.click('[data-card="experience"] .item-row .item', 'Location');
    await panel.click('[data-card="experience"] .item-row .item', 'From');
    await panel.click('[data-card="experience"] .item-row .item', 'To');
    await panel.click('.card-head', 'Education');
    await panel.click('[data-card="education"] .item-row .item', 'From');
    await panel.click('[data-card="education"] .item-row .item', 'To');
    assert.deepEqual(await panel.copied(), ['Initech', 'Cluj', 'Mar 2021', 'Present', 'Oct 2012', 'Jul 2015']);
    const rows = await page.evaluate(() => {
      const shadow = document.querySelector('[data-qts-apply-assist]').shadowRoot;
      return [...shadow.querySelectorAll('[data-card="experience"] .item-row, [data-card="education"] .item-row')]
        .map((row) => [...row.querySelectorAll('.item .label')].map((label) => label.textContent));
    });
    assert.deepEqual(rows, [['Company', 'Location'], ['From', 'To'], ['From', 'To']]);
  });
});

test('the résumé path copies only the suffix after the MSK folder', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await panel.click('.path-copy', 'Ana Pop');
    assert.deepEqual(await panel.copied(), ['Ana Pop\\Acme']);
    assert.ok(!(await panel.sent()).some((message) => message.action === 'open_folder'));
  });
  await withPanel(FORM, { ...STATE, resumeFolder: 'QTS_Resume/Other Candidate/Acme' }, async (page, panel) => {
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.path-copy')), null);
  });
});

test('the site account password shows as dots and copies with a click; without one the panel says where to save it', { skip }, async () => {
  await withPanel(FORM, { ...STATE, siteAccountPassword: 'S1te-Acc0unt!' }, async (page, panel) => {
    const text = await panel.text();
    assert.ok(text.includes('Site account password'));
    assert.ok(text.includes('••••••••'));
    assert.ok(!text.includes('S1te-Acc0unt!'));
    await panel.click('.item', 'Site account password');
    assert.deepEqual(await panel.copied(), ['S1te-Acc0unt!']);
    // Never in the copies meant for ChatGPT.
    await panel.click('.copy-all', '+ profile');
    assert.ok(!(await panel.copied())[1].includes('S1te-Acc0unt!'));
  });
  await withPanel(FORM, STATE, async (page, panel) => {
    assert.ok((await panel.text()).includes('No site account password saved'));
  });
});

test('Submitted and Cancel tell the worker; the site\'s own buttons are never watched', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await panel.click('.submitted', 'Submitted');
    const [submitted] = await panel.sent();
    assert.equal(submitted.action, 'submitted');
    assert.equal(submitted.assist, true);
    assert.equal(submitted.jobId, 'j1');
    assert.equal(submitted.noticed, undefined);
    assert.ok(submitted.answers.some((answer) => answer.label.startsWith('Email') && answer.value === 'ana@example.com'));
  });
  await withPanel(FORM, STATE, async (page, panel) => {
    await panel.click('.cancel', 'Cancel');
    assert.deepEqual((await panel.sent()).map((message) => message.action), ['cancel']);
  });
  // The site's Submit, Enter in a box, an Apply button: nothing is sent; only Submitted ends it.
  await withPanel(FORM, STATE, async (page, panel) => {
    await page.type('#fn', 'Ana');
    await page.keyboard.press('Enter');
    await page.click('button[type=submit]');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(await panel.sent(), []);
    assert.equal(await page.evaluate(() => window.siteSubmitted), true);
  });
  await withPanel('<main><h1>Data Engineer</h1><p>About the job</p><button type="button">Apply</button></main>', STATE, async (page, panel) => {
    await page.click('button');
    assert.deepEqual(await panel.sent(), []);
  });
});

test('new boxes on the page (a pop-up, the next step, a section shown) tell the worker once; other changes do not', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    const changes = async () => (await panel.sent()).filter((message) => message.action === 'fields_changed').length;
    // The count once messages stop coming (a slow machine delays them): unchanged for 1.5 s.
    const settled = async () => {
      let count = await changes();
      for (let stable = 0, waited = 0; stable < 1500 && waited < 10000; waited += 250) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const now = await changes();
        stable = now === count ? stable + 250 : 0;
        count = now;
      }
      return count;
    };
    // The first look after the panel shows.
    await page.evaluate(() => document.body.append(Object.assign(document.createElement('p'), { textContent: 'Loaded.' })));
    const first = await settled();
    // A pop-up with two new boxes: told once, after the page settles (half a second).
    await page.evaluate(() => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<label for="ph">Phone</label><input id="ph"><label for="ci">City</label><input id="ci">';
      document.body.append(dialog);
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(await changes(), first, 'not before the page settles');
    assert.equal(await settled(), first + 1);
    // Text and styles changing, with the same boxes: nothing is sent.
    await page.evaluate(() => { document.querySelector('p').textContent = 'Still loaded.'; document.body.className = 'busy'; });
    assert.equal(await settled(), first + 1);
    // A hidden section shown: told again.
    await page.evaluate(() => {
      const section = document.createElement('div');
      section.hidden = true;
      section.innerHTML = '<label for="lk">LinkedIn</label><input id="lk">';
      document.body.append(section);
    });
    const hiddenAdded = await settled();
    await page.evaluate(() => { document.querySelector('#lk').parentElement.hidden = false; });
    assert.equal(await settled(), hiddenAdded + 1);
  });
});

test('opening PDF recovery preserves a usable paused panel and explicit Retry', { skip }, async () => {
  await withPanel(FORM, { ...STATE, retryFill: true, relinkPdfs: true }, async (page, panel) => {
    await panel.click('.link-pdfs');
    assert.equal((await panel.sent()).at(-1).action, 'link_pdfs');
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.retry-fill').disabled), false);
    await panel.click('.retry-fill');
    assert.equal((await panel.sent()).at(-1).action, 'retry_fill');
  });
});

test('the panel alone leaves fields untouched and can hide and reopen', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.ok(!(await panel.text()).includes('Still empty'));
    assert.deepEqual(await page.evaluate(() => ({
      firstName: document.querySelector('#fn').value,
      email: document.querySelector('#em').value,
    })), { firstName: '', email: 'ana@example.com' });
    assert.deepEqual((await panel.sent()).filter((message) => message.action !== 'ping'), []);
    await page.type('#fn', 'Ana');
    assert.equal(await page.$eval('#fn', (input) => input.value), 'Ana');
    assert.ok(!(await panel.text()).includes('QTS filled'));
    await panel.click('.hide');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.qtsApplyDocked), 'false');
    await panel.click('.tab');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.qtsApplyDocked), 'true');
  });
});

test('an opened card moves to the top of the panel, and a redraw keeps where the panel was', { skip }, async () => {
  const many = { ...STATE, reusable: Array.from({ length: 18 }, (_, index) => ({ question: `Question ${index + 1}`, answer: `Answer ${index + 1}`, note: null })) };
  await withPanel(FORM, many, async (page, panel) => {
    await page.setViewport({ width: 1366, height: 600 });
    const where = () => page.evaluate(() => {
      const shadow = document.querySelector('[data-qts-apply-assist]').shadowRoot;
      const scroll = shadow.querySelector('.scroll');
      const card = shadow.querySelector('[data-card="reusable"]');
      return { scrollTop: scroll.scrollTop, offset: Math.round(card.getBoundingClientRect().top - scroll.getBoundingClientRect().top) };
    });
    await panel.click('.card-head', 'Reusable answers');
    const opened = await where();
    assert.ok(opened.scrollTop > 0, 'the panel scrolled to the card');
    assert.ok(opened.offset >= 0 && opened.offset <= 12, `the card is at the top (${opened.offset}px)`);
    // A redraw (the worker's next state, the still-empty list) keeps the place.
    await page.evaluate((next) => globalThis.__qtsApplyAssist.render(next), { ...many, filled: 4 });
    assert.equal((await where()).scrollTop, opened.scrollTop);
    // Closing a card leaves the panel where it is.
    await panel.click('.card-head', 'Profile');
    const after = await where();
    assert.ok(after.scrollTop > 0);
  });
});

test('a large frame appearing (a job board\'s embedded form) tells the worker; a small one does not', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    const changes = async () => (await panel.sent()).filter((message) => message.action === 'fields_changed').length;
    await page.evaluate(() => document.body.append(Object.assign(document.createElement('p'), { textContent: 'Loaded.' })));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const before = await changes();
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<iframe srcdoc="ad" style="width:120px;height:60px"></iframe>'));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(await changes(), before);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<iframe srcdoc="form" style="width:700px;height:900px"></iframe>'));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    assert.equal(await changes(), before + 1);
  });
});

test('after the extension restarted, a panel says what to do instead of doing nothing; a new panel replaces the dead one', { skip }, async () => {
  // A dead panel left by an earlier run of the extension is on the page before this one shows.
  await withPanel(`<div data-qts-apply-assist data-qts-apply-review>old panel</div>${FORM}`, STATE, async (page, panel) => {
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-qts-apply-assist]').length), 1);
    // The extension is reloaded: this panel can no longer reach it.
    await page.evaluate(() => { delete window.chrome.runtime.id; });
    await panel.click('.submitted', 'Submitted');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const text = await panel.text();
    assert.ok(text.includes('QTS was restarted or updated'), text.slice(-300));
    // Not stuck: the button can be clicked again.
    assert.equal(await page.evaluate(() => document.querySelector('[data-qts-apply-assist]').shadowRoot.querySelector('.submitted').disabled), false);
  });
});

test('a saved answer with similar wording is offered with [Use]; one click asks QTS to fill it and link the wording', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    const ids = await page.evaluate(() => globalThis.__qtsApplyForm.panelQuestions().map((entry) => ({ id: entry.id, label: entry.label })));
    const questions = [{ id: ids[1].id, label: ids[1].label, kind: 'text', required: true, value: '', status: 'need',
      reason: 'Looks like your saved answer "Are you willing to work remotely?". Use it if it means the same.',
      offer: { value: 'Yes', question: 'Are you willing to work remotely?', answer: 'Yes', level: 'manager', why: 'similar wording', savedAnswerId: '00000000-0000-4000-8000-000000000001' } }];
    await page.evaluate((next) => globalThis.__qtsApplyAssist.render(next), { ...STATE, questions });
    const text = await panel.text();
    assert.match(text, /Looks like: "Are you willing to work remotely\?" → Yes \(All my candidates\)/);
    // Nothing is filled or saved until the Manager clicks Use.
    assert.equal((await panel.sent()).filter((message) => message.action === 'use_offer').length, 0);
    await panel.click('.q-use', 'Use: Yes');
    const used = (await panel.sent()).filter((message) => message.action === 'use_offer');
    assert.equal(used.length, 1);
    assert.equal(used[0].fieldId, ids[1].id);
  });
});
