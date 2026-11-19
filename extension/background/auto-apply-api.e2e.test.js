// End-to-end test of Auto Apply with APIs in the REAL extension in Chrome (service worker, form
// engine, answer rules, review panel) against a local mock QTS server with synthetic forms. The AI is
// the mock's fixed rules: no Gemini, Groq or job site is called, and nothing leaves this machine.
// The only Submit clicks are the test playing the Manager on the local form.
// Run with: npm run test:apply-e2e (skipped when Chrome is not installed; QTS_CHROME sets it).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const CHROME = [
  process.env.QTS_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((candidate) => candidate && fs.existsSync(candidate));
const HEADFUL = process.env.QTS_E2E_HEADFUL === '1';
const skip = CHROME ? false : 'Chrome is not installed (set QTS_CHROME to run this test).';

const PORT = 47133;
const BASE = `http://127.0.0.1:${PORT}`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF').toString('base64');

const EVENT_LOG = `<script>
  window.events = [];
  for (const type of ['input', 'change']) document.addEventListener(type, (event) => window.events.push({ type, id: event.target.id,
    value: event.target.type === 'file' ? [...event.target.files].map((file) => file.name).join() : event.target.value }), true);
</script>`;
const FORM_END = `<script>
  document.getElementById('app').addEventListener('submit', (event) => { event.preventDefault(); fetch('/page-submitted', { method: 'POST' }); });
</script>`;

// A form someone else has already filled: old text, an old choice, a tick, and an attached file.
const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - Apply</title></head><body>${EVENT_LOG}
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required value="Old Name"></div>
  <div><label for="em">Email *</label><input id="em" type="email" required value="old@person.com"></div>
  <div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>
  <div><label for="hear">How did you hear about us? *</label><select id="hear" required><option value="">Select…</option><option selected>Indeed</option><option>LinkedIn</option></select></div>
  <div><label for="mot">What motivates you in your work? *</label><textarea id="mot" required>Someone else's answer</textarea></div>
  <div id="cv-box"><label for="cv">Resume *</label><input id="cv" type="file" accept=".pdf" required><div id="old-file"><span>old_person_cv.pdf</span> <button type="button" id="rm" aria-label="Remove file">×</button></div></div>
  <div><label><input type="checkbox" id="privacy" required checked> I agree to the privacy policy *</label></div>
  <div><label for="ref">Referral code</label><input id="ref" value="KEEP-123"></div>
  <button type="submit" id="submit">Submit application</button>
</form>
<script>document.getElementById('rm').addEventListener('click', () => document.getElementById('old-file').remove());</script>${FORM_END}
</body></html>`;

// A question that appears after another answer.
const FORM_DYN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dyn - Apply</title></head><body>
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <div><label for="car">Do you own a car? *</label><select id="car" required><option value="">Select…</option><option>Yes</option><option>No</option></select></div>
  <div id="more" hidden><label for="model">Which car model do you drive? *</label><input id="model" required disabled></div>
  <button type="submit" id="submit">Submit application</button>
</form>
<script>
  document.getElementById('car').addEventListener('change', (event) => {
    const yes = event.target.value === 'Yes';
    document.getElementById('more').hidden = !yes;
    document.getElementById('model').disabled = !yes;
  });
</script>${FORM_END}
</body></html>`;

// Two steps in one page, moved on only by the site's own Next.
const FORM_STEPS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Steps - Apply</title></head><body>
<form id="app">
  <div id="step1">
    <h2>Details</h2>
    <div><label for="fn">First name *</label><input id="fn" required></div>
    <div><label for="em">Email *</label><input id="em" type="email" required></div>
    <div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>
    <div><label for="extra">Anything else you would like to share?</label><textarea id="extra"></textarea></div>
    <button type="button" id="next1">Next</button>
  </div>
  <div id="step2" style="display:none">
    <h2>About you</h2>
    <div><label for="mot">What motivates you in your work? *</label><span id="mot-help">${'Tell us in detail. '.repeat(30)}</span><textarea id="mot" aria-describedby="mot-help" required></textarea></div>
    <div><label for="note">What is your favourite colour? *</label><input id="note" required></div>
    <button type="button" id="back2">Back</button>
    <button type="submit" id="submit">Submit application</button>
  </div>
</form>
<script>
  const show = (n) => { document.getElementById('step1').style.display = n === 1 ? '' : 'none'; document.getElementById('step2').style.display = n === 2 ? '' : 'none'; };
  document.getElementById('next1').addEventListener('click', () => show(2));
  document.getElementById('back2').addEventListener('click', () => show(1));
</script>${FORM_END}
</body></html>`;

const SMALL_FORM = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - Apply</title></head><body>${body}
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <button type="submit" id="submit">Submit application</button>
</form>${FORM_END}
</body></html>`;

const FORM_FACTS = SMALL_FORM('').replace('<button type="submit" id="submit">', `
  <div><label for="spon">Do you need visa sponsorship? *</label><select id="spon" required><option value="">Select…</option><option>Yes</option><option>No</option></select></div>
  <div><label for="relo">Are you willing to relocate? *</label><select id="relo" required><option value="">Select…</option><option>Yes</option><option>No</option></select></div>
  <div><label for="pay">Expected salary *</label><input id="pay" required></div>
  <button type="submit" id="submit">`);

const JOB_GUEST = `<!doctype html><html><body><h1>A job</h1>
  <a href="/account-login">Sign in</a> <a href="/account-login?register=1">Create account</a>
  <button id="guest" onclick="location.href='/small'">Apply as guest</button>
</body></html>`;
const JOB_SHARED = `<!doctype html><html><body><header><a href="/logout">Sign out</a></header><h1>A job</h1><button id="go" onclick="location.href='${BASE}/small'">Apply on company site</button></body></html>`;
const ATS = `http://jobs.ats-example.com:${PORT}`;
const JOB_LATE = `<!doctype html><html><body><h1>A job</h1><p>${'About this role. '.repeat(30)}</p><div id="slot"></div><script>setTimeout(() => { document.getElementById('slot').innerHTML = '<a href="/small">Apply now</a>'; }, 6000);</script></body></html>`;
const JOB_NEW_TAB = '<!doctype html><html><body><h1>A job</h1><a target="_blank" href="/small">Apply now</a></body></html>';
// An application whose every step opens in a new tab (the site's own Next / Continue links), with side
// links (privacy policy, company website) that open tabs which are not part of it.
const TAB_FORM = (title, fields, links) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - ${title}</title></head><body>
<form id="app">${fields}<button type="submit" id="submit">Submit application</button></form>${links}${FORM_END}</body></html>`;
const TAB_FIELDS1 = '<div><label for="fn">First name *</label><input id="fn" required></div><div><label for="ln">Last name *</label><input id="ln" required></div><div><label for="em">Email *</label><input id="em" type="email" required></div><div><label for="extra">Anything else you would like to share?</label><textarea id="extra"></textarea></div>';
// Every way a first page leads on: start / continue links and buttons (new tabs, a pop-up window, one
// click opening two tabs, a step that does not load, another domain, a page with no form yet, a
// sign-in), unclear links, and side links (policy, company site, Google sign-in, an upload picker).
const TAB_LINKS1 = `<p><a id="privacy-link" target="_blank" href="/privacy">Privacy policy</a> <a id="company-link" target="_blank" href="/about">Company website</a></p>
<p><a id="learn-more" target="_blank" href="/tab-step2?via=learn">Learn more</a> <a id="details" target="_blank" href="/tab-plain">Details</a> <a id="view-job" target="_blank" href="/tab-plain?view=1">View job</a></p>
<p><button type="button" id="google" onclick="window.open('http://accounts.google.com:${PORT}/o/oauth2/auth', 'g', 'popup,width=500,height=600')">Sign in with Google</button>
<button type="button" id="dropbox" onclick="window.open('http://www.dropbox.com:${PORT}/chooser', 'd', 'popup,width=600,height=500')">Choose from Dropbox</button></p>
<p><button type="button" id="popup" onclick="window.open('/tab-step2?via=popup', 'step', 'popup,width=1000,height=800')">Continue in a window</button>
<button type="button" id="two" onclick="window.open('/privacy?two=1', '_blank'); window.open('/tab-step2?via=two', '_blank')">Continue to both</button></p>
<p><a id="broken" target="_blank" href="http://127.0.0.1:1/next">Next (broken)</a> <a id="ats" target="_blank" href="${ATS}/tab-signed-in">Continue on our hiring site</a>
<a id="intro" target="_blank" href="/tab-intro">Continue to the next part</a> <a id="account" target="_blank" href="/tab-signin">Continue to your account</a></p>
<a id="next" target="_blank" href="/tab-step2">Next</a>`;
const TAB_STEP1 = TAB_FORM('Apply', TAB_FIELDS1, TAB_LINKS1);
// The same first page with a question only the AI answers (Ask AI, then Next while it answers).
const TAB_AI = TAB_FORM('Apply', `${TAB_FIELDS1}<div><label for="mot">What motivates you in your work? *</label><textarea id="mot" required></textarea></div>`, '<a id="next" target="_blank" href="/tab-step2">Next</a>');
// A site's own pop-ups over everything: a cookie wall at the highest z-index, then a full-page popover.
const TAB_OVERLAY = TAB_FORM('Apply', TAB_FIELDS1, `<div id="cookie-wall" style="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55)"><button type="button">Accept cookies</button></div>
<div id="promo" popover="manual" style="inset:0;width:100vw;height:100vh;margin:0;border:0;background:rgba(200,0,0,.4)">Chat with us</div>
<script>setTimeout(() => document.getElementById('promo').showPopover(), 1500);</script>`);
// Search and suggestion boxes that search only on a REAL key press (a value set by a script finds
// nothing), each counting the letter keys it got and any simulated key event. The school list knows
// only one-word searches; the tool list never has the answer; skills take several (chips).
const SUGGEST_BOX = (id, label, required = true) => `<div><label for="${id}">${label}${required ? ' *' : ''}</label><div id="${id}-chips"></div><input id="${id}" role="combobox" aria-autocomplete="list" aria-controls="${id}-list" autocomplete="off"${required ? ' required' : ''}><ul id="${id}-list" role="listbox"></ul></div>`;
const SUGGEST_SCRIPT = `<script>
  window.typing = { untrusted: 0, letters: {}, searches: {} };
  const lists = {
    city: ['Cluj-Napoca, Romania', 'Cluj, Iowa, USA', 'Bucharest, Romania'],
    school: ['Babes-Bolyai University (UBB)', 'Technical University of Cluj-Napoca'],
    country: ['Romania', 'Russia', 'Rwanda'],
    skills: ['JavaScript', 'Java', 'Python', 'PostgreSQL'],
    tool: ['Hammer', 'Saw'],
    nationality: ['French', 'German'],
  };
  for (const id of Object.keys(lists)) {
    const box = document.getElementById(id);
    if (!box) continue;
    const list = document.getElementById(id + '-list');
    box.addEventListener('keydown', (event) => {
      if (!event.isTrusted) { if (event.key.length === 1) typing.untrusted += 1; return; }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) typing.letters[id] = (typing.letters[id] || 0) + 1;
    });
    box.addEventListener('keyup', (event) => {
      if (!event.isTrusted) return;
      const query = box.value.trim().toLowerCase();
      list.innerHTML = '';
      if (!query) return;
      (typing.searches[id] ||= []).push(box.value);
      if (id === 'school' && query.includes(' ')) return;
      for (const text of lists[id].filter((entry) => entry.toLowerCase().includes(query))) {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.textContent = text;
        item.addEventListener('mousedown', (down) => down.preventDefault());
        item.addEventListener('click', () => {
          if (id === 'skills') {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.textContent = text;
            document.getElementById('skills-chips').append(chip);
            box.value = '';
          } else box.value = text;
          list.innerHTML = '';
          box.dispatchEvent(new Event('change', { bubbles: true }));
        });
        list.append(item);
      }
    });
  }
</script>`;
const SUGGEST_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - Apply</title></head><body>
<form id="app">${SUGGEST_BOX('city', 'City')}${SUGGEST_BOX('school', 'School')}${SUGGEST_BOX('country', 'Country')}${SUGGEST_BOX('skills', 'Skills')}${SUGGEST_BOX('tool', 'Favourite tool')}
<button type="submit" id="submit">Submit application</button></form>${SUGGEST_SCRIPT}</body></html>`;
// An application form with suggestion boxes the profile answers (city, country) and one it cannot pick (nationality).
const SUGGEST_FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - Apply</title></head><body>
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  ${SUGGEST_BOX('city', 'City')}${SUGGEST_BOX('country', 'Country')}${SUGGEST_BOX('nationality', 'Nationality')}
  <button type="submit" id="submit">Submit application</button>
