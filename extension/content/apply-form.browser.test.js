// Apply's form engine (apply-form.js) in a real Chrome, on small local pages: reading questions,
// discovering dropdown choices without side effects, and filling. Skipped when Chrome is not
// installed (set QTS_CHROME to its path). Nothing leaves the machine; no form is submitted.
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

/** Opens a page with html, adds the form engine, runs code (with `api`) inside it, and returns its result. */
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

test('a text answer never clicks another field\'s open list; its own suggestion is picked', { skip }, async () => {
  const other = await onPage(`<form><label for="yr">Years *</label><input id="yr"><ul role="listbox"><li role="option" id="o1">5-8 years</li></ul></form>
    <script>document.getElementById('o1').addEventListener('click', () => { window.wrong = true; });</script>`,
  `const f = api.scanForm()[0]; const res = await api.fillField(f.id, '5'); return { ok: res.ok, wrong: Boolean(window.wrong), value: document.getElementById('yr').value };`);
  assert.deepEqual(other, { ok: true, wrong: false, value: '5' });
  const own = await onPage(`<form><div class="application-label">Current location</div><input id="loc"><div class="dropdown-results"></div></form>
    <script>const i = document.getElementById('loc'), d = i.nextElementSibling;
      i.addEventListener('input', () => setTimeout(() => { d.innerHTML = '<div class="dropdown-location">Warsaw, Warszawa, Mazowieckie, POL</div>';
        d.firstChild.addEventListener('click', () => { i.value = d.firstChild.textContent; }); }, 100));</script>`,
  `const f = api.scanForm()[0]; const res = await api.fillField(f.id, 'Warsaw, Poland'); return { ok: res.ok, value: document.getElementById('loc').value };`);
  assert.deepEqual(own, { ok: true, value: 'Warsaw, Warszawa, Mazowieckie, POL' });
});

test('a box without its own label never takes another question\'s; an unsure one is marked unresolved', { skip }, async () => {
  const fields = await onPage(`<form>
      <div><label for="cv">Resume/CV *</label><input id="cv" type="file"></div>
      <div><input id="ph" placeholder="Your city"></div>
      <div><input id="nm" name="first_name"></div>
      <div><label>Employment dates</label><input placeholder="From"><input placeholder="To"></div>
    </form>`,
  `return api.scanForm().map((f) => [f.label, f.required, Boolean(f.labelUnresolved)]);`);
  assert.deepEqual(fields, [
    ['Resume/CV', true, false],
    ['Your city', false, false],
    ['first name', false, true],
    ['Employment dates', false, false],
    ['To', false, false],
  ]);
});

test('labels as real sites write them: aria-labelledby first, a label for a missing id, a label before its description', { skip }, async () => {
  const fields = await onPage(`<form>
      <div><span id="g-l"><strong>Gender:</strong></span><label><svg><text>SVGs not supported by this browser.</text></svg>
        <input id="g" role="combobox" aria-labelledby="g-l" aria-controls="g-list" readonly></label><ul id="g-list" role="listbox" hidden><li role="option">Female</li></ul></div>
      <div><label for="_systemfield_location">Location</label><p>What country will you primarily be working from?</p>
        <input role="combobox" aria-autocomplete="list" placeholder="Start typing..."></div>
      <div><label>Are you willing to relocate?</label><div><button type="button" aria-pressed="false">Yes</button><button type="button" aria-pressed="false">No</button></div></div>
      <div><input placeholder="Your city"></div>
    </form>`,
  'return api.scanForm().filter((f) => f.kind !== "radio").map((f) => f.label);');
  assert.deepEqual(fields, ['Gender:', 'Location', 'Your city']);
});

