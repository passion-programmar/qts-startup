// LinkedIn skip-list, the worker's part: the Manager's list kept in this Chrome (IndexedDB, not
// chrome.storage.local: the list can be large and storage.local changes reach every open tab), the
// latest changes pulled from QTS when a LinkedIn search page loads, and the marks this Chrome makes
// sent to QTS in batches, kept and retried while QTS cannot be reached.
// The LinkedIn page asks only this cache which of its cards are skipped: never one request per card.
(function initLinkedInSkips(global) {
  const CACHE_KEY = 'linkedinSkipsV1';
  const OUTBOX_KEY = 'linkedinSkipsOutboxV1';
  const RETRY_ALARM = 'qts-linkedin-skips-retry';
  const PULL_EVERY_MS = 60_000;
  const BATCH = 200;

  let cache = null; // { managerId, cursor, pulledAt, skips: Set, removed: Set, seen: Set }
  let loading = null;
  let pulling = null;
  let flushing = null;

  const store = () => global.__qtsScannerDocumentStore;

  async function managerId() {
    const user = await global.__qtsAccountAuth?.readWorkerSessionUser?.().catch(() => null);
    return user?.role === 'manager' && typeof user.id === 'string' ? user.id : null;
  }

  // The cache belongs to one Manager: another one signed in starts from an empty list.
  async function load() {
    const manager = await managerId();
    if (cache && cache.managerId === manager) return cache;
    if (loading) return loading;
    loading = (async () => {
      const saved = (await store().getSetting(CACHE_KEY).catch(() => null))?.value;
      cache = saved && saved.managerId === manager
        ? { ...saved, skips: new Set(saved.skips), removed: new Set(saved.removed), seen: new Set(saved.seen) }
        : { managerId: manager, cursor: null, pulledAt: 0, skips: new Set(), removed: new Set(), seen: new Set() };
      return cache;
    })();
    try { return await loading; } finally { loading = null; }
  }

  async function save() {
    if (!cache) return;
    await store().putSetting(CACHE_KEY, {
      managerId: cache.managerId, cursor: cache.cursor, pulledAt: cache.pulledAt,
      skips: [...cache.skips], removed: [...cache.removed], seen: [...cache.seen],
    }).catch(() => {});
  }

  /** Skipped: marked (and not un-skipped), or a bid / saved job the Manager did not un-skip. */
  function isSkipped(key) {
    return cache.skips.has(key) || (cache.seen.has(key) && !cache.removed.has(key));
  }

  /** The latest changes from QTS (at most once a minute, or now when asked). True when the list changed. */
  async function pull(force = false) {
    await load();
    if (!cache.managerId) return false;
    if (!force && Date.now() - cache.pulledAt < PULL_EVERY_MS) return false;
    if (pulling) return pulling;
    pulling = (async () => {
      const path = `/api/extension/linkedin-skips${cache.cursor ? `?since=${encodeURIComponent(cache.cursor)}` : ''}`;
      const reply = await workerApiRequest('GET', path).catch(() => null);
      if (reply?.success !== true) return false;
      if (reply.full) { cache.skips.clear(); cache.removed.clear(); cache.seen.clear(); }
      for (const entry of reply.skips || []) {
        if (typeof entry?.key !== 'string') continue;
        if (entry.removed) { cache.skips.delete(entry.key); cache.removed.add(entry.key); }
        else { cache.skips.add(entry.key); cache.removed.delete(entry.key); }
      }
      for (const key of reply.seen || []) if (typeof key === 'string') cache.seen.add(key);
      cache.cursor = typeof reply.cursor === 'string' ? reply.cursor : cache.cursor;
      cache.pulledAt = Date.now();
      await save();
      return true;
    })();
    try { return await pulling; } finally { pulling = null; }
  }

  async function readOutbox() {
    const saved = (await store().getSetting(OUTBOX_KEY).catch(() => null))?.value;
    return { add: Array.isArray(saved?.add) ? saved.add : [], remove: Array.isArray(saved?.remove) ? saved.remove : [] };
  }

  /** Sends the waiting marks; what QTS could not take stays and is tried again in a minute. */
  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      for (;;) {
        const outbox = await readOutbox();
        if (!outbox.add.length && !outbox.remove.length) { await chrome.alarms.clear(RETRY_ALARM).catch(() => {}); return true; }
        const add = outbox.add.slice(0, BATCH);
        const remove = outbox.remove.slice(0, BATCH);
        const reply = await workerApiRequest('POST', '/api/extension/linkedin-skips', {
          ...(add.length ? { add: add.map(({ title, company, source }) => ({ title, company, source })) } : {}),
          ...(remove.length ? { remove: remove.map(({ title, company }) => ({ title, company })) } : {}),
        }).catch(() => null);
        if (reply?.success !== true) {
          // A batch QTS refused as invalid is dropped; anything else waits for the retry.
          if (reply?._httpStatus === 400) await store().putSetting(OUTBOX_KEY, { add: outbox.add.slice(add.length), remove: outbox.remove.slice(remove.length) }).catch(() => {});
          else { await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: 1 }).catch(() => {}); return false; }
          continue;
        }
        const latest = await readOutbox();
        await store().putSetting(OUTBOX_KEY, { add: latest.add.slice(add.length), remove: latest.remove.slice(remove.length) }).catch(() => {});
      }
    })();
    try { return await flushing; } finally { flushing = null; }
  }

  async function queue(kind, items) {
    const outbox = await readOutbox();
    outbox[kind].push(...items);
    // The same pair waits once (its latest mark).
    for (const list of ['add', 'remove']) {
      const byKey = new Map(outbox[list].map((item) => [item.key, item]));
      outbox[list] = [...byKey.values()].slice(-2000);
    }
    await store().putSetting(OUTBOX_KEY, outbox).catch(() => {});
    flush().catch(() => {});
  }

  const validItems = (items) => (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.key === 'string' && item.key && item.key.length <= 600
      && typeof item.title === 'string' && item.title.trim() && typeof item.company === 'string' && item.company.trim())
    .slice(0, BATCH)
    .map((item) => ({ key: item.key, title: item.title.trim().slice(0, 300), company: item.company.trim().slice(0, 200), source: item.source }));

  /**
   * Marks from this Chrome. explicit: a click or a manual mark (also undoes an un-skip); otherwise
   * LinkedIn's own Viewed / Saved / Applied labels, which never bring back an un-skipped pair.
   */
  async function mark(items, explicit) {
    await load();
    const added = [];
    for (const item of validItems(items)) {
      if (!explicit && (cache.removed.has(item.key) || isSkipped(item.key))) continue;
      if (explicit && cache.skips.has(item.key) && !cache.removed.has(item.key)) continue;
      cache.skips.add(item.key);
      cache.removed.delete(item.key);
      added.push({ ...item, source: explicit ? (item.source === 'manual' ? 'manual' : 'clicked') : item.source });
    }
    if (!added.length) return 0;
    await save();
    await queue('add', added);
    return added.length;
  }

  async function unskip(items) {
    await load();
    const removed = validItems(items);
    for (const item of removed) { cache.skips.delete(item.key); cache.removed.add(item.key); }
    if (!removed.length) return 0;
    await save();
    await queue('remove', removed);
    return removed.length;
  }

  const fromLinkedIn = (sender) => {
    try { return /(^|\.)linkedin\.com$/i.test(new URL(sender.url || sender.tab?.url || '').hostname); } catch { return false; }
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!['QTS_LINKEDIN_SKIPS_MATCH', 'QTS_LINKEDIN_SKIPS_MARK', 'QTS_LINKEDIN_SKIPS_UNSKIP'].includes(msg?.type)) return false;
    (async () => {
      if (!fromLinkedIn(sender)) return { ok: false, error: 'Only LinkedIn pages use the skip-list.' };
      await load();
      if (!cache.managerId) return { ok: false, signedOut: true };
      if (msg.type === 'QTS_LINKEDIN_SKIPS_MARK') return { ok: true, added: await mark(msg.items, true) };
      if (msg.type === 'QTS_LINKEDIN_SKIPS_UNSKIP') return { ok: true, removed: await unskip(msg.items) };
      // A page load (refresh): the first time this Chrome waits for the list; later the page gets an
      // answer at once and is told to look again if the pulled changes alter anything.
      if (msg.refresh) {
        if (!cache.pulledAt) await pull(true);
        else pull().then((changed) => {
          if (changed && sender.tab?.id != null) chrome.tabs.sendMessage(sender.tab.id, { type: 'QTS_LINKEDIN_SKIPS_CHANGED' }).catch(() => {});
        }).catch(() => {});
        flush().catch(() => {});
      }
      await mark(msg.marks, false);
      const keys = Array.isArray(msg.keys) ? msg.keys.filter((key) => typeof key === 'string').slice(0, 500) : [];
      return { ok: true, skipped: keys.filter(isSkipped) };
    })().then(sendResponse, (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });

  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) flush().catch(() => {});
  });

  global.__qtsLinkedInSkips = Object.freeze({ pull, flush, mark, unskip, isSkipped: async (key) => { await load(); return isSkipped(key); } });
})(typeof self !== 'undefined' ? self : globalThis);