</form>${SUGGEST_SCRIPT}${FORM_END}</body></html>`;
const TAB_PLAIN = `<!doctype html><html><head><title>Globex careers</title></head><body><h1>Globex careers</h1><p>${'We build things people use. '.repeat(20)}</p></body></html>`;
const TAB_INTRO = `<!doctype html><html><head><title>Before you apply</title></head><body><h1>Before you apply</h1><p>${'Read this first. '.repeat(20)}</p><button id="start" onclick="location.href='/tab-step2?via=intro'">Start application</button></body></html>`;
const TAB_SIGNIN = `<!doctype html><html><head><title>Sign in</title></head><body><h1>Sign in to continue your application</h1>
<form id="login" onsubmit="event.preventDefault(); location.href='/tab-step2?via=signin'"><label for="email">Email</label><input id="email" type="email"><label for="password">Password</label><input id="password" type="password"><button type="submit">Sign in</button></form></body></html>`;
const TAB_STEP2 = TAB_FORM('Your details', '<div><label for="city">City *</label><input id="city" required></div><div><label for="ph">Phone *</label><input id="ph" type="tel" required></div>',
  '<a id="next" target="_blank" href="/tab-step3">Continue</a>');
const TAB_STEP3 = TAB_FORM('Review', '<div><label for="country">Country *</label><input id="country" required></div>', '');
const SIDE_PAGE = (title) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${'Some text about Globex. '.repeat(20)}</p></body></html>`;
const JOB_MODAL = `<!doctype html><html><body><h1>A job</h1><button id="open" onclick="document.getElementById('modal').hidden = false; this.remove();">Get started</button><div id="modal" hidden role="dialog"><form id="app"><div><label for="fn">First name *</label><input id="fn" required></div><div><label for="ln">Last name *</label><input id="ln" required></div><div><label for="em">Email *</label><input id="em" type="email" required></div><button type="submit">Submit application</button></form></div></body></html>`;
const JOB_REDIRECT = `<!doctype html><html><body><h1>A job</h1><a href="/go?to=${encodeURIComponent(`${ATS}/small`)}">Apply for this job</a></body></html>`;
const JOB_WRONG = `<!doctype html><html><body><h1>A job</h1><a href="${ATS}/other-vacancy">Apply for this job</a></body></html>`;
const OTHER_VACANCY = '<!doctype html><html lang="en"><head><title>Accountant at Initech</title></head><body><form id="app"><div><label for="fn">First name *</label><input id="fn" required></div><div><label for="ln">Last name *</label><input id="ln" required></div><div><label for="em">Email *</label><input id="em" type="email" required></div><button type="submit">Submit application</button></form></body></html>';
const JOB_HOSTED = `<!doctype html><html><body><h1>A job</h1><p>${'About this role. '.repeat(30)}</p><a id="hosted" href="http://smartapply.indeed.com:${PORT}/hosted">Apply now</a></body></html>`;
const JOB_EXTERNAL = `<!doctype html><html><body><h1>A job</h1><a id="hosted" href="/hosted-inner">Apply now</a> <a href="${ATS}/small">Apply on company site</a></body></html>`;
const JOB_NONE = `<!doctype html><html><body><h1>A job</h1><p>${'About this role. '.repeat(30)}</p></body></html>`;
const LOOP_A = '<!doctype html><html><body><h1>A</h1><a href="/loop-b">Apply now</a></body></html>';
const LOOP_B = '<!doctype html><html><body><h1>B</h1><a href="/loop-a">Continue to apply</a></body></html>';
const JOB_DIV = `<!doctype html><html><body><h1>A job</h1><div class="btn" onclick="location.href='/small'">Apply for this Position</div></body></html>`;
const JOB_BLOCKED = `<!doctype html><html><body><h1>A job</h1><p>Sign in to apply.</p><a href="/account-login">Sign in</a></body></html>`;
// Sign in: three social buttons and an email option that shows the email and password form.
const SIGN_IN_CHOICES = `<!doctype html><html><head><title>Sign In</title></head><body><h1>Sign In</h1>
  <button type="button" id="apple" onclick="fetch('/social-clicked?who=apple')">Sign in with Apple</button>
  <button type="button" id="google" onclick="fetch('/social-clicked?who=google')">Sign in with Google</button>
  <button type="button" id="linkedin" onclick="fetch('/social-clicked?who=linkedin')">Sign in with LinkedIn</button>
  <p>OR</p>
  <button type="button" id="with-email" onclick="document.getElementById('email-form').hidden = false; this.hidden = true;">Sign in with email</button>
  <form id="email-form" hidden onsubmit="event.preventDefault(); fetch('/account-login-submitted?email=' + encodeURIComponent(email.value) + '&password=' + encodeURIComponent(password.value)).then(() => { location.href = '/small'; });">
    <label for="email">Email</label><input id="email" type="email">
    <label for="password">Password</label><input id="password" type="password">
    <button type="submit">Sign in</button>
  </form>
</body></html>`;
// Create Account (as a Workday careers site shows it): email, password twice, the privacy agreement
// ("I Agree"), and a job-alerts box that must stay unticked.
const CREATE_ACCOUNT = `<!doctype html><html><head><title>Create Account</title></head><body><h1>Create Account</h1>
  <form id="create" onsubmit="event.preventDefault(); fetch('/account-login-submitted?email=' + encodeURIComponent(email.value) + '&password=' + encodeURIComponent(password.value) + '&agreed=' + agree.checked + '&alerts=' + alerts.checked).then(() => { location.href = '/small'; });">
    <label for="email">Email Address *</label><input id="email" type="email" required>
    <label for="password">Password *</label><input id="password" type="password" required>
    <label for="verify">Verify New Password *</label><input id="verify" type="password" required>
    <p>I have read, understood, and agree to the Global Candidate Privacy Notice.</p>
    <label><input type="checkbox" id="agree" required> I Agree</label>
    <label><input type="checkbox" id="alerts"> Send me job alerts about new jobs</label>
    <button type="submit">Create Account</button>
  </form>
  <p>Already have an account? <a href="/account-login">Sign In</a></p>
</body></html>`;
const ACCT_SIGNIN = (error) => `<!doctype html><html><head><title>Sign In</title></head><body><h1>Sign In</h1>
  ${error ? '<div role="alert" class="error">Incorrect email or password.</div>' : ''}
  <form id="signin" method="get" action="/acct-signin-submit">
    <label for="email">Email Address</label><input id="email" name="email" type="email">
    <label for="password">Password</label><input id="password" name="password" type="password">
    <button type="submit">Sign In</button>
  </form>
  <p>New here? <a href="/acct-create">Create Account</a></p>
</body></html>`;
const ACCT_CREATE = (exists) => `<!doctype html><html><head><title>Create Account</title></head><body><h1>Create Account</h1>
  ${exists ? '<div role="alert" class="error">An account with this email already exists.</div>' : ''}
  <form id="create" method="get" action="/acct-create-submit">
    <label for="email">Email Address *</label><input id="email" name="email" type="email" required>
    <label for="password">Password *</label><input id="password" name="password" type="password" required>
    <label for="verify">Verify New Password *</label><input id="verify" name="verify" type="password" required>
    <label><input type="checkbox" id="agree" name="agree" value="yes" required> I Agree</label>
    <button type="submit">Create Account</button>
  </form>
  <p>Already have an account? <a href="/acct-signin">Sign In</a></p>
</body></html>`;
const ACCT_VERIFY = '<!doctype html><html><head><title>Verify your email</title></head><body><h1>Verify your email</h1><p>We sent a verification code to your email. Enter the code to continue.</p><form><label for="code">Verification code</label><input id="code" name="code"><button type="submit">Verify</button></form></body></html>';
const GUEST_SIGNIN = `<!doctype html><html><head><title>Sign In</title></head><body><h1>Sign In</h1>
  <form method="get" action="/acct-signin-submit">
    <label for="email">Email Address</label><input id="email" name="email" type="email">
    <label for="password">Password</label><input id="password" name="password" type="password">
    <button type="submit">Sign In</button>
  </form>
  <p><a href="/acct-create">Create Account</a></p>
  <p><a id="guest" href="/small?via=guest">No account? Continue as guest</a></p>
</body></html>`;
const GUEST_CHOICE = `<!doctype html><html><head><title>How to apply</title></head><body><h1>How would you like to apply?</h1>
  <form id="choice" onsubmit="event.preventDefault(); location.href = document.getElementById('as-guest').checked ? '/small?via=choice' : '/acct-signin';">
    <label><input type="radio" name="how" id="as-member"> Sign in to my account</label>
    <label><input type="radio" name="how" id="as-guest"> Apply as a guest</label>
    <button type="submit">Continue</button>
  </form>
</body></html>`;
const GUEST_CREATE = ACCT_CREATE(false).replace('<p>Already have an account?', '<p><a id="no-account" href="/small?via=noaccount">Apply without an account</a></p><p>Already have an account?');
const JOB_NOOPENER = '<!doctype html><html><body><h1>A job</h1><p>About this role.</p><a target="_blank" rel="noopener" href="/small?via=noopener">Apply now</a></body></html>';
const ACCT_SPLIT = `<!doctype html><html><head><title>Sign In</title></head><body><h1>Sign In</h1>
  <div class="field"><label>Email Address *</label><input type="text" data-automation-id="email"></div>
  <form method="get" action="/acct-signin-submit" onsubmit="this.querySelector('[name=email]').value = document.querySelector('[data-automation-id=email]').value;">
    <input type="hidden" name="email">
    <label for="password">Password *</label><input id="password" name="password" type="password">
    <button type="submit">Sign In</button>
  </form>
</body></html>`;
// A phone section as Workday shows it: the device type, the country phone code as its own question
// (already on "Romania (+40)"), the number, and an optional extension.
const PHONE_SECTION = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Globex - Apply</title></head><body>
<form id="app">
  <div><label for="fn">First name *</label><input id="fn" required></div>
  <div><label for="ln">Last name *</label><input id="ln" required></div>
  <div><label for="em">Email *</label><input id="em" type="email" required></div>
  <section><h3>Phone</h3>
    <div><label for="ptype">Phone Device Type *</label><select id="ptype" required><option value="">Select One</option><option>Home</option><option>Mobile</option><option>Work</option></select></div>
    <div class="code-field"><label for="pcode">Country Phone Code *</label><span class="chip">Romania (+40)</span><input id="pcode" aria-label="Country Phone Code" readonly></div>
    <div><label for="pnum">Phone Number *</label><input id="pnum" type="tel" required></div>
    <div><label for="pext">Phone Extension</label><input id="pext"></div>
  </section>
  <button type="submit" id="submit">Submit application</button>
</form>${FORM_END}</body></html>`;
// A site that rebuilds its page and throws QTS's panel out, once.
const PANEL_THIEF = SMALL_FORM(`<script>setTimeout(() => { const panel = document.querySelector('[data-qts-apply-review]'); if (panel) { panel.remove(); window.panelThrownOut = true; } }, 4000);</script>`);
const ACCOUNT_LOGIN = `<!doctype html><html><body>
  <form onsubmit="event.preventDefault(); fetch('/account-login-submitted?email=' + encodeURIComponent(email.value) + '&password=' + encodeURIComponent(password.value)).then(() => { location.href = '/small'; });">
    <label for="email">Email</label><input id="email" type="email">
    <label for="password">Password</label><input id="password" name="password" type="password">
    <button type="submit">Sign in</button>
  </form>
