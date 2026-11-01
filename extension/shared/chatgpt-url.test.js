const test = require('node:test');
const assert = require('node:assert/strict');
require('./chatgpt-url.js');

const { DEFAULT_URL, normalize } = globalThis.__qtsChatGptUrl;

test('ChatGPT URL configuration accepts HTTPS ChatGPT project and conversation URLs', () => {
  assert.equal(normalize('https://chatgpt.com/g/p-123/project-name'), 'https://chatgpt.com/g/p-123/project-name');
  assert.equal(normalize('https://chat.openai.com/c/abc'), 'https://chat.openai.com/c/abc');
});

test('ChatGPT URL configuration rejects unsafe or unrelated URLs', () => {
  for (const value of [
    'http://chatgpt.com/',
    'https://chatgpt.com.evil.example/',
    'https://example.com/',
    'javascript:alert(1)',
    'https://user:pass@chatgpt.com/',
    'x'.repeat(2049),
  ]) assert.equal(normalize(value), null, value);
  assert.equal(DEFAULT_URL, 'https://chatgpt.com/');
});