test('a page like PeopleForce: rich-text cover letter, editor toolbar, language switcher, CSS required marks', { skip }, async () => {
  const result = await onPage(`<select id="lang" onchange="window.navigated = true"><option>English</option><option>Українська</option><option>Polski</option><option>Deutsch</option></select>
    <form>
      <div><label class="required" for="name">Full name</label><input id="name"></div>
      <div><label for="cl">Cover letter</label>
        <div class="fr-toolbar"><button type="button" aria-pressed="false">Bold</button><button type="button" aria-pressed="false">Italic</button></div>
        <div class="fr-element" contenteditable="true"><br></div>
        <textarea id="cl" name="cover_letter" class="hidden" style="display:none"></textarea></div>
    </form>`,
  `const fields = api.scanForm();
   const letter = fields.find((f) => f.label === 'Cover letter');
   const fill = await api.fillField(letter.id, 'Dear Hiring Manager,\\nI am writing to apply.');
   return { fields: fields.map((f) => [f.label, f.kind, f.required]), fill: fill.ok,
     editor: document.querySelector('.fr-element').textContent, hidden: document.getElementById('cl').value.includes('I am writing to apply'),
     navigated: Boolean(window.navigated) };`);
  assert.deepEqual(result.fields, [['Full name', 'text', true], ['Cover letter', 'textarea', false]]);
  assert.equal(result.fill, true);
  assert.match(result.editor, /Dear Hiring Manager,\s*I am writing to apply\./);
  assert.equal(result.hidden, true);
  assert.equal(result.navigated, false);
});

test('an upload that lost its file is seen as empty; one showing its file name is not', { skip }, async () => {
  const result = await onPage(`<form>
      <div><label for="a">Resume *</label><input id="a" type="file" required><div>Allowed formats: .doc, .docx, .pdf</div></div>
      <div><label for="b">CV *</label><input id="b" type="file" required><div>Radu_Star_CV.pdf uploaded</div></div>
    </form>`,
  `const [a, b] = api.scanForm(); return { a: api.uploadHolds(a.id), b: api.uploadHolds(b.id), empty: api.emptyRequiredUploads().map((e) => e.label) };`);
  assert.deepEqual(result, { a: false, b: true, empty: ['Resume'] });
});

test('the form as structured data (schema 1.0): types, values, option details, discovery status, sections, actions', { skip }, async () => {
  const result = await onPage(`<html lang="en"><body><form>
      <h2>Personal information</h2>
      <div><label for="em">Email *</label><input id="em" type="email" required value="x@example.com"></div>
      <div><label for="yr">Years of experience? *</label><select id="yr" required><option value="">Select…</option><option value="a">0-2 years</option><option value="b" disabled>3-5 years</option><optgroup label="Senior"><option value="c" selected>6+ years</option></optgroup></select></div>
      <div><label for="sal">Salary expectation</label><input id="sal" type="number" step="0.01" min="0"></div>
      <div><label for="lv">Level</label><input id="lv" role="combobox" aria-controls="lv-l"><ul id="lv-l" role="listbox" hidden><li role="option" id="o1" data-value="jr">Junior</li></ul></div>
      <div><label for="sk">Skill</label><input id="sk" role="combobox"></div>
      <div><label for="un">University</label><input id="un" list="unis"><datalist id="unis"><option value="TU Cluj"></option></datalist></div>
      <h2>More</h2>
      <div><label for="co">Country</label><select id="co"><option value="">Select…</option><option>Romania</option></select></div>
      <div><label for="rg">Region</label><select id="rg"><option value="">Select a country first</option></select></div>
      <div><input id="ct" placeholder="Your city"></div>
      <div><input id="q9" name="q_9"></div>
      <div><label for="cv">Resume *</label><input id="cv" type="file" accept=".pdf" required></div>
      <button type="button">Continue</button><button type="submit">Submit application</button><a href="/login">Sign in</a>
    </form></body></html>`,
  'const schema = api.formSchema(2); return { schema, problems: api.checkFormSchema(schema) };');
  const { schema, problems } = result;
  const by = (question) => schema.fields.find((entry) => entry.question === question);
  assert.deepEqual(problems, []);
  assert.equal(schema.schemaVersion, '1.0');
  assert.deepEqual([schema.page.type, schema.page.step, schema.page.language, schema.page.forms], ['application_form', 2, 'en', 1]);
  assert.deepEqual(schema.sections.map((section) => section.title), ['Personal information', 'More']);
  const email = by('Email *');
  assert.deepEqual([email.elementType, email.inputType, email.valueType, email.required, email.currentValue, email.optionsDiscovery.status, email.sectionId], ['input', 'email', 'string', true, 'x@example.com', 'not_applicable', 'section_1']);
  const years = by('Years of experience? *');
  assert.deepEqual([years.elementType, years.inputType, years.valueType, years.optionsDiscovery], ['select', 'single_select', 'enum', { method: 'dom', status: 'complete' }]);
  assert.deepEqual(years.options, [
    { label: '0-2 years', value: 'a', disabled: false, selected: false },
    { label: '3-5 years', value: 'b', disabled: true, selected: false },
    { label: '6+ years', value: 'c', disabled: false, selected: true, group: 'Senior' },
  ]);
  assert.deepEqual([by('Salary expectation').valueType, by('Salary expectation').constraints], ['decimal', { min: 0 }]);
  assert.deepEqual(by('Level').options, [{ label: 'Junior', value: 'jr', disabled: false, selected: false, optionId: 'o1' }]);
  assert.deepEqual([by('Level').inputType, by('Level').lifecycle], ['searchable_select', 'options_ready']);
  assert.deepEqual([by('Skill').optionsDiscovery.status, by('Skill').lifecycle], ['unknown', 'discovered']);
  assert.equal(by('University').optionsDiscovery.status, 'partial');
  assert.deepEqual([by('Region').optionsDiscovery.status, by('Region').lifecycle, by('Region').sectionId], ['pending_dependency', 'waiting_dependency', 'section_2']);
  assert.equal(by('Your city').labelConfidence, 'low');
  assert.deepEqual([by('q 9').labelConfidence, by('q 9').lifecycle], ['unresolved', 'unresolved']);
  assert.deepEqual(schema.unresolvedFields, [by('q 9').id]);
  assert.deepEqual([by('Resume').inputType, by('Resume').valueType, by('Resume').constraints, by('Resume').required], ['file_upload', 'file', { accept: '.pdf' }, true]);
  assert.deepEqual(schema.actions.map((action) => [action.type, action.text, action.safetyStatus]), [
    ['next', 'Continue', 'unverified'], ['submit', 'Submit application', 'final_submit'], ['sign_in', 'Sign in', 'never_automatic'],
  ]);
  assert.equal(schema.discoveryStatus, 'complete_for_current_state');
});