</body></html>`;

const attempt = (n) => `00000000-0000-4000-8000-00000000a${String(n).padStart(3, '0')}`;
const jobId = (n) => `00000000-0000-4000-8000-00000000b${String(n).padStart(3, '0')}`;
const ANA = { id: '00000000-0000-4000-8000-0000000000aa', candidateId: '00000000-0000-4000-8000-0000000000aa', firstName: 'Ana', lastName: 'Test', email: 'ana.test@example.com', phone: '+40264484948', city: 'Cluj-Napoca', country: 'Romania', nationality: 'Romanian', gender: 'woman', yearsOfExperience: 6 };
const BEN = { ...ANA, id: '00000000-0000-4000-8000-0000000000bb', candidateId: '00000000-0000-4000-8000-0000000000bb', firstName: 'Ben', lastName: 'Stone', email: 'ben.stone@example.com' };
const PROMPT = 'Profile: {{candidate_profile}}\nDocs: {{resume_and_cover_letter}}\nSaved: {{saved_answers}}\nQuestions:\n{{questions}}';
// The Manager's Stop all count when the job was taken (sent back with each check-in).
const STOP_VERSION = 3;
const application = (n, form, candidate = ANA, query = '') => ({
  attemptId: attempt(n),
  applyStopVersion: STOP_VERSION,
  aiMode: 'chatgpt',
  autoApplyApi: true,
  // Super Admin's settings say "submit by itself": QTS must still stop for the Manager.
  autoSubmit: true,
  reviewMode: 'every_step',
  job: {
    id: jobId(n), url: `${BASE}/${form}?job=${n}${query}`, title: 'Backend Engineer', company: 'Globex', location: 'Remote', workType: 'Remote', salary: null,
    description: 'We use Python and AWS.', resumeFolder: 'C:\\test-folder', resumeSavedOn: 'Test Chrome', promptName: 'Test prompt', templateName: 'Test template',
    resumeText: 'Backend Engineer since 2019.', coverLetterText: 'Dear Hiring Manager,\nHello.\nKind regards',
  },
  candidate: candidate,
  profileDetails: { experiences: [], educations: [] },
  savedAnswers: [],
  exchangeRates: null,
  rememberedChoices: [],
  answerPrompt: { id: 'p', template: PROMPT },
  siteAccountPassword: 'SavedEmployerPassword123!',
});

function aiReply(prompt) {
  const marker = prompt.lastIndexOf('Questions:\n');
  let questions = [];
  try { questions = JSON.parse(prompt.slice(marker + 11).split('\n')[0]); } catch { questions = []; }
  mock.asked.push(questions.map((question) => question.question.replace(/\s*\*\s*$/, '')));
  const person = /"email":"ben\.stone/.test(prompt) ? BEN : ANA;
  return JSON.stringify({ answers: questions.map((question) => {
    const value = (text) => ({ id: question.id, value: text, status: 'ready' });
    if (/first name/i.test(question.question)) return value(person.firstName);
    if (/last name/i.test(question.question)) return value(person.lastName);
    if (/email/i.test(question.question)) return value(mock.wrongEmail ? 'someone.else@example.com' : person.email);
    if (/phone/i.test(question.question)) return value(person.phone);
    if (/hear about/i.test(question.question)) return value('LinkedIn');
    if (/motivates/i.test(question.question)) return value(mock.longAnswer ? 'Reliable services. '.repeat(50) : 'Building reliable services.');
    if (/own a car/i.test(question.question)) return value('Yes');
    if (/car model/i.test(question.question)) return value('Dacia Logan');
    if (/colour/i.test(question.question)) return value('Blue');
    if (/sponsorship/i.test(question.question)) return value('No');
    if (/relocate/i.test(question.question)) return value('No');
    if (/salary/i.test(question.question)) return value('5500');
    return { id: question.id, value: null, status: 'review', reason: 'not in the documents' };
  }) });
}

const mock = {};
function resetMock(options = {}) {
  Object.assign(mock, {
    log: [], answers: 0, prompts: [], asked: [], released: [], reviews: [], submitted: [], results: [], accountLogins: [], cookies: [], claimBodies: [],
    pageSubmitted: 0, claims: 0, byAttempt: {}, queue: options.queue || [],
    autoApplyParallelLimit: options.autoApplyParallelLimit ?? 1,
    answerDelay: options.answerDelay || 0,
    aiMode: options.aiMode || 'rules',
    wrongEmail: options.wrongEmail === true,
    longAnswer: options.longAnswer === true,
    canUseAutoApply: options.canUseAutoApply ?? true,
    heartbeats: [], heartbeatMode: options.heartbeatMode || 'ok', savedBids: [], removeJobs: [], socialClicks: [],
    accounts: { ...(options.accounts || {}) }, acctLogins: [], acctCreates: [], verifyAfterCreate: options.verifyAfterCreate === true,
    holdGone: options.holdGone === true, removeRefused: options.removeRefused || null,
  });
}
resetMock();

const SIGNED_IN = '<header>Signed in as <b>ben.stone@example.com</b> <a href="/logout">Sign out</a></header>';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, BASE);
    mock.log.push({ at: Date.now(), method: req.method, path: url.pathname });
    const data = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    const json = (payload, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify(payload)); };
    const html = (text, headers = {}) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers }); res.end(text); };
    const cookie = req.headers.cookie || '';
    if (url.pathname === '/form') return html(FORM);
    if (url.pathname === '/dyn') return html(FORM_DYN);
    if (url.pathname === '/steps') return html(FORM_STEPS);
    if (url.pathname === '/small') return html(SMALL_FORM(''));
    if (url.pathname === '/facts') return html(FORM_FACTS);
    if (url.pathname === '/job-guest') return html(JOB_GUEST);
    if (url.pathname === '/job-blocked') return html(JOB_BLOCKED);
    if (url.pathname === '/job-shared') return html(JOB_SHARED);
    if (url.pathname === '/job-div') return html(JOB_DIV);
    if (url.pathname === '/job-late') return html(JOB_LATE);
    if (url.pathname === '/job-new-tab') return html(JOB_NEW_TAB);
    if (url.pathname === '/job-modal') return html(JOB_MODAL);
    if (url.pathname === '/tab-step1') return html(TAB_STEP1);
    if (url.pathname === '/tab-step2') return html(TAB_STEP2);
    if (url.pathname === '/tab-step3') return html(TAB_STEP3);
    if (url.pathname === '/privacy') return html(SIDE_PAGE('Privacy policy'));
    if (url.pathname === '/about') return html(SIDE_PAGE('About Globex'));
    if (url.pathname === '/tab-ai') return html(TAB_AI);
    if (url.pathname === '/tab-overlay') return html(TAB_OVERLAY);
    if (url.pathname === '/tab-plain') return html(TAB_PLAIN);
    if (url.pathname === '/suggest') return html(SUGGEST_PAGE);
    if (url.pathname === '/suggest-form') return html(SUGGEST_FORM);
    if (url.pathname === '/tab-intro') return html(TAB_INTRO);
    if (url.pathname === '/tab-signin') return html(TAB_SIGNIN);
    if (url.pathname === '/o/oauth2/auth') return html(SIDE_PAGE('Sign in - Google Accounts'));
    if (url.pathname === '/chooser') return html(SIDE_PAGE('Dropbox Chooser'));
    // The next step on another domain, signed in as another candidate for as long as its cookie is there.
    if (url.pathname === '/tab-signed-in') {
      mock.cookies.push({ job: 'tab-signed-in', cookie });
      return html(TAB_STEP2.replace('<form id="app">', `${cookie.includes('site_session=ben') ? SIGNED_IN : ''}<form id="app">`));
    }
    if (url.pathname === '/job-redirect') return html(JOB_REDIRECT);
    if (url.pathname === '/job-wrong') return html(JOB_WRONG);
    if (url.pathname === '/other-vacancy') return html(OTHER_VACANCY);
    if (url.pathname === '/job-hosted') return html(JOB_HOSTED);
    if (url.pathname === '/job-external') return html(JOB_EXTERNAL);
    if (url.pathname === '/job-none') return html(JOB_NONE);
    if (url.pathname === '/loop-a') return html(LOOP_A);
    if (url.pathname === '/loop-b') return html(LOOP_B);
    if (url.pathname === '/hosted') { mock.hostedOpened = (mock.hostedOpened || 0) + 1; return html('<!doctype html><title>Indeed Apply</title><h1>Hosted</h1>'); }
    if (url.pathname === '/go') { res.writeHead(302, { Location: url.searchParams.get('to') }); res.end(); return undefined; }
    if (url.pathname === '/account-login') return html(ACCOUNT_LOGIN);
    if (url.pathname === '/sign-in-choices') return html(SIGN_IN_CHOICES);
    if (url.pathname === '/create-account') return html(CREATE_ACCOUNT);
    if (url.pathname === '/acct-signin') return html(ACCT_SIGNIN(url.searchParams.get('error') === '1'));
    if (url.pathname === '/acct-create') return html(ACCT_CREATE(url.searchParams.get('exists') === '1'));
    if (url.pathname === '/acct-verify') return html(ACCT_VERIFY);
    if (url.pathname === '/guest-signin') return html(GUEST_SIGNIN);
    if (url.pathname === '/guest-choice') return html(GUEST_CHOICE);
    if (url.pathname === '/guest-create') return html(GUEST_CREATE);
    if (url.pathname === '/job-noopener') return html(JOB_NOOPENER);
    if (url.pathname === '/acct-split') return html(ACCT_SPLIT);
    if (url.pathname === '/phone-section') return html(PHONE_SECTION);
    const goTo = (where) => { res.writeHead(302, { Location: where }); res.end(); };
    if (url.pathname === '/acct-signin-submit') {
      const email = url.searchParams.get('email');
      mock.acctLogins.push({ email, password: url.searchParams.get('password') });
      return goTo(mock.accounts[email] && mock.accounts[email] === url.searchParams.get('password') ? '/small' : '/acct-signin?error=1');
    }
    if (url.pathname === '/acct-create-submit') {
      const email = url.searchParams.get('email');
      mock.acctCreates.push({ email, password: url.searchParams.get('password'), verify: url.searchParams.get('verify'), agree: url.searchParams.get('agree') });
      if (mock.accounts[email]) return goTo('/acct-create?exists=1');
      mock.accounts[email] = url.searchParams.get('password');
      return goTo(mock.verifyAfterCreate ? '/acct-verify' : '/acct-signin');
    }
    if (url.pathname === '/panel-thief') return html(PANEL_THIEF);
    if (url.pathname === '/social-clicked') { mock.socialClicks.push(url.searchParams.get('who')); return json({}); }
    if (url.pathname === '/account-login-submitted') {
      mock.accountLogins.push({ email: url.searchParams.get('email'), password: url.searchParams.get('password'), ...(url.searchParams.has('agreed') ? { agreed: url.searchParams.get('agreed'), alerts: url.searchParams.get('alerts') } : {}) });
      return json({});
    }
    // A site that remembers: a session cookie and a draft in the browser's storage.
    if (url.pathname === '/site') {
      mock.cookies.push({ job: url.searchParams.get('job'), cookie });
      const who = url.searchParams.get('who');
      return html(SMALL_FORM(`<script>window.draftFound = localStorage.getItem('draft'); localStorage.setItem('draft', ${JSON.stringify(who)});</script>`), { 'Set-Cookie': `site_session=${who}; Path=/` });
    }
    // Shows another account for as long as its cookie is there.
    if (url.pathname === '/signed-in') {
      mock.cookies.push({ job: url.searchParams.get('job'), cookie });
      return html(SMALL_FORM(cookie.includes('site_session=ben') ? SIGNED_IN : ''));
    }
    if (url.pathname === '/unknown-account') return html(SMALL_FORM('<header><a href="/logout">Sign out</a></header>'));
    // Another account appears only after QTS has filled the form.
    if (url.pathname === '/late-account') {
      return html(SMALL_FORM(`<div id="late"></div><script>document.addEventListener('input', (event) => { if (event.target.id === 'em') document.getElementById('late').innerHTML = ${JSON.stringify(SIGNED_IN)}; }, true);</script>`));
    }
    if (url.pathname === '/blank') return html('<!doctype html><title>Blank</title><h1>Blank</h1>');
    if (url.pathname === '/page-submitted') { mock.pageSubmitted += 1; return json({}); }
    if (url.pathname === '/api/extension/features/me') return json({ success: true, features: { canUseApply: true, canUseAutoApply: mock.canUseAutoApply, autoApplyParallelLimit: mock.autoApplyParallelLimit } });
    if (url.pathname === '/api/extension/apply/claim') {
      mock.claims += 1;
      mock.claimBodies.push(data);
      const selection = data.selection;
      const index = selection
        ? mock.queue.findIndex((entry) => (selection.candidateId == null || entry.candidate.id === selection.candidateId) && selection.jobIds.includes(entry.job.id))
        : 0;
      const next = index >= 0 ? mock.queue.splice(index, 1)[0] || null : null;
      if (next) mock.byAttempt[next.attemptId] = next;
      return json({ success: true, application: next });
    }
    if (url.pathname === '/api/extension/apply/resume') return json({ success: true, application: mock.byAttempt[data.attemptId] || null });
    // Check-ins: "lost" never renews (another Chrome holds the job); "recover" renews only with the job
    // and the Stop all count the application was taken with (a hold that ran out, taken back).
    if (url.pathname === '/api/extension/apply/heartbeat') {
      mock.heartbeats.push(data);
      const held = mock.heartbeatMode === 'lost' ? false
        : mock.heartbeatMode === 'recover' ? data.jobId && data.stopVersion === STOP_VERSION : true;
      return held ? json({ success: true, leaseSeconds: 120, reviewMode: 'every_step', autoSubmit: true }) : json({ success: false, message: 'This application is no longer held by this Chrome.' }, 409);
    }
    if (url.pathname === '/api/extension/apply/save-bid') { mock.savedBids.push(data); return json({ success: true }); }
    if (url.pathname === '/api/extension/apply/remove-job') {
      mock.removeJobs.push(data);
      return mock.removeRefused ? json({ success: false, message: mock.removeRefused }, 409) : json({ success: true });
    }
    if (url.pathname === '/api/extension/apply/answers') {
      mock.answers += 1;
      if (mock.aiMode === 'quota') return json({ success: false, retry: false, message: 'Every key has used its limit for today.' }, 429);
      const prompt = (data.turns || []).at(-1)?.text || '';
      mock.prompts.push(prompt);
      setTimeout(() => json({ success: true, reply: aiReply(prompt) }), mock.answerDelay);
      return undefined;
    }
    if (url.pathname === '/api/extension/apply/documents') {
      const { firstName, lastName } = mock.byAttempt[url.searchParams.get('attemptId')].candidate;
      return json({ success: true, documents: {
        resumePath: `QTS_Resume/Manager/${firstName} ${lastName}/Run/${firstName} ${lastName}.pdf`,
        coverLetterPath: `QTS_Resume/Manager/${firstName} ${lastName}/Run/${firstName} ${lastName}_Cover_Letter.pdf`,
      } });
    }
    if (url.pathname === '/api/extension/apply/review') { mock.reviews.push(data); return json({ success: true }); }
    // (holdGone: the application record is no longer this Chrome's: Submitted saves the bid from the job.)
    if (url.pathname === '/api/extension/apply/submitted') { mock.submitted.push(data); return mock.holdGone ? json({ success: false, message: 'Not held.' }, 409) : json({ success: true }); }
    if (url.pathname === '/api/extension/apply/result') { mock.results.push(data); return json({ success: true, result: 'confirmed' }); }
    if (url.pathname === '/api/extension/apply/release') {
      mock.released.push(data);
      return (mock.holdGone || mock.removeRefused) && data.mode === 'remove' ? json({ success: false, message: 'Not held.' }, 409) : json({ success: true });
    }
    if (url.pathname === '/api/extension/browsers/heartbeat') return json({ success: true, generationStopVersion: 0, applyStopVersion: 0, minWorkExtensionVersion: '1.36.0' });
    return json({ success: true });
  });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(200);
  }
}

async function connectWorker(target) {
  const session = await target.createCDPSession();
  // QTS_E2E_WORKER_LOG=1: the worker's own log (its diagnostics) printed with the test's output.
  if (process.env.QTS_E2E_WORKER_LOG === '1') {
    session.on('Runtime.consoleAPICalled', (event) => console.error('[worker]', event.args.map((arg) => (arg.value !== undefined ? JSON.stringify(arg.value) : arg.preview ? '{' + arg.preview.properties.map((entry) => entry.name + ': ' + entry.value).join(', ') + '}' : arg.description || arg.type)).join(' ').slice(0, 800)));
    await session.send('Runtime.enable').catch(() => {});
  }
  await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
  return {
    evaluate: (fn, ...args) => Promise.race([
      session.send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }).then((reply) => {
        if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
        return reply.result.value;
      }),
      sleep(30000).then(() => { throw new Error('the extension worker did not answer within 30 s'); }),
    ]),
  };
}

async function launch() {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: !HEADFUL, pipe: true, protocolTimeout: 600000, defaultViewport: HEADFUL ? null : { width: 1280, height: 900 },
    // indeed.com stands in for a site nobody is signed out of; it is mapped here, so nothing reaches it.
    enableExtensions: [path.join(root, 'extension')], args: ['--no-first-run', '--disable-popup-blocking', '--window-size=1300,950', '--host-resolver-rules=MAP www.indeed.com 127.0.0.1, MAP smartapply.indeed.com 127.0.0.1, MAP jobs.ats-example.com 127.0.0.1, MAP accounts.google.com 127.0.0.1, MAP www.dropbox.com 127.0.0.1, MAP globex.wd3.myworkdayjobs.com 127.0.0.1'],
  });
  const target = await browser.waitForTarget((entry) => entry.type() === 'service_worker' && entry.url().includes('service-worker.js'), { timeout: 30000 });
  const extensionId = new URL(target.url()).host;
  let worker = await connectWorker(target);
  await until(() => Promise.race([
    worker.evaluate(() => typeof chrome !== 'undefined' && Boolean(self.__qtsAutoApplyApi)).catch(() => false),
    sleep(3000).then(() => false),
  ]), 30000, 'the extension worker to load');
  await worker.evaluate(async (base) => {
    await chrome.storage.local.set({
      qtsServerUrl: base, authToken: 'e2e-test-token', authExpiresAt: Date.now() + 3600 * 1000,
      qtsSessionUser: { id: 'e2e', role: 'manager', displayName: 'E2E' }, qtsApplyDebug: true, qtsBrowserName: 'E2E Chrome',
      qtsAutoApplyFillOnKey: false,
    });
  }, BASE);
  const installWorkerMocks = () => worker.evaluate((documentPdf) => {
    Object.defineProperty(self, '__qtsScannerDocumentStore', { configurable: true, value: { getSetting: async (key) => ({ value: key === 'applyPdfDownloadsDirectoryV1' ? {} : null }) } });
    Object.defineProperty(self, '__qtsApplyLocalPdfs', { configurable: true, value: {
      SETTING_KEY: 'applyPdfDownloadsDirectoryV1',
      readApplyDocuments: async () => ({
        resume: { filename: 'Ana_Test_CV.pdf', base64: documentPdf, mimeType: 'application/pdf' },
        coverLetter: { filename: 'Ana_Test_Cover.pdf', base64: documentPdf, mimeType: 'application/pdf' },
      }),
    } });
  }, pdf);
  await installWorkerMocks();
  // QTS_E2E_WORKER_LOG=1: every tab QTS closes is logged with where it was closed from.
  if (process.env.QTS_E2E_WORKER_LOG === '1') await worker.evaluate(() => { const remove = chrome.tabs.remove.bind(chrome.tabs); chrome.tabs.remove = (id, ...rest) => { console.error('tabs.remove', JSON.stringify(id), String(new Error().stack).split(String.fromCharCode(10)).slice(2, 6).join(' | ')); return remove(id, ...rest); }; });
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup/popup.html`).catch(() => {});
  const action = (name, selection) => control.evaluate(({ act, workSelection }) => chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: act, ...(workSelection ? { selection: workSelection } : {}) }), { act: name, workSelection: selection });
  const storage = (keys) => worker.evaluate((k) => chrome.storage.local.get(k), keys);
  globalThis.__askAi = () => worker.evaluate(() => self.__qtsAutoApplyTabs.askAi());
  globalThis.__worker = () => worker;
  globalThis.__diag = () => worker.evaluate(() => [...activeReviews.values()].map((review) => ({ mode: review.panel?.mode, text: review.panel?.workingText, problems: review.panel?.problems, waiting: reviewWaiters.has(review.attemptId) })));
  // The worker stops (restarted, updated, asleep) and a new one wakes (here: the popup opened).
  const restartWorker = async () => {
    await worker.evaluate(() => { self.__beforeStop = true; });
    const cdp = await browser.target().createCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets');
    const running = targetInfos.find((info) => info.type === 'service_worker' && info.url.includes('service-worker.js'));
    await cdp.send('Target.closeTarget', { targetId: running.targetId });
    const wake = await browser.newPage();
    await wake.goto(`chrome-extension://${extensionId}/popup/popup.html`).catch(() => {});
    worker = await until(async () => {
      for (const entry of browser.targets().filter((t) => t.type() === 'service_worker' && t.url().includes('service-worker.js'))) {
        const candidate = await connectWorker(entry).catch(() => null);
        const fresh = candidate && await Promise.race([
          candidate.evaluate(() => !self.__beforeStop && Boolean(self.__qtsAutoApply)).catch(() => false),
          sleep(3000).then(() => false),
        ]);
        if (fresh) return candidate;
      }
      return null;
    }, 30000, 'a new worker');
    await installWorkerMocks();
    await wake.close().catch(() => {});
  };
  return { browser, get worker() { return worker; }, action, storage, restartWorker };
}

const formPage = async (browser, prefix) => (await browser.pages()).find((page) => page.url().startsWith(`${BASE}${prefix}`));

async function waitForStep(storage, step, ms = 60000) {
  let run = null;
  try {
    return await until(async () => {
      run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
      return run && run.step === step && ['needs_you', 'final'].includes(run.phase) ? run : null;
    }, ms, `step ${step} waiting for the Manager`);
  } catch (error) {
    const { lastRun } = { lastRun: (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.last };
    if (globalThis.__diag) error.message += `; worker: ${JSON.stringify(await globalThis.__diag().catch((e) => e.message))?.slice(0, 900)}`;
    error.message += `; run: ${JSON.stringify(run)?.slice(0, 500)}; last: ${JSON.stringify(lastRun)?.slice(0, 500)}; released: ${JSON.stringify(mock.released)}`;
    throw error;
  }
}

async function panelNodes(page) {
  const client = await page.createCDPSession();
  const { root: doc } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  return { client, doc };
}
async function clickPanelButton(page, label) {
  const { client, doc } = await panelNodes(page);
  try {
    const found = [];
    const walk = (node) => {
      if (node.nodeName === 'BUTTON') found.push(node);
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child);
    };
    walk(doc);
    for (const node of found) {
      const { outerHTML } = await client.send('DOM.getOuterHTML', { nodeId: node.nodeId });
      if (outerHTML.replace(/<[^>]+>/g, '').trim() !== label) continue;
      const { model } = await client.send('DOM.getBoxModel', { nodeId: node.nodeId });
      const [x1, y1, , , x3, y3] = model.content;
      await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
      return true;
    }
    return false;
  } finally {
    await client.detach().catch(() => {});
  }
}
async function panelText(page) {
  const { client, doc } = await panelNodes(page);
  try {
    let text = '';
    const walk = (node) => {
      if (node.nodeType === 3) text += `${node.nodeValue} `;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) walk(child);
    };
    const host = (function find(node) {
      if (node.attributes?.includes('data-qts-apply-review')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const hit = find(child); if (hit) return hit; }
      return null;
    })(doc);
    if (host) walk(host);
    return text.replace(/\s+/g, ' ');
  } finally {
    await client.detach().catch(() => {});
  }
}
const until_panel = async (page, pattern, ms = 30000) => {
  let last = '';
  try {
    return await until(async () => { last = await panelText(page).catch(() => ''); return pattern.test(last) ? last : null; }, ms, `the panel to say ${pattern}`);
  } catch (error) {
    error.message += `; the panel says: ${last.slice(-1100)}`;
    throw error;
  }
};
// Only once the worker is waiting: a click before that has nobody to answer it.
const pressPanel = (page, label) => until(async () => {
  if (!(await globalThis.__diag()).some((review) => review.waiting)) return false;
  return clickPanelButton(page, label).catch(() => false);
}, 20000, `the panel's ${label}`);
const valueOf = (page, id) => page.evaluate((box) => document.getElementById(box).value, id);
// The AI is asked only when the Manager clicks the panel's Ask AI. Like a Manager, the test then waits
// until the panel is back in review (QTS has finished typing and checking the answers).
const askAi = async (page, { wait = true } = {}) => {
  const before = mock.answers;
  // Alt+A (the panel has no Ask AI button): Chrome's shortcut, run by the worker on the page in front.
  await until(async () => (await globalThis.__diag()).some((review) => review.waiting && review.mode === 'review'), 20000, 'the review to wait');
  await page.bringToFront();
  await until(async () => (await globalThis.__askAi()) === 'asked', 20000, 'Alt+A to ask');
  if (!wait) return;
  await until(() => mock.answers > before, 30000, 'the AI request');
  await until(async () => (await globalThis.__diag()).some((review) => review.waiting && review.mode === 'review'), 60000, 'the review after Ask AI');
};
// A box emptied the way a page script would (not the Manager's typing, which QTS never touches).
const emptyBox = (page, id) => page.evaluate((box) => { document.getElementById(box).value = ''; }, id);

