// Injected in MAIN world on chatgpt.com — one-step composer typing (polled from service worker).
(function initChatGptMainHandoff() {
  if (window.__qtsChatGptMainHandoffLoaded) return;
  window.__qtsChatGptMainHandoffLoaded = true;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function walkDom(root, visit) {
    if (!root) return null;
    const hit = visit(root);
    if (hit) return hit;
    const children = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const child of children) {
      const found = visit(child);
      if (found) return found;
      if (child.shadowRoot) {
        const shadowHit = walkDom(child.shadowRoot, visit);
        if (shadowHit) return shadowHit;
      }
    }
    return null;
  }

  function resolveEditable(el) {
    if (!el) return null;
    if (el instanceof HTMLTextAreaElement) return el;
    if (el instanceof HTMLElement && el.isContentEditable) return el;
    const parentEditable = el.closest?.('[contenteditable="true"]');
    if (parentEditable instanceof HTMLElement) return parentEditable;
    const inner = el.querySelector?.('[contenteditable="true"], .ProseMirror, textarea');
    if (inner instanceof HTMLTextAreaElement) return inner;
    if (inner instanceof HTMLElement && inner.isContentEditable) return inner;
    return null;
  }

  function activateComposer() {
    const selectors = [
      '#prompt-textarea',
      '[contenteditable="true"]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const editable = resolveEditable(el);
      if (editable) {
        editable.click();
        editable.focus();
        return editable;
      }
    }

    const askHit = walkDom(document, (el) => {
      if (!(el instanceof HTMLElement) || !isVisible(el)) return null;
      const label = cleanText(el.textContent || '');
      const placeholder = el.getAttribute?.('data-placeholder') || el.getAttribute?.('placeholder') || '';
      if (/ask anything|message chatgpt|ask chatgpt/i.test(`${label} ${placeholder}`)) {
        const editable = resolveEditable(el) || el.closest?.('[contenteditable="true"]');
        if (editable instanceof HTMLElement) return editable;
        el.click();
        return el;
      }
      return null;
    });
    if (askHit instanceof HTMLElement) {
      askHit.focus?.();
      return resolveEditable(askHit) || askHit;
    }

    const candidates = [];
    document.querySelectorAll('[contenteditable="true"], textarea').forEach((el) => {
      if (!isVisible(el)) return;
      if (el.closest('nav, header, aside, [role="navigation"]')) return;
      const rect = el.getBoundingClientRect();
      candidates.push({ el, score: rect.width * rect.height + rect.top });
    });
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]?.el;
    if (best) {
      best.click();
      best.focus?.();
      return resolveEditable(best) || best;
    }
    return null;
  }

  function detectLoginRequired() {
    const loginHit = walkDom(document, (el) => {
      if (!(el instanceof HTMLElement) || !isVisible(el)) return null;
      const label = cleanText(el.textContent || el.getAttribute('aria-label') || '');
      if (/^(log in|sign in|login)$/i.test(label)) return el;
      const href = el.getAttribute?.('href') || '';
      if (/auth\/login|auth\/signin/i.test(href)) return el;
      return null;
    });
    if (loginHit) return true;
    const bodyText = document.body?.innerText || '';
    return !window.__qtsFindChatGptEditor?.() && /log in to chatgpt/i.test(bodyText);
  }

  window.__qtsFindChatGptEditor = function findChatGptEditor() {
    activateComposer();

    const selectors = [
      '#prompt-textarea',
      'div#prompt-textarea',
      'textarea#prompt-textarea',
      '[data-testid="composer-text-input"]',
      'form div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Ask" i]',
      '[contenteditable="true"]',
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        const editable = resolveEditable(el);
        if (editable && isVisible(editable)) return editable;
      } catch {
        // ignore
      }
    }

    const shadowHit = walkDom(document, (el) => {
      if (!(el instanceof HTMLElement)) return null;
      if (el.id === 'prompt-textarea' || el.matches?.('.ProseMirror[contenteditable="true"]')) {
        const editable = resolveEditable(el);
        return editable && isVisible(editable) ? editable : null;
      }
      return null;
    });
    if (shadowHit) return shadowHit;

    const candidates = [];
    document.querySelectorAll('div[contenteditable="true"], textarea').forEach((el) => {
      if (!isVisible(el)) return;
      if (el.closest('nav, header, aside, [role="navigation"]')) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 40) return;
      candidates.push({ el, area: rect.width * rect.height + rect.top * 0.01 });
    });
    candidates.sort((a, b) => b.area - a.area);
    return candidates[0]?.el || null;
  };

  function readEditorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement) return cleanText(editor.value);
    return cleanText(editor.textContent || editor.innerText || '');
  }

  function focusEditor(editor) {
    const target = resolveEditable(editor) || editor;
    try {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      target.scrollIntoView?.();
    }
    target.click?.();
    target.focus?.();
  }

  function insertTextIntoEditor(editor, text) {
    const target = resolveEditable(editor);
    if (!target) return false;
    focusEditor(target);

    if (target instanceof HTMLTextAreaElement) {
      target.value = text;
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      }));
      return readEditorText(target).includes(text.slice(0, 8));
    }

    if (!(target instanceof HTMLElement) || !target.isContentEditable) return false;

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch {
      // ignore
    }

    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }

    if (!ok || !readEditorText(target).includes(text.slice(0, 8))) {
      for (const char of text) {
        try {
          document.execCommand('insertText', false, char);
        } catch {
          // ignore
        }
      }
    }

    if (!readEditorText(target).includes(text.slice(0, 8))) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        target.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: dt,
        }));
      } catch {
        // ignore
      }
    }

    return readEditorText(target).length > 0;
  }

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLButtonElement && isVisible(el) && !el.disabled) return el;
    }
    return null;
  }

  function trySubmit(editor) {
    const target = resolveEditable(editor) || editor;
    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
      if (readEditorText(target) === '') {
        return { sent: true, method: 'main_send_button' };
      }
    }

    focusEditor(target);
    for (const eventType of ['keydown', 'keypress', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(eventType, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }
    if (readEditorText(target) === '') {
      return { sent: true, method: 'main_enter_key' };
    }

    target.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertParagraph',
      bubbles: true,
      cancelable: true,
      composed: true,
    }));
    if (readEditorText(target) === '') {
      return { sent: true, method: 'main_insert_paragraph' };
    }

    return { sent: false, method: 'main_paste_only' };
  }

  window.__qtsRunChatGptMainHandoffStep = function runChatGptMainHandoffStep(text) {
    const shared = window.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff?.(text);
    if (shared) return shared;

    const message = cleanText(text);
    if (!message) {
      return { ok: false, sent: false, fatal: true, error: 'Empty PROCESS_TASK message.', phase: 'empty' };
    }

    if (detectLoginRequired()) {
      return {
        ok: false,
        sent: false,
        fatal: true,
        error: 'Log into ChatGPT in the Custom GPT tab first.',
        phase: 'login_required',
      };
    }

    activateComposer();
    const editor = window.__qtsFindChatGptEditor();
    if (!editor) {
      return { ok: false, sent: false, phase: 'no_editor', error: 'Waiting for ChatGPT composer…' };
    }

    const editable = resolveEditable(editor);
    if (!editable || !(editable instanceof HTMLElement)) {
      return { ok: false, sent: false, phase: 'no_editable', error: 'Composer found but not editable.' };
    }

    const before = readEditorText(editable);
    if (before.includes(message.slice(0, 8))) {
      const submit = trySubmit(editable);
      if (submit.sent) {
        return { ok: true, sent: true, method: submit.method, phase: 'resent' };
      }
      return {
        ok: true,
        sent: false,
        needsManualSend: true,
        method: submit.method,
        phase: 'already_typed',
        editorText: before,
      };
    }

    if (!insertTextIntoEditor(editable, message)) {
      return { ok: false, sent: false, phase: 'insert_failed', error: 'Could not type into ChatGPT composer.' };
    }

    const after = readEditorText(editable);
    if (!after.includes(message.slice(0, 8))) {
      return { ok: false, sent: false, phase: 'insert_failed', error: 'Text did not appear in composer.' };
    }

    const submit = trySubmit(editable);
    if (submit.sent) {
      return { ok: true, sent: true, method: submit.method, phase: 'typed_and_sent' };
    }

    return {
      ok: true,
      sent: false,
      needsManualSend: true,
      method: submit.method,
      phase: 'typed_needs_enter',
      editorText: after,
      message,
    };
  };
})();
