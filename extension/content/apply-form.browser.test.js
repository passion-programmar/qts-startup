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

test('Normal Apply policy context changes with inline terms and refuses linked documents', { skip }, async () => {
  const result = await onPage('<form><div><label for="consent">I acknowledge the application notice</label><input id="consent" type="checkbox"><p id="terms">Notice version 1</p></div></form>', `
    const first = api.scanForAssist()[0].policyContext;
    document.querySelector('#terms').textContent = 'Notice version 2';
    const changed = api.scanForAssist()[0].policyContext;
    document.querySelector('#terms').innerHTML = '<a href="https://employer.example/privacy">Privacy</a>';
    return { first, changed, linked: api.scanForAssist()[0].policyContext };
  `);
  assert.ok(result.first); assert.notEqual(result.first, result.changed); assert.equal(result.linked, null);
});

test('shared semantic definitions fill equivalent profile and saved-choice labels through real controls', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<form><label for="email">What is your contact email?</label><input id="email" type="email"><label for="channel">What is your preferred interview channel?</label><select id="channel"><option value="">Select</option><option>Video</option><option>Phone</option></select></form>');
    for (const file of ['../shared/semantic-fields.js', '../shared/apply-answers.js', 'apply-form.js']) await page.addScriptTag({ path: path.join(__dirname, file) });
    const result = await page.evaluate(async () => {
      const api = globalThis.__qtsApplyForm;
      const saved = [{ id: 'saved', scope: 'candidate', questionText: 'Preferred interview format', questionKey: 'preferred interview format', answer: 'Video' }];
      const before = JSON.stringify(saved), fields = api.scanForAssist();
      const plan = globalThis.__qtsApplyAnswers.resolveFields(fields, { email: 'ana@example.test' }, saved, { normalApply: true });
      const outcomes = [];
      for (const [id, answer] of Object.entries(plan.answers)) outcomes.push((await api.fillField(id, answer.value)).ok);
      const auto = globalThis.__qtsApplyAnswers.resolveFields(fields, { email: 'ana@example.test' }, saved, { autoApply: true });
      return { outcomes, email: document.querySelector('#email').value, choice: document.querySelector('#channel').value,
        untouched: before === JSON.stringify(saved), autoChannel: auto.answers[fields.find((field) => field.label.includes('channel')).id]?.value ?? null };
    });
    assert.deepEqual(result, { outcomes: [true, true], email: 'ana@example.test', choice: 'Video', untouched: true, autoChannel: null });
  } finally { await page.close(); }
});