test.before(() => new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve)));
test.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

test('the form is filled from the profile and documents without AI (what the site put in boxes QTS has no answer for stays); Ask AI answers what is left; QTS never submits', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(1, 'form')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    // The profile and the documents in (over what was there); nothing emptied; no AI request by itself.
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    assert.equal(await valueOf(form, 'em'), 'ana.test@example.com');
    assert.equal(await valueOf(form, 'ph'), '+40264484948');
    assert.equal(await valueOf(form, 'hear'), 'Indeed', 'a choice QTS has no answer for stays as the site had it');
    assert.equal(await valueOf(form, 'mot'), "Someone else's answer", 'nothing emptied, nothing invented');
    assert.equal(await valueOf(form, 'ref'), 'KEEP-123', 'a referral code the site put there stays');
    assert.equal(await form.evaluate(() => document.getElementById('privacy').checked), true);
    assert.equal(await form.evaluate(() => document.getElementById('cv').files[0]?.name), 'Ana_Test_CV.pdf');
    const events = await form.evaluate(() => window.events);
    const uploadedAt = events.findIndex((event) => event.id === 'cv' && event.value === 'Ana_Test_CV.pdf');
    const filledAt = events.findIndex((event) => event.id === 'fn' && event.value === 'Ana');
    assert.ok(uploadedAt >= 0 && filledAt > uploadedAt, `upload ${uploadedAt} before fill ${filledAt}`);
    await sleep(2000);
    assert.equal(mock.answers, 0, 'the AI is never asked by itself');

    // The Manager empties two boxes; Ask AI: one request, only about the boxes now empty.
    await emptyBox(form, 'hear');
    await emptyBox(form, 'mot');
    await askAi(form);
    await until(() => mock.answers === 1, 30000, 'the AI request');
    await until(async () => await valueOf(form, 'mot') === 'Building reliable services.', 30000, 'the AI answers to be filled');
    assert.equal(await valueOf(form, 'hear'), 'LinkedIn');
    assert.deepEqual([...mock.asked[0]].sort(), ['How did you hear about us?', 'What motivates you in your work?']);
    assert.match(mock.prompts[0], /ana\.test@example\.com/);
    assert.doesNotMatch(mock.prompts[0], /diversityAnswers/);
    assert.equal(await valueOf(form, 'fn'), 'Ana', 'what was filled stays');

    // The site's Submit is neither held nor taken as the bid; nothing is submitted by QTS.
    await sleep(1500);
    assert.equal(mock.pageSubmitted, 0, 'QTS never submits by itself');
    await form.click('#submit');
    await until(() => mock.pageSubmitted === 1, 15000, 'the Manager\'s own Submit');
    await sleep(1500);
    assert.equal(mock.submitted.length, 0, 'the site\'s Submit is not recorded as the bid');
  } finally { await browser.close(); }
});

test('Submitted saves the bid at once, on any step, and the tab closes', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(60, 'steps')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/steps');
    // Step 1 of 2, with things still to do: Submitted is there and works.
    await until_panel(form, /Submitted/);
    await pressPanel(form, 'Submitted');
    await until(() => mock.results.length === 1, 20000, 'the bid');
    assert.equal(mock.submitted.length, 1);
    assert.equal(mock.results[0].submitted, true);
    assert.equal(mock.results[0].removeJob, true, 'the job leaves the Jobs list');
    assert.ok((mock.results[0].appliedAnswers || []).some((entry) => entry.answer === 'Ana'), 'the form\'s answers go with the bid');
    await until(async () => !(await formPage(browser, '/steps')), 20000, 'the tab to close');
    assert.equal(mock.released.length, 0, 'nothing given back');
    assert.equal(mock.pageSubmitted, 0);
  } finally { await browser.close(); }
});

test('Submitted while the AI is answering stops it and saves the bid', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(61, 'form')], answerDelay: 15000 });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await emptyBox(form, 'mot');
    await askAi(form, { wait: false });
    await until(() => mock.answers === 1, 30000, 'the AI request');
    await until_panel(form, /Asking the AI/);
    assert.equal(await clickPanelButton(form, 'Submitted'), true, 'Submitted is there while QTS works');
    await until(() => mock.results.length === 1, 20000, 'the bid');
    assert.equal(mock.results[0].removeJob, true);
    await until(async () => !(await formPage(browser, '/form')), 20000, 'the tab to close');
    await sleep(16000);
    assert.equal(mock.released.length, 0, 'nothing given back');
    assert.equal(mock.results.length, 1, 'one bid');
  } finally { await browser.close(); }
});

test('the panel is on the job page while QTS looks for the form, with Submitted', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(62, 'job-late')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const page = await until(() => formPage(browser, '/job-late'), 30000, 'the job page');
    const text = await until_panel(page, /Finding the application form|Opening the job page/);
    assert.match(text, /Ana Test/);
    assert.match(text, /Backend Engineer — Globex/);
    assert.match(text, /Submitted/);
    await waitForStep(storage, 1);
    assert.ok(await formPage(browser, '/small'), 'and QTS still reached the form');
  } finally { await browser.close(); }
});

test('without Super Admin\'s "Auto Apply with APIs" Auto Apply does not start', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(63, 'small')], canUseAutoApply: false });
  const { browser, action } = await launch();
  try {
    const reply = await action('auto_apply');
    assert.equal(reply.ok, false);
    assert.match(reply.error, /Auto Apply with APIs/);
    await sleep(1500);
    assert.equal(mock.claims, 0, 'no job is taken');
  } finally { await browser.close(); }
});

test('the panel lists only the required questions still empty, with the profile\'s answers; Fill puts one in and it leaves the list', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(64, 'small')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/small');
    const filled = await until_panel(form, /✉ Letter/);
    assert.match(filled, /💬 Answer/);
    assert.doesNotMatch(filled, /Still empty on this page/, 'all filled: no list');
    // The Manager clears First name (a real edit: the panel reads the form again).
    await form.evaluate(() => { const box = document.getElementById('fn'); box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true })); });
    const text = await until_panel(form, /Still empty on this page \(1\)/);
    assert.match(text, /First name \* Ana/);
    // ("(1)": the filled boxes, Email among them, are not listed.)
    assert.equal(await clickPanelButton(form, 'Fill'), true);
    await until(async () => await valueOf(form, 'fn') === 'Ana', 15000, 'First name filled from the panel');
    await until(async () => !/Still empty on this page/.test(await panelText(form)), 15000, 'the list is gone once filled');
    assert.equal(mock.answers, 0);
  } finally { await browser.close(); }
});

test('an AI answer that changes a profile fact is replaced by the profile, and the Manager is told', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(2, 'small')], wrongEmail: true });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/small');
    assert.equal(await valueOf(form, 'em'), 'ana.test@example.com');
    await emptyBox(form, 'em');
    await askAi(form);
    await until(() => mock.answers === 1, 30000, 'the AI request');
    await until_panel(form, /someone\.else@example\.com.*QTS used the profile/);
    assert.equal(await valueOf(form, 'em'), 'ana.test@example.com');
  } finally { await browser.close(); }
});

test('when the AI has no answers nothing is filled from it, and Ask AI again finishes the page', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(3, 'form')], aiMode: 'quota' });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await emptyBox(form, 'mot');
    await askAi(form);
    await until_panel(form, /The AI did not answer/);
    assert.equal(mock.answers, 1, 'a day\'s limit is not retried');
    assert.equal(await valueOf(form, 'mot'), '');
    assert.equal(await valueOf(form, 'fn'), 'Ana', 'the profile\'s answers stay');
    mock.aiMode = 'rules';
    await askAi(form);
    await until(async () => await valueOf(form, 'mot') === 'Building reliable services.', 30000, 'the page to be filled');
    assert.equal(mock.answers, 2);
  } finally { await browser.close(); }
});

test('a question that appears after an AI answer is asked alone', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(4, 'dyn')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/dyn');
    assert.equal(await valueOf(form, 'car'), '');
    await askAi(form);
    await until(async () => await valueOf(form, 'model') === 'Dacia Logan', 30000, 'the new question to be answered');
    assert.equal(mock.answers, 2);
    assert.deepEqual(mock.asked[0], ['Do you own a car?']);
    assert.deepEqual(mock.asked[1], ['Which car model do you drive?']);
  } finally { await browser.close(); }
});

test('the Manager moves the form on; each step is filled once and their edits are never overwritten', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(5, 'steps')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/steps');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    await sleep(3000);
    assert.equal(await form.evaluate(() => document.getElementById('step2').style.display), 'none', 'QTS does not press Next');
    assert.equal(mock.answers, 0);

    // The Manager changes an answer and presses the site's own Next.
    await form.focus('#ph');
    await form.keyboard.down('Control');
    await form.keyboard.press('KeyA');
    await form.keyboard.up('Control');
    await form.keyboard.type('+40 700 000 111');
    await form.click('#next1');
    await waitForStep(storage, 2);
    assert.equal(await valueOf(form, 'mot'), '');
    assert.equal(mock.answers, 0, 'no AI by itself on the new step either');
    await askAi(form);
    await until(async () => await valueOf(form, 'note') === 'Blue', 30000, 'the step 2 AI answers');
    assert.equal(await valueOf(form, 'mot'), 'Building reliable services.');
    assert.equal(mock.answers, 1);
    assert.deepEqual([...mock.asked[0]].sort(), ['What is your favourite colour?', 'What motivates you in your work?']);

    // Back on step 1: nothing is emptied or filled again.
    await form.click('#back2');
    await waitForStep(storage, 1);
    await sleep(2000);
    assert.equal(await valueOf(form, 'ph'), '+40 700 000 111', 'the Manager\'s edit stays');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    assert.equal(mock.answers, 1);
    assert.equal(mock.pageSubmitted, 0);
  } finally { await browser.close(); }
});

test('a way in without an account comes first, even beside Sign in', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(6, 'job-guest')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.ok(await formPage(browser, '/small'), 'the form is reached');
    assert.deepEqual(mock.accountLogins, [], 'nobody signed in');
  } finally { await browser.close(); }
});

test('a sign-in comes only when nothing else leads on: QTS types the email and the saved password and signs in', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(7, 'job-blocked')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.deepEqual(mock.accountLogins, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!' }]);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('a sign-in with Apple, Google, LinkedIn and email: QTS opens the email option only and signs in with it', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(140, 'sign-in-choices')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.deepEqual(mock.accountLogins, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!' }]);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
    assert.deepEqual(mock.socialClicks, [], 'no Apple, Google or LinkedIn');
  } finally { await browser.close(); }
});

test('Create Account: QTS types the email and password twice, ticks "I Agree" (never job alerts), and creates the account', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(142, 'create-account')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.deepEqual(mock.accountLogins, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!', agreed: 'true', alerts: 'false' }]);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('a new candidate: Create Account first (from the Sign In page), then Sign In the natural way, then the form', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(143, 'acct-signin')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 90000);
    assert.deepEqual(mock.acctCreates, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!', verify: 'SavedEmployerPassword123!', agree: 'yes' }]);
    assert.deepEqual(mock.acctLogins, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!' }]);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('an account that already exists: QTS switches to Sign In once and signs in', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(144, 'acct-signin')], accounts: { 'ana.test@example.com': 'SavedEmployerPassword123!' } });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 90000);
    assert.equal(mock.acctCreates.length, 1, 'tried creating first');
    assert.deepEqual(mock.acctLogins, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!' }]);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('a verification code after Create Account is the Manager\'s; QTS goes on when the page moves on', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(145, 'acct-signin')], verifyAfterCreate: true });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const verify = await until(() => formPage(browser, '/acct-verify'), 60000, 'the verification page');
    await until_panel(verify, /Do the verification yourself/, 40000);
    await sleep(2000);
    assert.equal(mock.acctLogins.length, 0, 'nothing else is tried');
    assert.equal(await valueOf(verify, 'code'), '', 'QTS never types a code');
    assert.equal(mock.released.length, 0);
    // The Manager enters the code; the site goes on to the application.
    await verify.goto(`${BASE}/small`);
    await waitForStep(storage, 1, 60000);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('a wrong password stops for the Manager with the site\'s message; the password is never tried again', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(146, 'acct-signin')], accounts: { 'ana.test@example.com': 'AnotherPassword!' } });
  const { browser, action } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const page = await until(async () => (await browser.pages()).find((entry) => entry.url().includes('/acct-signin?error=1')), 90000, 'the refused sign-in');
    await until_panel(page, /Incorrect email or password.*does not try the password again/, 40000);
    await sleep(3000);
    assert.equal(mock.acctLogins.length, 1, 'one try only');
    assert.equal(mock.acctCreates.length, 1);
    assert.equal(mock.released.length, 0, 'the job is not given up');
  } finally { await browser.close(); }
});

test('a guest way beside Sign in is taken: no account is made and nobody signs in', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(160, 'guest-signin')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.ok(await formPage(browser, '/small?via=guest'), 'went on as a guest');
    assert.deepEqual(mock.acctCreates, []);
    assert.deepEqual(mock.acctLogins, []);
  } finally { await browser.close(); }
});

test('a guest choice ("Apply as a guest") is picked and continued, not Sign in', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(161, 'guest-choice')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.ok(await formPage(browser, '/small?via=choice'), 'the guest choice was taken');
    assert.deepEqual(mock.acctLogins, []);
  } finally { await browser.close(); }
});

test('a Create Account page with "Apply without an account": the guest way wins', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(162, 'guest-create')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.ok(await formPage(browser, '/small?via=noaccount'));
    assert.deepEqual(mock.acctCreates, [], 'no account made');
  } finally { await browser.close(); }
});

test('an Apply that opens a tab without telling its opener: the job page still closes', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(163, 'job-noopener')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.equal(await valueOf(await formPage(browser, '/small?via=noopener'), 'fn'), 'Ana');
    await until(async () => !(await formPage(browser, '/job-noopener')), 20000, 'the job page to close');
  } finally { await browser.close(); }
});

test('an email box outside the sign-in form (named only by its data-automation-id) is still found', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(164, 'acct-split')], accounts: { 'ana.test@example.com': 'SavedEmployerPassword123!' } });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 60000);
    assert.deepEqual(mock.acctLogins, [{ email: 'ana.test@example.com', password: 'SavedEmployerPassword123!' }]);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('a stopped panel keeps all its buttons; Fill again takes the job up again in the same tab', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(165, 'form')] });
  const { browser, action, worker, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await worker.evaluate(() => chrome.storage.local.set({ qtsExtensionStatus: null }));
    const panel = await until_panel(form, /Give back/, 30000);
    for (const label of ['Submitted', 'Check', 'Skip', 'Later', 'Fill again', 'Give back']) assert.match(panel, new RegExp(label));
    // Auto Apply on again; Fill again goes on in this tab (not a new one).
    await worker.evaluate(() => chrome.storage.local.set({ qtsApplyKind: 'auto', qtsExtensionStatus: 'apply' }));
    await emptyBox(form, 'fn');
    await clickStopped(form, 'Fill again');
    await until(async () => (await valueOf(form, 'fn')) === 'Ana', 40000, 'filled again');
    assert.equal((await tabsAt(browser, '/form')).length, 1, 'the same tab');
  } finally { await browser.close(); }
});

test('a kept (stopped) tab counts toward the limit: no new job opens beside it until the Manager lets it go', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(166, 'form'), application(167, 'small')], autoApplyParallelLimit: 1, removeRefused: 'This job has a bid, so it is not removed.' });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    // A refused Remove leaves a stopped tab, kept for the Manager.
    form.once('dialog', (dialog) => dialog.accept());
    await until(() => clickPanelButton(form, '🗑').catch(() => false), 10000, 'the 🗑 button');
    await until_panel(form, /Not removed/, 30000);
    await sleep(15000);
    assert.equal(mock.claims, 1, 'no second job while the kept tab is open');
    assert.ok(!(await formPage(browser, '/small')));
    await clickStopped(form, 'Give back');
    await until(() => mock.claims >= 2, 30000, 'the next job once the kept tab is let go');
    await until(() => formPage(browser, '/small'), 30000, 'the next job page');
  } finally { await browser.close(); }
});