test('the form record is well formed, and its revision grows only when questions or choices change', { skip }, async () => {
  const result = await onPage(`<form><label for="co">Country</label><select id="co"><option>Romania</option><option>Poland</option></select>
      <label for="rg">Region</label><select id="rg"><option>Mazowieckie</option></select></form>`,
  `const one = api.formSchema(); const two = api.formSchema();
   document.getElementById('rg').innerHTML = '<option>Cluj</option><option>Bihor</option>';
   const three = api.formSchema();
   return { problems: api.checkFormSchema(one), broken: api.checkFormSchema({ schemaVersion: '1.0', page: {}, fields: [{ id: 'x' }], actions: [] }), revisions: [one.page.revision, two.page.revision, three.page.revision] };`);
  assert.deepEqual(result.problems, []);
  assert.ok(result.broken.length >= 5);
  assert.equal(result.revisions[1], result.revisions[0]);
  assert.equal(result.revisions[2], result.revisions[0] + 1);
});

test('pages are told apart: form, partial form, email-first, sign-in, account, code, CAPTCHA, closed, sent, job page, nothing', { skip }, async () => {
  const kind = (html) => onPage(html, 'return api.classifyPage().type;');
  assert.equal(await kind(`<form><label for="a">Full name</label><input id="a"><label for="b">Email</label><input id="b" type="email"><label for="c">CV</label><input id="c" type="file"></form>`), 'application_form');
  assert.equal(await kind(`<form><label for="q1">Why us?</label><textarea id="q1"></textarea><label for="q2">Years?</label><input id="q2" type="number"></form>`), 'partial_application_form');
  assert.equal(await kind(`<form><label for="e">Email address</label><input id="e" type="email"><button type="submit">Continue</button><button type="button">Continue with Google</button></form>`), 'email_first_application');
  assert.equal(await kind(`<form><label for="e">Email</label><input id="e" type="email"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form>`), 'authentication_required');
  assert.equal(await kind(`<h1>Create your account</h1><form><label for="e">Email</label><input id="e" type="email"><label for="p">Password</label><input id="p" type="password"><label for="p2">Confirm password</label><input id="p2" type="password"><button>Sign up</button></form>`), 'registration_required');
  assert.equal(await kind(`<p>We sent a code to your email.</p><form><label for="c">Verification code</label><input id="c" autocomplete="one-time-code"><button>Verify</button></form>`), 'verification_required');
  assert.equal(await kind(`<form><label for="k">Type below image text</label><input id="k"><img alt="captcha"></form>`), 'captcha_required');
  assert.equal(await kind(`<main><h1>Data Scientist</h1><p>This job has expired.</p></main>`), 'application_closed');
  assert.equal(await kind(`<main><h1>Thank you for applying!</h1><p>We have received your application.</p></main>`), 'application_submitted');
  assert.equal(await kind(`<main><h1>Data Scientist</h1><p>About the role…</p><button>Apply now</button></main>`), 'application_navigation');
  assert.equal(await kind(`<main><h1>Welcome</h1></main>`), 'unsupported_page');
});

