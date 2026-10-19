// In-page toast alerts — stacked vertically, numbered, slide in left-to-right.

(function () {
  'use strict';

  if (typeof window.__showQtsDetectToast === 'function') return;

  const TOAST_HOST_ID = 'qts-toast-host';
  const STYLE_ID = 'qts-toast-style';
  const AUTO_HIDE_MS = 3000;
  const APPLIED_HIDE_MS = 3000;
  const MIN_HIDE_MS = 0;
  const MAX_VISIBLE = 8;
  const EXIT_MS = 320;

  const hideTimers = new WeakMap();

  function getToastPageState() {
    if (!window.__qtsToastPageState) {
      window.__qtsToastPageState = { seq: 0, oncePerPage: new Set() };
    }
    return window.__qtsToastPageState;
  }

  function normalizeToastType(typeOrSuccess) {
    if (typeof typeOrSuccess === 'boolean') {
      return typeOrSuccess ? 'success' : 'fail';
    }
    const type = String(typeOrSuccess || 'info').toLowerCase();
    if (['success', 'fail', 'error', 'info', 'warn', 'applied'].includes(type)) return type;
    return 'info';
  }

  function resolveHideMs(type, durationMs) {
    if (Number.isFinite(durationMs) && durationMs >= MIN_HIDE_MS) return durationMs;
    if (type === 'applied') return APPLIED_HIDE_MS;
    return AUTO_HIDE_MS;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_HOST_ID} {
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        pointer-events: none;
        max-width: min(380px, calc(100vw - 32px));
      }
      .qts-toast {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        max-width: min(380px, calc(100vw - 32px));
        padding: 12px 14px;
        border-radius: 10px;
        font: 600 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #fff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.22);
        opacity: 0;
        transform: translateX(-28px);
        transition: opacity 0.35s ease, transform 0.35s ease;
      }
      .qts-toast.is-visible {
        opacity: 1;
        transform: translateX(0);
      }
      .qts-toast.is-leaving {
        opacity: 0;
        transform: translateX(28px);
      }
      .qts-toast-index {
        flex: 0 0 auto;
        min-width: 1.4em;
        font-weight: 800;
        font-size: 14px;
        line-height: 1.2;
        opacity: 0.92;
      }
      .qts-toast-text {
        flex: 1 1 auto;
        min-width: 0;
        word-break: break-word;
      }
      .qts-toast--success { background: #15803d; border: 1px solid #166534; }
      .qts-toast--fail { background: #475569; border: 1px solid #334155; }
      .qts-toast--error { background: #b91c1c; border: 1px solid #991b1b; }
      .qts-toast--info { background: #1d4ed8; border: 1px solid #1e40af; }
      .qts-toast--warn { background: #b45309; border: 1px solid #92400e; }
      .qts-toast--applied {
        background: #eab308;
        border: 1px solid #ca8a04;
        color: #1c1917;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureHost() {
    let host = document.getElementById(TOAST_HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = TOAST_HOST_ID;
      (document.body || document.documentElement).appendChild(host);
    }
    return host;
  }

  function dismissToast(toast) {
    if (!toast || !toast.isConnected) return;
    const timer = hideTimers.get(toast);
    if (timer) window.clearTimeout(timer);
    hideTimers.delete(toast);
    toast.classList.remove('is-visible');
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), EXIT_MS);
  }

  function trimStack(host) {
    while (host.children.length > MAX_VISIBLE) {
      dismissToast(host.children[0]);
    }
  }

  window.__showQtsDetectToast = function showQtsToast(message, typeOrSuccess = 'info', durationMs, oncePerPage) {
    ensureStyles();
    const host = ensureHost();
    const type = normalizeToastType(typeOrSuccess);
    const hideMs = resolveHideMs(type, durationMs);

    const pageState = getToastPageState();

    if (oncePerPage) {
      const pageKey = String(location.href || '').split('#')[0];
      if (pageState.oncePerPage.has(pageKey)) return;
      pageState.oncePerPage.add(pageKey);
    }

    pageState.seq += 1;
    const index = pageState.seq;

    const toast = document.createElement('div');
    toast.className = `qts-toast qts-toast--${type}`;
    toast.setAttribute('role', 'alert');

    const indexEl = document.createElement('span');
    indexEl.className = 'qts-toast-index';
    indexEl.textContent = String(index);

    const textEl = document.createElement('span');
    textEl.className = 'qts-toast-text';
    textEl.textContent = String(message || '');

    toast.appendChild(indexEl);
    toast.appendChild(textEl);
    host.appendChild(toast);
    trimStack(host);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('is-visible'));
    });

    const timer = window.setTimeout(() => dismissToast(toast), hideMs);
    hideTimers.set(toast, timer);
  };
})();
