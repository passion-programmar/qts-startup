// LinkedIn skip-list, the worker's part. QTS's server is the only source of truth and is required:
// the skip-list runs only while QTS has answered within the last 2 minutes (any extension call
// counts, so this adds no requests), and pauses otherwise. This Chrome keeps a mirror of the list
// (IndexedDB: it can be large, and chrome.storage.local changes reach every open tab) only to match
// cards quickly while QTS is reachable; there is no offline queue.
// Fetch: only what changed, at most every 10 minutes (sooner, but not within 30 s, when the panel
// opens or the Manager returns to the tab). Save: a panel Skip / Un-skip at once; clicks and
// LinkedIn's own labels in one batch every 10 s or 25 marks, and when the Manager leaves the tab. A
// batch QTS does not take is dropped and its cards go back to normal.
(function initLinkedInSkips(global) {
  const MIRROR_KEY = 'linkedinSkipsMirrorV2';
  const FRESH_MS = 10 * 60_000;
  const NUDGE_MS = 30_000;
  const REACH_MS = 2 * 60_000;
  const BATCH_MS = 10_000;
  const BATCH_MAX = 25;
  const POST_MAX = 200;

  let mirror = null; // { managerId, cursor, pulledAt, disabled, skips: Map, removed: Set, seen: Map }
  let loading = null;
  let pulling = null;
  const pending = new Map(); // key -> mark waiting for the next batch
  let batchTimer = null;

  const store = () => global.__qtsScannerDocumentStore;
  const now = () => Date.now();

  /** QTS answered within the last 2 minutes, and nothing failed since. */
  function reachable() {
    const answered = Number(global.__qtsServerAnsweredAt) || 0;
    const failed = Number(global.__qtsServerFailedAt) || 0;
    return now() - answered < REACH_MS && answered >= failed;
  }

  async function managerId() {
    const user = await global.__qtsAccountAuth?.readWorkerSessionUser?.().catch(() => null);
    return user?.role === 'manager' && typeof user.id === 'string' ? user.id : null;
  }

  const empty = (manager) => ({ managerId: manager, cursor: null, pulledAt: 0, disabled: false, skips: new Map(), removed: new Set(), seen: new Map() });

  // The mirror belongs to one Manager: another one signed in starts from an empty list.
  async function load() {
    const manager = await managerId();
    if (mirror && mirror.managerId === manager) return mirror;
    if (loading) return loading;
    loading = (async () => {
      const saved = (await store().getSetting(MIRROR_KEY).catch(() => null))?.value;
      mirror = saved && saved.managerId === manager
        ? { ...saved, skips: new Map(saved.skips), removed: new Set(saved.removed), seen: new Map(saved.seen) }
        : empty(manager);
      pending.clear();
      return mirror;
    })();
    try { return await loading; } finally { loading = null; }
  }

  async function save() {
    if (!mirror) return;
    await store().putSetting(MIRROR_KEY, {
      managerId: mirror.managerId, cursor: mirror.cursor, pulledAt: mirror.pulledAt, disabled: mirror.disabled,
      skips: [...mirror.skips], removed: [...mirror.removed], seen: [...mirror.seen],
    }).catch(() => {});
  }

  /** Skipped: marked (not un-skipped), or a bid / saved job the Manager did not un-skip. */
  function isSkipped(key) {
    return mirror.skips.has(key) || (mirror.seen.has(key) && !mirror.removed.has(key));
  }

  /** Where and how a pair was seen: { source, location, at }, or null. */
  function infoOf(key) {
    if (mirror.skips.has(key)) return mirror.skips.get(key);
    if (mirror.seen.has(key) && !mirror.removed.has(key)) return mirror.seen.get(key);
    return null;
  }

  /** The changes since the last look. 'changed', 'same', or 'failed'. */
  async function pull() {
    if (pulling) return pulling;
    pulling = (async () => {
      const path = `/api/extension/linkedin-skips${mirror.cursor ? `?since=${encodeURIComponent(mirror.cursor)}` : ''}`;
      const reply = await workerApiRequest('GET', path).catch(() => null);
      if (reply?.disabled === true) {
        const was = mirror.disabled;
        Object.assign(mirror, empty(mirror.managerId), { disabled: true, pulledAt: now() });
        pending.clear();
        await save();
        return was ? 'same' : 'changed';
      }
      if (reply?.success !== true) return 'failed';
      const wasDisabled = mirror.disabled;
      mirror.disabled = false;
      if (reply.full) { mirror.skips.clear(); mirror.removed.clear(); mirror.seen.clear(); }
      let changed = Boolean(reply.full) || wasDisabled;
      for (const entry of reply.skips || []) {
        if (typeof entry?.key !== 'string') continue;
        const detail = { source: entry.source, location: entry.location || null, at: entry.at };
        if (entry.removed) { changed ||= mirror.skips.delete(entry.key) || !mirror.removed.has(entry.key); mirror.removed.add(entry.key); }
        else { changed ||= !mirror.skips.has(entry.key) || mirror.removed.has(entry.key); mirror.skips.set(entry.key, detail); mirror.removed.delete(entry.key); }
      }
      for (const entry of reply.seen || []) {
        if (typeof entry?.key !== 'string') continue;
        changed ||= !mirror.seen.has(entry.key);
        mirror.seen.set(entry.key, { source: entry.source, location: entry.location || null, at: entry.at });
      }
      mirror.cursor = typeof reply.cursor === 'string' ? reply.cursor : mirror.cursor;
      mirror.pulledAt = now();
      await save();
      return changed ? 'changed' : 'same';
    })();
    try { return await pulling; } finally { pulling = null; }
  }

  /**
   * Ready to run on LinkedIn: 'ok', 'signed-out', 'admin-off' (Super Admin's switch) or
   * 'server-down'. Fetches when the mirror is older than 10 minutes, or (reason 'panel' / 'return')
   * older than 30 s, or when QTS has not answered lately.
   */
  async function ensureReady(reason) {
    await load();
    if (!mirror.managerId) return { state: 'signed-out', changed: false };
    const age = now() - mirror.pulledAt;
    const due = !mirror.pulledAt || age > FRESH_MS || ((reason === 'panel' || reason === 'return') && age > NUDGE_MS);
    let changed = false;
    if (due || !reachable()) {
      const result = await pull();
      if (result === 'failed') return { state: 'server-down', changed: false };
      changed = result === 'changed';
    }
    if (mirror.disabled) return { state: 'admin-off', changed };
    return { state: reachable() ? 'ok' : 'server-down', changed };
  }

  const validItems = (items) => (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.key === 'string' && item.key && item.key.length <= 600
      && typeof item.title === 'string' && item.title.trim() && typeof item.company === 'string' && item.company.trim())
    .slice(0, POST_MAX)
    .map((item) => ({
      key: item.key, title: item.title.trim().slice(0, 300), company: item.company.trim().slice(0, 200),
      location: typeof item.location === 'string' && item.location.trim() ? item.location.trim().slice(0, 200) : null,
      source: item.source,
    }));
  const toServer = ({ title, company, location, source }) => ({ title, company, location, source });

  async function tellLinkedInTabs() {
    const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/jobs/*' }).catch(() => []);
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'QTS_LINKEDIN_SKIPS_CHANGED' }).catch(() => {});
  }

  /** The waiting batch to QTS. If QTS does not take it, its marks are dropped and their cards go back to normal. */
  async function flush() {
    clearTimeout(batchTimer);
    batchTimer = null;
    if (!pending.size) return true;
    const batch = [...pending.values()];
    pending.clear();
    const reply = await workerApiRequest('POST', '/api/extension/linkedin-skips', { add: batch.map(toServer) }).catch(() => null);
    if (reply?.success === true) return true;
    for (const item of batch) mirror.skips.delete(item.key);
    if (reply?.disabled) { mirror.disabled = true; } else { global.__qtsServerFailedAt = now(); }
    await save();
    await tellLinkedInTabs();
    return false;
  }

  function scheduleFlush() {
    if (pending.size >= BATCH_MAX) { flush().catch(() => {}); return; }
    if (batchTimer == null) batchTimer = setTimeout(() => flush().catch(() => {}), BATCH_MS);
  }

  /**
   * Marks: shown at once (the mirror), saved in the next batch; immediate (the panel's Skip) is
   * saved now and undone when QTS does not take it. LinkedIn's labels (explicit: false) never bring
   * back an un-skipped pair, and nothing already in the list is sent again.
   */
  async function mark(items, { explicit, immediate = false }) {
    const fresh = [];
    for (const item of validItems(items)) {
      if (!explicit && (mirror.removed.has(item.key) || isSkipped(item.key))) continue;
      if (explicit && mirror.skips.has(item.key)) continue;
      fresh.push({ ...item, source: explicit ? (item.source === 'manual' ? 'manual' : 'clicked') : item.source });
    }
    if (!fresh.length) return { ok: true, added: 0 };
    const wasRemoved = new Set(fresh.filter((item) => mirror.removed.has(item.key)).map((item) => item.key));
    for (const item of fresh) {
      mirror.skips.set(item.key, { source: item.source, location: item.location, at: new Date().toISOString() });
      mirror.removed.delete(item.key);
    }
    if (immediate) {
      const reply = await workerApiRequest('POST', '/api/extension/linkedin-skips', { add: fresh.map(toServer) }).catch(() => null);
      if (reply?.success !== true) {
        for (const item of fresh) { mirror.skips.delete(item.key); if (wasRemoved.has(item.key)) mirror.removed.add(item.key); }
        if (reply?.disabled) mirror.disabled = true;
        return { ok: false, error: reply?.message || 'QTS could not be reached; the skip-list is paused.' };
      }
      await save();
      return { ok: true, added: fresh.length };
    }
    for (const item of fresh) pending.set(item.key, item);
    await save();
    scheduleFlush();
    return { ok: true, added: fresh.length };
  }

  /** The panel's Un-skip: saved at once; nothing changes here when QTS does not take it. */
  async function unskip(items) {
    const removed = validItems(items);
    if (!removed.length) return { ok: true, removed: 0 };
    for (const item of removed) pending.delete(item.key);
    const reply = await workerApiRequest('POST', '/api/extension/linkedin-skips', { remove: removed.map(toServer) }).catch(() => null);
    if (reply?.success !== true) return { ok: false, error: reply?.message || 'QTS could not be reached; the skip-list is paused.' };
    for (const item of removed) { mirror.skips.delete(item.key); mirror.removed.add(item.key); }
    await save();
    return { ok: true, removed: removed.length };
  }

  const fromLinkedIn = (sender) => {
    try { return /(^|\.)linkedin\.com$/i.test(new URL(sender.url || sender.tab?.url || '').hostname); } catch { return false; }
  };
  const TYPES = ['QTS_LINKEDIN_SKIPS_MATCH', 'QTS_LINKEDIN_SKIPS_MARK', 'QTS_LINKEDIN_SKIPS_UNSKIP', 'QTS_LINKEDIN_SKIPS_FLUSH', 'QTS_LINKEDIN_SKIPS_INFO'];

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!TYPES.includes(msg?.type)) return false;
    (async () => {
      if (!fromLinkedIn(sender)) return { ok: false, error: 'Only LinkedIn pages use the skip-list.' };
      if (msg.type === 'QTS_LINKEDIN_SKIPS_FLUSH') { await load(); return { ok: await flush() }; }
      const ready = await ensureReady(msg.type === 'QTS_LINKEDIN_SKIPS_MATCH' ? msg.reason : undefined);
      if (ready.state !== 'ok') return { ok: false, state: ready.state };
      if (msg.type === 'QTS_LINKEDIN_SKIPS_MARK') return mark(msg.items, { explicit: true, immediate: msg.immediate === true });
      if (msg.type === 'QTS_LINKEDIN_SKIPS_UNSKIP') return unskip(msg.items);
      if (msg.type === 'QTS_LINKEDIN_SKIPS_INFO') {
        const key = typeof msg.key === 'string' ? msg.key : '';
        return { ok: true, skipped: Boolean(key) && isSkipped(key), info: key ? infoOf(key) : null };
      }
      // MATCH: LinkedIn's labels join the batch; the page gets which of its cards are skipped.
      await mark(msg.marks, { explicit: false });
      const keys = Array.isArray(msg.keys) ? msg.keys.filter((key) => typeof key === 'string').slice(0, 500) : [];
      return { ok: true, state: 'ok', changed: ready.changed, skipped: keys.filter(isSkipped) };
    })().then(sendResponse, (error) => sendResponse({ ok: false, state: 'server-down', error: error instanceof Error ? error.message : String(error) }));
    return true;
  });

  global.__qtsLinkedInSkips = Object.freeze({ ensureReady, flush, isReachable: reachable });
})(typeof self !== 'undefined' ? self : globalThis);
