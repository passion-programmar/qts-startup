const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
const start = source.indexOf('const TOOLBAR_LAUNCHER_FILES');
const end = source.indexOf('// On owned Apply tabs', start);

function fixture(owned, missingLauncher = false) {
  const events = [];
  const context = { self: { __qtsApplyRunner: { openOwnedPanel: async (id) => { events.push(['apply', id]); return owned; } } },
    chrome: { tabs: { sendMessage: async (id, message) => { events.push(['launcher', id, message.type]); if (missingLauncher) { missingLauncher = false; throw new Error('No content script'); } return { ok: true }; } },
      scripting: { executeScript: async () => { events.push(['inject-launcher']); } } },
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.click = sendToolbarClick;`, context);
  return { events, click: () => context.click({ id: 7, url: 'https://employer.test/apply' }) };
}

test('toolbar opens the owned Apply panel instead of the launcher hidden behind it', async () => {
  const f = fixture(true); assert.equal((await f.click()).ok, true);
  assert.deepEqual(f.events, [['apply', 7]]);
});

test('unowned pages retain the existing launcher action and missing-script recovery', async () => {
  const f = fixture(false); assert.equal((await f.click()).ok, true);
  assert.deepEqual(f.events, [['apply', 7], ['launcher', 7, 'QTS_TOOLBAR_ICON_CLICKED']]);
  const missing = fixture(false, true); assert.equal((await missing.click()).ok, true);
  assert.deepEqual(missing.events.map(([kind]) => kind), ['apply', 'launcher', 'inject-launcher', 'launcher']);
});
