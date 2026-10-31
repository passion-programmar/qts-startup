const test = require('node:test');
const assert = require('node:assert/strict');
const { createLauncherFocus, createNavigationMonitor } = require('./page-activity');

function fixture() {
  const local = {}, session = {}, messages = [], evaluated = [];
  let clock = 100;
  let focused = 1;
  const tabs = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, windowId: i < 3 ? 1 : 2,
    active: i === 0 || i === 3, url: `https://example.test/jobs/${i + 1}` }));
  const area = (data) => ({
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, structuredClone(data[key])])),
    set: async (values) => Object.assign(data, structuredClone(values)),
    remove: async (key) => { delete data[key]; },
  });
  const chrome = {
    storage: { local: area(local), session: area(session) },
    tabs: {
      get: async (id) => tabs.find((tab) => tab.id === id),
      query: async (query) => tabs.filter((tab) => (!query.active || tab.active) && (!query.windowId || tab.windowId === query.windowId)),
      sendMessage: async (id, message) => { messages.push([id, message.active]); },
    },
    windows: {
      get: async (id) => ({ id, focused: id === focused }),
      getLastFocused: async () => ({ id: focused, focused: focused !== -1 }),
    },
  };
  const monitor = () => createNavigationMonitor({ chrome, now: () => clock,
    evaluate: async (...args) => { evaluated.push(args); } });
  const event = (overrides = {}) => ({ tabId: 1, frameId: 0, documentId: 'document-1',
    url: tabs[0].url, timeStamp: ++clock, ...overrides });
  return { chrome, local, session, tabs, messages, evaluated, monitor, event,
    focus: (value) => { focused = value; }, tick: () => ++clock };
}

test('launcher follows active tab and focused window without any evaluation', async () => {
  const f = fixture(); const ui = createLauncherFocus({ chrome: f.chrome });
  await ui.sync();
  f.tabs[0].active = false; f.tabs[1].active = true;
  await ui.sync();
  f.focus(2); await ui.sync();
  f.focus(-1); await ui.sync();
  assert.deepEqual(f.messages, [[1, true], [1, false], [2, true], [2, false], [4, true], [4, false]]);
  assert.deepEqual(f.evaluated, []);
});

test('launcher refuses helper/restricted tabs and tolerates inaccessible pages', async () => {
  const f = fixture(); const ui = createLauncherFocus({ chrome: f.chrome, eligible: async (tab) => tab.id !== 1 });
  await ui.sync(); assert.deepEqual(f.messages, []);
  assert.equal(await ui.isActive(1), false);
  f.chrome.tabs.sendMessage = async () => { throw Error('Injection forbidden'); };
  f.tabs[0].active = false; f.tabs[1].active = true;
  await ui.sync(); assert.equal(await ui.isActive(2), true);
});

test('window focus events take precedence over a stale last-focused query', async () => {
  const f = fixture(); const ui = createLauncherFocus({ chrome: f.chrome });
  await ui.sync(1);
  f.chrome.windows.getLastFocused = async () => ({ id: 1, focused: true });
  f.focus(2); await ui.sync(2);
  assert.equal(await ui.isActive(1), false);
  assert.equal(await ui.isActive(4), true);
  await ui.sync(-1);
  assert.equal(await ui.isActive(4), false);
  assert.deepEqual(f.messages.slice(-3), [[1, false], [4, true], [4, false]]);
});

test('a launcher mounted after about:blank is tracked for the next window blur', async () => {
  const f = fixture(); f.tabs[0].url = 'about:blank';
  const ui = createLauncherFocus({ chrome: f.chrome, eligible: async (tab) => tab.url.startsWith('https:') });
  await ui.sync(); assert.deepEqual(f.messages, []);
  f.tabs[0].url = 'https://example.test/jobs/new';
  assert.equal(await ui.isActive(1), true);
  f.focus(-1); await ui.sync(-1);
  assert.deepEqual(f.messages, [[1, false]]);
});

test('closing a background tab or window does not suspend the current launcher', async () => {
  const f = fixture(); const ui = createLauncherFocus({ chrome: f.chrome }); await ui.sync(1);
  await ui.removeTab(3); await ui.removeWindow(2);
  assert.deepEqual(f.messages, [[1, true]]);
});

test('rapid focus changes cannot activate a stale tab', async () => {
  const f = fixture(); let release;
  const ui = createLauncherFocus({ chrome: f.chrome, eligible: () => new Promise((r) => { release = r; }) });
  const first = ui.sync();
  while (!release) await new Promise((r) => setImmediate(r));
  f.focus(-1); await ui.sync(); release(true); await first;
  assert.deepEqual(f.messages, []);
});