/** The A and F signals as the page shows them: their classes ('sig', 'sig busy', 'sig done', 'sig failed'), read inside the panel's closed shadow root. */
async function signalClasses(page) {
  const worker = globalThis.__worker();
  const url = page.url();
  return worker.evaluate(async (pageUrl) => {
    const [tab] = (await chrome.tabs.query({})).filter((entry) => entry.url === pageUrl);
    if (!tab) return { a: '', f: '' };
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
      const host = document.querySelector('[data-qts-apply-review]');
      const root = host && chrome.dom.openOrClosedShadowRoot(host);
      const found = root ? [...root.querySelectorAll('.sig')].map((node) => node.className) : [];
      return { a: found[0] || '', f: found[1] || '' };
    } });
    return result?.result || { a: '', f: '' };
  }, url);
}

test('the A and F signals: F spins while filling and turns green; A spins while the AI answers, then green (red when it does not)', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(170, 'form')], answerDelay: 4000 });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    let lastSeen = null;
    await until(async () => { const seen = lastSeen = await signalClasses(form); return seen.f === 'sig done' && seen.a === 'sig' ? seen : null; }, 15000, 'F green, A idle after the fill').catch((error) => { throw new Error(error.message + ' ' + JSON.stringify(lastSeen)); });
    // (Nothing is emptied by QTS: the Manager empties the box the site had filled.)
    await emptyBox(form, 'mot');
    await askAi(form, { wait: false });
    await until(async () => (await signalClasses(form)).a === 'sig busy', 10000, 'A spinning while the AI answers');
    await until(async () => { const seen = await signalClasses(form); return seen.a === 'sig done' && seen.f === 'sig done' ? seen : null; }, 40000, 'A and F green after the AI answers are in');
    // An AI that does not answer: A red.
    mock.aiMode = 'quota';
    await emptyBox(form, 'mot');
    await askAi(form, { wait: false });
    await until(async () => (await signalClasses(form)).a === 'sig failed', 40000, 'A red when the AI did not answer');
  } finally { await browser.close(); }
});

test('a Workday phone section: device type Mobile, the number without the +40 the code question shows, the extension left empty', { skip, timeout: 120000 }, async () => {
  const job = application(171, 'phone-section');
  job.job.url = `http://globex.wd3.myworkdayjobs.com:${PORT}/phone-section?job=171`;
  resetMock({ queue: [job] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = (await browser.pages()).find((page) => page.url().includes('myworkdayjobs.com'));
    assert.equal(await valueOf(form, 'ptype'), 'Mobile');
    assert.equal(await valueOf(form, 'pnum'), '264484948', 'no +40: the code question already says it');
    assert.equal(await valueOf(form, 'pext'), '', 'an extension is not the phone number');
  } finally { await browser.close(); }
});

test('the same phone section on another site: the whole number (the +40 rule is Workday only)', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(172, 'phone-section')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/phone-section');
    assert.equal(await valueOf(form, 'pnum'), '+40264484948');
    assert.equal(await valueOf(form, 'ptype'), 'Mobile');
    assert.equal(await valueOf(form, 'pext'), '');
  } finally { await browser.close(); }
});

test('a site that throws the panel out gets it back at once', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(141, 'panel-thief')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/panel-thief');
    await until(() => form.evaluate(() => window.panelThrownOut === true), 20000, 'the site to throw the panel out');
    await until(() => form.evaluate(() => Boolean(document.querySelector('[data-qts-apply-review]')?.isConnected)), 5000, 'the panel back');
    await until_panel(form, /Ana Test/, 5000);
    assert.equal(await form.evaluate(() => document.querySelectorAll('[data-qts-apply-review]').length), 1, 'one panel');
  } finally { await browser.close(); }
});

test('a site last used for another candidate is cleared before it opens; the same candidate keeps it', { skip, timeout: 240000 }, async () => {
  resetMock({ queue: [application(8, 'site', ANA, '&who=ana'), application(9, 'site', ANA, '&who=ana2'), application(10, 'site', BEN, '&who=ben')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const stepFor = async (job) => {
      const page = await until(async () => {
        const found = (await browser.pages()).find((entry) => entry.url().includes(`job=${job}`));
        const run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
        return found && run?.jobId === jobId(job) && ['needs_you', 'final'].includes(run.phase) ? found : null;
      }, 60000, `job ${job} to wait for the Manager`);
      return page;
    };
    const first = await stepFor(8);
    assert.equal(await first.evaluate(() => window.draftFound), null);
    await pressPanel(first, 'Skip');

    const second = await stepFor(9);
    assert.equal(mock.cookies.find((entry) => entry.job === '9').cookie, 'site_session=ana', 'the same candidate keeps the session');
    assert.equal(await second.evaluate(() => window.draftFound), 'ana');
    await pressPanel(second, 'Skip');

    const third = await stepFor(10);
    assert.equal(mock.cookies.find((entry) => entry.job === '10').cookie, '', 'another candidate starts with no session');
    assert.equal(await third.evaluate(() => window.draftFound), null, 'and with no stored draft');
    assert.equal(await valueOf(third, 'fn'), 'Ben');
  } finally { await browser.close(); }
});

test('a page signed in as someone else is signed out before anything is filled', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(11, 'signed-in')] });
  const { browser, action, storage } = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/blank`);
    await page.evaluate(() => { document.cookie = 'site_session=ben; path=/'; });
    await page.close();
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/signed-in');
    assert.equal(mock.cookies[0].cookie, 'site_session=ben', 'it opened signed in as someone else');
    assert.equal(mock.cookies.at(-1).cookie, '', 'it was opened again signed out');
    assert.equal(await form.evaluate(() => document.body.innerText.includes('Signed in as')), false);
    assert.equal(await valueOf(form, 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('an account QTS cannot name waits for the Manager before anything is filled', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(12, 'unknown-account')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(() => formPage(browser, '/unknown-account'), 30000, 'the page');
    await until_panel(form, /account QTS cannot identify/);
    assert.equal(mock.answers, 0);
    assert.equal(await valueOf(form, 'fn'), '');
    await pressPanel(form, 'Continue →');
    await waitForStep(storage, 1);
    await until(async () => await valueOf(form, 'fn') === 'Ana', 15000, 'the form to be filled');
    assert.equal(mock.answers, 0, 'and still no AI by itself');
  } finally { await browser.close(); }
});

test('a signed-in job page on a site like Indeed does not stop QTS on its way to the form', { skip, timeout: 120000 }, async () => {
  const job = application(17, 'job-shared');
  job.job.url = `http://www.indeed.com:${PORT}/job-shared?job=17`;
  resetMock({ queue: [job] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/small');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('an application form that is itself on such a site still waits for the Manager', { skip, timeout: 120000 }, async () => {
  const job = application(18, 'unknown-account');
  job.job.url = `http://www.indeed.com:${PORT}/unknown-account?job=18`;
  resetMock({ queue: [job] });
  const { browser, action } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(async () => (await browser.pages()).find((page) => page.url().includes('/unknown-account')), 30000, 'the page');
    await until_panel(form, /account QTS cannot identify/);
    assert.equal(mock.answers, 0);
    assert.equal(await valueOf(form, 'fn'), '');
  } finally { await browser.close(); }
});

test('another account showing at the end is shown to the Manager; the site\'s Submit is theirs', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(13, 'late-account')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/late-account');
    await until_panel(form, /Candidate check.*signed in as ben\.stone@example\.com/);
    // QTS no longer holds the site's Submit: the Manager decides, and records it with Submitted.
    await form.click('#submit');
    await until(() => mock.pageSubmitted === 1, 15000, 'the site\'s Submit');
    await sleep(800);
    assert.equal(mock.submitted.length, 0);
  } finally { await browser.close(); }
});

test('a cancelled job starts fresh: nothing is kept, and the AI is asked again', { skip, timeout: 150000 }, async () => {
  const job = application(15, 'form');
  resetMock({ queue: [job] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    await emptyBox(await formPage(browser, '/form'), 'mot');
    await askAi(await formPage(browser, '/form'));
    await until(() => mock.answers === 1, 30000, 'the AI request');
    await waitForStep(storage, 1);
    await action('cancel_status');
    await until(() => mock.released.length === 1, 20000, 'the application to be given back');
    await until(async () => (await storage(['qtsExtensionStatus'])).qtsExtensionStatus !== 'apply', 20000, 'the run to stop');
    // Auto Apply switched off is not the Manager ending the application: the tab stays, with the
    // stopped panel. The Manager's Give back closes it.
    const stoppedForm = await formPage(browser, '/form');
    await until_panel(stoppedForm, /Give back/, 20000);
    await clickStopped(stoppedForm, 'Give back');
    await until(async () => !(await formPage(browser, '/form')), 20000, 'the old tab to close after Give back');
    assert.equal(mock.released[0].mode, 'drop', 'nothing is recorded on the job');
    assert.deepEqual(mock.released[0].appliedAnswers, [], 'no answers go back with the job');
    assert.ok(mock.reviews.every((entry) => (entry.appliedAnswers || []).length === 0), 'no answers are recorded while it runs');
    await until(async () => Object.keys((await storage(['qtsAutoApplyRuns'])).qtsAutoApplyRuns || {}).length === 0, 10000, 'nothing to be kept in this Chrome');

    mock.queue.push(job);
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(() => formPage(browser, '/form'), 30000, 'the form again');
    await waitForStep(storage, 1);
    await until(async () => await valueOf(form, 'em') === 'ana.test@example.com', 30000, 'the page to be filled');
    assert.notEqual(await valueOf(form, 'mot'), 'Building reliable services.', 'the earlier AI answers were not kept');
    await emptyBox(form, 'mot');
    await askAi(form);
    await until(async () => await valueOf(form, 'mot') === 'Building reliable services.', 30000, 'the new AI answers');
    assert.equal(mock.answers, 2, 'a new AI request');
    assert.ok(mock.claimBodies.every((body) => !(body.skipJobIds || []).includes(job.job.id)), 'a stopped run leaves the job free for the next one');
  } finally { await browser.close(); }
});

test('a closed tab leaves the job as it was, and QTS goes on to the next job', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(48, 'small'), application(49, 'facts')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    await (await formPage(browser, '/small')).close();
    await until(() => mock.released.length === 1, 20000, 'the job to be given back');
    assert.equal(mock.released[0].attemptId, attempt(48));
    assert.equal(mock.released[0].mode, 'drop', 'nothing is recorded on the job');
    assert.deepEqual(mock.released[0].appliedAnswers, []);
    await until(() => formPage(browser, '/facts'), 30000, 'the next job');
    assert.ok(mock.claimBodies.at(-1).skipJobIds.includes(jobId(48)), 'the closed job is not opened again in this run');
    assert.equal(await formPage(browser, '/small'), undefined);
  } finally { await browser.close(); }
});

test('Skip and Later leave the job as it was, and QTS goes on to the next job', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(50, 'small'), application(51, 'small')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    await pressPanel(await formPage(browser, '/small'), 'Skip');
    await until(() => mock.byAttempt[attempt(51)], 30000, 'the next job');
    await waitForStep(storage, 1);
    await pressPanel(await formPage(browser, '/small'), 'Later');
    await until(() => mock.released.length === 2, 20000, 'the second job to be given back');
    assert.deepEqual(mock.released.map((entry) => [entry.attemptId, entry.mode]), [[attempt(50), 'drop'], [attempt(51), 'drop']]);
    assert.deepEqual(mock.released.flatMap((entry) => entry.appliedAnswers), []);
  } finally { await browser.close(); }
});

test('saved answers play no part; what the prompt covers is filled, and what it does not goes to the Manager', { skip, timeout: 120000 }, async () => {
  const job = application(16, 'facts');
  job.savedAnswers = [
    { questionKey: 'do you need visa sponsorship', questionText: 'Do you need visa sponsorship?', answer: 'Yes', note: null, scope: 'manager' },
    { questionKey: 'expected salary', questionText: 'Expected salary', answer: '9999 EUR per month', note: null, scope: 'manager' },
    { questionKey: 'notice', questionText: 'Notice period', answer: '3 months', note: null, scope: 'candidate' },
  ];
  // The prompt covers sponsorship and salary, and says nothing about relocating.
  job.answerPrompt = { id: 'p', template: `Visa sponsorship needed: No. Expected salary: 5,000 - 6000 EUR/month.\n${PROMPT}` };
  resetMock({ queue: [job] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/facts');
    assert.equal(await valueOf(form, 'spon'), '', 'no saved answer fills it');
    await askAi(form);
    await until(async () => await valueOf(form, 'spon') === 'No', 30000, 'the AI answers');
    assert.equal(await valueOf(form, 'spon'), 'No', 'the prompt, not the saved Yes');
    assert.equal(await valueOf(form, 'pay'), '5500');
    assert.equal(await valueOf(form, 'relo'), '', 'nothing in the prompt about relocating: not filled');
    await until_panel(form, /Are you willing to relocate\?[\s\S]*prompt and résumé do not give it/);
    assert.equal(mock.prompts.length, 1);
    for (const text of ['salaryExpectation', 'needsSponsorship', '9999', '3 months']) assert.ok(!mock.prompts[0].includes(text), text);
    assert.match(mock.prompts[0], /Saved: \(none\)/);
  } finally { await browser.close(); }
});

test('an Apply drawn without a real button is found and clicked, quickly', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(21, 'job-div')] });
  const { browser, action, storage } = await launch();
  try {
    const started = Date.now();
    assert.equal((await action('auto_apply')).ok, true);
    await until(() => formPage(browser, '/small'), 15000, 'the form, without the 20 second wait');
    assert.ok(Date.now() - started < 15000);
    await waitForStep(storage, 1);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

// No QTS_Resume folder saved: the worker's settings say so for every key.
const noFolderSaved = () => {
  Object.defineProperty(self, '__qtsScannerDocumentStore', { configurable: true, value: { getSetting: async () => ({ value: null }) } });
};
// A folder is saved, but it cannot be read (not a real folder): Auto Apply may start; only a form
// with uploads would read it.
const unreadableFolderSaved = () => {
  Object.defineProperty(self, '__qtsScannerDocumentStore', { configurable: true, value: {
    getSetting: async (key) => ({ value: key === self.__qtsApplyLocalPdfs.SETTING_KEY ? { name: 'QTS_Resume' } : null }),
  } });
};

test('without a saved PDF folder Auto Apply does not start: no job is taken and no AI request goes out', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(19, 'form'), application(20, 'form')], autoApplyParallelLimit: 1 });
  const { browser, action, storage, worker } = await launch();
  try {
    await worker.evaluate(noFolderSaved);
    const reply = await action('auto_apply');
    assert.equal(reply.ok, false);
    assert.equal(reply.resumeFolderRequired, true);
    assert.match(reply.error, /QTS_Resume/);
    assert.notEqual((await storage(['qtsExtensionStatus'])).qtsExtensionStatus, 'apply');
    assert.equal(mock.claims, 0, 'no job is taken');
    assert.equal(mock.answers, 0, 'no AI request');
  } finally { await browser.close(); }
});

