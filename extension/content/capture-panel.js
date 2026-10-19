(() => {
  if (globalThis.__qtsCapturePanelInitialized) return;
  globalThis.__qtsCapturePanelInitialized = true;

  const hostId = 'qts-floating-panel-host';
  let host = document.getElementById(hostId);
  let activeConfirmation = null;

  if (!host) {
    host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .toast-host {
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        width: min(420px, calc(100vw - 32px));
        pointer-events: none;
        font-family: Arial, sans-serif;
      }
      .toast {
        box-sizing: border-box;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        padding: 12px 14px;
        border: 1px solid #cbd5e1;
        border-left: 4px solid #64748b;
        border-radius: 10px;
        background: #fff;
        box-shadow: 0 8px 28px rgba(15, 23, 42, .22);
        color: #0f172a;
        font: 14px/1.45 Arial, sans-serif;
        pointer-events: auto;
      }
      .toast[data-type="success"] { border-left-color: #16a34a; }
      .toast[data-type="new-job"] {
        border-color: #16a34a;
        border-left-color: #15803d;
        background: #dcfce7;
        color: #14532d;
      }
      .toast[data-type="warn"] {
        border-left-color: #eab308;
        background: #fef9c3;
      }
      .toast[data-type="error"], .toast[data-type="fail"] { border-left-color: #dc2626; }
      .toast-text { flex: 1; overflow-wrap: anywhere; }
      .toast-close {
        flex: 0 0 auto;
        border: 0;
        padding: 0 0 0 6px;
        background: transparent;
        color: #64748b;
        font: 20px/1 Arial, sans-serif;
        cursor: pointer;
      }
      .toast-close:hover { color: #0f172a; }
      .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 1;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(15, 23, 42, .48);
        pointer-events: auto;
      }
      .confirm-card {
        box-sizing: border-box;
        width: min(380px, 100%);
        padding: 20px;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 18px 50px rgba(15, 23, 42, .3);
        color: #0f172a;
        font: 14px/1.5 Arial, sans-serif;
      }
      .confirm-title { margin: 0 0 8px; font-size: 17px; }
      .confirm-message { margin: 0 0 18px; color: #475569; }
      .confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
      .confirm-actions button {
        min-width: 76px;
        padding: 8px 12px;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        background: #fff;
        color: #0f172a;
        font: 600 13px Arial, sans-serif;
        cursor: pointer;
      }
      .confirm-actions button[data-choice="yes"] {
        border-color: #166534;
        background: #166534;
        color: #fff;
      }
      .panel {
        position: fixed;
        top: 48px;
        right: 16px;
        width: min(420px, calc(100vw - 32px));
        height: min(760px, calc(100vh - 64px));
        min-height: 420px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, .2);
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 18px 60px rgba(15, 23, 42, .35);
        pointer-events: auto;
      }
      .panel[hidden] { display: none; }
      iframe {
        width: 100%;
        min-height: 0;
        flex: 1;
        border: 0;
        background: #fff;
      }
      @media (max-width: 560px) {
        .panel { top: 40px; right: 8px; width: calc(100vw - 16px); height: calc(100vh - 48px); }
      }
    `;
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'QTS job tracking');
    const frame = document.createElement('iframe');
    frame.title = 'QTS job tracking';
    frame.allow = 'clipboard-read; clipboard-write';
    panel.append(frame);
    const toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('aria-live', 'polite');
    shadow.append(style, toastHost, panel);
    document.documentElement.append(host);
    host.__qtsPanel = panel;
    host.__qtsFrame = frame;
    host.__qtsToastHost = toastHost;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'QTS_SHOW_PAGE_TOAST') {
      const toastHost = document.getElementById(hostId)?.__qtsToastHost;
      const text = typeof message.message === 'string' ? message.message.trim() : '';
      if (!toastHost || !text) {
        sendResponse({ ok: false, error: 'Page notification could not be displayed.' });
        return false;
      }
      const type = ['success', 'fail', 'error', 'info', 'warn', 'applied', 'new-job'].includes(message.toastType)
        ? message.toastType
        : 'info';
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.dataset.type = type;
      if (typeof message.alertId === 'string') toast.dataset.alertId = message.alertId;
      toast.setAttribute('role', 'alert');
      const textElement = document.createElement('span');
      textElement.className = 'toast-text';
      textElement.textContent = text;
      const close = document.createElement('button');
      close.className = 'toast-close';
      close.type = 'button';
      close.setAttribute('aria-label', 'Dismiss notification');
      close.textContent = '\u00d7';
      close.addEventListener('click', () => toast.remove());
      toast.append(textElement, close);
      toastHost.append(toast);
      while (toastHost.children.length > 8) toastHost.firstElementChild?.remove();
      const duration = Number.isFinite(message.durationMs) && message.durationMs >= 0
        ? message.durationMs
        : 3000;
      if (message.persistUntilCleared !== true) {
        setTimeout(() => toast.remove(), duration);
      }
      if (Number.isFinite(message.closeTabAfterMs) && message.closeTabAfterMs >= 0) {
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'QTS_CLOSE_PAGE_TAB' }).catch((error) => {
            console.warn('Could not close the job tab:', error);
          });
        }, message.closeTabAfterMs);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'QTS_CONFIRM_PAGE') {
      const toastHost = document.getElementById(hostId)?.__qtsToastHost;
      if (!toastHost) {
        sendResponse({ ok: false, error: 'Page confirmation could not be displayed.' });
        return false;
      }
      activeConfirmation?.(false);
      let settled = false;
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.setAttribute('role', 'presentation');
      const card = document.createElement('section');
      card.className = 'confirm-card';
      card.setAttribute('role', 'alertdialog');
      card.setAttribute('aria-modal', 'true');
      const title = document.createElement('h2');
      title.className = 'confirm-title';
      title.textContent = typeof message.title === 'string' ? message.title : 'Please confirm';
      const text = document.createElement('p');
      text.className = 'confirm-message';
      text.textContent = typeof message.message === 'string' ? message.message : '';
      const actions = document.createElement('div');
      actions.className = 'confirm-actions';
      const no = document.createElement('button');
      no.type = 'button';
      no.dataset.choice = 'no';
      no.textContent = 'No';
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.dataset.choice = 'yes';
      yes.textContent = 'Yes';
      actions.append(no, yes);
      card.append(title, text, actions);
      overlay.append(card);
      toastHost.append(overlay);

      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        activeConfirmation = null;
        overlay.remove();
        sendResponse({ ok: true, confirmed });
      };
      activeConfirmation = finish;
      no.addEventListener('click', () => finish(false));
      yes.addEventListener('click', () => finish(true));
      overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') finish(false);
      });
      yes.focus();
      return true;
    }

    if (message?.type === 'QTS_CLEAR_PAGE_ALERT') {
      const toastHost = document.getElementById(hostId)?.__qtsToastHost;
      if (toastHost && typeof message.alertId === 'string') {
        [...toastHost.children]
          .filter((toast) => toast.dataset.alertId === message.alertId)
          .forEach((toast) => toast.remove());
      }
      sendResponse({ ok: true });
      return false;
    }

    if (
      message?.type === 'QTS_SHOW_CAPTURE_PANEL'
      || message?.type === 'QTS_TOGGLE_CAPTURE_PANEL'
    ) {
      const panelHost = document.getElementById(hostId);
      const panel = panelHost?.__qtsPanel;
      const frame = panelHost?.__qtsFrame;
      if (!panel || !frame) {
        sendResponse({ ok: false, error: 'QTS panel could not be initialized.' });
        return false;
      }
      if (message.type === 'QTS_TOGGLE_CAPTURE_PANEL' && !panel.hidden) {
        panel.hidden = true;
        sendResponse({ ok: true, visible: false });
        return false;
      }
      const panelUrl = new URL(chrome.runtime.getURL('popup/popup.html'));
      panelUrl.searchParams.set('tabId', String(message.tabId));
      panelUrl.searchParams.set('embedded', '1');
      if (frame.src !== panelUrl.toString()) frame.src = panelUrl.toString();
      panel.hidden = false;
      sendResponse({ ok: true, visible: true });
      return false;
    }

    if (message?.type === 'QTS_CLOSE_CAPTURE_PANEL') {
      const panelHost = document.getElementById(hostId);
      if (panelHost?.__qtsPanel) panelHost.__qtsPanel.hidden = true;
      sendResponse({ ok: true });
    }
    return false;
  });
})();