test('typed representations are accepted by real date, phone, number, radio and multiselect controls', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<form>
      <div><label for="name">Full name</label><input id="name" placeholder="Last, First"></div>
      <div><label for="dob">Date of birth</label><input id="dob" placeholder="DD/MM/YYYY" pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"></div>
      <div><select aria-label="Phone country code"><option>+49</option><option selected>+40</option></select><label for="phone">Local phone number</label><input id="phone" type="tel" pattern="[0-9]{9}"></div>
      <div><label for="years">Years of experience</label><input id="years" type="number" min="0" step="1"></div>
      <div><label for="notice">Notice period in days</label><input id="notice" type="number" data-unit="days" step="1"></div>
      <div><label for="start">Earliest start date</label><input id="start" type="date" min="2026-01-01" max="2027-12-31"></div>
      <div><label for="languages">Programming languages</label><select id="languages" multiple><option>Python</option><option>JavaScript</option></select></div>
      <fieldset><legend>Do you need sponsorship now?</legend><label><input type="radio" name="sponsor" value="yes">Yes, I do</label><label><input id="no" type="radio" name="sponsor" value="no">No, I do not</label></fieldset>
      <div><label for="unsafe">Phone number</label><input id="unsafe" type="tel" pattern="[0-9]{3}"></div>
    </form>`);
    for (const file of ['../shared/semantic-fields.js', '../shared/answer-representations.js', '../shared/apply-answers.js', 'apply-form.js']) await page.addScriptTag({ path: path.join(__dirname, file) });
    const result = await page.evaluate(async () => {
      const api = globalThis.__qtsApplyForm, fields = api.scanForAssist();
      const rows = [{ scope: 'candidate', questionText: 'Languages you can program in', questionKey: 'languages you can program in', answer: 'Python | JavaScript', variants: [{ kind: 'checkbox-group', options: [], answer: 'Python | JavaScript' }] },
        { scope: 'candidate', questionText: 'Do you currently require visa sponsorship?', questionKey: 'do you currently require visa sponsorship', answer: 'false', variants: [] }];
      const plan = globalThis.__qtsApplyAnswers.resolveFields(fields, { firstName: 'Ana', lastName: 'Pop', birthday: '1990-12-31', phone: '+40 711222333', yearsOfExperience: 0, noticePeriod: '1_week' }, rows,
        { normalApply: true, today: new Date('2026-01-01T12:00:00') });
      const outcomes = [];
      for (const [id, answer] of Object.entries(plan.answers)) outcomes.push((await api.fillField(id, answer.value)).ok);
      return { outcomes, name: document.querySelector('#name').value, dob: document.querySelector('#dob').value, phone: document.querySelector('#phone').value,
        years: document.querySelector('#years').value, notice: document.querySelector('#notice').value, start: document.querySelector('#start').value,
        languages: [...document.querySelector('#languages').selectedOptions].map((entry) => entry.textContent), no: document.querySelector('#no').checked,
        unsafe: document.querySelector('#unsafe').value, valid: document.querySelector('form').checkValidity() };
    });
    assert.ok(result.outcomes.length >= 8); assert.ok(result.outcomes.every(Boolean));
    assert.deepEqual({ ...result, outcomes: undefined }, { outcomes: undefined, name: 'Pop, Ana', dob: '31/12/1990', phone: '711222333', years: '0', notice: '7', start: '2026-01-08', languages: ['Python', 'JavaScript'], no: true, unsafe: '', valid: true });
  } finally { await page.close(); }
});

test('repeated PDF fills and a redrawn empty input do not duplicate an accepted attachment', { skip }, async () => {
  const result = await onPage(`<form><section id="cv"><div><label for="resume">Resume *</label><input id="resume" type="file" required></div><ul id="attachments"></ul></section><section><label for="letter">Cover letter</label><input id="letter" type="file"></section></form>
    <script>window.uploads = 0; document.querySelector('#resume').addEventListener('change', (event) => { window.uploads++; const row = document.createElement('li'); row.textContent = event.target.files[0].name; document.querySelector('#attachments').append(row); event.target.value = ''; });</script>`,
  `const file = { filename: 'Original Resume (2).pdf', base64: btoa('%PDF-original'), mimeType: 'application/pdf' };
   let field = api.scanForm().find(f => f.label.includes('Resume'));
   const first = await api.fillField(field.id, null, file);
   await api.fillField(field.id, null, file); await api.fillField(field.id, null, file);
   document.querySelector('#resume').replaceWith(Object.assign(document.createElement('input'), { id: 'resume', type: 'file' }));
   document.querySelector('#resume').addEventListener('change', () => window.uploads++);
   field = api.scanForm().find(f => f.label.includes('Resume'));
   const holds = api.uploadHolds(field.id); await api.fillField(field.id, null, file);
   const letter = api.scanForm().find(f => f.label.includes('Cover'));
   const other = await api.fillField(letter.id, null, { ...file, filename: 'Original Letter.pdf' });
   return { uploads: window.uploads, first: first.ok, holds, other: other.ok, attachments: document.querySelectorAll('#attachments li').length };`);
  assert.deepEqual(result, { uploads: 1, first: true, holds: true, other: true, attachments: 1 });
});

test('an asynchronously cleared upload without acceptance evidence is not dispatched repeatedly', { skip }, async () => {
  const result = await onPage(`<form><label for="resume">Resume *</label><input id="resume" type="file"></form><script>window.uploads = 0; document.querySelector('input').addEventListener('change', (e) => { window.uploads++; e.target.value = ''; });</script>`,
  `const field = api.scanForm()[0], file = { filename: 'Resume.pdf', base64: btoa('%PDF-original') };
   await api.fillField(field.id, null, file);
   eval(${JSON.stringify(fs.readFileSync(FORM_FILE, 'utf8'))});
   const retry = await globalThis.__qtsApplyForm.fillField(field.id, null, file);
   return { uploads: window.uploads, ok: retry.ok, error: retry.error };`);
  assert.equal(result.uploads, 1);
  assert.equal(result.ok, false);
  assert.match(result.error, /already sent.*attach it manually/);
});

test('a fresh document can upload the original PDF again', { skip }, async () => {
  for (let index = 0; index < 2; index++) {
    assert.equal(await onPage('<form><label for="cv">Resume</label><input id="cv" type="file"></form>',
      `const field = api.scanForm()[0]; return (await api.fillField(field.id, null, { filename: 'Resume.pdf', base64: btoa('%PDF-original') })).ok;`), true);
  }
});

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

test('Location(City) is scanned and filled from the candidate profile without geolocation or AI', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<form><label for="city">Location(City)<span>*</span></label><input id="city" required><a href="#" id="locate">Locate me</a></form><script>document.getElementById("locate").onclick=()=>{window.located=true;};</script>');
    await page.addScriptTag({ path: FORM_FILE });
    await page.addScriptTag({ path: path.join(__dirname, '../shared/apply-answers.js') });
    const result = await page.evaluate(async () => {
      const api = globalThis.__qtsApplyForm, fields = api.scanForm();
      const resolved = globalThis.__qtsApplyAnswers.resolveFields(fields, { city: 'Sample City', country: 'Romania' }, [], { autoApply: true });
      const field = fields.find(entry => entry.label.includes('City'));
      const answer = resolved.answers[field.id];
      const filled = await api.fillField(field.id, answer.value);
      return { label: field.label, value: document.getElementById('city').value, source: answer.source, fact: answer.fact, open: resolved.open.length, filled: filled.ok, located: Boolean(window.located) };
    });
    assert.match(result.label, /Location\(City\)/);
    assert.equal(result.value, 'Sample City'); assert.equal(result.source, 'profile'); assert.equal(result.fact, 'city');
    assert.equal(result.open, 0); assert.equal(result.filled, true); assert.equal(result.located, false);
  } finally { await page.close(); }
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

test('live-site labels: Greenhouse uploads named by their group, Workable radios by their radiogroup (both Apply modes)', { skip }, async () => {
  // Greenhouse: each input's own label is only its button ("Attach"); the group names it and says if it is required.
  const upload = (key, title, required) => `<div role="group" aria-labelledby="upload-label-${key}" aria-required="${required}"><div id="upload-label-${key}" class="label upload-label">${title}${required ? '<span>*</span>' : ''}</div><div class="button-container"><button type="button">Attach</button><label class="visually-hidden" for="${key}">Attach</label><input id="${key}" class="visually-hidden" type="file" accept=".pdf"></div></div>`;
  const files = await onPage(`<form><label for="fn">First Name</label><input id="fn">${upload('resume', 'Resume/CV', true)}${upload('cover_letter', 'Cover Letter', false)}</form>`,
    'return api.scanForm().filter((f) => f.kind === "file").map((f) => [f.label, f.required]);');
  assert.deepEqual(files, [['Resume/CV', true], ['Cover Letter', false]]);
  // Workable: the options' labels hold an icon whose fallback text is not the question.
  const option = (id, text) => `<label role="presentation"><div role="radio" aria-labelledby="g_label l_${id}"><input id="${id}" type="radio" name="CA_1" value="${id}" required><svg><text>SVGs not supported by this browser.</text></svg></div><span id="l_${id}">${text}</span></label>`;
  const radios = await onPage(`<form><div><span><strong>*</strong></span><span id="g_label"><strong>Gender</strong></span><fieldset role="radiogroup" aria-labelledby="g_label">${option('a', 'Female')}${option('b', 'Male')}</fieldset></div></form>`,
    'return api.scanForm().filter((f) => f.kind === "radio").map((f) => f.label);');
  assert.deepEqual(radios, ['Gender']);
});

test('Normal Apply start signals: guest beats sign-in, never Sign in/Register or a Continue inside a sign-in form, main Continue', { skip }, async () => {
  const signIn = `<form id="login"><label for="e">Email</label><input id="e" type="email"><label for="p">Password</label><input id="p" type="password"><button type="submit">Continue</button></form>`;
  const run = (html, assistant = true) => onPage(html, `const r = api.clickStart([], { assistant: ${assistant} }); return r.ok ? r.text : (r.email ? 'email' : null);`);
  // A guest way in beside the sign-in form is taken.
  assert.equal(await run(`${signIn}<button type="button">Apply as guest</button><a href="/register">Create account</a>`), 'Apply as guest');
  assert.equal(await run(`${signIn}<button type="button">Continue without an account</button>`), 'Continue without an account');
  // Only sign-in / register on offer: nothing is clicked (not the form's own Continue, not Sign in).
  assert.equal(await run(`${signIn}<a href="/signin">Sign in</a><a href="/register">Register</a>`), null);
  // An email-only form's Continue is signing in too.
  assert.equal(await run(`<form><label for="m">Email address</label><input id="m" type="email"><button type="submit">Continue</button></form>`), null);
  // Several Continue buttons on a page with no questions: the main (largest) one.
  assert.equal(await run(`<main><p>Before you apply, read this.</p><button style="width:60px;height:20px">Continue</button><button style="width:300px;height:48px" id="main">Continue</button></main>`), 'Continue');
  assert.equal(await onPage(`<main><p>Read this.</p><button style="width:60px;height:20px" onclick="window.hit='small'">Continue</button><button style="width:300px;height:48px" onclick="window.hit='main'">Continue</button></main>`,
    'api.clickStart([], { assistant: true }); return window.hit;'), 'main');
  // Real sites: Manatal "Apply for Position", Breezy "Apply To Position", cord.com "Apply to <company>".
  for (const label of ['Apply for Position', 'Apply To Position', 'Apply to Lead Forensics']) {
    assert.equal(await run(`<main><h1>Engineer</h1><p>About the role.</p><a href="#apply">${label}</a></main>`), label);
  }
  // Still never: LinkedIn, Indeed, alerts, similar jobs.
  for (const label of ['Apply with LinkedIn', 'Apply for a job alert', 'Apply to similar jobs', 'Apply via Indeed']) {
    assert.equal(await run(`<main><h1>Engineer</h1><p>About the role.</p><a href="#x">${label}</a></main>`), null, label);
  }
  // Manatal (careers-page.com): an agreement box with value="checked" and its words in a span beside it.
  const manatal = await onPage(`<form><div><label>Phone:</label><input name="phone"></div><div><input type="checkbox" name="terms_and_condition" value="checked"> <span>
    I agree to the <a target="_blank" href="/t">terms and conditions</a> &amp; <a target="_blank" href="/p">privacy policy</a></span> <br></div></form>`, `
    const box = api.scanForAssist().find((field) => field.kind === 'checkbox');
    const plan = globalThis.__qtsApplyAnswers ? globalThis.__qtsApplyAnswers.resolveFields([box], {}, [], { normalApply: true }) : null;
    return { label: box.label, answer: plan ? plan.answers[box.id]?.value : 'no-answers-module' };`);
  assert.equal(manatal.label, 'I agree to the terms and conditions & privacy policy');
  if (manatal.answer !== 'no-answers-module') assert.equal(manatal.answer, true);
  // Auto Apply keeps its own account handling: it may still choose Sign in.
  // ("#signin": the click must not navigate the test page, or closing it can hang.)
  assert.equal(await run(`<main><p>Sign in to continue your application.</p><a href="#signin">Sign in</a></main>`, false), 'Sign in');
});

test('live-site pages: a cookie banner and a declared language switcher are not application questions', { skip }, async () => {
  // emagine (Cookiebot): the banner's tick boxes made a job page look like a form, so Apply was never clicked.
  const cookiebot = `<div id="CybotCookiebotDialog"><fieldset><label><input type="checkbox" id="c1" checked disabled> Necessary</label><label><input type="checkbox" id="c2"> Preferences</label><label><input type="checkbox" id="c3"> Statistics</label><label><input type="checkbox" id="c4"> Marketing</label></fieldset><button>Allow all</button></div>`;
  assert.equal(await onPage(`<main><h1>DevOps Engineer</h1><a href="/apply" class="button">Apply now</a></main>${cookiebot}`, 'return api.classifyPage().type;'), 'application_navigation');
  // mozilla.org: name="lang" in a language-switcher form, options tagged lang: not a question, even labelled "Language".
  const switcher = `<footer><form id="lang_form" class="c-language-switcher"><label for="ls">Language</label><select id="ls" name="lang"><option lang="en-CA" value="en-CA">English (Canadian)</option><option lang="en-GB" value="en-GB">English (British)</option><option lang="en-US" value="en-US" selected>English</option></select></form></footer>`;
  assert.deepEqual(await onPage(`<main><h1>Engineer</h1><button type="button">Apply Now</button></main>${switcher}`, 'return api.scanForm().map((f) => f.label);'), []);
  // A real question about languages is still one.
  assert.deepEqual(await onPage(`<form><label for="q">Which language do you speak at work?</label><select id="q"><option>English</option><option>Deutsch</option><option>Polski</option></select></form>`, 'return api.scanForm().map((f) => f.label);'), ['Which language do you speak at work?']);
  // A body class mentioning cookies does not hide a real form.
  assert.equal(await onPage(`<div class="cookies-accepted"><form><label for="a">Full name</label><input id="a"><label for="b">Email</label><input id="b" type="email"><label for="c">CV</label><input id="c" type="file"></form></div>`, 'return api.classifyPage().type;'), 'application_form');
});

test('pages are told apart: form, partial form, email-first, sign-in, account, code, CAPTCHA, closed, sent, job page, nothing', { skip }, async () => {
  const kind = (html) => onPage(html, 'return api.classifyPage().type;');
  assert.equal(await kind(`<form><label for="a">Full name</label><input id="a"><label for="b">Email</label><input id="b" type="email"><label for="c">CV</label><input id="c" type="file"></form>`), 'application_form');
  assert.equal(await kind(`<form><label for="q1">Why us?</label><textarea id="q1"></textarea><label for="q2">Years?</label><input id="q2" type="number"></form>`), 'partial_application_form');
  assert.equal(await kind(`<form><label for="e">Email address</label><input id="e" type="email"><button type="submit">Continue</button><button type="button">Continue with Google</button></form>`), 'email_first_application');
  // An email gate whose password box appears later is still email-first.
  assert.equal(await kind(`<form><label for="e">Email address</label><input id="e" type="email"><div hidden><label for="p">Password</label><input id="p" type="password"></div><button type="submit">Continue</button></form>`), 'email_first_application');
  // Step 1 of a multi-step application (name and email, later steps already in the page): an application form.
  assert.equal(await kind(`<form><div><label for="n">First name *</label><input id="n" required><label for="e">Email *</label><input id="e" type="email" required><button type="button">Next</button></div><div hidden><label for="ph">Phone *</label><input id="ph" type="tel"><label for="w">Why us? *</label><textarea id="w"></textarea></div></form>`), 'partial_application_form');
  assert.equal(await kind(`<form><label for="e">Email</label><input id="e" type="email"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form>`), 'authentication_required');
  assert.equal(await kind(`<h1>Create your account</h1><form><label for="e">Email</label><input id="e" type="email"><label for="p">Password</label><input id="p" type="password"><label for="p2">Confirm password</label><input id="p2" type="password"><button>Sign up</button></form>`), 'registration_required');
  assert.equal(await kind(`<p>We sent a code to your email.</p><form><label for="c">Verification code</label><input id="c" autocomplete="one-time-code"><button>Verify</button></form>`), 'verification_required');
  assert.equal(await kind(`<form><label for="k">Type below image text</label><input id="k"><img alt="captcha"></form>`), 'captcha_required');
  assert.equal(await kind(`<main><h1>Data Scientist</h1><p>This job has expired.</p></main>`), 'application_closed');
  assert.equal(await kind(`<main><h1>Thank you for applying!</h1><p>We have received your application.</p></main>`), 'application_submitted');
  assert.equal(await kind(`<main><h1>Data Scientist</h1><p>About the role…</p><button>Apply now</button></main>`), 'application_navigation');
  assert.equal(await kind(`<main><h1>Welcome</h1></main>`), 'unsupported_page');
  const withSearchAndNewsletter = await onPage(`<header><form role="search"><label for="q">City</label><input id="q"><button>Search jobs</button></form></header>
    <main><h1>Data Scientist</h1><a id="apply" href="https://jobs.example/form" target="_blank">Apply now</a></main>
    <footer><form class="newsletter"><label for="n">Email</label><input id="n" type="email"><button>Subscribe</button></form></footer>`,
  `const page = api.classifyPage().type; const start = api.clickStart([], { assistant: true }); return { page, start: start.ok, href: start.href };`);
  assert.equal(withSearchAndNewsletter.page, 'application_navigation');
  assert.equal(withSearchAndNewsletter.start, true);
  assert.match(withSearchAndNewsletter.href, /\/form$/);
});

test('application actions take priority over account actions; sign-in/register is the fallback', { skip }, async () => {
  const priority = await onPage(`<a id="login" href="/login">Sign in</a>
    <button id="apply">Apply now</button><a id="register" href="/register">Register</a>
    <script>document.getElementById('apply').addEventListener('click', () => { window.clicked = 'apply'; });
      document.getElementById('login').addEventListener('click', (event) => { event.preventDefault(); window.clicked = 'login'; });</script>`,
  `const result = api.clickStart(); return { result, clicked: window.clicked };`);
  assert.equal(priority.clicked, 'apply');
  assert.equal(priority.result.action, 'application');

  const fallback = await onPage(`<a id="login" href="/login">Sign in</a><a href="/register">Register</a>
    <script>document.getElementById('login').addEventListener('click', (event) => { event.preventDefault(); window.clicked = 'login'; });</script>`,
  `const result = api.clickStart(); return { result, clicked: window.clicked };`);
  assert.equal(fallback.clicked, 'login');
  assert.equal(fallback.result.action, 'account');
});

test('application start and pre-form Continue signals allow punctuation but never Submit', { skip }, async () => {
  const started = await onPage(`<main><h1>Automation AI Manager</h1><button id="apply">Apply now!</button></main>
    <script>document.getElementById('apply').addEventListener('click', () => {
      document.querySelector('main').innerHTML = '<h1>Apply</h1><button id="continue">Continue!</button>';
      document.getElementById('continue').addEventListener('click', () => {
        document.querySelector('main').innerHTML = '<form><label for="name">Name</label><input id="name"></form><button id="submit" type="submit">Submit application!</button>';
        document.getElementById('submit').addEventListener('click', () => { window.submitted = true; });
      });
    });</script>`,
  `const first = api.clickStart();
   const second = api.clickStart([first.text]);
   return { first, second, page: api.classifyPage().type, buttons: api.buttons(), submitted: Boolean(window.submitted) };`);
  assert.deepEqual(started.first, { ok: true, action: 'application', text: 'Apply now' });
  assert.deepEqual(started.second, { ok: true, action: 'application', text: 'Continue' });
  assert.equal(started.page, 'unknown');
  assert.deepEqual(started.buttons, { submit: true, next: false, submitDisabled: false });
  assert.equal(started.submitted, false);
});

test('account steps use saved email and password, but stop for unrecognized registration fields', { skip }, async () => {
  const credentials = await onPage(`<form id="login" onsubmit="event.preventDefault()">
    <label for="email">Email</label><input id="email" type="email" required>
    <label for="password">Password</label><input id="password" type="password" required>
    <button type="submit">Sign in</button>
  </form><script>document.querySelector('button').addEventListener('click', () => { window.loggedIn = true; });</script>`,
  `const type = api.classifyPage().type;
   const filled = api.fillAccountForm({ email: 'candidate@example.test', password: 'stored-password' });
   const clicked = api.clickAccountAction(type);
   return { type, filled, clicked, email: document.getElementById('email').value,
     password: document.getElementById('password').value, loggedIn: Boolean(window.loggedIn) };`);
  assert.equal(credentials.type, 'authentication_required');
  assert.equal(credentials.filled.ok, true);
  assert.equal(credentials.filled.fieldsFilled, 2);
  assert.equal(JSON.stringify(credentials.filled).includes('stored-password'), false);
  assert.equal(credentials.email, 'candidate@example.test');
  assert.equal(credentials.password, 'stored-password');
  assert.equal(credentials.loggedIn, true);

  const registration = await onPage(`<form>
    <label for="first">First name</label><input id="first" required>
    <label for="last">Last name</label><input id="last" required>
    <label for="email">Email</label><input id="email" type="email" required>
    <label for="password">Password</label><input id="password" type="password" required>
    <label for="confirm">Confirm password</label><input id="confirm" type="password" required>
    <label><input type="checkbox" required>Accept terms</label>
    <button type="submit">Create account</button>
  </form>`,
  `return api.fillAccountForm({ email: 'candidate@example.test', firstName: 'Ada', lastName: 'Lovelace', password: 'stored-password' });`);
  assert.equal(registration.ok, false);
  assert.match(registration.reason, /additional information/);
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

test('an upload carries the heading of its section, so a cover-letter step is told from a CV step', { skip }, async () => {
  const sections = await onPage(`<main><h1>Apply to Acme</h1>
      <section><h2>Confirm your cover letter</h2><div class="drop"><input id="up" type="file" required><button>Upload file</button></div></section></main>`,
  `return api.scanForm().filter((f) => f.kind === 'file').map((f) => f.section);`);
  assert.deepEqual(sections, ['Confirm your cover letter']);
});

test('a phone box holding only its country\'s dialling code is empty and takes the number; a real number stays', { skip }, async () => {
  const result = await onPage(`<form>
      <label for="ph">Phone number *</label><div><button type="button">Germany</button><input id="ph" type="tel" value="+49" required></div>
      <label for="mb">Mobile</label><input id="mb" value="0049">
      <label for="own">Phone</label><input id="own" type="tel" value="+49 151 2345678">
      <label for="age">Age</label><input id="age" value="+49">
    </form>`,
  `const fields = api.scanForm();
   const byId = (id) => fields.find((f) => document.querySelector('[data-qts-apply-field="' + f.id + '"]').id === id);
   const empty = api.emptyRequired().map((e) => e.label);
   const filled = await api.fillField(byId('ph').id, '+40264484948');
   return { ph: Boolean(byId('ph').filled), mb: Boolean(byId('mb').filled), own: Boolean(byId('own').filled), age: Boolean(byId('age').filled),
     empty, ok: filled.ok, value: document.getElementById('ph').value };`);
  assert.deepEqual(result, { ph: false, mb: false, own: true, age: true, empty: ['Phone number *'], ok: true, value: '+40264484948' });
});

test('LinkedIn autofill adds HTTPS and www from the saved account and respects a fixed field prefix', { skip }, async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<form><label for="full">Linkedin profile link *</label><input id="full" type="url" required><label for="handle">LinkedIn URL</label><div><span>https://www.linkedin.com/in/</span><input id="handle"></div></form>');
    await page.addScriptTag({ path: FORM_FILE });
    await page.addScriptTag({ path: path.join(__dirname, '../shared/apply-answers.js') });
    const result = await page.evaluate(async () => {
      const api = globalThis.__qtsApplyForm;
      const resolved = globalThis.__qtsApplyAnswers.resolveFields(api.scanForm(), { linkedinUrl: 'linkedin.com/in/anna-123' }, [], { autoApply: true });
      const filled = [];
      for (const [id, answer] of Object.entries(resolved.answers)) filled.push((await api.fillField(id, answer.value)).ok);
      return { full: document.getElementById('full').value, valid: document.getElementById('full').checkValidity(), handle: document.getElementById('handle').value, filled };
    });
    assert.deepEqual(result, { full: 'https://www.linkedin.com/in/anna-123', valid: true, handle: 'anna-123', filled: [true, true] });
  } finally { await page.close(); }
});

test('a box after a fixed start ("https://linkedin.com/in/") takes only the handle; other boxes the whole value', { skip }, async () => {
  const result = await onPage(`<form>
      <label for="li">LinkedIn URL *</label><div class="group"><span class="addon">https://linkedin.com/in/</span><input id="li" placeholder="your-handle"></div>
      <label for="gh">GitHub</label><div><div class="addon">github.com/</div><div><input id="gh"></div></div>
      <label for="plain">LinkedIn</label><input id="plain">
      <label for="other">Website</label><div><span>https://linkedin.com/in/</span><input id="other"></div>
    </form>`,
  `const fields = api.scanForm();
   const idOf = (box) => fields.find((f) => document.querySelector('[data-qts-apply-field="' + f.id + '"]').id === box).id;
   await api.fillField(idOf('li'), 'https://www.linkedin.com/in/ana-pop-123/');
   await api.fillField(idOf('gh'), 'github.com/anapop');
   await api.fillField(idOf('plain'), 'linkedin.com/in/ana-pop-123');
   const other = await api.fillField(idOf('other'), 'https://ana.dev');
   const value = (id) => document.getElementById(id).value;
   return { li: value('li'), gh: value('gh'), plain: value('plain'), other: value('other'), otherOk: other.ok };`);
  assert.deepEqual(result, { li: 'ana-pop-123', gh: 'anapop', plain: 'linkedin.com/in/ana-pop-123', other: 'https://ana.dev', otherOk: true });
});

test('a company page showing a job board\'s form in a frame of another site gives that form\'s address', { skip }, async () => {
  const embedded = async (html) => {
    const page = await browser.newPage();
    try {
      // Nothing leaves the machine: the frame's request is refused, so it stays a frame of another site.
      await page.setRequestInterception(true);
      page.on('request', (request) => (request.url().startsWith('https://') ? request.abort() : request.continue()));
      await page.setContent(html);
      await page.addScriptTag({ path: FORM_FILE });
      return await page.evaluate(() => globalThis.__qtsApplyForm.embeddedApplicationUrl());
    } finally {
      await page.close();
    }
  };
  const frame = '<iframe src="https://job-boards.greenhouse.io/embed/job_app?for=elastic&token=8195964" style="width:700px;height:900px"></iframe>';
  // Elastic: "Apply for this job" is a Greenhouse frame; the page's own job-alert box does not count.
  assert.equal(await embedded(`<main><h2>Apply for this job</h2>${frame}</main><footer><form><input type="email" aria-label="Email"></form></footer>`),
    'https://job-boards.greenhouse.io/embed/job_app?for=elastic&token=8195964');
  // A page with its own form, a small frame, or a frame of another kind of site: nothing to open.
  assert.equal(await embedded(`<form><label for="a">First name</label><input id="a"><label for="b">Email</label><input id="b" type="email"></form>${frame}`), '');
  assert.equal(await embedded('<iframe src="https://job-boards.greenhouse.io/embed/job_app?token=1" style="width:100px;height:50px"></iframe>'), '');
  assert.equal(await embedded('<iframe src="https://www.youtube.com/embed/x" style="width:700px;height:400px"></iframe>'), '');
});

test('the panel question list groups separate tick boxes under their question and skips reCAPTCHA', { skip }, async () => {
  // Ashby (Oyster): each tool is its own check box with its own name, under one question.
  const rows = await onPage(`<form>
    <div class="field"><label for="n">Full name *</label><input id="n" value="Radu Star"></div>
    <div class="tools"><p>Which remote collaboration tools have you used professionally? (Select all that apply)*</p>
      <label><input type="checkbox" name="Notion" checked> Notion</label>
      <label><input type="checkbox" name="Loom"> Loom</label>
      <label><input type="checkbox" name="Slack" checked> Slack</label></div>
    <div class="privacy"><label><input type="checkbox" name="privacy"> I confirm I have read OysterHR's Privacy Notice</label></div>
    <textarea name="g-recaptcha-response" style="width:10px;height:10px"></textarea>
  </form>`, 'return api.panelQuestions();');
  assert.deepEqual(rows.map((row) => row.label), ['Full name *', 'Which remote collaboration tools have you used professionally? (Select all that apply)',
    "I confirm I have read OysterHR's Privacy Notice"]);
  const tools = rows[1];
  assert.equal(tools.kind, 'checkbox-group');
  assert.deepEqual(tools.options, ['Notion', 'Loom', 'Slack']);
  assert.deepEqual(tools.value, ['Notion', 'Slack']);
  assert.equal(tools.required, true);
  assert.equal(tools.memberIds.length, 3);
  // A lone agreement box stays its own question; an unticked box is empty (false), not "filled".
  assert.equal(rows[2].kind, 'checkbox'); assert.equal(rows[2].value, false);
});

test('a React Select list that opens only when its box is pressed is read, and a "Select..." placeholder is no answer', { skip }, async () => {
  // Greenhouse's new job boards: the text input ignores clicks and keys; a press on the outer box opens it.
  const result = await onPage(`<form><label for="q1">Are you currently employed by Exadel? *</label>
    <div class="select__control"><div class="select__placeholder">Select...</div>
      <input id="q1" class="select__input" role="combobox" aria-expanded="false" aria-haspopup="true"></div>
    <div id="menu"></div></form>
    <script>const box = document.querySelector('.select__control'), input = document.getElementById('q1'), menu = document.getElementById('menu');
      box.addEventListener('mousedown', () => { input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'react-select-q1-listbox');
        menu.innerHTML = '<div id="react-select-q1-listbox" role="listbox"><div role="option">No</div><div role="option">Yes - Exadel</div><div role="option">Yes - Other</div></div>'; });
      input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); } });</script>`,
  'const f = api.scanForm().find((x) => /exadel/i.test(x.label)); const read = await api.discoverComboboxChoices(f.id); const row = api.panelQuestions().find((x) => /exadel/i.test(x.label)); return { options: read.options, value: row.value };');
  assert.deepEqual(result.options, ['No', 'Yes - Exadel', 'Yes - Other']);
  assert.equal(result.value, '', 'the placeholder is not an answer');
});

test('Ashby: a CSS-drawn required mark, a hint between label and box, and an upload shown as a file name', { skip }, async () => {
  const result = await onPage(`<style>._required_x::after { content: "*"; }</style><form>
    <div><label class="_heading _required_x" for="sal">Salary Expectations&nbsp;</label><div><p><strong>Gross annual base salary range</strong> (before tax), please use local currency</p></div>
      <input id="sal" type="number" placeholder="Type here..."></div>
    <fieldset><label class="_heading _required_x" for="start">Earliest availability to start</label>
      <div><input type="radio" id="s1" name="start"><label for="s1">Immediately</label></div>
      <div><input type="radio" id="s2" name="start"><label for="s2">Within 1 month</label></div></fieldset>
    <div><label for="cv">Resume</label><div><input id="cv" type="file" style="display:none"><div><span>Alex_Tester_CV.pdf</span><button type="button">Replace</button></div></div></div>
    </form>`,
  `const fields = api.scanForAssist().filter((f) => !f.hidden);
   const salary = fields.find((f) => /salary/i.test(f.label)), start = fields.find((f) => /availability/i.test(f.label));
   const cv = api.panelQuestions().find((q) => /resume/i.test(q.label));
   return { salaryRequired: salary.required, note: salary.note, startRequired: start.required, cv: cv ? cv.value : 'not listed' };`);
  assert.equal(result.salaryRequired, true);
  assert.match(result.note, /Gross annual base salary range \(before tax\), please use local currency/);
  assert.equal(result.startRequired, true, 'a radio question whose label draws the * is required');
});
