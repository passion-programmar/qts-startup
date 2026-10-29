const assert = require('node:assert/strict');
const test = require('node:test');
const prints = require('./resume-print-requests.js');

// What the Resume page sends (toResumeTemplateData), trimmed to what the check reads.
const job = (template = 'qts-standard', name = 'Ana Pop') => ({
  template,
  data: {
    candidate: { fullName: name, email: 'ana@example.com' },
    resume: { targetRole: 'Engineer', sections: [{ id: 'experience', title: 'Experience', items: [] }] },
    coverLetter: { candidate: { fullName: name }, paragraphs: ['Hello.'] },
    theme: { template },
  },
});

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('a résumé and cover letter request is accepted and keyed by its template and content', () => {
  const result = prints.checkPrintJob(job());
  assert.equal(result.error, undefined);
  assert.equal(result.key, `qts-standard\n${JSON.stringify(job().data)}`);
  assert.notEqual(prints.checkPrintJob(job('qts-standard', 'Ion Pop')).key, result.key);
  assert.notEqual(prints.checkPrintJob(job('harvard')).key, result.key);
});

test('a request without usable résumé data is refused, never printed with the sample résumé', () => {
  const broken = (change) => {
    const value = job();
    change(value);
    return prints.checkPrintJob(value).error;
  };
  assert.match(prints.checkPrintJob(undefined).error, /no document/);
  assert.match(prints.checkPrintJob(null).error, /no document/);
  assert.match(prints.checkPrintJob([]).error, /no document/);
  assert.match(broken((value) => { delete value.data; }), /no résumé data/);
  assert.match(broken((value) => { value.data = 'x'; }), /no résumé data/);
  assert.match(broken((value) => { value.data = [job().data]; }), /no résumé data/);
  assert.match(broken((value) => { value.data.candidate = null; }), /candidate name/);
  assert.match(broken((value) => { value.data.candidate.fullName = '  '; }), /candidate name/);
  assert.match(broken((value) => { value.data.resume.sections = null; }), /no sections/);
  assert.match(broken((value) => { value.data.coverLetter.paragraphs = []; }), /no paragraphs/);
  assert.match(broken((value) => { delete value.data.theme; }), /another template/);
  assert.match(broken((value) => { value.data.resume.summary = 'x'.repeat(prints.MAX_DATA_CHARACTERS); }), /too large/);
  assert.match(broken((value) => { value.data.self = value.data; }), /cannot be read/);
});

test('only the 24 QTS templates are accepted, never a stand-in for an unknown one', () => {
  assert.equal(prints.TEMPLATES.length, 24);
  for (const template of prints.TEMPLATES) assert.equal(prints.checkPrintJob(job(template)).error, undefined, template);
  for (const template of ['no-such-template', '', 'QTS-STANDARD', '../resume', 'heritage', null, 7]) {
    const value = job();
    value.template = template;
    assert.match(prints.checkPrintJob(value).error, /QTS templates/, String(template));
  }
  assert.match(prints.checkPrintJob({ ...job('harvard'), template: 'classic' }).error, /another template/);
});

test('two identical requests at once print once and both get that print', async () => {
  const gate = deferred();
  let calls = 0;
  const print = () => { calls += 1; return gate.promise; };
  const first = prints.printOnce('same', print);
  const second = prints.printOnce('same', print);
  assert.equal(prints.inFlightCount(), 1);
  gate.resolve({ resume: 'R', 'cover-letter': 'C' });
  assert.deepEqual(await Promise.all([first, second]), [{ resume: 'R', 'cover-letter': 'C' }, { resume: 'R', 'cover-letter': 'C' }]);
  assert.equal(calls, 1);
  assert.equal(prints.inFlightCount(), 0);
});

test('two different requests print separately and each gets its own files', async () => {
  const calls = [];
  const print = (name) => () => { calls.push(name); return Promise.resolve({ resume: name, 'cover-letter': name }); };
  const [one, two] = await Promise.all([prints.printOnce('one', print('one')), prints.printOnce('two', print('two'))]);
  assert.deepEqual(calls.sort(), ['one', 'two']);
  assert.equal(one.resume, 'one');
  assert.equal(two.resume, 'two');
  assert.equal(prints.inFlightCount(), 0);
});

test('a failed print is not kept: the next request prints again', async () => {
  let calls = 0;
  assert.equal(await prints.printOnce('retry', () => { calls += 1; return null; }), null);
  assert.equal(prints.inFlightCount(), 0);
  assert.equal(await prints.printOnce('retry', () => { calls += 1; throw new Error('tab closed'); }), null);
  assert.equal(prints.inFlightCount(), 0);
  assert.deepEqual(await prints.printOnce('retry', () => { calls += 1; return { resume: 'R', 'cover-letter': 'C' }; }), { resume: 'R', 'cover-letter': 'C' });
  assert.equal(calls, 3);
  assert.equal(prints.inFlightCount(), 0);
});

test('a print that never finishes frees its request after the limit', async () => {
  const stuck = prints.printOnce('stuck', () => new Promise(() => {}), { limitMs: 20 });
  assert.equal(prints.inFlightCount(), 1);
  assert.equal(await stuck, null);
  assert.equal(prints.inFlightCount(), 0);
  let calls = 0;
  await prints.printOnce('stuck', () => { calls += 1; return { resume: 'R', 'cover-letter': 'C' }; });
  assert.equal(calls, 1);
});

test('a finished print is never handed to a later request', async () => {
  await prints.printOnce('later', () => ({ resume: 'old', 'cover-letter': 'old' }));
  const next = await prints.printOnce('later', () => ({ resume: 'new', 'cover-letter': 'new' }));
  assert.equal(next.resume, 'new');
});
