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
  resumeFolder: 'QTS/Ana Pop/Acme',
  profile: { firstName: 'Ana', lastName: 'Pop', email: 'ana@example.com', phone: '+40 711 222 333', city: 'Cluj-Napoca', country: 'Romania', linkedinUrl: 'https://linkedin.com/in/ana', yearsOfExperience: 7, gender: 'prefer_not_to_say' },
  experiences: [{ jobTitle: 'Senior Data Engineer', companyName: 'Initech', location: 'Cluj', workMode: 'remote', startDate: '2021-03-01', endDate: null, isCurrent: true, description: 'Built Spark pipelines.' }],
  educations: [{ institution: 'UBB', degree: 'BSc', fieldOfStudy: 'Computer Science', startDate: '2012-10-01', endDate: '2015-07-01', isCurrent: false, description: null }],
  reusable: [{ question: 'Notice period', answer: 'Immediately', note: null }],
  filled: 3,
  filling: false,
  problems: [],
};

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

test('the panel shows the account, the job, two copy buttons, the profile cards, and Submitted / Cancel', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    const text = await panel.text();
    for (const shown of ['Ana Pop', 'Chrome 2', 'ACCOUNT', 'Data Engineer', 'Acme', 'Remote · Full-time · Remote', 'jobs.example', 'Copy résumé + JD', 'Copy résumé + JD + profile',
      'PROFILE', 'EXPERIENCE', 'EDUCATION', 'REUSABLE ANSWERS', 'ana@example.com', 'QTS filled 3 answers', 'Submitted', 'Cancel']) {
      assert.ok(text.includes(shown), `shows "${shown}"`);
    }
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

test('the copy buttons copy the résumé and the job description, and with the profile; each item copies its value', { skip }, async () => {
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

test('Submitted and Cancel tell the worker; the site\'s own Submit asks Yes / No, an Apply button on a job page does not', { skip }, async () => {
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
  await withPanel(FORM, STATE, async (page, panel) => {
    await page.type('#fn', 'Ana');
    await page.click('button[type=submit]');
    const [noticed] = await panel.sent();
    assert.equal(noticed.action, 'submitted');
    assert.equal(noticed.noticed, true);
    assert.equal(await page.evaluate(() => window.siteSubmitted), true);
  });
  await withPanel('<main><h1>Data Engineer</h1><p>About the job</p><button type="button">Apply</button></main>', STATE, async (page, panel) => {
    await page.click('button');
    assert.deepEqual(await panel.sent(), []);
  });
  await withPanel(FORM, { ...STATE, mode: 'confirm' }, async (page, panel) => {
    const text = await panel.text();
    assert.ok(text.includes('Submitted successfully?'));
    assert.ok(!text.includes('Cancel'));
    await panel.click('.submitted', 'Yes, submitted');
    assert.deepEqual((await panel.sent()).map((message) => message.action), ['yes']);
  });
});

test('the panel lists the required questions still empty as the Manager fills them, and hides to a tab', { skip }, async () => {
  await withPanel(FORM, STATE, async (page, panel) => {
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.match(await panel.text(), /Still empty \(1 required\)\s+First name/);
    await page.type('#fn', 'Ana');
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.ok(!(await panel.text()).includes('Still empty'));
    // Typing on the page is what the worker waits for before filling.
    assert.ok(await page.evaluate(() => Date.now() - globalThis.__qtsApplyAssist.lastKeyAt() < 5000));
    await panel.click('.hide');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.qtsApplyDocked), 'false');
    await panel.click('.tab');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.qtsApplyDocked), 'true');
  });
});