test('a form with no uploads never reads the saved PDF folder', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(22, 'small')] });
  const { browser, action, storage, worker } = await launch();
  try {
    await worker.evaluate(unreadableFolderSaved);
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

const reachesForm = (name, form, prefix = '/small', extra = () => {}) => test(name, { skip, timeout: 120000 }, async () => {
  const job = application(30 + form.length, form);
  extra(job);
  resetMock({ queue: [job] });
  const { browser, action, storage, worker } = await launch();
  try {
    // (QTS_E2E_SPEED_OFF=1: the same check with the speed switch off, to compare timings.)
    if (process.env.QTS_E2E_SPEED_OFF === '1') await worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplySpeedOff: true }));
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.equal(await valueOf(await formPage(browser, prefix) || (await browser.pages()).find((page) => page.url().includes(prefix)), 'fn'), 'Ana');
    assert.deepEqual(mock.released, []);
    assert.equal(mock.pageSubmitted, 0);
    // QTS_E2E_TIMING=1: how long the job page took from its load to the next page asked for (the click).
    if (process.env.QTS_E2E_TIMING === '1') {
      const jobAt = mock.log.find((entry) => entry.path === '/' + form)?.at;
      // (The page the click leads to; not the site's icon or other requests the page makes by itself.)
      const nextAt = mock.log.find((entry) => entry.at > jobAt && ['/small', '/go'].includes(entry.path))?.at;
      console.error('TIMING', form, jobAt && nextAt ? nextAt - jobAt : 'n/a', 'ms');
    }
  } finally { await browser.close(); }
});
reachesForm('a button the page draws a few seconds later is found', 'job-late');
reachesForm('an Apply that opens a new tab is followed', 'job-new-tab');
// The speed switch off (qtsAutoApplySpeedOff): the 2 s wait before a steady Apply comes back; the same page is reached.
test('with the speed switch off, an Apply is still found and followed the old way', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(150, 'job-new-tab')] });
  const { browser, action, worker, storage } = await launch();
  try {
    await worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplySpeedOff: true }));
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.equal(await valueOf(await formPage(browser, '/small'), 'fn'), 'Ana');
    assert.deepEqual(mock.released, []);
  } finally { await browser.close(); }
});
reachesForm('a form in a pop-up is reached, on "Get started"', 'job-modal', '/job-modal');
reachesForm('a redirect to the company\'s application system is followed', 'job-redirect', `${ATS}/small`);

const firstPage = async (browser, part) => (await browser.pages()).find((page) => page.url().includes(part));
test('an Apply on a job board that leads to the employer is used, not the board\'s own', { skip, timeout: 120000 }, async () => {
  const job = application(40, 'job-external');
  job.job.url = `http://www.indeed.com:${PORT}/job-external?job=40`;
  resetMock({ queue: [job] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    assert.equal(await valueOf(await firstPage(browser, 'jobs.ats-example.com'), 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('a job board\'s own Apply is never clicked, and the job goes back with the reason', { skip, timeout: 120000 }, async () => {
  const job = application(41, 'job-hosted');
  job.job.url = `http://www.indeed.com:${PORT}/job-hosted?job=41`;
  resetMock({ queue: [job] });
  const { browser, action } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await until(() => mock.released.length === 1, 45000, 'the job to be given back');
    assert.match(mock.released[0].reason, /job board only offers its own application/);
    assert.match(mock.released[0].reason, /Ended at http:\/\/www\.indeed\.com/);
    assert.match(mock.released[0].reason, /"Apply now"/);
    assert.equal(mock.hostedOpened || 0, 0);
    assert.equal(mock.answers, 0);
  } finally { await browser.close(); }
});

test('a saved link that is itself a job board application is refused at once', { skip, timeout: 120000 }, async () => {
  const job = application(42, 'hosted');
  job.job.url = `http://smartapply.indeed.com:${PORT}/hosted?job=42`;
  resetMock({ queue: [job] });
  const { browser, action } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await until(() => mock.released.length === 1, 30000, 'the job to be given back');
    assert.match(mock.released[0].reason, /job board's own application \(smartapply\.indeed\.com\)/);
    assert.equal(mock.answers, 0);
  } finally { await browser.close(); }
});

test('a form that names another vacancy waits for the Manager before anything is touched', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(43, 'job-wrong')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(() => firstPage(browser, '/other-vacancy'), 30000, 'the other vacancy');
    await until_panel(form, /does not mention Backend Engineer at Globex/);
    assert.equal(mock.answers, 0);
    await pressPanel(form, 'Continue →');
    await waitForStep(storage, 1);
    assert.equal(await valueOf(form, 'fn'), 'Ana');
  } finally { await browser.close(); }
});

test('with no way to the form, QTS says what it saw and waits for the Manager with the whole panel; the job is not given up', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(44, 'job-none')] });
  const { browser, action } = await launch();
  try {
    const started = Date.now();
    assert.equal((await action('auto_apply')).ok, true);
    const page = await until(() => formPage(browser, '/job-none'), 20000, 'the job page');
    const panel = await until_panel(page, /No way to the application form was found/, 30000);
    assert.ok(Date.now() - started < 30000, `took ${Date.now() - started} ms`);
    assert.match(panel, /Nothing to click was recognised/);
    for (const label of ['Submitted', 'Skip', 'Later', 'Fill again']) assert.match(panel, new RegExp(label));
    await sleep(3000);
    assert.equal(mock.released.length, 0, 'the job is not given up');
    // The Manager gives it up: Skip.
    await pressPanel(page, 'Skip');
    await until(() => mock.released.length === 1, 20000, 'the job given back');
  } finally { await browser.close(); }
});

test('two pages sending QTS back and forth do not loop', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(45, 'loop-a')] });
  const { browser, action } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const page = await until(async () => (await browser.pages()).find((entry) => /\/loop-[ab]/.test(entry.url())), 20000, 'the looping pages');
    await until_panel(page, /Clicked: "Apply now", "Continue to apply"/, 45000);
    assert.equal(mock.released.length, 0, 'waits for the Manager, never loops on');
    assert.equal(mock.answers, 0);
  } finally { await browser.close(); }
});

test('a long answer goes into the form whole, and Fill again never asks the AI', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(46, 'steps')], longAnswer: true });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/steps');
    await form.click('#next1');
    await waitForStep(storage, 2);
    await askAi(form);
    await until(async () => await valueOf(form, 'mot') === 'Reliable services. '.repeat(50).trim(), 30000, 'the long answer');
    assert.equal(mock.answers, 1);
    assert.ok(mock.prompts[0].includes('Tell us in detail. '.repeat(20).trim()), 'the whole help text goes to the AI');
    await pressPanel(form, 'Fill again');
    await sleep(1000);
    await waitForStep(storage, 2);
    await sleep(2000);
    assert.equal(mock.answers, 1, 'Fill again uses no AI');
    assert.equal(await valueOf(form, 'mot'), 'Reliable services. '.repeat(50).trim());
  } finally { await browser.close(); }
});

test('Ask AI again answers only the boxes still empty, keeps the documents attached, and leaves the Manager\'s own answers', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(52, 'form')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await emptyBox(form, 'mot');
    await askAi(form);
    await until(async () => await valueOf(form, 'mot') === 'Building reliable services.', 30000, 'the AI answers');
    assert.equal(mock.answers, 1);
    const attachments = () => form.evaluate(() => window.events.filter((event) => event.id === 'cv' && event.type === 'change' && event.value).length);
    const attached = await attachments();
    assert.ok(attached >= 1, 'the document went in');
    await form.focus('#ph');
    await form.keyboard.down('Control');
    await form.keyboard.press('KeyA');
    await form.keyboard.up('Control');
    await form.keyboard.type('+40 700 000 111');
    await emptyBox(form, 'mot');
    await waitForStep(storage, 1);
    await askAi(form);
    await until(() => mock.answers === 2, 30000, 'a new AI request');
    await until(async () => await valueOf(form, 'mot') === 'Building reliable services.', 30000, 'the empty box answered');
    assert.deepEqual(mock.asked[1], ['What motivates you in your work?'], 'only the empty box is asked about');
    assert.equal(await valueOf(form, 'ph'), '+40 700 000 111', 'the Manager\'s edit stays');
    assert.equal(await valueOf(form, 'hear'), 'Indeed', 'what the site had chosen stays (QTS empties nothing)');
    assert.equal(await attachments(), attached, 'the document is not attached twice');
    assert.equal(await form.evaluate(() => document.getElementById('cv').files[0]?.name), 'Ana_Test_CV.pdf');
  } finally { await browser.close(); }
});

test('Check saves nothing to the saved answers', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(47, 'small')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/small');
    await form.focus('#ln');
    await form.keyboard.type('x');
    await pressPanel(form, 'Check');
    await sleep(1500);
    assert.equal(mock.log.filter((entry) => entry.path.endsWith('/check-answers')).length, 0);
  } finally { await browser.close(); }
});

test('chosen jobs open as many at once as the Manager\'s limit in Settings, not just 1', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(70, 'form'), application(71, 'form'), application(72, 'form')], autoApplyParallelLimit: 2 });
  const { browser, action, storage } = await launch();
  try {
    const selection = { candidateId: ANA.id, jobIds: [jobId(70), jobId(71), jobId(72)] };
    assert.equal((await action('auto_apply', selection)).ok, true);
    const formTabs = async () => (await browser.pages()).filter((page) => page.url().startsWith(`${BASE}/form`));
    // Two jobs at once: both waiting for the Manager together.
    await until(async () => {
      const runs = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs || [];
      return runs.length === 2 && runs.every((run) => ['needs_you', 'final'].includes(run.phase));
    }, 90000, 'two jobs open at once');
    assert.equal((await formTabs()).length, 2, 'two application tabs');
    await sleep(2000);
    assert.equal(mock.queue.length, 1, 'the third job waits: the limit is 2');
    // One is submitted: the third opens in its place.
    await pressPanel((await formTabs())[0], 'Submitted');
    await until(() => mock.results.length === 1, 20000, 'the bid');
    await until(() => mock.queue.length === 0, 60000, 'the third job to be taken');
    await until(async () => ((await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs || []).length === 2, 60000, 'two open again');
  } finally { await browser.close(); }
});

test('a limit raised in Settings while Auto Apply runs counts without Stop and Start', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(77, 'form'), application(78, 'form')], autoApplyParallelLimit: 1 });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    const runs = async () => ((await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs || []).length;
    await until(async () => (await runs()) === 1, 60000, 'one job open (limit 1)');
    await sleep(3000);
    assert.equal(mock.queue.length, 1, 'the second waits');
    // The Manager raises the limit to 2 in Settings: the second opens within about 30 s.
    mock.autoApplyParallelLimit = 2;
    await until(() => mock.queue.length === 0, 60000, 'the second job taken after the limit changed');
    await until(async () => (await runs()) === 2, 60000, 'two open');
  } finally { await browser.close(); }
});

test('with no candidate chosen (all jobs), as many open at once as the Manager\'s limit too', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [application(73, 'form'), application(74, 'form'), application(75, 'form'), application(76, 'form')], autoApplyParallelLimit: 2 });
  const { browser, action, storage } = await launch();
  try {
    // The checked jobs of every candidate (no candidate chosen); job 76 is not checked.
    assert.equal((await action('auto_apply', { candidateId: null, jobIds: [jobId(73), jobId(74), jobId(75)] })).ok, true);
    const formTabs = async () => (await browser.pages()).filter((page) => page.url().startsWith(`${BASE}/form`));
    await until(async () => {
      const runs = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs || [];
      return runs.length === 2 && runs.every((run) => ['needs_you', 'final'].includes(run.phase));
    }, 90000, 'two jobs open at once');
    assert.equal((await formTabs()).length, 2, 'two application tabs');
    await sleep(2000);
    assert.equal(mock.queue.length, 2, 'the third job waits: the limit is 2 (76 is not checked)');
    assert.ok(mock.claimBodies.every((body) => body.selection && body.selection.candidateId == null), 'no candidate goes to the server');
    await pressPanel((await formTabs())[0], 'Submitted');
    await until(() => mock.queue.length === 1, 60000, 'the third job to be taken');
    await until(async () => ((await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs || []).length === 2, 60000, 'two open again');
    await sleep(2000);
    assert.deepEqual(mock.queue.map((entry) => entry.job.id), [jobId(76)], 'the unchecked job is never taken');
  } finally { await browser.close(); }
});

test('the panel follows the application into each new tab the Manager opens; side tabs are never taken or closed', { skip, timeout: 240000 }, async () => {
  resetMock({ queue: [application(80, 'tab-step1')] });
  const { browser, action, storage } = await launch();
  try {
    const unrelated = await browser.newPage();
    await unrelated.goto(`${BASE}/about?unrelated=1`);
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const step1 = await formPage(browser, '/tab-step1');
    assert.equal(await valueOf(step1, 'fn'), 'Ana');
    // The Manager opens the privacy policy and the company's site: side tabs, left alone.
    await step1.click('#privacy-link');
    await step1.bringToFront();
    await step1.click('#company-link');
    const aboutTabs = async () => (await browser.pages()).filter((page) => page.url().startsWith(`${BASE}/about`)).length;
    await until(async () => Boolean(await formPage(browser, '/privacy')) && (await aboutTabs()) === 2, 20000, 'the side tabs');
    await sleep(15000);
    assert.ok(await formPage(browser, '/tab-step1'), "the application's tab stays");
    assert.ok(await formPage(browser, '/privacy'), 'the privacy policy tab stays');
    assert.equal((await browser.pages()).filter((page) => page.url().startsWith(`${BASE}/about`)).length, 2, 'the company site and the unrelated tab stay');
    let run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState.runs[0];
    assert.equal(run.step, 1, 'still step 1');
    assert.match(await panelText(step1), /Ana Test/);
    // The site's Next opens step 2 in a new tab: it becomes the application, the old tab closes.
    await step1.bringToFront();
    await step1.type('#extra', 'Typed on page one');
    await step1.click('#next');
    await waitForStep(storage, 2, 60000);
    await until(async () => !(await formPage(browser, '/tab-step1')), 20000, 'the old tab to close');
    const step2 = await formPage(browser, '/tab-step2');
    assert.equal(await valueOf(step2, 'city'), 'Cluj-Napoca');
    const panel2 = await until_panel(step2, /Moved to the new tab/);
    assert.match(panel2, /Ana Test/);
    assert.equal(await panelText(await formPage(browser, '/privacy')), '', 'no panel in a side tab');
    assert.match(panel2, /Backend Engineer/);
    assert.match(panel2, /Globex/);
    // Again for the next tab.
    await step2.bringToFront();
    await step2.click('#next');
    await waitForStep(storage, 3, 60000);
    await until(async () => !(await formPage(browser, '/tab-step2')), 20000, 'the step 2 tab to close');
    const step3 = await formPage(browser, '/tab-step3');
    assert.equal(await valueOf(step3, 'country'), 'Romania');
    await until_panel(step3, /Ana Test/);
    run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState.runs[0];
    assert.equal(run.jobId, jobId(80), 'the same job all along');
    // Submitted ends it: the bid is saved, the application's tab closes; the side tabs stay.
    await pressPanel(step3, 'Submitted');
    await until(() => mock.results.length === 1, 20000, 'the bid');
    assert.ok((mock.results[0].appliedAnswers || []).some((entry) => entry.answer === 'Typed on page one'), "the closed page's answers go with the bid");
    await until(async () => !(await formPage(browser, '/tab-step3')), 20000, 'the tab to close');
    assert.ok(await formPage(browser, '/privacy'), 'the privacy policy tab is never closed');
    assert.equal((await browser.pages()).filter((page) => page.url().startsWith(`${BASE}/about`)).length, 2);
    assert.equal(mock.released.length, 0, 'nothing given back');
    assert.equal(mock.pageSubmitted, 0, "QTS never clicks the site's Submit");
  } finally { await browser.close(); }
});

test('an Apply that QTS clicks opens a new tab: the panel goes with it and the job page closes', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(81, 'job-new-tab')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/small');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    await until_panel(form, /Ana Test/);
    await until(async () => !(await formPage(browser, '/job-new-tab')), 20000, 'the job page to close');
  } finally { await browser.close(); }
});

// ---- Auto Apply: the application follows its tabs ----
const tabsAt = async (browser, prefix) => (await browser.pages()).filter((page) => page.url().startsWith(prefix.startsWith('http') ? prefix : `${BASE}${prefix}`));
// (Chrome always opens Google and Dropbox over https, so the stand-ins there show an error page: still a tab.)
const tabsOnHost = async (browser, host) => (await browser.pages()).filter((page) => { try { return new URL(page.url()).hostname === host; } catch { return false; } });
const runNow = async (storage) => (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0] || null;
const activeUrl = (worker) => worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url || '');
/** Starts Auto Apply on one job and waits for its first page to be filled and waiting. */
async function startOn(n, form, options = {}) {
  resetMock({ queue: [application(n, form)], ...options });
  const launched = await launch();
  assert.equal((await launched.action('auto_apply')).ok, true);
  await waitForStep(launched.storage, 1);
  const first = await formPage(launched.browser, `/${form}`);
  await first.bringToFront();
  return { ...launched, first };
}
/** A box of the panel (its class), from the page's DOM through the shadow root. */
async function panelBox(page, className) {
  const { client, doc } = await panelNodes(page);
  try {
    const find = (node) => {
      const attrs = node.attributes || [];
      const index = attrs.indexOf('class');
      if (index >= 0 && String(attrs[index + 1]).split(/\s+/).includes(className)) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const hit = find(child); if (hit) return hit; }
      return null;
    };
    const node = find(doc);
    if (!node) return null;
    const { model } = await client.send('DOM.getBoxModel', { nodeId: node.nodeId });
    const [x1, y1, , , x3, y3] = model.border;
    return { x: x1, y: y1, width: x3 - x1, height: y3 - y1 };
  } finally { await client.detach().catch(() => {}); }
}