test('a list that says it is loading is waited for, within a limit', { skip }, async () => {
  const result = await onPage(`<form><label for="of">Office *</label><input id="of" role="combobox" aria-controls="ol"><ul id="ol" role="listbox"></ul></form>
    <script>const i = document.getElementById('of'), l = document.getElementById('ol');
      i.addEventListener('focus', () => { l.setAttribute('aria-busy', 'true'); l.textContent = 'Loading…';
        setTimeout(() => { l.removeAttribute('aria-busy'); l.innerHTML = '<li role="option">Bucharest</li><li role="option">Cluj</li>'; }, 2000); });</script>`,
  'const f = api.scanForm()[0]; const read = await api.discoverComboboxChoices(f.id); return read.options;');
  assert.deepEqual(result, ['Bucharest', 'Cluj']);
});

test('a list beside its box never makes the box look answered; a choice counts only once the box shows it', { skip }, async () => {
  const result = await onPage(`<form><div><label for="y">Years of experience? *</label><input id="y" role="combobox" aria-controls="yl" required><ul id="yl" role="listbox" hidden></ul></div>
      <div><label for="z">Seniority *</label><input id="z" role="combobox" aria-controls="zl"><ul id="zl" role="listbox"><li role="option">Senior</li></ul></div></form>
    <script>const y = document.getElementById('y'), yl = document.getElementById('yl');
      y.addEventListener('focus', () => { yl.innerHTML = '<li role="option">0-2 years</li><li role="option">6+ years</li>'; yl.hidden = false; });
      yl.addEventListener('click', (e) => { if (e.target.getAttribute('role') === 'option') { y.value = e.target.textContent; yl.hidden = true; } });</script>`,
  `const [years, seniority] = api.scanForm();
   await api.discoverComboboxChoices(years.id);
   const before = { unanswered: api.isUnanswered(years), shown: api.shownValue(years.id) };
   const fill = await api.fillField(years.id, '6+ years');
   // A list whose choice does nothing when clicked: the fill must not report success.
   const stuck = await api.fillField(seniority.id, 'Senior');
   return { before, fill, value: document.getElementById('y').value, stuck: stuck.ok, stuckValue: document.getElementById('z').value };`);
  assert.deepEqual(result.before, { unanswered: true, shown: '' });
  assert.deepEqual([result.fill.ok, result.value], [true, '6+ years']);
  assert.deepEqual([result.stuck, result.stuckValue], [false, '']);
});

test('an unlabeled dialing-code dropdown beside a phone box is the phone\'s country code', { skip }, async () => {
  const fields = await onPage(`<form><label for="p">Telephone *</label><select id="cc"><option>+48</option><option>+40</option></select><input id="p" type="tel"></form>`,
  'return api.scanForm().map((f) => [f.label, f.kind, Boolean(f.labelUnresolved)]);');
  assert.deepEqual(fields, [['Phone country code', 'select', false], ['Telephone *', 'tel', false]]);
});

test('a chip\'s remove mark is dropped and every other character kept', { skip }, async () => {
  const texts = await onPage(`<form><label for="t">Tools</label><input id="t" role="combobox" aria-controls="l"><ul id="l" role="listbox" hidden>
      <li role="option">Yes✕</li><li role="option">Tests✕</li><li role="option">None of the above ✕</li><li role="option">C++</li><li role="option">R&amp;D</li><li role="option">2×2 grid</li></ul></form>`,
  'return api.scanForm()[0].options;');
  assert.deepEqual(texts, ['Yes', 'Tests', 'None of the above', 'C++', 'R&D', '2×2 grid']);
});

test('required uploads stay required whichever way the page marks them', { skip }, async () => {
  const uploads = await onPage(`<form>
      <div><label for="a">Resume *</label><input id="a" type="file"></div>
      <div><span id="b-l">Portfolio (required)</span><input type="file" aria-labelledby="b-l"></div>
      <div><label for="c">Cover letter</label><input id="c" type="file"></div>
      <div><label for="d">Certificate</label><input id="d" type="file" required></div>
    </form>`,
  'return api.scanForm().map((f) => [f.label, f.required]);');
  assert.deepEqual(uploads, [['Resume', true], ['Portfolio (required)', true], ['Cover letter', false], ['Certificate', true]]);
});

