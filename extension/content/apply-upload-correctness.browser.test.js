const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => p && fs.existsSync(p));
const FORM = path.resolve('extension/content/apply-form.js');
let browser;
test.before(async () => { if (CHROME) browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true }); });
test.after(async () => browser?.close());
const options = { skip: !CHROME, timeout: 30000 };
async function scenario(html, run) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    await page.addScriptTag({ path: FORM });
    await page.evaluate(() => {
      window.resume = { filename: 'Candidate_Resume.pdf', base64: btoa('%PDF-1.4 RESUME'), mimeType: 'application/pdf' };
      window.letter = { filename: 'Candidate_Cover_Letter.pdf', base64: btoa('%PDF-1.4 LETTER'), mimeType: 'application/pdf' };
      window.api = __qtsApplyForm;
      api.setUploadContext({ attemptId: 'candidate-a', step: 1 });
      window.field = id => api.scanForm().find(f => document.querySelector('[data-qts-apply-field="' + f.id + '"]')?.id === id);
    });
    return await run(page);
  } finally { await page.close(); }
}
const pair = '<form><div role="group" aria-label="Resume"><label for="resume">Resume</label><input id="resume" type="file"><span id="attached"></span></div><div role="group" aria-label="Cover letter"><label for="cover">Cover letter</label><input id="cover" type="file" required></div></form>';

test('neighbor filename cannot satisfy an empty required cover letter; correct files are independent', options, async () => {
 const result = await scenario(pair, p => p.evaluate(async () => {
   document.querySelector('#attached').textContent = resume.filename;
   const before = { holds: api.uploadHolds(field('cover').id), missing: api.emptyRequiredUploads().length };
   const filled = await api.fillField(field('cover').id, null, letter);
   return { before, ok: filled.ok, name: document.querySelector('#cover').files[0].name, problems: await api.verifyUploads() };
 }));
 assert.deepEqual(result, { before: { holds: false, missing: 1 }, ok: true, name: 'Candidate_Cover_Letter.pdf', problems: [] });
});

test('wrong document and same-named wrong bytes are rejected without replacing existing files', options, async () => {
 for (const sameName of [false, true]) {
  const result = await scenario(pair, p => p.evaluate(async sameName => {
   const input = document.querySelector('#cover'), transfer = new DataTransfer();
   transfer.items.add(new File(['%PDF-1.4 RESUME'], sameName ? letter.filename : resume.filename, { type: 'application/pdf' })); input.files = transfer.files;
   let changes = 0; input.addEventListener('change', () => changes++);
   const result = await api.fillField(field('cover').id, null, letter);
   return { ok: result.ok, state: result.uploadState, changes, contents: await input.files[0].text() };
  }, sameName));
  assert.deepEqual(result, { ok: false, state: 'mismatch', changes: 0, contents: '%PDF-1.4 RESUME' });
 }
});

test('redrawn empty control, concurrent calls, and reinjection never resend an uncertain upload', options, async () => {
 const result = await scenario('<form><label for="resume">Resume</label><input type="file" id="resume"></form>', async p => {
  await p.evaluate(async () => {
   window.count = 0;
   const input = document.querySelector('#resume');
   document.querySelector('form').addEventListener('change', event => { count++; const replacement = document.createElement('input'); replacement.type = 'file'; replacement.id = 'resume'; event.target.replaceWith(replacement); });
   const id = field('resume').id;
   window.first = await Promise.all([api.fillField(id, null, resume), api.fillField(id, null, resume)]);
  });
  await p.addScriptTag({ path: FORM });
  return p.evaluate(async () => {
   window.api = __qtsApplyForm;
   const again = await api.fillField(field('resume').id, null, resume);
   return { count, first: first.map(x => x.ok), again: again.ok, review: again.manualUpload, problems: (await api.verifyUploads()).length };
  });
 });
 assert.deepEqual(result, { count: 1, first: [false, false], again: false, review: true, problems: 1 });
});

test('parser and actual attachment each receive the resume once, cover gets different bytes', options, async () => {
 const result = await scenario('<form><section><label for="parser">Autofill from resume</label><input type="file" id="parser"></section><section><label for="resume">Resume</label><input type="file" id="resume"></section><section><label for="cover">Cover letter</label><input type="file" id="cover"></section></form>', p => p.evaluate(async () => {
  const counts = {}; document.querySelector('form').addEventListener('change', e => { counts[e.target.id] = (counts[e.target.id] || 0) + 1; });
  for (let pass = 0; pass < 2; pass++) for (const id of ['parser', 'resume', 'cover']) await api.fillField(field(id).id, null, id === 'cover' ? letter : resume);
  return { counts, resume: await document.querySelector('#resume').files[0].text(), cover: await document.querySelector('#cover').files[0].text() };
 }));
 assert.deepEqual(result, { counts: { parser: 1, resume: 1, cover: 1 }, resume: '%PDF-1.4 RESUME', cover: '%PDF-1.4 LETTER' });
});

