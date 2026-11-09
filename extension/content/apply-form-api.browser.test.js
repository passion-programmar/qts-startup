// The parts of Apply's form engine that Auto Apply with APIs adds, in a real Chrome on small local
// pages: removing attached files, reading who is signed in, keeping tracking codes. Skipped when
// Chrome is not installed (set QTS_CHROME to its path). Nothing leaves the machine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FORM_FILE = path.join(__dirname, 'apply-form.js');
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

async function onPage(html, code) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1366, height: 900 });
    await page.setContent(html);
    await page.addScriptTag({ path: FORM_FILE });
    return await page.evaluate(`(async () => { const api = globalThis.__qtsApplyForm; ${code} })()`);
  } finally {
    await page.close();
  }
}

const BOXES = `<div><label for="a">First name</label><input id="a"></div>
  <div><label for="b">Last name</label><input id="b"></div>
  <div><label for="c">Email</label><input id="c" type="email"></div>`;
const ROW = (name) => `<div class="row"><span>${name}</span><button type="button" aria-label="Remove file" onclick="this.parentElement.remove()">x</button></div>`;

test('an old attached file is removed; this candidate\'s own stays', { skip }, async () => {
  const result = await onPage(`<form>${BOXES}${ROW('old_person_cv.pdf')}${ROW('Ana_Test_CV.pdf')}</form>`, `
    const done = await api.emptyOldAnswers({ uploads: true, keepFiles: ['Ana_Test_CV.pdf'] });
    return { text: document.body.innerText, emptied: done.emptied, stuck: done.stuck };
  `);
  assert.doesNotMatch(result.text, /old_person_cv/);
  assert.match(result.text, /Ana_Test_CV/);
  assert.deepEqual(result.emptied, ['old_person_cv.pdf']);
  assert.deepEqual(result.stuck, []);
});

test('Normal Apply\'s cleaning still leaves attached files alone', { skip }, async () => {
  const text = await onPage(`<form>${BOXES}${ROW('old_person_cv.pdf')}</form>`, `
    await api.emptyOldAnswers({});
    return document.body.innerText;
  `);
  assert.match(text, /old_person_cv/);
});

test('a file with no way to remove it is reported', { skip }, async () => {
  const stuck = await onPage(`<form>${BOXES}<div><label for="cv">Resume</label><input id="cv" type="file"><span>old_person_cv.pdf</span></div></form>`, `
    return (await api.emptyOldAnswers({ uploads: true })).stuck;
  `);
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].upload, true);
});

test('a page shows who is signed in', { skip }, async () => {
  const account = (html) => onPage(`${html}<form>${BOXES}</form>`, 'return api.siteAccount();');
  assert.equal((await account('<h1>A job</h1>')).signedIn, false);
  const shown = await account('<header>ana@x.com <a href="/logout">Log out</a></header>');
  assert.equal(shown.signedIn, true);
  assert.deepEqual(shown.emails, ['ana@x.com']);
  assert.equal((await account('<nav><div style="display:none"><a href="/account/sign-out">x</a></div></nav>')).signedIn, true, 'a Sign out hidden in a closed menu counts');
  assert.deepEqual((await account('<p>Signed in as ben@x.com.</p>')).emails, ['ben@x.com']);
  assert.equal((await account('<nav><a href="/me">My account</a></nav>')).signedIn, true);
  assert.equal((await account('<nav><a href="/me">My account</a> <a href="/in">Sign in</a></nav>')).signedIn, false, 'an account link beside Sign in is for signed-out visitors');
});

test('words in a job description and a contact address are not a login', { skip }, async () => {
  const account = await onPage(`<header>careers@acme.com</header><p>Sign out of your old job and join us. Write to hr@acme.com.</p><form>${BOXES}</form>`, 'return api.siteAccount();');
  assert.equal(account.signedIn, false);
  assert.deepEqual(account.emails, []);
});

test('the email in the form is read only when someone is signed in', { skip }, async () => {
  const account = await onPage(`<header><a href="/logout">Sign out</a></header><form>${BOXES.replace('type="email"', 'type="email" value="ben@x.com"')}</form>`, 'return api.siteAccount();');
  assert.equal(account.formEmail, 'ben@x.com');
});

test('a tracking code already on the form is marked to stay; an empty one is a question', { skip }, async () => {
  const fields = await onPage(`<form>${BOXES}<div><label for="r">Referral code</label><input id="r" value="KEEP"></div><div><label for="s">Promo code</label><input id="s"></div></form>`, 'return api.scanForAssist();');
  assert.equal(fields.find((field) => field.label === 'Referral code').trackingValue, true);
  assert.equal(fields.find((field) => field.label === 'Promo code').trackingValue, undefined);
});

test('uploads holding someone else\'s file are named', { skip }, async () => {
  const html = `<form>${BOXES}<div><label for="cv">Resume</label><input id="cv" type="file"><span>other_person.pdf</span></div></form>`;
  assert.deepEqual((await onPage(html, 'return api.foreignUploads(["Ana.pdf"]);')).map((entry) => entry.name), ['other_person.pdf']);
  assert.deepEqual(await onPage(html, 'return api.foreignUploads(["other_person.pdf"]);'), []);
});

test('the wait for a page ends when it stops changing, and never runs past its limit', { skip }, async () => {
  const quiet = await onPage('<p>x</p>', 'const t = performance.now(); await api.settled({ quietMs: 100, maxMs: 2000 }); return performance.now() - t;');
  assert.ok(quiet < 800, `took ${quiet}`);
  const busy = await onPage('<p id="x">x</p>', `
    setInterval(() => { document.getElementById('x').textContent += '.'; }, 30);
    const t = performance.now(); await api.settled({ quietMs: 200, maxMs: 700 }); return performance.now() - t;
  `);
  assert.ok(busy >= 650 && busy < 1500, `took ${busy}`);
});
