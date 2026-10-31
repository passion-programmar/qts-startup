const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadHelper() {
  const context = { globalThis: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'generation-chatgpt.js'), 'utf8'),
    context,
  );
  return context.globalThis.__qtsGenerationChatGpt;
}

test('extracts the resume and cover letter JSON package', () => {
  const helper = loadHelper();
  const result = helper.extractJsonObject('```json\n{"resume":{"name":"A"},"coverLetter":{"body":"B"}}\n```');
  assert.equal(result.resume.name, 'A');
  assert.equal(result.coverLetter.body, 'B');
});

test('rejects JSON without both document objects', () => {
  const helper = loadHelper();
  assert.equal(helper.extractJsonObject('{"resume":{}}'), null);
});

test('refuses a legacy server contract before a Generation prompt is sent', () => {
  const helper = loadHelper();
  for (const result of [null, {}, { resumeJsonVersion: 1 }, { resumeJsonVersion: '2' }]) {
    assert.match(helper.generationContractIssue(result), /outdated Generation contract/);
  }
  assert.equal(helper.generationContractIssue({ resumeJsonVersion: 2 }), '');
});

test('the real worker preparation stops on a legacy server and preserves a current server prompt', async () => {
  const helper = loadHelper();
  const source = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
  const start = source.indexOf('      const started = await workerApiRequest(', source.indexOf('  async function runGenerationForTab('));
  const end = source.indexOf('      ensureGenerationIsActive(cancellationKey, cancellationToken);', start);
  assert.ok(start > 0 && end > start);
  const prepare = source.slice(start, end);
  for (const version of [undefined, 1, 2]) {
    const prompt = 'Manager instructions and protected V2 contract';
    const result = { success: true, generationId: '807bc8f8-64c3-4072-936a-598ffe85af8b', prompt, resumeJsonVersion: version };
    const context = vm.createContext({ self: { __qtsGenerationChatGpt: helper }, queuedJob: { id: 'job' }, workerApiRequest: async () => result, generationId: '' });
    const pending = vm.runInContext(`(async () => { ${prepare}; return generationPrompt; })()`, context);
    if (version === 2) assert.ok((await pending).endsWith(prompt));
    else await assert.rejects(pending, { name: 'GenerationSetupError' });
  }
});

test('builds a task-specific prompt without asking ChatGPT to return transport metadata', () => {
  const helper = loadHelper();
  const id = '807bc8f8-64c3-4072-936a-598ffe85af8b';
  const prompt = helper.buildTaskPrompt('Return the document package.', id);
  assert.match(prompt, /^QTS_GENERATION_ID: 807bc8f8/);
  assert.match(prompt, /Do not include it in the output JSON/);
  assert.match(prompt, /Return the document package\.$/);
});
