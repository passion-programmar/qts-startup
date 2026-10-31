// Event-driven UI ownership and navigation admission. No page extraction or polling here.
(function initPageActivity(global) {
  function createLauncherFocus({ chrome, eligible = async () => true }) {
    let previous = null;
    let revision = 0;
    let focusedWindowId;
    const send = (id, active) => chrome.tabs.sendMessage(id, {
      type: 'QTS_LAUNCHER_ACTIVE', active,
    }, { frameId: 0 }).catch(() => {});
    async function isActive(tabId) {
      const currentRevision = revision;
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab?.active) return false;
      const window = focusedWindowId === undefined
        ? await chrome.windows.getLastFocused().catch(() => null)
        : await chrome.windows.get(focusedWindowId).catch(() => null);
      const active = window?.id === tab.windowId && window.focused === true && await eligible(tab);
      if (active && currentRevision === revision) {
        // A new document can mount after its tab's about:blank activation was excluded.
        // Remember that owner too, so a later window blur can unmount it.
        const old = previous;
        previous = tabId;
        if (old != null && old !== tabId) await send(old, false);
      }
      return active;
    }
    async function sync(windowId) {
      // Focus events are authoritative; querying last-focused during the OS transition can lag.
      focusedWindowId = typeof windowId === 'number' ? windowId : undefined;
      const currentRevision = ++revision;
      const old = previous;
      previous = null;
      if (old != null) await send(old, false);
      const window = focusedWindowId === undefined
        ? await chrome.windows.getLastFocused().catch(() => null)
        : await chrome.windows.get(focusedWindowId).catch(() => null);
      if (currentRevision !== revision || !window?.focused) return;
      focusedWindowId = window.id;
      const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
      if (!tab || !(await eligible(tab)) || currentRevision !== revision) return;
      previous = tab.id;
      await send(tab.id, true);
    }
    function removeWindow(windowId) {
      if (focusedWindowId >= 0 && focusedWindowId !== windowId) return Promise.resolve();
      if (focusedWindowId === windowId) focusedWindowId = undefined;
      return sync();
    }
    function removeTab(tabId) {
      if (previous !== tabId) return Promise.resolve();
      previous = null;
      return sync();
    }
    return { sync, isActive, removeWindow, removeTab };
  }

  function createNavigationMonitor({ chrome, evaluate, now = Date.now }) {
    const SINCE = 'qtsGetJdEnabledAt';
    const key = (id) => `qtsGetJdNavigation:${id}`;
    const operations = new Map();
    const evaluations = new Map();
    let activationRevision = 0;
    function serialize(id, action) {
      const next = (operations.get(id) || Promise.resolve()).catch(() => {}).then(action);
      operations.set(id, next);
      next.finally(() => { if (operations.get(id) === next) operations.delete(id); }).catch(() => {});
      return next;
    }
    async function state() {
      return chrome.storage.local.get(['qtsGetJdOn', SINCE]);
    }
    async function enable() {
      activationRevision += 1;
      // No enumeration or injection: only future creation and explicit reload events qualify.
      await chrome.storage.local.set({ qtsGetJdOn: true, [SINCE]: now() });
    }
    async function restore() {
      const saved = await state();
      if (saved.qtsGetJdOn && !saved[SINCE]) await enable();
    }
    function created(tab) {
      const at = now();
      const revision = activationRevision;
      return serialize(tab.id, async () => {
        const settings = await state();
        if (revision !== activationRevision || !settings.qtsGetJdOn || !settings[SINCE] || at < settings[SINCE]) return;
        await chrome.storage.session.set({ [key(tab.id)]: { opening: true, epoch: settings[SINCE], at } });
      });
    }
    async function handle(kind, event) {
      if (!['committed', 'ready'].includes(kind) || event.frameId !== 0
        || (event.documentLifecycle && event.documentLifecycle !== 'active')) return;
      return serialize(event.tabId, async () => {
        const settings = await state();
        if (settings.qtsGetJdOn !== true) return;
        const saved = (await chrome.storage.session.get(key(event.tabId)))[key(event.tabId)];
        const at = event.timeStamp || now();
        const epoch = settings[SINCE];
        if (!epoch) return;
        if (kind === 'committed') {
          if (!/^https?:/i.test(event.url)) return;
          const reload = event.transitionType === 'reload' || event.transitionQualifiers?.includes('reload');
          const opening = saved?.opening === true && saved.epoch === epoch
            && (!saved.documentId || event.transitionQualifiers?.some((q) => ['client_redirect', 'server_redirect'].includes(q)));
          if ((!opening && !reload) || at < epoch) return;
          if (saved?.documentId === event.documentId && saved.url === event.url) return;
          await chrome.storage.session.set({ [key(event.tabId)]: {
            epoch, opening, url: event.url, documentId: event.documentId, at, processed: false,
          } });
          return;
        }
        if (!saved || saved.epoch !== epoch || saved.url !== event.url
          || saved.documentId !== event.documentId || saved.processed) return;
        const record = { ...saved, processed: true };
        await chrome.storage.session.set({ [key(event.tabId)]: record });
        // A newer route replaces waiting work; an old request may finish, but cannot cause a scan
        // of whatever happens to be open afterwards. Persisted admission survives worker restarts.
        const work = (evaluations.get(event.tabId) || Promise.resolve()).catch(() => {}).then(async () => {
          const latest = (await chrome.storage.session.get(key(event.tabId)))[key(event.tabId)];
          const current = await state();
          if (current.qtsGetJdOn !== true || current[SINCE] !== epoch
            || latest?.url !== record.url || latest?.documentId !== record.documentId) return;
          await evaluate(event.tabId, event.url, event.documentId);
          await serialize(event.tabId, async () => {
            const done = (await chrome.storage.session.get(key(event.tabId)))[key(event.tabId)];
            if (done?.documentId === record.documentId && done.epoch === epoch) {
              await chrome.storage.session.set({ [key(event.tabId)]: { ...done, opening: false } });
            }
          });
        });
        evaluations.set(event.tabId, work);
        work.finally(() => { if (evaluations.get(event.tabId) === work) evaluations.delete(event.tabId); }).catch(() => {});
      });
    }
    async function remove(tabId) {
      await serialize(tabId, () => chrome.storage.session.remove(key(tabId)));
    }
    return { enable, restore, created, handle, remove, idle: async () => {
      await Promise.all([...operations.values()]); await Promise.all([...evaluations.values()]);
    } };
  }
  global.__qtsPageActivity = { createLauncherFocus, createNavigationMonitor };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.__qtsPageActivity;
})(typeof self !== 'undefined' ? self : globalThis);
