// Real Chrome: the verification page's code box is found, filled with the code from the mailbox, and
// the page's Verify button is clicked; a password box is never taken for a code box.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));

test('code boxes: one box, six one-letter boxes, never a password box', { skip: !CHROME, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    const script = path.resolve('extension/content/verification-code.js');
    const load = async (html) => {
      await page.setContent(html);
      await page.addScriptTag({ path: script });
    };

    // One box named "code" whose value a page reads only through its input events (as React does).
    await load(`<form onsubmit="event.preventDefault()"><p>We sent a verification code to your email.</p>
      <label for="c">Verification code</label><input id="c" name="otp">
      <button type="button" onclick="window.clicked = document.getElementById('c').dataset.seen">Verify</button></form>
      <script>document.getElementById('c').addEventListener('input', (e) => { e.target.dataset.seen = e.target.value; });</script>`);
    assert.deepEqual(await page.evaluate(() => window.__qtsVerificationCode.state().codeBox), true);
    assert.equal((await page.evaluate(() => window.__qtsVerificationCode.fill('482913'))).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(await page.evaluate(() => window.clicked), '482913', 'the page saw the code before Verify was clicked');

    // Six boxes of one character each.
    await load(`<div>Enter the 6-digit code</div>${Array.from({ length: 6 }, (_, i) => `<input maxlength="1" id="d${i}">`).join('')}
      <button onclick="window.clicked = true">Continue</button>`);
    assert.equal((await page.evaluate(() => window.__qtsVerificationCode.fill('593204'))).ok, true);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).join('')), '593204');
    assert.equal((await page.evaluate(() => window.__qtsVerificationCode.fill('12345'))).ok, false, 'a code of another length is not spread over the boxes');

    // Pages the watcher acts on: a code page, a "check your email for a link" page; never a form.
    await load('<h2>Verify your email</h2><p>We sent a 6-digit code to a***@gmail.com</p><input name="code"><button>Verify</button>');
    assert.equal(await page.evaluate(() => window.__qtsVerificationCode.waitsForMail()), true, 'code page');
    await load('<h2>Check your inbox</h2><p>We sent you a link to activate your account.</p><button>Resend</button>');
    assert.equal(await page.evaluate(() => window.__qtsVerificationCode.waitsForMail()), true, 'link page');
    await load(`<h2>Apply</h2>${['First name', 'Last name', 'Email', 'Phone', 'City', 'LinkedIn', 'Website', 'Salary', 'Notice'].map((l) => `<label>${l}<input></label>`).join('')}
      <label>Referral code<input name="referral_code"></label><p>We will verify your email after you apply.</p>`);
    assert.equal(await page.evaluate(() => window.__qtsVerificationCode.waitsForMail()), false, 'an application form with a referral code box');

    // A sign-in page: email and password only.
    await load('<p>Sign in</p><input type="email" name="email"><input type="password" name="password"><button>Sign in</button>');
    assert.equal(await page.evaluate(() => window.__qtsVerificationCode.state().codeBox), false);
    assert.equal((await page.evaluate(() => window.__qtsVerificationCode.fill('482913'))).ok, false);
    assert.equal(await page.evaluate(() => document.querySelector('input[type=password]').value), '');
  } finally {
    await browser.close();
  }
});