test('Ctrl+click and middle-click on Next are followed; the new tab comes to the front because the old one was', { skip, timeout: 180000 }, async () => {
  const { browser, worker, storage, first } = await startOn(100, 'tab-step1');
  try {
    await first.keyboard.down('Control');
    await first.click('#next');
    await first.keyboard.up('Control');
    await waitForStep(storage, 2, 60000);
    await until(async () => !(await formPage(browser, '/tab-step1')), 20000, 'the old tab to close');
    const step2 = await formPage(browser, '/tab-step2');
    await until(async () => (await activeUrl(worker)).includes('/tab-step2'), 10000, 'the new tab in front');
    assert.equal(await valueOf(step2, 'city'), 'Cluj-Napoca');
    await step2.click('#next', { button: 'middle' });
    await waitForStep(storage, 3, 60000);
    await until(async () => !(await formPage(browser, '/tab-step2')), 20000, 'the step 2 tab to close');
    assert.equal(await valueOf(await formPage(browser, '/tab-step3'), 'country'), 'Romania');
    assert.equal(mock.released.length, 0);
  } finally { await browser.close(); }
});

test('a pop-up window that is the next step becomes the application, with the panel', { skip, timeout: 150000 }, async () => {
  const { browser, worker, storage, first } = await startOn(101, 'tab-step1');
  try {
    await first.click('#popup');
    await waitForStep(storage, 2, 60000);
    const popup = await formPage(browser, '/tab-step2?via=popup');
    assert.ok(popup, 'the pop-up');
    const type = await worker.evaluate(async () => {
      const [tab] = (await chrome.tabs.query({})).filter((entry) => entry.url.includes('via=popup'));
      return (await chrome.windows.get(tab.windowId)).type;
    });
    assert.equal(type, 'popup');
    assert.equal(await valueOf(popup, 'city'), 'Cluj-Napoca');
    await until_panel(popup, /Ana Test/);
    await until(async () => !(await formPage(browser, '/tab-step1')), 20000, 'the old tab to close');
  } finally { await browser.close(); }
});

test('the next step on another domain gets the site checks: another candidate signed in there is signed out first', { skip, timeout: 180000 }, async () => {
  const { browser, storage, first } = await startOn(102, 'tab-step1');
  try {
    const seed = await browser.newPage();
    await seed.goto(`${ATS}/blank`);
    await seed.setCookie({ name: 'site_session', value: 'ben', url: ATS });
    await seed.close();
    await first.bringToFront();
    await first.click('#ats');
    await waitForStep(storage, 2, 90000);
    const [step2] = await tabsAt(browser, `${ATS}/tab-signed-in`);
    const seen = mock.cookies.filter((entry) => entry.job === 'tab-signed-in');
    assert.ok(seen.length >= 2, 'opened again after signing out');
    assert.match(seen[0].cookie, /site_session=ben/);
    assert.doesNotMatch(seen.at(-1).cookie, /site_session=ben/, 'the other candidate is signed out');
    assert.equal(await valueOf(step2, 'city'), 'Cluj-Napoca');
    assert.doesNotMatch(await step2.evaluate(() => document.body.innerText), /ben\.stone/);
  } finally { await browser.close(); }
});

test('a new tab without a form yet: QTS clicks Start there; on a sign-in it signs in itself; the job is never given up', { skip, timeout: 240000 }, async () => {
  const { browser, storage, first } = await startOn(103, 'tab-step1');
  try {
    await first.click('#intro');
    await waitForStep(storage, 2, 90000);
    const step2 = await formPage(browser, '/tab-step2?via=intro');
    assert.ok(step2, 'QTS clicked Start application in the new tab');
    assert.equal(await valueOf(step2, 'city'), 'Cluj-Napoca');
    assert.ok(!(await formPage(browser, '/tab-intro')), 'one tab for the job');
    // The next one is a sign-in page: QTS waits for the Manager, and goes on after the sign-in.
    resetMock({ queue: [application(104, 'tab-step1')] });
  } finally { await browser.close(); }
  const second = await startOn(104, 'tab-step1');
  try {
    await second.first.click('#account');
    // The new tab is a sign-in page: QTS types the candidate's email and the saved password and signs
    // in itself (no Create account offered there), then goes on to the form.
    await until(async () => formPage(second.browser, '/tab-signin'), 20000, 'the sign-in tab');
    await waitForStep(second.storage, 2, 90000);
    assert.equal(await valueOf(await formPage(second.browser, '/tab-step2?via=signin'), 'city'), 'Cluj-Napoca');
    assert.equal(mock.released.length, 0);
  } finally { await second.browser.close(); }
});

test('unclear links: one whose tab shows a form is followed; one without is asked about (Ignore, Use this tab)', { skip, timeout: 240000 }, async () => {
  const { browser, storage, first } = await startOn(105, 'tab-step1');
  try {
    // "Details" opens a page with no form: the panel asks; Ignore leaves the tab and the application.
    await first.click('#details');
    await first.bringToFront();
    await until_panel(first, /Is this tab this application\?/, 40000);
    await pressPanel(first, 'Ignore');
    await until(async () => !/Is this tab this application\?/.test(await panelText(first)), 10000, 'the question to go');
    assert.ok(await formPage(browser, '/tab-plain'), 'the ignored tab stays open');
    assert.equal((await runNow(storage)).step, 1);
    // "View job" too: this time Use this tab. The application goes there (no form: QTS says so and waits).
    await first.click('#view-job');
    await first.bringToFront();
    await until_panel(first, /Is this tab this application\?/, 40000);
    await pressPanel(first, 'Use this tab');
    await until(async () => !(await formPage(browser, '/tab-step1')), 20000, 'the old tab to close');
    const plain = await formPage(browser, '/tab-plain?view=1');
    await until_panel(plain, /No way on found\. Click it yourself; QTS fills when the form appears/, 60000);
    assert.ok(await formPage(browser, '/tab-plain'), 'the ignored tab is still open');
    assert.equal(mock.released.length, 0);
  } finally { await browser.close(); }
  // "Learn more" opens a page with a form: followed without asking.
  const second = await startOn(106, 'tab-step1');
  try {
    await second.first.click('#learn-more');
    await waitForStep(second.storage, 2, 60000);
    assert.equal(await valueOf(await formPage(second.browser, '/tab-step2?via=learn'), 'city'), 'Cluj-Napoca');
  } finally { await second.browser.close(); }
});

test('one click that opens two tabs: the one with the form is followed, the other is left alone', { skip, timeout: 150000 }, async () => {
  const { browser, storage, first } = await startOn(107, 'tab-step1');
  try {
    await first.click('#two');
    await waitForStep(storage, 2, 60000);
    assert.ok(await formPage(browser, '/tab-step2?via=two'));
    await sleep(2000);
    assert.ok(await formPage(browser, '/privacy?two=1'), 'the other tab stays');
    assert.equal(await panelText(await formPage(browser, '/privacy?two=1')), '', 'no panel there');
  } finally { await browser.close(); }
});

test('Google sign-in and upload-picker pop-ups are never taken over or closed', { skip, timeout: 150000 }, async () => {
  const { browser, worker, storage, first } = await startOn(108, 'tab-step1');
  try {
    await first.click('#google');
    await first.bringToFront();
    await first.click('#dropbox');
    // (Their error pages show no address to the test tool: Chrome's own tab list has it.)
    const onHost = (host) => worker.evaluate(async (name) => (await chrome.tabs.query({})).filter((tab) => { try { return new URL(tab.url || tab.pendingUrl).hostname === name; } catch { return false; } }).length, host);
    await until(async () => (await onHost('accounts.google.com')) === 1, 20000, 'the Google pop-up');
    await until(async () => (await onHost('www.dropbox.com')) === 1, 20000, 'the Dropbox pop-up');
    await sleep(22000);
    assert.equal(await onHost('accounts.google.com'), 1, 'Google stays');
    assert.equal(await onHost('www.dropbox.com'), 1, 'Dropbox stays');
    assert.ok(await formPage(browser, '/tab-step1'), 'the application stays in its own tab');
    assert.equal((await runNow(storage)).step, 1);
  } finally { await browser.close(); }
});

test('a next step that does not load: the old tab stays and the panel says so', { skip, timeout: 120000 }, async () => {
  const { browser, storage, first } = await startOn(109, 'tab-step1');
  try {
    await first.click('#broken');
    await first.bringToFront();
    await until_panel(first, /The next step did not open\. Try again or open it yourself\./, 40000);
    assert.ok(await formPage(browser, '/tab-step1'));
    assert.equal((await runNow(storage)).step, 1);
    assert.equal(mock.released.length, 0);
  } finally { await browser.close(); }
});

test('the site closes its own tab after opening the next step: moved, not cancelled', { skip, timeout: 150000 }, async () => {
  const { browser, storage, first } = await startOn(110, 'tab-step1');
  try {
    await first.click('#next');
    await first.close();
    await waitForStep(storage, 2, 60000);
    assert.equal(await valueOf(await formPage(browser, '/tab-step2'), 'city'), 'Cluj-Napoca');
    assert.equal(mock.released.length, 0, 'the job was not given back');
  } finally { await browser.close(); }
});

test('two jobs open at once: each new tab stays with the job whose tab opened it', { skip, timeout: 240000 }, async () => {
  const alpha = application(111, 'tab-step1');
  const beta = application(112, 'tab-step1');
  alpha.job.title = 'Alpha Engineer';
  beta.job.title = 'Beta Engineer';
  resetMock({ queue: [alpha, beta], autoApplyParallelLimit: 2 });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await until(async () => {
      const runs = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs || [];
      return runs.length === 2 && runs.every((run) => run.step === 1 && ['needs_you', 'final'].includes(run.phase));
    }, 90000, 'both jobs waiting');
    const firsts = await tabsAt(browser, '/tab-step1');
    const byTitle = {};
    for (const page of firsts) byTitle[/Alpha/.test(await panelText(page)) ? 'alpha' : 'beta'] = page;
    await byTitle.beta.bringToFront();
    await byTitle.beta.click('#next');
    await until(async () => (await tabsAt(browser, '/tab-step2')).length === 1, 30000, "Beta's step 2");
    await until_panel((await tabsAt(browser, '/tab-step2'))[0], /Beta Engineer/, 30000);
    await byTitle.alpha.bringToFront();
    await byTitle.alpha.click('#next');
    await until(async () => (await tabsAt(browser, '/tab-step2')).length === 2 && !(await tabsAt(browser, '/tab-step1')).length, 60000, 'both on step 2');
    const panels = await Promise.all((await tabsAt(browser, '/tab-step2')).map((page) => until_panel(page, /Engineer/)));
    assert.equal(panels.filter((text) => /Alpha Engineer/.test(text)).length, 1);
    assert.equal(panels.filter((text) => /Beta Engineer/.test(text)).length, 1);
    await until(async () => {
      const runs = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs || [];
      return runs.length === 2 && runs.every((run) => run.step === 2);
    }, 60000, 'both runs at step 2');
    assert.equal(mock.claims, 2, 'a move never counts as another open job');
  } finally { await browser.close(); }
});

test('Next while Ask AI answers: QTS stops in the old tab and goes on in the new one, never filling both', { skip, timeout: 180000 }, async () => {
  const { browser, storage, first } = await startOn(113, 'tab-ai', { answerDelay: 12000 });
  try {
    await askAi(first, { wait: false });
    await until(() => mock.answers === 1, 30000, 'the AI request');
    await first.click('#next');
    await waitForStep(storage, 2, 60000);
    const step2 = await formPage(browser, '/tab-step2');
    assert.ok(!(await formPage(browser, '/tab-ai')), 'the old tab closed');
    await sleep(14000);
    assert.equal(mock.answers, 1, 'no second AI request');
    assert.equal(await valueOf(step2, 'city'), 'Cluj-Napoca');
    assert.ok(!/Asking/.test(await panelText(step2)), 'nothing of the old tab\'s AI round here');
    assert.equal((await runNow(storage)).step, 2);
  } finally { await browser.close(); }
});

test('an extension restart right after a move goes on in the new tab', { skip, timeout: 240000 }, async () => {
  const launched = await startOn(114, 'tab-step1');
  const { browser, storage, first } = launched;
  try {
    await first.click('#next');
    await waitForStep(storage, 2, 60000);
    await until(async () => !(await formPage(browser, '/tab-step1')), 20000, 'the old tab to close');
    const opened = mock.log.filter((entry) => entry.path === '/tab-step2').length;
    await launched.restartWorker();
    await until(async () => {
      const run = (await launched.storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
      return run?.resumed && run.step === 2 && ['needs_you', 'final'].includes(run.phase);
    }, 90000, 'the resumed run at step 2');
    assert.equal((await tabsAt(browser, '/tab-step2')).length, 1, 'the same tab');
    assert.equal(mock.log.filter((entry) => entry.path === '/tab-step2').length, opened, 'not opened again');
    assert.ok(!(await formPage(browser, '/tab-step1')), 'the old tab is not back');
    assert.equal(mock.released.length, 0);
  } finally { await browser.close(); }
});

test('after a move, Later gives the job back unchanged and leaves side tabs open', { skip, timeout: 150000 }, async () => {
  const { browser, storage, first } = await startOn(115, 'tab-step1');
  try {
    await first.click('#privacy-link');
    await first.bringToFront();
    await first.click('#next');
    await waitForStep(storage, 2, 60000);
    const step2 = await formPage(browser, '/tab-step2');
    await step2.bringToFront();
    await pressPanel(step2, 'Later');
    await until(() => mock.released.length === 1, 20000, 'the job given back');
    assert.equal(mock.released[0].mode, 'drop', 'nothing recorded on the job');
    assert.equal(mock.results.length, 0, 'no bid');
    await until(async () => !(await formPage(browser, '/tab-step2')), 20000, 'the tab to close');
    assert.ok(await formPage(browser, '/privacy'), 'the side tab stays');
  } finally { await browser.close(); }
});

test('Alt+S stops the filling at once (here the AI under way): nothing more goes in, the job stays open, the panel says so', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(173, 'form')], answerDelay: 12000 });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await emptyBox(form, 'mot');
    await askAi(form, { wait: false });
    await until(() => mock.answers === 1, 30000, 'the AI request');
    await form.bringToFront();
    await form.keyboard.down('Alt');
    await form.keyboard.press('KeyS');
    await form.keyboard.up('Alt');
    await until_panel(form, /You stopped the filling \(Alt\+S\)/, 15000);
    await sleep(14000);
    assert.equal(await valueOf(form, 'mot'), '', 'the AI answer never went in');
    assert.equal(mock.released.length, 0, 'the job stays open');
    const seen = await signalClasses(form);
    assert.notEqual(seen.a, 'sig busy');
    assert.notEqual(seen.f, 'sig busy');
  } finally { await browser.close(); }
});

test('Alt+F: nothing is filled until the Manager presses it; each new step waits for it again', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(174, 'steps')] });
  const { browser, action, worker, storage } = await launch();
  try {
    await worker.evaluate(() => chrome.storage.local.set({ qtsAutoApplyFillOnKey: true }));
    assert.equal((await action('auto_apply')).ok, true);
    const form = await until(() => formPage(browser, '/steps'), 30000, 'the form');
    // No hint box any more: the step's review waiting is the sign it waits for Alt+F.
    await until(async () => (await globalThis.__diag()).some((review) => review.waiting && review.mode === 'review'), 40000, 'step 1 waits for Alt+F');
    await sleep(2000);
    assert.equal(await valueOf(form, 'fn'), '', 'not filled without Alt+F');
    assert.equal((await signalClasses(form)).f, 'sig', 'F dim');
    await until(async () => (await globalThis.__diag()).some((review) => review.waiting && review.mode === 'review'), 20000, 'the review');
    await form.bringToFront();
    await form.keyboard.down('Alt');
    await form.keyboard.press('KeyF');
    await form.keyboard.up('Alt');
    await until(async () => (await valueOf(form, 'fn')) === 'Ana', 30000, 'filled after Alt+F');
    await until(async () => (await signalClasses(form)).f === 'sig done', 15000, 'F green');
    // The Manager's own Next: the next step waits for Alt+F again.
    await form.click('#next1');
    await until(async () => Boolean(await form.$('#note')) && (await globalThis.__diag()).some((review) => review.waiting && review.mode === 'review'), 40000, 'step 2 waits for Alt+F');
    await sleep(1500);
    assert.equal(await valueOf(form, 'note'), '', 'step 2 not filled without Alt+F');
    assert.equal(mock.answers, 0);
  } finally { await browser.close(); }
});

