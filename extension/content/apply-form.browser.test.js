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
