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