test("Alt+A asks the AI on the job page in front, as the panel's Ask AI button", { skip, timeout: 120000 }, async () => {
  const { browser, worker, first } = await startOn(117, 'form');
  try {
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    assert.ok(commands.some((command) => command.name === 'auto-apply-ask-ai'), 'the Alt+A shortcut is there');
    assert.equal(await valueOf(first, 'mot'), "Someone else's answer", 'nothing asked by itself (and nothing emptied)');
    await until(async () => (await globalThis.__diag()).some((review) => review.waiting && review.mode === 'review'), 20000, 'the review to wait');
    await emptyBox(first, 'mot');
    assert.equal(await worker.evaluate(() => self.__qtsAutoApplyTabs.askAi()), 'asked');
    await until(() => mock.answers === 1, 30000, 'the AI request');
    await until(async () => (await valueOf(first, 'mot')) === 'Building reliable services.', 30000, 'the AI answer filled');
  } finally { await browser.close(); }
});

test('"bring to front" still brings the application tab to the front with its panel (no key unless set)', { skip, timeout: 120000 }, async () => {
  const { browser, worker, first } = await startOn(116, 'tab-step1');
  try {
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    assert.ok(commands.some((command) => command.name === 'focus-auto-apply'), 'the command is there');
    const other = await browser.newPage();
    await other.goto(`${BASE}/blank`);
    await other.bringToFront();
    await until(async () => (await activeUrl(worker)).includes('/blank'), 10000, 'another tab in front');
    assert.equal(await worker.evaluate(() => self.__qtsAutoApplyTabs.focus()), true);
    await until(async () => (await activeUrl(worker)).includes('/tab-step1'), 10000, 'the application in front');
    await until_panel(first, /Ana Test/);
  } finally { await browser.close(); }
});

test('the panel stays above the site\'s own pop-ups, can be dragged by its title bar, and [▴] makes it small', { skip, timeout: 150000 }, async () => {
  const { browser, first } = await startOn(117, 'tab-overlay');
  try {
    await sleep(3000);
    const hit = await first.evaluate(() => {
      const element = document.elementFromPoint(window.innerWidth - 60, Math.round(window.innerHeight / 2));
      return Boolean(element?.closest?.('[data-qts-apply-review]'));
    });
    assert.ok(hit, 'the panel is on top of the cookie wall and the full-page pop-up');
    const brand = await panelBox(first, 'brand');
    await first.mouse.move(brand.x + 70, brand.y + 20);
    await first.mouse.down();
    await first.mouse.move(260, 140, { steps: 8 });
    await first.mouse.up();
    const moved = await panelBox(first, 'panel');
    assert.ok(Math.abs(moved.x - 190) < 40 && Math.abs(moved.y - 120) < 40, `moved to ${JSON.stringify(moved)}`);
    assert.equal(await first.evaluate(() => document.documentElement.getAttribute('data-qts-apply-docked')), null, 'the page is no longer pushed aside');
    const full = moved.height;
    assert.ok(await clickPanelButton(first, '▴'));
    await sleep(300);
    const smaller = await panelBox(first, 'panel');
    assert.ok(smaller.height < Math.min(140, full / 2), `small: ${smaller.height} (was ${full})`);
  } finally { await browser.close(); }
});

// ---- Search and suggestion boxes: Chrome's own input, never letter by letter ----
test('suggestion boxes (city, school, country, skills) get the whole text as real input, then Backspace and the last letter; the first word next; else left empty', { skip, timeout: 180000 }, async () => {
  resetMock({ queue: [] });
  const { browser, worker } = await launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/suggest`);
    await page.bringToFront();
    const outcomes = await worker.evaluate(async (url) => {
      const [tab] = (await chrome.tabs.query({})).filter((entry) => entry.url === url);
      const fields = await inForm(tab.id, () => globalThis.__qtsApplyForm.scanForm());
      const byLabel = (text) => fields.find((field) => field.label.startsWith(text));
      const fill = async (label, value) => fillAndCheck(tab.id, byLabel(label), { value, source: 'profile' }, null, new Set());
      const results = {};
      results.city = await fill('City', 'Cluj-Napoca');
      results.school = await fill('School', 'Babes-Bolyai University');
      results.country = await fill('Country', 'Romania');
      results.skills = await fill('Skills', ['JavaScript', 'Python']);
      results.tool = await fill('Favourite tool', 'Screwdriver Pro');
      await releaseDebugger(tab.id);
      return results;
    }, `${BASE}/suggest`);
    assert.equal(outcomes.city.ok, true, JSON.stringify(outcomes.city));
    assert.equal(outcomes.school.ok, true, JSON.stringify(outcomes.school));
    assert.equal(outcomes.country.ok, true, JSON.stringify(outcomes.country));
    assert.equal(outcomes.skills.ok, true, JSON.stringify(outcomes.skills));
    assert.equal(outcomes.tool.ok, false);
    assert.match(outcomes.tool.error, /pick it yourself/);
    const seen = await page.evaluate(() => ({
      city: document.getElementById('city').value,
      school: document.getElementById('school').value,
      country: document.getElementById('country').value,
      skills: [...document.querySelectorAll('#skills-chips .chip')].map((chip) => chip.textContent),
      tool: document.getElementById('tool').value,
      typing: window.typing,
    }));
    assert.equal(seen.city, 'Cluj-Napoca, Romania');
    assert.equal(seen.school, 'Babes-Bolyai University (UBB)', 'found with the first word');
    assert.equal(seen.country, 'Romania');
    assert.deepEqual(seen.skills, ['JavaScript', 'Python']);
    assert.equal(seen.tool, '', 'no suggestion: left empty');
    // Never letter by letter: one real letter key per try (the last letter after Backspace), and no
    // simulated key events at all.
    assert.equal(seen.typing.untrusted, 0, 'no simulated letter keys');
    assert.equal(seen.typing.letters.city, 1);
    assert.equal(seen.typing.letters.country, 1);
    assert.equal(seen.typing.letters.school, 2, 'the whole name, then the first word');
    assert.equal(seen.typing.letters.skills, 2, 'one per skill');
    assert.equal(seen.typing.letters.tool, 2, 'the whole text, then the first word, then left');
    // Every search the box made was the whole text (or it with its last letter taken back), first the
    // whole answer, then its first word: nothing shorter, as letter-by-letter typing would make.
    const searchedAs = (searches, whole, first) => {
      const allowed = [whole, whole.slice(0, -1), first, first.slice(0, -1)];
      assert.ok(searches.every((text) => allowed.includes(text)), JSON.stringify(searches));
      assert.ok(searches.indexOf(whole) >= 0 && searches.indexOf(whole) < searches.lastIndexOf(first), JSON.stringify(searches));
    };
    searchedAs(seen.typing.searches.school, 'Babes-Bolyai University', 'Babes-Bolyai');
    searchedAs(seen.typing.searches.tool, 'Screwdriver Pro', 'Screwdriver');
  } finally { await browser.close(); }
});

test('Auto Apply fills suggestion boxes from the profile with real input; one with no suggestion says "pick it yourself" in the panel', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(120, 'suggest-form')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1, 90000);
    const form = await formPage(browser, '/suggest-form');
    assert.equal(await valueOf(form, 'city'), 'Cluj-Napoca, Romania');
    assert.equal(await valueOf(form, 'country'), 'Romania');
    assert.equal(await valueOf(form, 'nationality'), '', 'left empty');
    await until_panel(form, /pick it yourself/i, 20000);
    const typing = await form.evaluate(() => window.typing);
    assert.equal(typing.untrusted, 0, 'no simulated letter keys');
    assert.ok((typing.letters.city || 0) <= 2, `city: ${typing.letters.city} letter keys`);
  } finally { await browser.close(); }
});

// ---- Auto Apply never closes the application's tab unless the Manager ended it; Remove ----
const stopLog = async (storage) => (await storage(['qtsAutoApplyStopLog'])).qtsAutoApplyStopLog || [];
/** Clicks a panel button when no application waits (a stopped panel). */
const clickStopped = (page, label) => until(() => clickPanelButton(page, label).catch(() => false), 20000, `the panel's ${label}`);
/** Answers the page's next confirm() (Remove asks first). */
const answerConfirm = (page, accept) => new Promise((resolve) => page.once('dialog', async (dialog) => { resolve(dialog.message()); await (accept ? dialog.accept() : dialog.dismiss()); }));

test('a missed check-in is taken back: QTS sends the job and the Stop all count, and the application goes on in its tab', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(130, 'form')], heartbeatMode: 'recover' });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    await until(() => mock.heartbeats.length >= 2, 45000, 'two check-ins');
    assert.ok(mock.heartbeats.every((beat) => beat.jobId === jobId(130) && beat.stopVersion === STOP_VERSION), JSON.stringify(mock.heartbeats));
    const run = (await storage(['qtsAutoApplyState'])).qtsAutoApplyState?.runs?.[0];
    assert.ok(run && ['needs_you', 'final'].includes(run.phase), 'still waiting for the Manager');
    assert.equal(mock.released.length, 0);
    assert.ok(await formPage(browser, '/form'), 'the tab stays');
  } finally { await browser.close(); }
});

test('a hold really lost keeps the tab, the form and the panel (why, Submitted, Give back); Submitted then saves the bid from the job', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(131, 'form')], heartbeatMode: 'lost', holdGone: true });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    const panel = await until_panel(form, /Give back/, 45000);
    assert.match(panel, /Why QTS stopped: .*no longer holds/);
    assert.match(panel, /Give back/);
    assert.match(panel, /Submitted/);
    assert.ok(await formPage(browser, '/form'), 'the tab stays');
    assert.equal(await valueOf(form, 'fn'), 'Ana', 'what is filled stays');
    const ended = (await stopLog(storage)).at(-1);
    assert.equal(ended.jobId, jobId(131));
    assert.equal(ended.tabClosed, false, 'the log says the tab stayed');
    await clickStopped(form, 'Submitted');
    await until(() => mock.savedBids.length === 1, 20000, 'the bid saved from the job');
    assert.equal(mock.savedBids[0].jobId, jobId(131));
    assert.ok(mock.savedBids[0].appliedAnswers.some((entry) => entry.answer === 'Ana'));
    await until(async () => !(await formPage(browser, '/form')), 20000, 'the tab to close after Submitted');
    assert.equal((await stopLog(storage)).at(-1).tabClosed, true);
  } finally { await browser.close(); }
});

test('Auto Apply switched off keeps the tab with the panel; Give back closes it and returns the job unchanged', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(132, 'form')] });
  const { browser, action, worker, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await worker.evaluate(() => chrome.storage.local.set({ qtsExtensionStatus: null }));
    const panel = await until_panel(form, /Give back/, 30000);
    assert.match(panel, /switched off|stopped/i);
    await sleep(1500);
    assert.ok(await formPage(browser, '/form'), 'the tab stays');
    assert.equal(await valueOf(form, 'fn'), 'Ana');
    assert.equal(mock.results.length, 0, 'no bid');
    await clickStopped(form, 'Give back');
    await until(async () => !(await formPage(browser, '/form')), 20000, 'the tab to close');
    assert.equal(mock.released.at(-1).mode, 'drop', 'the job back unchanged');
    assert.equal(mock.results.length, 0);
    const log = await stopLog(storage);
    assert.ok(log.some((entry) => entry.jobId === jobId(132) && entry.tabClosed === false), 'the stop, tab kept');
    assert.ok(log.some((entry) => entry.jobId === jobId(132) && entry.tabClosed === true && /Given back/.test(entry.reason)), 'Give back, tab closed');
  } finally { await browser.close(); }
});

test('Remove asks first: Cancel there changes nothing; OK deletes the job row and closes the tab', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(133, 'form')] });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    let asked = answerConfirm(form, false);
    await until(() => clickPanelButton(form, '🗑').catch(() => false), 10000, 'the 🗑 button');
    assert.equal(await asked, 'Remove "Backend Engineer" at Globex from the Jobs table?');
    await sleep(1500);
    assert.ok(await formPage(browser, '/form'), 'nothing changes');
    assert.equal(mock.released.length, 0);
    asked = answerConfirm(form, true);
    await until(() => clickPanelButton(form, '🗑').catch(() => false), 10000, 'the 🗑 button');
    await asked;
    await until(() => mock.released.some((entry) => entry.mode === 'remove'), 20000, 'the job removed');
    assert.ok(!mock.released.some((entry) => entry.mode === 'drop'), 'removed, never just dropped');
    await until(async () => !(await formPage(browser, '/form')), 20000, 'the tab to close');
    assert.equal(mock.removeJobs.length, 0, 'the hold itself removed it');
  } finally { await browser.close(); }
});

test('Remove while Ask AI answers stops it at once; with the hold gone the job is removed by its id', { skip, timeout: 150000 }, async () => {
  resetMock({ queue: [application(134, 'form')], answerDelay: 15000, holdGone: true });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await emptyBox(form, 'mot');
    await askAi(form, { wait: false });
    await until(() => mock.answers === 1, 30000, 'the AI request');
    const asked = answerConfirm(form, true);
    await until(() => clickPanelButton(form, '🗑').catch(() => false), 10000, 'the 🗑 button');
    await asked;
    await until(() => mock.removeJobs.length === 1, 20000, 'the job removed by its id');
    assert.equal(mock.removeJobs[0].jobId, jobId(134));
    await until(async () => !(await formPage(browser, '/form')), 20000, 'the tab to close');
    await sleep(16000);
    assert.equal(mock.answers, 1, 'Ask AI stopped: nothing asked again');
  } finally { await browser.close(); }
});

test('a Remove the server refuses leaves the tab and the panel, with the reason', { skip, timeout: 120000 }, async () => {
  resetMock({ queue: [application(135, 'form')], removeRefused: 'This job has a bid, so it is not removed: it belongs to the Bids page.' });
  const { browser, action, storage } = await launch();
  try {
    assert.equal((await action('auto_apply')).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    const asked = answerConfirm(form, true);
    await until(() => clickPanelButton(form, '🗑').catch(() => false), 10000, 'the 🗑 button');
    await asked;
    const panel = await until_panel(form, /Not removed: This job has a bid/, 30000);
    assert.match(panel, /Give back/);
    assert.ok(await formPage(browser, '/form'), 'the tab stays');
  } finally { await browser.close(); }
});

test('choosing another candidate stops what was under way for the first', { skip, timeout: 120000 }, async () => {
  const job = application(14, 'form');
  resetMock({ queue: [job], answerDelay: 15000 });
  const { browser, action, worker, storage } = await launch();
  try {
    const selection = { candidateId: ANA.id, jobIds: [jobId(14)] };
    assert.equal((await action('auto_apply', selection)).ok, true);
    await waitForStep(storage, 1);
    const form = await formPage(browser, '/form');
    await emptyBox(form, 'mot');
    await askAi(form, { wait: false });
    await until(() => mock.answers === 1, 60000, 'the AI request');
    await worker.evaluate((candidateId) => chrome.storage.local.set({ qtsWorkSelection: { mode: 'auto_apply', candidateId, jobIds: [] } }), BEN.id);
    await until(() => mock.released.length === 1, 20000, 'the application to be given back');
    assert.equal(mock.released[0].attemptId, attempt(14));
    assert.match(mock.released[0].reason, /Another candidate was chosen/);
    assert.equal(mock.released[0].mode, 'drop', 'nothing is recorded on the job');
    await sleep(500);
    // The AI's answers for the old candidate never went in (the tab closes with the job).
    const left = await form.evaluate(() => document.getElementById('mot')?.value).catch(() => '');
    assert.ok(!left, 'nothing the AI said was filled for the old candidate');
  } finally { await browser.close(); }
});
