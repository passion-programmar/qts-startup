const assert = require('node:assert/strict');
const test = require('node:test');
const { createTabOwnership } = require('./tab-ownership.js');

function memoryArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
  };
}

test('tabs Generation or Apply open are owned; the Manager\'s own tabs are not', async () => {
  const ownership = createTabOwnership(memoryArea());
  await ownership.markTab(10, 'generation');
  assert.equal(await ownership.ownerOf(10), 'generation');
  assert.equal(await ownership.ownerOf(11), null);
  await ownership.markTab(12, 'something-else');
  assert.equal(await ownership.ownerOf(12), null);
});

test('a tab opened from an owned tab, or in an owned window, belongs to the same workflow', async () => {
  const ownership = createTabOwnership(memoryArea());
  await ownership.markTab(20, 'apply');
  await ownership.markWindow(5, 'apply');
  assert.equal(await ownership.inherit(21, { sourceTabId: 20 }), 'apply');
  assert.equal(await ownership.ownerOf(21), 'apply');
  assert.equal(await ownership.ownerOf(99, 5), 'apply');
  assert.equal(await ownership.inherit(22, { sourceTabId: 30 }), null);
});

test('marks survive a service-worker restart and are removed with their tab', async () => {
  const area = memoryArea();
  await createTabOwnership(area).markTab(40, 'generation');
  const restarted = createTabOwnership(area);
  assert.equal(await restarted.ownerOf(40), 'generation');
  await restarted.replaceTab(41, 40);
  assert.equal(await restarted.ownerOf(41), 'generation');
  assert.equal(await restarted.ownerOf(40), null);
  await restarted.releaseTab(41);
  assert.equal(await restarted.ownerOf(41), null);
});
