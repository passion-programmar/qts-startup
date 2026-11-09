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

test('a "Preferred" question is emptied; a real referral code stays', { skip }, async () => {
  const html = `<form>${BOXES}<div><label for="p">Preferred location</label><input id="p" value="Berlin"></div><div><label for="r">Referral code</label><input id="r" value="KEEP"></div></form>`;
  const after = await onPage(html, `
    await api.emptyOldAnswers({ uploads: true });
    return { preferred: document.getElementById('p').value, referral: document.getElementById('r').value };
  `);
  assert.deepEqual(after, { preferred: '', referral: 'KEEP' });
  const fields = await onPage(html, 'return api.scanForAssist();');
  assert.equal(fields.find((field) => field.label === 'Preferred location').trackingValue, undefined);
  assert.equal(fields.find((field) => field.label === 'Referral code').trackingValue, true);
});

test('Normal Apply\'s cleaning treats "Preferred" boxes as before', { skip }, async () => {
  const value = await onPage(`<form>${BOXES}<div><label for="p">Preferred location</label><input id="p" value="Berlin"></div></form>`, `
    await api.emptyOldAnswers({});
    return document.getElementById('p').value;
  `);
  assert.equal(value, 'Berlin');
});

test('a dropdown at its own start is not reported; one showing another choice is', { skip }, async () => {
  const html = `<form>${BOXES}<div><label for="cur">Salary currency</label><select id="cur"><option>USD</option><option>EUR</option></select></div></form>`;
  assert.deepEqual(await onPage(html, 'return (await api.emptyOldAnswers({ uploads: true })).stuck;'), []);
  const changed = await onPage(html, `
    document.getElementById('cur').value = 'EUR';
    return (await api.emptyOldAnswers({ uploads: true })).stuck;
  `);
  assert.deepEqual(changed.map((box) => box.label), ['Salary currency']);
});

test('a start control drawn without a real button is found only when asked for', { skip }, async () => {
  const html = '<h1>A job</h1><div class="btn" onclick="window.started = true">Apply for this Position</div>';
  assert.equal((await onPage(html, 'return api.clickStart([], { assistant: true, probe: true });')).ok, false);
  const found = await onPage(html, 'return api.clickStart([], { assistant: true, probe: true, apiFlow: true });');
  assert.deepEqual([found.ok, found.text], [true, 'Apply for this Position']);
  assert.equal(await onPage(html, 'api.clickStart([], { assistant: true, apiFlow: true }); return window.started === true;'), true);
});

test('a drawn control is clicked at its innermost element, so the handler is reached either way', { skip }, async () => {
  const html = '<h1>A job</h1><div id="outer" onclick="window.started = event.target.id" style="cursor:pointer"><span id="inner">Apply now</span></div>';
  assert.equal(await onPage(html, 'api.clickStart([], { assistant: true, apiFlow: true }); return window.started;'), 'inner');
});

test('a drawn Continue or Apply as guest counts too', { skip }, async () => {
  for (const words of ['Continue', 'Apply as guest']) {
    const found = await onPage(`<h1>A job</h1><div onclick="1">${words}</div>`, 'return api.clickStart([], { assistant: true, probe: true, apiFlow: true });');
    assert.deepEqual([found.ok, found.text], [true, words]);
  }
});

test('a long answer is read back from the page in full', { skip }, async () => {
  const length = await onPage(`<form>${BOXES}<div><label for="t">Why us?</label><textarea id="t">${'word '.repeat(200)}</textarea></div></form>`, `
    return api.auditForm().fields.find((field) => field.label === 'Why us?').value.length;
  `);
  assert.ok(length > 900, String(length));
});

test('the API flow reads a question\'s whole help text; every other flow keeps its limit', { skip }, async () => {
  const help = 'Tell us in detail. '.repeat(30);
  const html = `<form>${BOXES}<div><label for="t">Why us?</label><span id="h">${help}</span><textarea id="t" aria-describedby="h"></textarea></div></form>`;
  const [whole, limited] = await onPage(html, "return [api.scanForAssist({ fullNotes: true }), api.scanForAssist()].map((fields) => fields.find((field) => field.label === 'Why us?').note.length);");
  assert.ok(whole > 500, String(whole));
  assert.ok(limited <= 200, String(limited));
});

test('more start words count only for the API flow', { skip }, async () => {
  const html = '<h1>A job</h1><a href="#x">Get started</a>';
  assert.equal((await onPage(html, 'return api.clickStart([], { assistant: true, probe: true });')).ok, false);
  assert.equal((await onPage(html, 'return api.clickStart([], { assistant: true, probe: true, apiFlow: true });')).ok, true);
});

test('a failure report names the application controls on the page', { skip }, async () => {
  const controls = await onPage('<h1>A job</h1><a href="#a">Apply on LinkedIn</a><button>Share</button><div onclick="1">Start your journey</div>', 'return api.applyControlsSeen();');
  assert.deepEqual(controls, ['Apply on LinkedIn', 'Start your journey']);
});

test('the wait for a page says whether it went quiet', { skip }, async () => {
  assert.equal(await onPage('<p>x</p>', 'return api.settled({ quietMs: 100, maxMs: 1500 });'), true);
  assert.equal(await onPage('<p id="x">x</p>', `setInterval(() => { document.getElementById('x').textContent += '.'; }, 30); return api.settled({ quietMs: 200, maxMs: 600 });`), false);
});

test('other drawn text is not taken for a start control', { skip }, async () => {
  for (const html of [
    '<div onclick="1">Apply for this Position with LinkedIn</div>',
    '<div style="cursor:pointer">Read more about the role</div>',
    '<div>Apply now</div>',
    `<div onclick="1">${'Apply for this role and tell us about yourself. '.repeat(4)}</div>`,
  ]) {
    assert.equal((await onPage(`<h1>A job</h1>${html}`, 'return api.clickStart([], { assistant: true, probe: true, apiFlow: true });')).ok, false, html.slice(0, 50));
  }
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