test('a native multi-select takes several choices', { skip }, async () => {
  const result = await onPage(`<form><label for="m">Languages</label><select id="m" multiple><option>English</option><option>German</option><option>Polish</option></select></form>`,
  `const f = api.scanForm()[0]; const res = await api.fillField(f.id, ['English', 'Polish']);
   return { multiple: f.multiple, ok: res.ok, selected: [...document.getElementById('m').selectedOptions].map((o) => o.text) };`);
  assert.deepEqual(result, { multiple: true, ok: true, selected: ['English', 'Polish'] });
});

test('search-type comboboxes, autocompletes without the role, and read-only pickers are questions', { skip }, async () => {
  const fields = await onPage(`<form>
      <div><label for="s">Skill *</label><input id="s" type="search" role="combobox"></div>
      <div><label for="a">Location *</label><input id="a" aria-autocomplete="list" aria-controls="al"><ul id="al" role="listbox" hidden><li role="option">Warsaw</li></ul></div>
      <div><label for="d">Date of birth</label><input id="d" readonly placeholder="DD/MM/YYYY"></div>
      <div><label for="e">Email (locked)</label><input id="e" readonly value="x@example.com"></div>
    </form>`,
  'return api.scanForm().map((f) => [f.label, f.kind, Boolean(f.disabled), f.options || null]);');
  assert.deepEqual(fields, [
    ['Skill *', 'combobox', false, null],
    ['Location *', 'combobox', false, ['Warsaw']],
    ['Date of birth', 'text', false, null],
    // A locked prefilled box is not a picker: left alone, as before.
    ['Email (locked)', 'text', true, null],
  ]);
});

test('looking at choices never picks one, adds a tag, or leaves text; long scroll lists are read to their end', { skip }, async () => {
  const result = await onPage(`<form>
      <div><label for="lvl">Level</label><input id="lvl" role="combobox" aria-controls="ll"><ul id="ll" role="listbox" hidden></ul></div>
      <div><label for="tg">Tools</label><input id="tg" role="combobox" aria-controls="tl"><ul id="tl" role="listbox"></ul><div id="out"></div></div>
      <div><label for="ct">City</label><input id="ct" role="combobox" aria-controls="cl"><ul id="cl" role="listbox" style="height:200px;overflow:auto" hidden></ul></div>
    </form>
    <script>
      const lvl = document.getElementById('lvl'), ll = document.getElementById('ll'); let hi = null;
      lvl.addEventListener('focus', () => { ll.hidden = false; ll.innerHTML = '<li role="option">Junior</li><li role="option">Senior</li>'; });
      lvl.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') hi = 'Junior'; });
      lvl.addEventListener('blur', () => { if (hi) lvl.value = hi; ll.hidden = true; });
      const tg = document.getElementById('tg');
      tg.addEventListener('change', () => { if (tg.value) document.getElementById('out').textContent += '[' + tg.value + ']'; });
      const all = Array.from({ length: 100 }, (_, k) => 'City ' + (k + 1)); const cl = document.getElementById('cl'); let shown = 20;
      const draw = () => { cl.innerHTML = all.slice(0, shown).map((c) => '<li role="option" style="height:20px">' + c + '</li>').join(''); };
      document.getElementById('ct').addEventListener('focus', () => { draw(); cl.hidden = false; });
      cl.addEventListener('scroll', () => { if (cl.scrollTop + cl.clientHeight >= cl.scrollHeight - 5) { shown = Math.min(100, shown + 20); draw(); } });
    </script>`,
  `const fs = api.scanForm();
   const level = await api.discoverComboboxChoices(fs[0].id);
   const tools = await api.searchComboboxChoices(fs[1].id);
   const city = await api.discoverComboboxChoices(fs[2].id);
   return { levelValue: document.getElementById('lvl').value, levelChanged: level.changed, tags: document.getElementById('out').textContent,
     toolsValue: document.getElementById('tg').value, cities: city.options.length, cityPartial: city.partial, cityValue: document.getElementById('ct').value };`);
  assert.deepEqual(result, { levelValue: '', levelChanged: false, tags: '', toolsValue: '', cities: 100, cityPartial: false, cityValue: '' });
});