test('slow upload stays pending without hidden-input fallback; later acknowledgement reconciles', options, async () => {
 const result = await scenario('<form><section><label>Resume</label><div id="zone" data-qts-apply-drop="1">Drop files here</div><span id="status"></span></section></form><input type="file" class="dz-hidden-input" hidden>', p => p.evaluate(async () => {
  const zone = document.querySelector('#zone'); zone.setAttribute('data-qts-apply-field', 'zone');
  let drops = 0, hiddenChanges = 0;
  document.querySelector('input').addEventListener('change', () => hiddenChanges++);
  zone.addEventListener('drop', () => { drops++; zone.setAttribute('aria-busy', 'true'); });
  const first = await api.fillField('zone', null, resume);
  zone.removeAttribute('aria-busy'); document.querySelector('#status').textContent = resume.filename;
  const again = await api.fillField('zone', null, resume);
  return { drops, hiddenChanges, first: first.uploadState, again: again.ok };
 }));
 assert.deepEqual(result, { drops: 1, hiddenChanges: 0, first: 'pending', again: true });
});

test('late rejection is caught by final verification and never automatically retried', options, async () => {
 const result = await scenario('<form><label for="resume">Resume</label><input id="resume" type="file" required><span role="alert" id="error"></span></form>', p => p.evaluate(async () => {
  let count = 0; document.querySelector('#resume').addEventListener('change', e => { count++; setTimeout(() => { e.target.value = ''; document.querySelector('#error').textContent = 'File rejected'; }, 1200); });
  const first = await api.fillField(field('resume').id, null, resume);
  await new Promise(resolve => setTimeout(resolve, 1400));
  const problems = await api.verifyUploads(); const retry = await api.fillField(field('resume').id, null, resume);
  return { count, first: first.uploadState, error: problems[0]?.message, retry: retry.ok };
 }));
 assert.deepEqual(result, { count: 1, first: 'selected', error: 'File rejected', retry: false });
});

test('a recreated shadow-root input with a confirmed attachment does not duplicate the PDF', options, async () => {
 const result = await scenario('<form><upload-widget></upload-widget></form>', p => p.evaluate(async () => {
  const host = document.querySelector('upload-widget'); host.attachShadow({ mode: 'open' }).innerHTML = '<label for="cv">Resume</label><input id="cv" type="file"><span></span>';
  let count = 0;
  host.shadowRoot.querySelector('input').addEventListener('change', e => { count++; const next = document.createElement('upload-widget'); const shadow = next.attachShadow({ mode: 'open' }); shadow.innerHTML = '<label for="cv">Resume</label><input id="cv" type="file"><span>' + resume.filename + '</span>'; host.replaceWith(next); shadow.querySelector('input').addEventListener('change', () => count++); });
  const first = await api.fillField(api.scanForm()[0].id, null, resume);
  const retry = await api.fillField(api.scanForm()[0].id, null, resume);
  if (!first.ok || !retry.ok) throw new Error(JSON.stringify({ first, retry }));
  return { count, first: first.ok, retry: retry.ok };
 }));
 assert.deepEqual(result, { count: 1, first: true, retry: true });
});

test('multiple selected documents require review even when the expected PDF is present', options, async () => {
 const result = await scenario(pair, p => p.evaluate(async () => {
  const input = document.querySelector('#cover'), transfer = new DataTransfer();
  transfer.items.add(new File(['%PDF-1.4 LETTER'], letter.filename, { type: 'application/pdf' }));
  transfer.items.add(new File(['%PDF-1.4 RESUME'], resume.filename, { type: 'application/pdf' }));
  input.files = transfer.files;
  return api.fillField(field('cover').id, null, letter);
 }));
 assert.equal(result.ok, false);
 assert.match(result.error, /multiple files/);
});

test('removed inputs retain acknowledgement and subsequent rejection in their own widget', options, async () => {
 const result = await scenario(pair, p => p.evaluate(async () => {
  const input = document.querySelector('#resume'), scope = input.parentElement;
  input.addEventListener('change', () => { input.remove(); document.querySelector('#attached').textContent = resume.filename; });
  const first = await api.fillField(field('resume').id, null, resume);
  scope.insertAdjacentHTML('beforeend', '<div role="alert">Upload rejected</div>');
  return { first: first.ok, problems: await api.verifyUploads() };
 }));
 assert.equal(result.first, true);
 assert.equal(result.problems[0].message, 'Upload rejected');
});

test('a new application inspects existing attachments and never assumes the previous candidate PDF is correct', options, async () => {
 const result = await scenario(pair, p => p.evaluate(async () => {
  const first = await api.fillField(field('resume').id, null, resume);
  api.setUploadContext({ attemptId: 'candidate-b', step: 1 });
  const second = await api.fillField(field('resume').id, null, { ...resume, base64: btoa('%PDF-1.4 ANOTHER CANDIDATE') });
  return { first: first.ok, second: second.uploadState, problems: await api.verifyUploads() };
 }));
 assert.equal(result.first, true);
 assert.equal(result.second, 'mismatch');
 assert.equal(result.problems.length, 1);
});

test('a drop widget gaining its own native input uses and verifies that input once', options, async () => {
 const result = await scenario('<form><div id="zone">Resume: drag and drop files here</div></form>', p => p.evaluate(async () => {
  const id = api.scanForm().find(f => f.drop).id;
  const zone = document.querySelector('#zone');
  zone.insertAdjacentHTML('beforeend', '<input type="file" aria-label="Resume">');
  let changes = 0, drops = 0;
  zone.querySelector('input').addEventListener('change', () => changes++);
  zone.addEventListener('drop', () => drops++);
  const first = await api.fillField(id, null, resume);
  const retry = await api.fillField(id, null, resume);
  return { first: first.ok, retry: retry.ok, changes, drops, problems: await api.verifyUploads() };
 }));
 assert.deepEqual(result, { first: true, retry: true, changes: 1, drops: 0, problems: [] });
});
