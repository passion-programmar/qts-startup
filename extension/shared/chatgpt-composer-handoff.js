// Shared ChatGPT unified-composer handoff (ProseMirror #prompt-textarea).
// Loaded in content scripts and service worker (importScripts).
(function initQtsChatGptComposerHandoff(global) {
  const HANDOFF_VERSION = 13;
  // How long each send attempt waits for ChatGPT to show the sent message.
  const SEND_CONFIRM_MS = 8000;
  const FALLBACK_CONFIRM_MS = 4000;
  // ChatGPT collapses a long sent message ("Show more"), so a send is recognised by
  // its beginning, which starts with the task marker for Generation.
  const MATCH_PREFIX_LENGTH = 120;
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

    // The newer composer ("Ask ChatGPT") is a textarea; the old one keeps a hidden one named prompt-textarea.
    if (!editors.size) {
      const textareas = document.querySelectorAll(
        'form textarea[name="prompt"], textarea[data-mobile-composer-prompt], textarea#prompt-textarea, form textarea[aria-label*="ChatGPT" i], form textarea[placeholder*="ChatGPT" i]',
      );
      for (const el of textareas) {
        if (el instanceof HTMLTextAreaElement && !el.disabled && isVisible(el)) editors.add(el);
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
    // [data-message-role] is the newer ChatGPT interface (ol[data-conversation-transcript] > li).
    const semanticMessages = [...document.querySelectorAll('[data-message-author-role="assistant"], [data-message-role="assistant"]')];
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
    if (editor instanceof HTMLTextAreaElement) {
      setTextareaValue(editor, '');
      return !readEditorText(editor);
    }
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
    // The newer composer marks its dictation buttons with data attributes and empty labels.
    const dictationData = (btn.getAttributeNames?.() || []).some((name) => /dictation/i.test(name));
    return dictationData || /voice|dictation|microphone|start voice/i.test(label);
  }

  // The newer ChatGPT composer is a plain textarea; React notices a value only through the
  // native setter plus an input event.
  function setTextareaValue(textarea, text) {
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(textarea, text);
    else textarea.value = text;
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: text ? 'insertText' : 'deleteContent',
      data: text || null,
    }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
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
    if (editor instanceof HTMLTextAreaElement) {
      setTextareaValue(editor, text);
      return readEditorText(editor) === cleanText(text);
    }
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
          || (el.getAttribute('type') === 'submit' && editor instanceof HTMLTextAreaElement && form === editor.closest('form'))
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

  // ChatGPT shows a Stop button while it writes; its test id and label change between versions.
  function isGenerating() {
    if (document.querySelector('[data-testid="stop-button"]')) return true;
    return [...document.querySelectorAll('button')].some((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('data-testid') || ''}`;
      return /\bstop\b/i.test(label) && !/dictat|record|voice|listen|audio|shar/i.test(label) && isVisible(button);
    });
  }

  // The sent text shows on the page outside the message box, whatever ChatGPT's message markup is.
  function pageShowsSentText(editor, expectedText) {
    const probe = cleanText(expectedText).slice(0, MATCH_PREFIX_LENGTH);
    if (!probe) return false;
    const count = (text) => text.split(probe).length - 1;
    return count(cleanText(document.body?.innerText || '')) > count(readEditorText(editor));
  }

  function findUserMessages() {
    const selectors = [
      '[data-message-author-role="user"]',
      '[data-message-role="user"]',
      '[data-markdown-text-tone="user-message"]',
      'article[data-turn="user"]',
      '[data-testid*="conversation-turn-user" i]',
      '[data-testid="user-message"]',
    ];
    const messages = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((message) => messages.add(message));
    }
    return [...messages];
  }

  function countUserMessages() {
    return findUserMessages().length;
  }

  function messageContainsExpectedText(message, expectedText) {
    const actual = cleanText(message?.innerText || message?.textContent || '');
    const expected = cleanText(expectedText).slice(0, MATCH_PREFIX_LENGTH);
    return Boolean(actual && expected && actual.includes(expected));
  }

  // The prompt is still in the message box, unsent: safe to try another way of sending it.
  function stillUnsent(editor, initialUserMessageCount, expectedText) {
    return editor.isConnected
      && readEditorText(editor).includes(cleanText(expectedText).slice(0, MATCH_PREFIX_LENGTH))
      && countUserMessages() === initialUserMessageCount
      && !pageShowsSentText(editor, expectedText)
      && !isGenerating();
  }

  function pressEnter(editor) {
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
  }

  /** The sent messages carrying the task's marker, oldest first (the prompt, then any follow-ups). */
  function taskMessages(generationId) {
    const marker = `QTS_GENERATION_ID: ${String(generationId || '').trim()}`;
    if (!/^QTS_GENERATION_ID: [0-9a-f-]{36}$/i.test(marker)) return [];
    return findUserMessages()
      .filter((message) => messageContainsExpectedText(message, marker))
      .sort((left, right) =>
        left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      );
  }

  /**
   * ChatGPT's answer to the task's latest sent message. minimumSent: how many of the task's
   * messages must have been sent, so a follow-up that never left the box is never answered by the
   * reply to the message before it.
   */
  function findAssistantResponseForTask(generationId, minimumSent = 0) {
    const marker = `QTS_GENERATION_ID: ${String(generationId || '').trim()}`;
    if (!/^QTS_GENERATION_ID: [0-9a-f-]{36}$/i.test(marker)) return null;
    const sent = taskMessages(generationId);
    // From a follow-up on: its own sent message is needed. The first prompt may still be found by its text.
    if (minimumSent > 1 && sent.length < minimumSent) return null;
    // The latest message for the task: a follow-up asking for a corrected answer carries the marker too.
    const userMessage = sent.at(-1) || (minimumSent > 1 ? null : findSentTurnByText(marker));
    if (!userMessage) return null;
    const answer = findAssistantMessages()
      .filter((message) => Boolean(
        userMessage.compareDocumentPosition(message)
        & Node.DOCUMENT_POSITION_FOLLOWING,
      ))
      .sort((left, right) =>
        left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )[0];
    if (answer) return answer;
    // Unknown markup: the answer is the conversation turn after the sent one.
    const turn = userMessage.closest?.(TURN_SELECTOR);
    const next = turn?.nextElementSibling;
    return next && !next.querySelector('[contenteditable="true"], textarea') && cleanText(next.innerText) ? next : null;
  }

  const TURN_SELECTOR = 'article, [data-turn], [data-testid^="conversation-turn"], [data-message-author-role], [data-message-role]';

  // The sent message found by its text, when ChatGPT's message markers have changed.
  function findSentTurnByText(marker) {
    if (!document.body || typeof document.createTreeWalker !== 'function') return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let found = null;
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || !walker.currentNode.nodeValue.includes(marker.slice(0, 20))) continue;
      if (parent.closest('[contenteditable="true"], textarea, form')) continue;
      if (!cleanText(parent.closest(TURN_SELECTOR)?.innerText || parent.innerText).includes(marker)) continue;
      found = parent.closest(TURN_SELECTOR) || parent;
    }
    return found;
  }

  async function waitForSubmission(editor, initialUserMessageCount, timeoutMs, expectedText) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const userMessages = findUserMessages();
      const newMessages = userMessages.slice(initialUserMessageCount);
      if (newMessages.some((message) => messageContainsExpectedText(message, expectedText))) {
        return { sent: true, method: 'matching_user_message_added' };
      }
      if (pageShowsSentText(editor, expectedText)) return { sent: true, method: 'sent_text_on_page' };
      if (!readEditorText(editor) && isGenerating()) return { sent: true, method: 'composer_cleared_while_generating' };
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    return null;
  }

  async function trySubmitAsync(editor, initialUserMessageCount, expectedText, timing = {}) {
    const confirmMs = timing.confirmMs ?? SEND_CONFIRM_MS;
    const fallbackMs = timing.fallbackMs ?? FALLBACK_CONFIRM_MS;
    const sendBtn = findSendButton(editor);
    if (sendBtn) {
      sendBtn.click();
      const clickSubmission = await waitForSubmission(
        editor,
        initialUserMessageCount,
        confirmMs,
        expectedText,
      );
      if (clickSubmission) return clickSubmission;

      // The click did not take: the prompt is still waiting in the box, so Enter sends it.
      if (stillUnsent(editor, initialUserMessageCount, expectedText)) {
        pressEnter(editor);
        const enterSubmission = await waitForSubmission(editor, initialUserMessageCount, fallbackMs, expectedText);
        if (enterSubmission) return { ...enterSubmission, method: `enter_${enterSubmission.method}` };
      }

      const form = editor.closest('form[data-chatgpt-composer], form[data-type="unified-composer"]')
        || editor.closest('form');
      if (
        stillUnsent(editor, initialUserMessageCount, expectedText)
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
        const formSubmission = await waitForSubmission(
          editor,
          initialUserMessageCount,
          fallbackMs,
          expectedText,
        );
        if (formSubmission) {
          return { ...formSubmission, method: `form_${formSubmission.method}` };
        }
      }

      // The box emptied and ChatGPT is answering: the message went, even if it is not shown yet.
      if (!readEditorText(editor) && isGenerating()) {
        return { sent: true, method: 'composer_cleared_while_generating' };
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

    pressEnter(editor);
    return await waitForSubmission(editor, initialUserMessageCount, confirmMs, expectedText)
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
    // retype: the box may show the prompt while ChatGPT's page code, still loading, never saw it.
    const shown = readEditorText(editor);
    const before = options.retype && shown === message && clearComposer(editor) ? '' : shown;
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
    const submit = await trySubmitAsync(editor, initialUserMessageCount, message, options.timing);
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
    findUserMessages,
    findAssistantResponseForTask,
    countTaskMessages: (generationId) => taskMessages(generationId).length,
    isGenerating,
    insertIntoProseMirror,
    activateComposer,
    readEditorText,
  };
  if (typeof module === 'object' && module.exports) {
    module.exports = global.__qtsChatGptComposerHandoff;
  }
})(typeof self !== 'undefined' ? self : window);