test('dependent lists are read again from the page after their parent is chosen', { skip }, async () => {
  const result = await onPage(`<form>
      <div><label for="co">Country</label><select id="co"><option value="">Select…</option><option>Poland</option><option>Romania</option></select></div>
      <div><label for="rg">Region</label><select id="rg"><option value="">Select country first</option><option>Mazowieckie</option></select></div>
    </form>
    <script>const co = document.getElementById('co'), rg = document.getElementById('rg');
      co.addEventListener('change', () => { rg.innerHTML = '<option value="">Select…</option>' + (co.value === 'Romania' ? '<option>Cluj</option><option>Bihor</option>' : '<option>Mazowieckie</option>'); });</script>`,
  `const [co, rg] = api.scanForm(); const before = api.currentChoices(rg.id); await api.fillField(co.id, 'Romania'); return { before, after: api.currentChoices(rg.id) };`);
  assert.deepEqual(result, { before: ['Mazowieckie'], after: ['Cluj', 'Bihor'] });
});

test('a form in a frame from the same site is read and filled', { skip }, async () => {
  const result = await onPage(`<form><label for="n">Name</label><input id="n"></form>
    <iframe id="same" srcdoc="<form><label for='q'>Frame question *</label><input id='q' required></form>"></iframe>`,
  `await new Promise((r) => setTimeout(r, 300));
   const f = api.scanForm().find((x) => x.label === 'Frame question *');
   const res = f ? await api.fillField(f.id, 'Answer') : null;
   return { found: Boolean(f), ok: res && res.ok, value: document.getElementById('same').contentDocument.getElementById('q').value };`);
  assert.deepEqual(result, { found: true, ok: true, value: 'Answer' });
});

test('the assistant\'s scan marks search, newsletter, job-alert and footer boxes as not the application', { skip }, async () => {
  const fields = await onPage(`<header><form action="/jobs/search"><label for="q">Keywords</label><input id="q" type="text"><label for="where">Location</label><input id="where"></form></header>
    <div role="search"><label for="s2">Find jobs</label><input id="s2"></div>
    <form id="apply"><label for="fn">First name</label><input id="fn"><label for="em">Email</label><input id="em" type="email"><label for="ci">City</label><input id="ci"><button>Submit application</button></form>
    <form class="newsletter-signup"><label for="nl">Your email</label><input id="nl" type="email"><button>Go</button></form>
    <aside><form><p>Get job alerts for roles like this</p><label for="ja">Email</label><input id="ja" type="email"><button>Notify me</button></form></aside>
    <footer><form><label for="ft">Email</label><input id="ft" type="email"></form></footer>`,
  `return api.scanForAssist().map((f) => [document.querySelector('[data-qts-apply-field="' + f.id + '"]').id, Boolean(f.unrelated)]);`);
  assert.deepEqual(Object.fromEntries(fields), { q: true, where: true, s2: true, fn: false, em: false, ci: false, nl: true, ja: true, ft: true });
});

test('sign-in and create-account forms are the Manager\'s; the application form beside them is not', { skip }, async () => {
  const marks = (html) => onPage(html,
    `return api.scanForAssist().filter((f) => !f.hidden).map((f) => [document.querySelector('[data-qts-apply-field="' + f.id + '"]').id, Boolean(f.account)]);`);
  assert.deepEqual(Object.fromEntries(await marks(`<form id="login"><label for="u">Email or username</label><input id="u"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form>`)),
    { u: true });
  assert.deepEqual(Object.fromEntries(await marks(`<form><label for="fn">First name</label><input id="fn"><label for="em">Email</label><input id="em" type="email">
      <label for="p1">Password</label><input id="p1" type="password"><label for="p2">Confirm password</label><input id="p2" type="password"><button>Create account</button></form>`)),
    { fn: true, em: true });
  // A sign-in box beside the application's own form leaves the application's questions to QTS.
  assert.deepEqual(Object.fromEntries(await marks(`<form><label for="u">Email</label><input id="u" type="email"><label for="p">Password</label><input id="p" type="password"></form>
      <form><label for="fn">First name</label><input id="fn"><label for="em">Email</label><input id="em" type="email"><label for="ci">City</label><input id="ci"></form>`)),
    { u: true, fn: false, em: false, ci: false });
  // A one-time code box is not a password: its form stays QTS's.
  assert.deepEqual(Object.fromEntries(await marks(`<form><label for="em">Email</label><input id="em" type="email"><label for="otp">Code</label><input id="otp" type="password" autocomplete="one-time-code"></form>`)),
    { em: false });
});
