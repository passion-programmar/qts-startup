const assert = require('node:assert/strict');
const test = require('node:test');

test('the QTS_Resume folder is found from a downloaded PDF path', async () => {
  globalThis.chrome = { downloads: { search: async () => [
    { filename: 'C:\\Users\\a\\Downloads\\QTS_Resume\\Old\\gone.pdf', exists: false },
    { filename: 'C:\\Users\\a\\Downloads\\QTS_Resume\\MSK\\Alex\\Run\\CV.pdf', exists: true },
  ] } };
  const helpers = require('./apply-pdf-path-detect.js');
  assert.equal(helpers.rootOf('C:\\Users\\a\\Downloads\\QTS_Resume\\MSK\\x.pdf'), 'C:\\Users\\a\\Downloads\\QTS_Resume');
  assert.equal(helpers.rootOf('D:/Data/QTS_Resume/M/x.pdf'), 'D:\\Data\\QTS_Resume');
  assert.equal(helpers.rootOf('C:\\Users\\a\\Downloads\\other\\x.pdf'), null);
  assert.equal(await helpers.detectRoot(), 'C:\\Users\\a\\Downloads\\QTS_Resume', 'a moved or deleted download is skipped');
  globalThis.chrome = { downloads: { search: async () => [] } };
  assert.equal(await helpers.detectRoot(), null);
});
