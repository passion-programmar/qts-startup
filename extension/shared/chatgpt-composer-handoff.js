// Shared ChatGPT unified-composer handoff (ProseMirror #prompt-textarea).
// Loaded in content scripts and service worker (importScripts).
(function initQtsChatGptComposerHandoff(global) {
  const HANDOFF_VERSION = 6;
  if (global.__qtsChatGptComposerHandoff?.version === HANDOFF_VERSION) return;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el?.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 24 && rect.height > 8;
  }

  function readEditorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement) return cleanText(editor.value);
    return cleanText(editor.textContent || editor.innerText || '');
  }

  function findUnifiedComposerEditor(expectedText = '') {
    const selectors = [
      'div.ProseMirror[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]',
      'div[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]',
      'div.ProseMirror[contenteditable="true"][role="textbox"]',
      'div#prompt-textarea.ProseMirror[contenteditable="true"]',
      '#thread-bottom div#prompt-textarea[contenteditable="true"]',
      'form[data-type="unified-composer"] div[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]#prompt-textarea',
    ];
    const editors = new Set();
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const el of nodes) {
        if (el instanceof HTMLElement && el.isContentEditable && isVisible(el)) {
          editors.add(el);
        }
      }
    }

    const placeholder = document.querySelector(
      'p[data-placeholder="Ask anything"], p.placeholder[data-empty-paragraph="true"]'
    );
    if (placeholder instanceof HTMLElement) {
      const editable = placeholder.closest('[contenteditable="true"]');
      if (editable instanceof HTMLElement && editable.isContentEditable && isVisible(editable)) {
        editors.add(editable);
      }
    }

    if (!editors.size) return null;

    const candidates = [...editors];
    const promptPrefix = cleanText(expectedText).slice(0, 32);
    if (promptPrefix) {
      const matchingEditor = candidates.find((editor) => readEditorText(editor).includes(promptPrefix));
      if (matchingEditor) return matchingEditor;
    }

    const editorWithSendButton = candidates.find((editor) => findSendButton(editor));
    return editorWithSendButton || candidates[candidates.length - 1];
  }

  function findAssistantMessages() {
    const semanticMessages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (semanticMessages.length) return semanticMessages;
    return [...document.querySelectorAll('[data-markdown-text-style="assistant-message"]')];
  }

  function activateComposer(editor) {
    const surface = editor.closest('[data-composer-surface="true"]');
    if (surface instanceof HTMLElement) {
      surface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      surface.click();
    }

    const placeholder = editor.querySelector(
      'p[data-placeholder="Ask anything"], p.placeholder[data-empty-paragraph="true"], p[data-empty-paragraph]'
    );
    if (placeholder instanceof HTMLElement) {
      placeholder.click();
    }

    editor.scrollIntoView({ block: 'center', behavior: 'auto' });
    editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    editor.click();
    editor.focus();

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      const para = editor.querySelector('p') || editor;
      range.selectNodeContents(para);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {
      // ignore
    }
  }

  function dispatchInput(editor, text, inputType) {
    const before = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType,
      data: text,
    });
    editor.dispatchEvent(before);
    if (!before.defaultPrevented) {
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType,
        data: text,
      }));
    }
  }

  function clearComposer(editor) {
    activateComposer(editor);
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch {
      // Continue to the fallback textarea and verify the editor was cleared.
    }
    dispatchInput(editor, '', 'deleteContent');
    if (!readEditorText(editor)) return true;

    const form = editor.closest('form[data-type="unified-composer"]');
    const fallback = form?.querySelector('textarea[name="prompt-textarea"]');
    if (fallback instanceof HTMLTextAreaElement) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) nativeSetter.call(fallback, '');
      else fallback.value = '';
      fallback.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'deleteContent',
        data: null,
      }));
      fallback.dispatchEvent(new Event('change', { bubbles: true }));
    }
    editor.focus();
    return !readEditorText(editor);
  }

  function syncFallbackTextarea(editor, text) {
    const form = editor.closest('form[data-type="unified-composer"]');
    const fallback = form?.querySelector('textarea[name="prompt-textarea"]');
    if (!(fallback instanceof HTMLTextAreaElement)) return false;
    fallback.value = text;
    fallback.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text,
    }));
    fallback.dispatchEvent(new Event('change', { bubbles: true }));
    return readEditorText(editor).includes(text.slice(0, 8)) || fallback.value.includes(text.slice(0, 8));
  }

  function isVoiceOrDictationButton(btn) {
    if (!(btn instanceof HTMLButtonElement)) return false;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    return /voice|dictation|microphone|start voice/i.test(label);
  }

  function insertViaFallbackTextarea(editor, text) {
    const form = editor.closest('form[data-type="unified-composer"]');
    const fallback = form?.querySelector('textarea[name="prompt-textarea"]');
    if (!(fallback instanceof HTMLTextAreaElement)) return false;

    activateComposer(editor);
    fallback.focus();

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(fallback, text);
    } else {
      fallback.value = text;
    }

    fallback.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text,
    }));
    fallback.dispatchEvent(new Event('change', { bubbles: true }));

    editor.focus();
  }

  function typeLikeUser(editor, text) {
    activateComposer(editor);
    const target = editor;
    target.focus();
    for (const ch of text) {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true, cancelable: true, composed: true,
      }));
      try {
        document.execCommand('insertText', false, ch);
      } catch {
        // ignore
      }
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true, composed: true, inputType: 'insertText', data: ch,
      }));
      target.dispatchEvent(new KeyboardEvent('keyup', {
        key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true, composed: true,
      }));
    }
  }

  function insertCharByChar(editor, text) {
    activateComposer(editor);
    editor.focus();
    typeLikeUser(editor, text);
    for (const ch of text) {
      try {
        document.execCommand('insertText', false, ch);
      } catch {
        // ignore
      }
    }
  }

  function insertIntoProseMirror(editor, text) {
    if (!(editor instanceof HTMLElement) || !editor.isContentEditable) return false;
    activateComposer(editor);

    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    insertViaFallbackTextarea(editor, text);
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      if (document.execCommand('insertText', false, text)) {
        if (readEditorText(editor).includes(text.slice(0, 8))) return true;
      }
    } catch {
      // ignore
    }

    dispatchInput(editor, text, 'insertText');
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    dispatchInput(editor, text, 'insertFromPaste');
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dt,
      }));
    } catch {
      // ignore
    }
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    const para = editor.querySelector('p');
    if (para instanceof HTMLElement) {
      while (para.firstChild) para.removeChild(para.firstChild);
      para.appendChild(document.createTextNode(text));
      para.removeAttribute('data-empty-paragraph');
      para.classList.remove('placeholder');
      dispatchInput(editor, text, 'insertText');
      if (readEditorText(editor).includes(text.slice(0, 8))) return true;
    }

    insertCharByChar(editor, text);
    if (readEditorText(editor).includes(text.slice(0, 8))) return true;

    return syncFallbackTextarea(editor, text);
  }

  function findSendButton(editor) {
    const form = editor?.closest('form[data-chatgpt-composer], form[data-type="unified-composer"]')
      || editor?.closest('form')
      || document.querySelector('form[data-chatgpt-composer], form[data-type="unified-composer"]');
    const scope = form || document;
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[type="submit"]',
      'button.composer-submit-button-color',
    ];
    for (const selector of selectors) {
      const nodes = scope.querySelectorAll(selector);
      for (const el of nodes) {
        if (!(el instanceof HTMLButtonElement) || !isVisible(el) || el.disabled) continue;
        if (isVoiceOrDictationButton(el)) continue;
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        if (
          label.includes('send')
          || el.getAttribute('data-testid') === 'send-button'
          || (el.getAttribute('type') === 'submit' && form?.matches('[data-chatgpt-composer], [data-type="unified-composer"]'))
        ) {
          return el;
        }
      }
    }
    return null;
  }

  function spinWait(testFn, maxMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (testFn()) return true;
    }
    return testFn();
  }

  function trySubmit(editor) {
    let submitAttempted = false;
    spinWait(() => Boolean(findSendButton(editor)), 3000);
    const sendBtn = findSendButton(editor);
    if (sendBtn) {
      submitAttempted = true;
      sendBtn.click();
      spinWait(() => readEditorText(editor) === '', 2000);
      if (readEditorText(editor) === '') {
        return { sent: true, method: 'unified_send_button', submitAttempted: true };
      }
    }

    editor.focus();
    submitAttempted = true;
    for (const eventType of ['keydown', 'keypress', 'keyup']) {
      editor.dispatchEvent(new KeyboardEvent(eventType, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }

    spinWait(() => readEditorText(editor) === '', 1000);
    if (readEditorText(editor) === '') {
      return { sent: true, method: 'unified_enter_key', submitAttempted: true };
    }

    const form = editor.closest('form[data-type="unified-composer"]');
    if (form instanceof HTMLFormElement && typeof form.requestSubmit === 'function') {
      submitAttempted = true;
      form.requestSubmit();
      spinWait(() => readEditorText(editor) === '', 1000);
      if (readEditorText(editor) === '') {
        return { sent: true, method: 'unified_form_submit', submitAttempted: true };
      }
    }

    return { sent: false, method: 'unified_needs_manual_send', submitAttempted };
  }

  function isGenerating() {
    return Boolean(
      document.querySelector('[data-testid="stop-button"]')
      || [...document.querySelectorAll('button')].some((button) =>
        /stop generating|stop streaming/i.test(button.getAttribute('aria-label') || '')
      )
    );
  }

  function countUserMessages() {
    const selectors = [
      '[data-message-author-role="user"]',
      '[data-markdown-text-tone="user-message"]',
      'article[data-turn="user"]',
      '[data-testid*="conversation-turn-user" i]',
      '[data-testid="user-message"]',
    ];
    const messages = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((message) => messages.add(message));
    }
    return messages.size;
  }

  async function waitForSubmission(editor, initialUserMessageCount, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (isGenerating()) return { sent: true, method: 'chatgpt_generating' };
      if (countUserMessages() > initialUserMessageCount) {
        return { sent: true, method: 'user_message_added' };
      }
      if (editor?.isConnected && !readEditorText(editor)) {
        return { sent: true, method: 'composer_cleared' };
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return null;
  }

  async function trySubmitAsync(editor, initialUserMessageCount) {
    const sendBtn = findSendButton(editor);
    if (sendBtn) {
      sendBtn.click();
      const clickSubmission = await waitForSubmission(editor, initialUserMessageCount, 1500);
      if (clickSubmission) return clickSubmission;

      const form = editor.closest('form[data-chatgpt-composer], form[data-type="unified-composer"]')
        || editor.closest('form');
      if (
        editor.isConnected
        && readEditorText(editor)
        && countUserMessages() === initialUserMessageCount
        && !isGenerating()
        && form instanceof HTMLFormElement
        && typeof form.requestSubmit === 'function'
      ) {
        try {
          form.requestSubmit(sendBtn);
        } catch (error) {
          console.warn('[QTS Scanner] ChatGPT form submission fallback failed:', error);
          try {
            form.requestSubmit();
          } catch (fallbackError) {
            console.warn('[QTS Scanner] ChatGPT form submission without a button failed:', fallbackError);
          }
        }
        const formSubmission = await waitForSubmission(editor, initialUserMessageCount, 3000);
        if (formSubmission) {
          return { ...formSubmission, method: `form_${formSubmission.method}` };
        }
      }

      return {
        sent: false,
        method: 'send_uncertain',
        submitAttempted: true,
        sendButtonFound: true,
        sendButtonLabel: sendBtn.getAttribute('aria-label') || '',
        sendButtonType: sendBtn.getAttribute('type') || '',
      };
    }

    editor.focus();
    for (const eventType of ['keydown', 'keypress', 'keyup']) {
      editor.dispatchEvent(new KeyboardEvent(eventType, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }
    return await waitForSubmission(editor, initialUserMessageCount, 3000)
      || {
        sent: false,
        method: 'manual_send_required',
        submitAttempted: true,
        sendButtonFound: false,
      };
  }

  async function runUnifiedComposerHandoffAsync(text, options = {}) {
    const message = cleanText(text);
    if (!message) {
      return { ok: false, sent: false, phase: 'empty', error: 'Empty message.' };
    }

    const editor = findUnifiedComposerEditor(message);
    if (!editor) {
      return {
        ok: false,
        sent: false,
        phase: 'no_editor',
        error: 'Waiting for ChatGPT composer…',
        pageUrl: location.href,
      };
    }

    const prefix = message.slice(0, 8);
    const before = readEditorText(editor);
    if (before && before !== message && !clearComposer(editor)) {
      return {
        ok: false,
        sent: false,
        phase: 'clear_failed',
        error: 'Could not clear the existing ChatGPT draft; the Scanner prompt was not sent.',
        editorText: before,
        pageUrl: location.href,
      };
    }
    if (before !== message && !insertIntoProseMirror(editor, message)) {
      return {
        ok: false,
        sent: false,
        phase: 'insert_failed',
        error: 'Could not type into ProseMirror composer.',
        pageUrl: location.href,
        editorText: readEditorText(editor),
      };
    }

    const after = readEditorText(editor);
    if (after !== message) {
      return {
        ok: false,
        sent: false,
        phase: 'insert_failed',
        error: 'The complete Scanner prompt did not appear in the ChatGPT composer.',
        pageUrl: location.href,
        editorText: after,
      };
    }

    const initialUserMessageCount = countUserMessages();
    if (typeof options.onSending === 'function') {
      try {
        await options.onSending();
      } catch (error) {
        console.warn('[QTS Scanner] Could not show the sending progress update:', error);
      }
    }
    const submit = await trySubmitAsync(editor, initialUserMessageCount);
    if (!submit.sent) {
      return {
        ok: true,
        sent: false,
        needsManualSend: true,
        method: submit.method,
        phase: 'typed_needs_send',
        submitAttempted: Boolean(submit.submitAttempted),
        sendButtonFound: Boolean(submit.sendButtonFound),
        sendButtonLabel: submit.sendButtonLabel || '',
        sendButtonType: submit.sendButtonType || '',
        editorText: readEditorText(editor),
        pageUrl: location.href,
      };
    }

    return {
      ok: true,
      sent: true,
      method: submit.method,
      phase: 'typed_and_sent',
      submitAttempted: true,
      pageUrl: location.href,
    };
  }

  function runUnifiedComposerHandoff(text) {
    const message = cleanText(text);
    if (!message) {
      return { ok: false, sent: false, phase: 'empty', error: 'Empty message.' };
    }

    const editor = findUnifiedComposerEditor();
    if (!editor) {
      return {
        ok: false,
        sent: false,
        phase: 'no_editor',
        error: 'Waiting for ChatGPT composer…',
        pageUrl: location.href,
      };
    }

    const prefix = message.slice(0, 8);
    const before = readEditorText(editor);
    if (before && before !== message && !clearComposer(editor)) {
      return {
        ok: false,
        sent: false,
        phase: 'clear_failed',
        error: 'Could not clear the existing ChatGPT draft; the Scanner prompt was not sent.',
        editorText: before,
        pageUrl: location.href,
      };
    }
    if (before !== message) {
      if (!insertIntoProseMirror(editor, message)) {
        return {
          ok: false,
          sent: false,
          phase: 'insert_failed',
          error: 'Could not type into ProseMirror composer.',
          pageUrl: location.href,
          editorText: readEditorText(editor),
        };
      }
    }

    const after = readEditorText(editor);
    if (after !== message) {
      return {
        ok: false,
        sent: false,
        phase: 'insert_failed',
        error: 'The complete Scanner prompt did not appear in the ChatGPT composer.',
        pageUrl: location.href,
        editorText: after,
      };
    }

    const submit = trySubmit(editor);
    if (submit.sent) {
      spinWait(() => readEditorText(editor) === '', 2500);
      return {
        ok: true,
        sent: true,
        method: submit.method,
        phase: 'typed_and_sent',
        submitAttempted: true,
        pageUrl: location.href,
      };
    }

    return {
      ok: true,
      sent: false,
      needsManualSend: true,
      method: submit.method,
      phase: 'typed_needs_enter',
      submitAttempted: Boolean(submit.submitAttempted),
      editorText: after,
      pageUrl: location.href,
    };
  }

  global.__qtsChatGptComposerHandoff = {
    version: HANDOFF_VERSION,
    runUnifiedComposerHandoff,
    runUnifiedComposerHandoffAsync,
    findUnifiedComposerEditor,
    findAssistantMessages,
    insertIntoProseMirror,
    activateComposer,
    readEditorText,
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = global.__qtsChatGptComposerHandoff;
  }
})(typeof self !== 'undefined' ? self : window);
