// One toast stack per page, shared by the launcher, the Get JD panel, and
// worker-driven notices, so toasts from different sources never overlap.
// The newest toast is on top; older ones move down and the oldest leaves
// first when the stack is full.

(function initializeQtsPageToast() {
  if (globalThis.__qtsPageToast) return;

  const MAX_VISIBLE = 4;
  const EXIT_MS = 220;
  // Errors and warnings stay longer so they can be read before they leave.
  const DURATION_MS = { info: 4500, success: 4500, applied: 5000, warn: 7000, error: 8000 };
  // The same notice (for example one Get JD result) is not repeated within this window.
  const DUPLICATE_WINDOW_MS = 10000;
  const ICONS = { info: 'i', success: '✓', applied: '★', warn: '!', error: '×' };
  const recentKeys = new Map();

  let host = null;
  let stack = null;

  function normalizeType(type) {
    const value = String(type || 'info').toLowerCase();
    if (value === 'fail') return 'error';
    if (value === 'normal') return 'info';
    return Object.hasOwn(DURATION_MS, value) ? value : 'info';
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
        width: min(380px, calc(100vw - 32px)); pointer-events: none;
        font: 500 13.5px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .toast {
        --accent: #2563eb; --tint: #eff6ff;
        position: relative; display: grid; grid-template-columns: 32px 1fr 24px; align-items: start; gap: 12px;
        padding: 13px 12px 15px 14px; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 16px;
        background: rgba(255, 255, 255, .94); color: #0f172a;
        box-shadow: 0 18px 40px -12px rgba(15, 23, 42, .28), 0 4px 12px -4px rgba(15, 23, 42, .12);
        backdrop-filter: blur(14px) saturate(1.4); -webkit-backdrop-filter: blur(14px) saturate(1.4);
        pointer-events: auto; animation: enter .28s cubic-bezier(.2, .9, .3, 1.2) both;
      }
      .toast.success { --accent: #16a34a; --tint: #f0fdf4; }
      .toast.applied { --accent: #7c3aed; --tint: #f5f3ff; }
      .toast.warn { --accent: #d97706; --tint: #fffbeb; }
      .toast.error { --accent: #dc2626; --tint: #fef2f2; }
      .icon {
        display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px;
        background: var(--tint); color: var(--accent); font: 800 15px/1 system-ui, sans-serif;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
      }
      .text { padding-top: 6px; overflow-wrap: anywhere; }
      .close {
        display: grid; place-items: center; width: 24px; height: 24px; margin-top: 4px; padding: 0;
        border: 0; border-radius: 8px; background: transparent; color: #64748b;
        font: 600 17px/1 system-ui, sans-serif; cursor: pointer;
      }
      .close:hover { background: #f1f5f9; color: #0f172a; }
      .close:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      .progress {
        position: absolute; left: 0; bottom: 0; height: 3px; width: 100%;
        background: var(--accent); opacity: .55; transform-origin: left;
        animation: drain linear forwards; animation-duration: var(--duration);
      }
      .toast:hover .progress { animation-play-state: paused; }
      .toast.leaving { animation: leave ${EXIT_MS}ms ease forwards; }
      @keyframes enter { from { opacity: 0; transform: translateY(-14px) scale(.96); } to { opacity: 1; transform: none; } }
      @keyframes leave { to { opacity: 0; transform: translateX(-24px) scale(.97); } }
      @keyframes drain { to { transform: scaleX(0); } }
      @media (prefers-color-scheme: dark) {
        .toast { border-color: #334155; background: rgba(15, 23, 42, .92); color: #f1f5f9; }
        .toast { --tint: color-mix(in srgb, var(--accent) 18%, #0f172a); }
        .close { color: #94a3b8; }
        .close:hover { background: #1e293b; color: #f8fafc; }
      }
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
    setTimeout(() => toast.remove(), EXIT_MS);
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

  function show(message, options = {}) {
    const text = String(message || '').trim();
    if (!text || isDuplicate(options.key)) return;
    const type = normalizeType(options.type);
    const durationMs = Number(options.durationMs) > 0 ? Number(options.durationMs) : DURATION_MS[type];
    const container = ensureStack();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' || type === 'warn' ? 'alert' : 'status');
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ICONS[type];
    const body = document.createElement('div');
    body.className = 'text';
    body.textContent = text;
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.addEventListener('click', () => dismiss(toast));
    const progress = document.createElement('span');
    progress.className = 'progress';
    progress.style.setProperty('--duration', `${durationMs}ms`);
    toast.append(icon, body, close, progress);

    // Hovering pauses the countdown so a long message can be finished.
    toast.addEventListener('mouseenter', () => {
      clearTimeout(toast.__qtsHideTimer);
      toast.__qtsRemainingMs -= Date.now() - toast.__qtsHideStartedAt;
    });
    toast.addEventListener('mouseleave', () => scheduleHide(toast, Math.max(toast.__qtsRemainingMs, 1200)));

    container.prepend(toast);
    const active = [...container.children].filter((node) => !node.classList.contains('leaving'));
    for (const stale of active.slice(MAX_VISIBLE)) dismiss(stale);
    scheduleHide(toast, durationMs);
  }

  function clear() {
    if (stack) stack.replaceChildren();
    recentKeys.clear();
  }

  globalThis.__qtsPageToast = { show, clear };
})();