test('enabling and restoring do not enumerate or evaluate loaded tabs', async () => {
  const f=fixture(); f.chrome.tabs.query=async()=>{ throw Error('Must not enumerate'); };
  const m=f.monitor(); await m.enable(); await m.restore(); await m.handle('ready',f.event()); await m.idle();
  assert.deepEqual(f.evaluated,[]);
});
for (const opening of ['Ctrl-click', 'middle-click', 'context menu', 'about:blank']) {
  test(opening+' new-tab event admits the final loaded destination once', async () => {
    const f=fixture(),m=f.monitor(); await m.enable(); await m.created({id:1,url:'about:blank'});
    await m.handle('committed',f.event({url:'about:blank'}));
    const nav=f.event(); await m.handle('committed',nav); await m.handle('ready',nav); await m.handle('ready',nav); await m.idle();
    assert.equal(f.evaluated.length,1);
  });
}
for (const refresh of ['Refresh', 'F5', 'Ctrl+R', 'hard refresh']) {
  test(refresh+' uses Chrome reload metadata, including on old tabs', async () => {
    const f=fixture(),m=f.monitor(); await m.enable(); const nav=f.event({transitionType:'reload'});
    await m.handle('committed',nav); await m.handle('ready',nav); await m.idle(); assert.equal(f.evaluated.length,1);
    const second=f.event({transitionType:'reload',documentId:'reload-2'});
    await m.handle('committed',second); await m.handle('ready',second); await m.idle(); assert.equal(f.evaluated.length,2);
  });
}
test('ordinary navigation, history and SPA changes are not triggers', async () => {
  const f=fixture(),m=f.monitor(); await m.enable();
  for(const type of ['link','typed','auto_bookmark','auto_subframe']) {
    const nav=f.event({transitionType:type}); await m.handle('committed',nav); await m.handle('ready',nav);
  }
  await m.handle('history',f.event({url:'https://example.test/jobs/new'})); await m.idle(); assert.equal(f.evaluated.length,0);
});
test('redirect notifications belong to one new-tab opening', async () => {
  const f=fixture(),m=f.monitor(); await m.enable(); await m.created({id:1});
  const first=f.event(); await m.handle('committed',first);
  const final=f.event({url:'https://example.test/jobs/final',documentId:'final',transitionQualifiers:['client_redirect']});
  await m.handle('committed',final); await m.handle('ready',first); await m.handle('ready',final); await m.idle();
  assert.deepEqual(f.evaluated.map(x=>x[1]),[final.url]);
  const ordinary=f.event({url:'https://example.test/jobs/another',documentId:'another',transitionType:'link'});
  await m.handle('committed',ordinary); await m.handle('ready',ordinary); await m.idle(); assert.equal(f.evaluated.length,1);
});
test('disabled and re-enabled monitors do not reuse old new-tab claims', async () => {
  const f=fixture(),m=f.monitor(); await m.enable(); await m.created({id:1});
  f.local.qtsGetJdOn=false; const nav=f.event(); await m.handle('committed',nav); await m.handle('ready',nav);
  f.tick(); await m.enable(); await m.handle('committed',nav); await m.handle('ready',nav); await m.idle(); assert.equal(f.evaluated.length,0);
});

test('a pending creation callback from before enable cannot become a new-tab claim', async () => {
  const f=fixture(),m=f.monitor();
  const pending=m.created({id:1});
  await m.enable(); await pending;
  const nav=f.event(); await m.handle('committed',nav); await m.handle('ready',nav); await m.idle();
  assert.equal(f.evaluated.length,0);
});
test('worker restart preserves a pending eligible document without replaying completed work', async () => {
  const f=fixture(); let m=f.monitor(); await m.enable(); await m.created({id:1}); const nav=f.event(); await m.handle('committed',nav);
  m=f.monitor(); await m.restore(); await m.handle('ready',nav); await m.idle();
  m=f.monitor(); await m.restore(); await m.handle('ready',nav); await m.idle(); assert.equal(f.evaluated.length,1);
});
test('subframes, prerenders and closed tabs do not schedule work', async () => {
  const f=fixture(),m=f.monitor(); await m.enable(); await m.created({id:1});
  await m.handle('committed',f.event({frameId:2})); await m.handle('committed',f.event({documentLifecycle:'prerender'}));
  const nav=f.event(); await m.handle('committed',nav); await m.remove(1); await m.handle('ready',nav); await m.idle(); assert.equal(f.evaluated.length,0);
});
test('closing a tab during a request prevents a late queued redirect evaluation', {timeout:3000}, async () => {
  const f=fixture();let release; const started=new Promise(resolve=>{release=resolve}); let finish;
  const m=createNavigationMonitor({chrome:f.chrome,now:()=>f.tick(),evaluate:async()=>{release();await new Promise(r=>{finish=r});}});
  await m.enable(); await m.created({id:1});const nav=f.event();await m.handle('committed',nav);await m.handle('ready',nav);await started;
  const next=f.event({url:'https://example.test/final',documentId:'final',transitionQualifiers:['client_redirect']});
  await m.handle('committed',next); await m.handle('ready',next); await m.remove(1); finish(); await m.idle();
});
