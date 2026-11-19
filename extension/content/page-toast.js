// One toast stack per page, shared by the launcher, the Get JD panel, and
// worker-driven notices, so toasts from different sources never overlap.
// The newest toast is on top; older ones move down and the oldest leaves
// first when the stack is full.
//
// Look: the QTS launcher's dark navy cards (same colours, radius, borders),
// a coloured rail and icon per tone, a title line with the Q·T·S mark, and
// a thin countdown bar. Every toast is built as:
//   [icon] [body: head (title, QTS mark) + message] [close] [progress]

(function initializeQtsPageToast() {
  if (globalThis.__qtsPageToast) return;

  const MAX_VISIBLE = 4;
  const EXIT_MS = 220;
  // Errors and warnings stay longer so they can be read before they leave.
  const DURATION_MS = { info: 4500, success: 4500, applied: 5000, warn: 7000, error: 8000 };
  // The same notice (for example one Get JD result) is not repeated within this window.
  const DUPLICATE_WINDOW_MS = 10000;
  const TITLES = { info: 'Info', success: 'Success', applied: 'Applied', warn: 'Warning', error: 'Error' };
  // Shown when the page cannot build SVG (never in Chrome; kept for safety).
  const GLYPHS = { info: 'i', success: '✓', applied: '★', warn: '!', error: '×', close: '×' };
  // Lucide-style 24px stroke icons, built with createElementNS (no innerHTML: safe on Trusted Types pages).
  const ICON_SHAPES = {
    info: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
    success: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'm8.5 12.5 2.5 2.5 4.5-5' }]],
    applied: [['path', { d: 'M12 2.5 14.9 8.4l6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9Z' }]],
    warn: [['path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' }], ['path', { d: 'M12 9v4' }], ['path', { d: 'M12 17h.01' }]],
    error: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'm15 9-6 6' }], ['path', { d: 'm9 9 6 6' }]],
    close: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
  };
  const recentKeys = new Map();

  let host = null;
  let stack = null;
  let getJdSummaryToast = null;
  let getJdSummarySnapshotKey = '';
  let getJdSummaryTimer = null;

  function normalizeType(type) {
    const value = String(type || 'info').toLowerCase();
    if (value === 'fail') return 'error';
    if (value === 'normal') return 'info';
    return Object.hasOwn(DURATION_MS, value) ? value : 'info';
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgIcon(name) {
    const shapes = ICON_SHAPES[name];
    if (!shapes || typeof document.createElementNS !== 'function') return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [key, value] of Object.entries({
      viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    })) svg.setAttribute(key, String(value));
    for (const [tag, attributes] of shapes) {
      const shape = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
      svg.appendChild(shape);
    }
    return svg;
  }

  function iconNode(name, className) {
    const node = element('span', className);
    node.setAttribute('aria-hidden', 'true');
    const svg = svgIcon(name);
    if (svg) node.appendChild(svg);
    else node.textContent = GLYPHS[name] || '';
    return node;
  }

  // The small Q·T·S mark used on the launcher, so every toast reads as QTS.
  function brandMark() {
    const mark = element('span', 'brand');
    mark.setAttribute('aria-hidden', 'true');
    mark.append(element('span', 'q', 'Q'), element('span', 't', 'T'), element('span', 's', 'S'));
    return mark;
  }

  function closeButton(label, onClick) {
    // A real button: keyboard and screen readers can dismiss the toast.
    const button = element('button', 'close');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    const svg = svgIcon('close');
    if (svg) button.appendChild(svg);
    else button.textContent = GLYPHS.close;
    button.addEventListener('click', onClick);
    return button;
  }

  function progressBar(durationMs) {
    const progress = element('span', 'progress');
    progress.style.setProperty('--duration', `${durationMs}ms`);
    return progress;
  }

  function ensureStack() {
    if (stack?.isConnected) return stack;
    host = document.createElement('div');
    host.setAttribute('data-qts-page-toast', '');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .stack {
        position: fixed; top: 16px; left: 16px; display: flex; flex-direction: column; gap: 10px;
        width: min(380px, calc(100vw - 32px)); pointer-events: none; color-scheme: dark;
        font: 500 13px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .toast {
        --ink: #93c5fd; --rail: #3b82f6; --tint: rgb(59 130 246 / .16);
        position: relative; display: grid; grid-template-columns: 34px minmax(0, 1fr) 28px; align-items: start;
        column-gap: 12px; padding: 12px 10px 14px 14px; overflow: hidden;
        border: 1px solid #1f2a40; border-radius: 14px;
        background: linear-gradient(180deg, #131c31, #0d1526); color: #e6ebf5;
        box-shadow: inset 3px 0 0 var(--rail), 0 18px 40px -14px rgb(2 6 23 / .7), 0 4px 14px -6px rgb(2 6 23 / .5);
        pointer-events: auto; animation: enter .28s cubic-bezier(.2, .9, .3, 1.15) both;
        transition: border-color .15s ease;
      }
      .toast:hover { border-color: #2c3a55; }
      .toast.success { --ink: #6ee7b7; --rail: #10b981; --tint: rgb(16 185 129 / .16); }
      .toast.applied { --ink: #d8b4fe; --rail: #a855f7; --tint: rgb(168 85 247 / .16); }
      .toast.warn { --ink: #fdba74; --rail: #f97316; --tint: rgb(249 115 22 / .16); }
      .toast.error { --ink: #fca5a5; --rail: #ef4444; --tint: rgb(239 68 68 / .16); }
      .icon {
        display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px;
        background: var(--tint); color: var(--ink); font: 800 15px/1 system-ui, sans-serif;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rail) 30%, transparent);
      }
      .icon svg { display: block; }
      .body { min-width: 0; padding-top: 1px; }
      .head { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .title {
        overflow: hidden; color: #f8fafc; font: 700 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .time { flex: none; color: #66758c; font: 600 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
      .brand {
        display: inline-flex; flex: none; gap: 1px; margin-left: auto; padding: 3px 6px;
        border: 1px solid #243047; border-radius: 999px; background: #0b1322;
        font: 800 9px/1 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: .04em;
      }
      .brand .q { color: #fcd34d; } .brand .t { color: #e2e8f0; } .brand .s { color: #60a5fa; }
      .text { margin-top: 3px; color: #cbd5e1; overflow-wrap: anywhere; white-space: pre-line; }
      .meta { margin-top: 3px; overflow: hidden; color: #8b9ab3; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
      .chip {
        display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px;
        border: 1px solid #34425a; border-radius: 999px; background: #111a2e; color: #cbd5e1;
        font: 700 10.5px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap;
      }
      .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .chip.success { border-color: rgb(16 185 129 / .45); background: rgb(16 185 129 / .1); color: #6ee7b7; }
      .chip.failed { border-color: rgb(239 68 68 / .5); background: rgb(239 68 68 / .1); color: #fca5a5; }
      .chip.review { border-color: rgb(249 115 22 / .5); background: rgb(249 115 22 / .1); color: #fdba74; }
      .chip.processing { border-color: rgb(59 130 246 / .5); background: rgb(59 130 246 / .1); color: #93c5fd; }
      .chip.skipped, .chip.cancelled { color: #94a3b8; }
      .close {
        display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
        border: 1px solid transparent; border-radius: 8px; background: transparent; color: #8190a7;
        font: 600 16px/1 system-ui, sans-serif; cursor: pointer; transition: background .15s ease, color .15s ease;
      }
      .close svg { width: 15px; height: 15px; }
      .close:hover { border-color: #2c3a55; background: #16213a; color: #f8fafc; }
      .close:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
      .progress {
        position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
        background: linear-gradient(90deg, var(--rail), var(--ink)); opacity: .8; transform-origin: left;
        animation: drain linear forwards; animation-duration: var(--duration);
      }
      .toast:hover .progress { animation-play-state: paused; }
      .toast.leaving { animation: leave ${EXIT_MS}ms ease forwards; }
      @keyframes enter { from { opacity: 0; transform: translateY(-12px) scale(.97); } to { opacity: 1; transform: none; } }
      @keyframes leave { to { opacity: 0; transform: translateX(-24px) scale(.97); } }
      @keyframes drain { to { transform: scaleX(0); } }
      @media (prefers-reduced-motion: reduce) {
        .toast, .toast.leaving { animation: none; }
        .progress { display: none; }
      }
    `;
    stack = document.createElement('div');
    stack.className = 'stack';
    stack.setAttribute('aria-live', 'polite');
    root.append(style, stack);
    (document.documentElement || document.body).appendChild(host);
    return stack;
  }

  function dismiss(toast) {
    if (!toast.isConnected || toast.classList.contains('leaving')) return;
    clearTimeout(toast.__qtsHideTimer);
    toast.classList.add('leaving');
    toast.__qtsExitTimer = setTimeout(() => toast.remove(), EXIT_MS);
  }

  function scheduleHide(toast, remainingMs) {
    toast.__qtsHideStartedAt = Date.now();
    toast.__qtsRemainingMs = remainingMs;
    toast.__qtsHideTimer = setTimeout(() => dismiss(toast), remainingMs);
  }

  function isDuplicate(key) {
    if (!key) return false;
    const now = Date.now();
    for (const [storedKey, shownAt] of recentKeys) {
      if (now - shownAt > DUPLICATE_WINDOW_MS) recentKeys.delete(storedKey);
    }
    if (recentKeys.has(key)) return true;
    recentKeys.set(key, now);
    return false;
  }

  // options.title replaces the tone's title ("Success", "Error", …).
  function show(message, options = {}) {
    const text = String(message || '').trim();
    if (!text || isDuplicate(options.key)) return;
    const type = normalizeType(options.type);
    const durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : DURATION_MS[type];
    const container = ensureStack();

    const toast = element('div', `toast ${type}`);
    toast.setAttribute('role', type === 'error' || type === 'warn' ? 'alert' : 'status');
    const body = element('div', 'body');
    const head = element('div', 'head');
    head.append(element('span', 'title', String(options.title || TITLES[type])), brandMark());
    body.append(head, element('div', 'text', text));
    toast.append(
      iconNode(type, 'icon'),
      body,
      closeButton('Dismiss notification', () => dismiss(toast)),
      progressBar(durationMs),
    );

    // Hovering pauses the countdown so a long message can be finished.
    toast.addEventListener('mouseenter', () => {
      clearTimeout(toast.__qtsHideTimer);
      toast.__qtsRemainingMs -= Date.now() - toast.__qtsHideStartedAt;
    });
    toast.addEventListener('mouseleave', () => scheduleHide(toast, Math.max(toast.__qtsRemainingMs, 1200)));

    container.prepend(toast);
    const active = [...container.children].filter((node) => !node.classList.contains('leaving'));
    for (const stale of active.slice(MAX_VISIBLE)) {
      if (stale !== getJdSummaryToast) dismiss(stale);
    }
    scheduleHide(toast, durationMs);
  }

  const SUMMARY_CHIPS = [
    ['success', 'Success'], ['failed', 'Failed'], ['review', 'Review needed'], ['partial', 'Partial failure'],
    ['processing', 'Processing'], ['skipped', 'Skipped'], ['cancelled', 'Cancelled'],
  ];

  // The Get JD card: title with time, one chip per non-zero count, then the page and its message.
  function getJdSummaryBody(batch) {
    const items = Array.isArray(batch?.items) ? batch.items : [];
    const counts = globalThis.__qtsGetJdNotifications?.summarizeBatch(batch)
      || { success: 0, failed: 0, skipped: 0, processing: 0, cancelled: 0 };
    const latest = items[items.length - 1];
    const body = element('div', 'body');
    const head = element('div', 'head');
    const status = String(latest?.status || 'Processing');
    head.append(element('span', 'title', items.length > 1
      ? `Get JD · ${items.length} results`
      : `Get JD · ${status.charAt(0).toUpperCase()}${status.slice(1)}`));
    const timestamp = Number(latest?.updatedAt);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      head.append(element('span', 'time', new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
    }
    head.append(brandMark());
    body.append(head);

    const chips = element('div', 'chips');
    for (const [key, label] of SUMMARY_CHIPS) {
      const count = Number(counts[key]) || 0;
      if (count > 0) chips.append(element('span', `chip ${key === 'partial' ? 'failed' : key}`, `${label} ${count}`));
    }
    if ((chips.children || []).length) body.append(chips);

    let source = latest?.pageTitle ? latest.pageTitle.slice(0, 100) : '';
    if (!source) {
      try { source = new URL(latest?.pageUrl || '').hostname; } catch { /* No source site is available. */ }
    }
    if (source) body.append(element('div', 'meta', source));
    if (latest?.message && items.length === 1) {
      body.append(element('div', 'text', latest.message.length > 180 ? `${latest.message.slice(0, 177)}...` : latest.message));
    }
    return body;
  }

  function showGetJdSummary(batch) {
    const items = Array.isArray(batch?.items) ? batch.items : [];
    if (!items.length || !batch?.id) return;
    const dismissAt = Number(batch.dismissAt);
    if (Number.isFinite(dismissAt) && dismissAt <= Date.now()) return;
    const snapshotKey = `${batch.id}:${batch.updatedAt || ''}`;
    if (snapshotKey === getJdSummarySnapshotKey) return;
    getJdSummarySnapshotKey = snapshotKey;
    const counts = globalThis.__qtsGetJdNotifications?.summarizeBatch(batch)
      || { success: 0, failed: 0, skipped: 0, processing: 0, cancelled: 0 };
    const type = counts.failed || counts.partial ? 'error'
      : counts.processing || counts.review ? 'warn'
        : (counts.skipped || counts.cancelled) && !counts.success ? 'info' : 'success';
    const container = ensureStack();
    host.setAttribute('data-qts-get-jd-summary-id', batch.id);
    const toast = getJdSummaryToast || document.createElement('div');
    getJdSummaryToast = toast;
    if (toast.__qtsExitTimer) clearTimeout(toast.__qtsExitTimer);
    toast.classList.remove('leaving');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.replaceChildren();
    toast.append(
      iconNode(type, 'icon'),
      getJdSummaryBody(batch),
      closeButton('Dismiss Get JD notification', () => dismissGetJdSummary()),
      progressBar(5000),
    );

    if (!toast.parentNode) container.prepend(toast);
    if (!toast.__qtsGetJdListenersAttached) {
      toast.addEventListener('mouseenter', () => {
        toast.__qtsHovering = true;
        if (getJdSummaryTimer) clearTimeout(getJdSummaryTimer);
        toast.__qtsRemainingMs = Math.max(0, toast.__qtsRemainingMs - (Date.now() - toast.__qtsHideStartedAt));
      });
      toast.addEventListener('mouseleave', () => {
        toast.__qtsHovering = false;
        scheduleGetJdSummaryHide(Math.max(toast.__qtsRemainingMs, 1200));
      });
      toast.__qtsGetJdListenersAttached = true;
    }
    if (getJdSummaryTimer) clearTimeout(getJdSummaryTimer);
    toast.__qtsRemainingMs = Number.isFinite(dismissAt)
      ? Math.min(5000, dismissAt - Date.now())
      : 5000;
    if (!toast.__qtsHovering) scheduleGetJdSummaryHide(toast.__qtsRemainingMs);
  }

  function scheduleGetJdSummaryHide(durationMs) {
    const toast = getJdSummaryToast;
    if (!toast) return;
    clearTimeout(getJdSummaryTimer);
    toast.__qtsHideStartedAt = Date.now();
    toast.__qtsRemainingMs = durationMs;
    getJdSummaryTimer = setTimeout(() => dismissGetJdSummary(), durationMs);
  }

  function dismissGetJdSummary() {
    if (getJdSummaryTimer) clearTimeout(getJdSummaryTimer);
    getJdSummaryTimer = null;
    const toast = getJdSummaryToast;
    if (toast) {
      clearTimeout(toast.__qtsExitTimer);
      toast.remove();
    }
    host?.removeAttribute('data-qts-get-jd-summary-id');
    getJdSummaryToast = null;
  }

  function onRuntimeMessage(message) {
    if (message?.type === 'QTS_GET_JD_NOTIFICATION_SUMMARY') showGetJdSummary(message.summary);
  }

  function clear() {
    if (getJdSummaryTimer) clearTimeout(getJdSummaryTimer);
    getJdSummaryTimer = null;
    getJdSummaryToast = null;
    getJdSummarySnapshotKey = '';
    if (stack) {
      for (const toast of stack.children) {
        clearTimeout(toast.__qtsHideTimer);
        clearTimeout(toast.__qtsExitTimer);
      }
      stack.replaceChildren();
    }
    host?.removeAttribute('data-qts-get-jd-summary-id');
    recentKeys.clear();
  }

  chrome.runtime?.onMessage?.addListener(onRuntimeMessage);
  window.addEventListener('pagehide', () => {
    clear();
    chrome.runtime?.onMessage?.removeListener(onRuntimeMessage);
  }, { once: true });

  globalThis.__qtsPageToast = { show, clear, showGetJdSummary };
})();
