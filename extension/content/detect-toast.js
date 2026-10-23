// In-page toast alerts — newest first with a numbered status badge.

(function () {
  'use strict';

  if (typeof window.__showQtsDetectToast === 'function') return;

  const TOAST_HOST_ID = 'qts-toast-host';
  const STYLE_ID = 'qts-toast-style';
  const AUTO_HIDE_MS = 4000;
  const APPLIED_HIDE_MS = 4000;
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
    // Use the same lifetime for every toast.
    if (type === 'applied') return APPLIED_HIDE_MS;
    return AUTO_HIDE_MS;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOAST_HOST_ID} {
        all: initial;
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 2147483646;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        pointer-events: none;
        width: min(390px, calc(100vw - 32px));
      }
      .qts-toast {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        width: 100%;
        padding: 13px 15px;
        border: 1px solid #e2e8f0;
        border-left: 4px solid var(--qts-toast-accent, #64748b);
        border-radius: 14px;
        box-sizing: border-box;
        background: color-mix(in srgb, var(--qts-toast-accent, #2563eb) 7%, white);
        color: #172033;
        font: 500 13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.06);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        opacity: 0;
        transform: translateX(-36px);
        transition: opacity 0.22s ease, transform 0.22s ease;
      }
      .qts-toast.is-visible {
        opacity: 1;
        transform: translateX(0);
      }
      .qts-toast.is-leaving {
        opacity: 0;
        transform: translateX(36px);
      }
      .qts-toast-index {
        flex: 0 0 auto;
        display: inline-flex;
        width: 25px;
        height: 25px;
        align-items: center;
        justify-content: center;
        border-radius: 9px;
        background: color-mix(in srgb, var(--qts-toast-accent, #64748b) 12%, white);
        color: var(--qts-toast-accent, #475569);
        font: 750 11px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .qts-toast-text {
        flex: 1 1 auto;
        min-width: 0;
        padding-top: 3px;
        overflow-wrap: anywhere;
      }
      .qts-toast--success { --qts-toast-accent: #15803d; }
      .qts-toast--fail { --qts-toast-accent: #dc2626; }
      .qts-toast--error { --qts-toast-accent: #dc2626; }
      .qts-toast--info { --qts-toast-accent: #2563eb; }
      .qts-toast--warn { --qts-toast-accent: #d97706; }
      .qts-toast--applied { --qts-toast-accent: #7c3aed; }
      @media (prefers-reduced-motion: reduce) {
        .qts-toast { transition: none; }
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
    host.insertBefore(toast, host.firstChild);


    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('is-visible'));
    });

    const timer = window.setTimeout(() => dismissToast(toast), hideMs);
    hideTimers.set(toast, timer);
  };
})();
