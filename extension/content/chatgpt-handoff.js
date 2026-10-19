// Injected on chatgpt.com — experimental PROCESS_TASK composer handoff (manual Action approval).
(function initChatGptHandoff() {
  if (window.__qtsChatGptHandoffLoaded) return;
  window.__qtsChatGptHandoffLoaded = true;
  const ALLOW_LABELS = /^(allow|always allow|confirm|run|approve|yes|continue)$/i;

  function isAllowLabel(label) {
    const text = cleanText(label).toLowerCase();
    if (!text || text.length > 64) return false;
    if (/\bdeny\b/i.test(text)) return false;
    if (/always allow/.test(text)) return true;
    if (/\ballow\b/i.test(text)) return true;
    if (ALLOW_LABELS.test(text)) return true;
    return false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseTaskId(message) {
    const match = String(message || '').match(/task_[\w-]+/i);
    return match ? match[0] : null;
  }

  function getClickableLabel(el) {
    if (!el) return '';
    return cleanText(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  }

  function isExcludedStarterZone(el) {
    return Boolean(el.closest(
      'nav, header, footer, aside, [role="navigation"], form, [data-testid="profile-button"]'
    ));
  }

  function resolveClickTarget(el) {
    if (!el) return null;
    const direct = el.closest('button, [role="button"], a, [tabindex="0"]');
    if (direct && isVisible(direct)) return direct;
    if (el.matches('button, [role="button"], a, [tabindex="0"]') && isVisible(el)) return el;
    return isVisible(el) ? el : null;
  }

  function starterMatchesLabel(label, taskId, message) {
    const text = label.toLowerCase();
    if (!text) return false;
    const full = cleanText(message).toLowerCase();
    if (taskId && text === taskId.toLowerCase()) return true;
    if (full && text === full) return true;
    if (taskId && text.includes(taskId.toLowerCase())) return true;
    if (full && text.includes(full)) return true;
    if (taskId) {
      const num = taskId.replace(/^task_/, '');
      if (num && (text === num || text.includes(`session ${num}`) || text.includes(`application id ${num}`))) {
        return true;
      }
    }
    return /^process_task:\s*task_[\w-]+$/i.test(text);
  }

  function findExactTextStarter(taskId) {
    if (!taskId) return null;
    const tid = taskId.toLowerCase();
    const matches = [];
    document.querySelectorAll('button, [role="button"], a, div, span').forEach((el) => {
      if (!isVisible(el) || isExcludedStarterZone(el)) return;
      const label = getClickableLabel(el);
      if (label.toLowerCase() !== tid) return;
      const target = resolveClickTarget(el);
      if (target) matches.push({ el: target, label, size: label.length });
    });
    matches.sort((a, b) => a.size - b.size);
    return matches[0]?.el || null;
  }

  function scoreStarter(el, label, taskId) {
    let score = 10;
    const text = label.toLowerCase();
    const tid = (taskId || '').toLowerCase();
    if (tid && text === tid) score += 100;
    if (/^process_task:/i.test(label)) score += 60;
    if (el.matches('button')) score += 20;
    if (el.getAttribute('role') === 'button') score += 15;
    if (el.closest('main, [role="main"], #thread, [class*="thread" i]')) score += 10;
    if (isExcludedStarterZone(el)) score -= 100;
    return score;
  }

  function findConversationStarter(taskId, message) {
    const exact = findExactTextStarter(taskId);
    if (exact) return exact;

    if (!taskId && !message) return null;
    const candidates = new Set();
    ['button', '[role="button"]', 'a', '[tabindex="0"]', '[data-testid*="conversation" i]'].forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => candidates.add(el));
      } catch {
        // ignore
      }
    });

    const matches = [];
    for (const raw of candidates) {
      const el = resolveClickTarget(raw);
      if (!el || !isVisible(el) || isExcludedStarterZone(el)) continue;
      const label = getClickableLabel(el);
      if (!starterMatchesLabel(label, taskId, message)) continue;
      matches.push({ el, label, score: scoreStarter(el, label, taskId) });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches[0]?.el || null;
  }

  function clickElement(el) {
    const target = resolveClickTarget(el) || el;
    try {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      target.scrollIntoView();
    }
    target.focus?.();
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (typeof target.click === 'function') target.click();
  }

  function visitAllRoots(visitor) {
    const seen = new Set();
    const walk = (root, depth = 0) => {
      if (!root || seen.has(root) || depth > 4) return;
      seen.add(root);
      visitor(root);
      if (depth >= 4) return;
      try {
        root.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
        });
      } catch {
        // ignore
      }
    };
    walk(document);
  }

  function taskPatternForId(taskId, message) {
    const tid = cleanText(taskId || parseTaskId(message) || '');
    if (!tid) return null;
    const escaped = tid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`PROCESS_TASK:\\s*${escaped}`, 'i');
  }

  const GPT_SUBMIT_LOCK_MS = 45000;

  function getUserChatNodes() {
    return document.querySelectorAll(
      '[data-message-author-role="user"],' +
      'article[data-turn="user"],' +
      '[data-testid*="conversation-turn-user"],' +
      '[data-testid="user-message"],' +
      'div[data-message-id][data-message-author-role="user"]'
    );
  }

  function countTaskMessagesInChat(taskId, message) {
    const pattern = taskPatternForId(taskId, message);
    if (!pattern) return 0;

    const editor = findPromptEditor();
    const composerText = readEditorText(editor);
    if (composerText && pattern.test(composerText)) return 0;

    let count = 0;
    for (const node of getUserChatNodes()) {
      if (pattern.test(cleanText(node.innerText || ''))) count += 1;
    }
    return count;
  }

  function taskMessageInChatHistory(taskId, message) {
    return countTaskMessagesInChat(taskId, message) >= 1;
  }

  function lockTaskSubmit(taskId) {
    const tid = cleanText(taskId || '');
    if (!tid) return;
    if (!window.__qtsGptSubmitLockedAt) window.__qtsGptSubmitLockedAt = {};
    window.__qtsGptSubmitLockedAt[tid] = Date.now();
  }

  function isTaskSubmitLocked(taskId) {
    const tid = cleanText(taskId || '');
    if (!tid || !window.__qtsGptSubmitLockedAt) return false;
    const at = window.__qtsGptSubmitLockedAt[tid];
    return Boolean(at && Date.now() - at < GPT_SUBMIT_LOCK_MS);
  }

  function handoffStepAttemptedSubmit(stepResult) {
    return Boolean(
      stepResult?.sent
      || stepResult?.submitAttempted
      || stepResult?.phase === 'typed_and_sent'
      || stepResult?.phase === 'typed_needs_enter'
      || stepResult?.needsManualSend
    );
  }

  function composerHasTaskMessage(taskId, message) {
    const pattern = taskPatternForId(taskId, message);
    if (!pattern) return false;
    const editor = findPromptEditor();
    const composerText = readEditorText(editor);
    return Boolean(composerText && pattern.test(composerText));
  }

  async function waitForTaskInChat(taskId, message, timeoutMs = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (taskMessageInChatHistory(taskId, message)) return true;
      await sleep(250);
    }
    return taskMessageInChatHistory(taskId, message);
  }

  function finishSuccessfulSend(tid, text, method, extra = {}) {
    markTaskSentInPage(tid, text);
    showGptLiveStatus({
      phase: 'allowing',
      taskId: tid,
      message: 'PROCESS_TASK sent — watching for GPT Actions…',
      type: 'warn',
    });
    return { ok: true, sent: true, method, taskId: tid, ...extra };
  }

  function markTaskSentInPage(taskId, message) {
    const tid = cleanText(taskId || '');
    if (!tid || !taskMessageInChatHistory(tid, message)) return;
    if (!window.__qtsGptSentTaskIds) {
      window.__qtsGptSentTaskIds = new Set();
    }
    window.__qtsGptSentTaskIds.add(tid);
  }

  const handoffInFlightByTask = new Map();

  function domOrderScore(el) {
    const rect = el.getBoundingClientRect();
    return rect.top * 10000 + rect.left;
  }

  function isGptTaskSavedConfirmation(bodyText) {
    const text = cleanText(bodyText);
    if (!text) return false;
    if (/task\s+task_[\w-]+\s+saved/i.test(text)) return true;
    if (/Extension will apply answers/i.test(text)) return true;
    return /(?:^|\n)\s*Confirmed\.?\s*(?:\n|$)/im.test(text);
  }

  function scrapePageState() {
    const bodyText = cleanText(document.body?.innerText || '');
    return {
      hasApprovalDialog: /wants to talk to/i.test(bodyText),
      hasGetTaskContext: /getTaskContext/i.test(bodyText),
      hasSubmitTaskPackage: /submitTaskPackage/i.test(bodyText),
      taskSaved: isGptTaskSavedConfirmation(bodyText),
      thinking: /\bThinking\b/i.test(bodyText),
      stoppedThinking: /Stopped thinking/i.test(bodyText),
      snippet: bodyText.slice(0, 600),
    };
  }

  function findAllowButtons() {
    const matches = [];
    visitAllRoots((root) => {
      root.querySelectorAll('button, [role="button"], a, div[tabindex="0"]').forEach((el) => {
        if (!isVisible(el)) return;
        const label = getClickableLabel(el);
        if (!label || label.length > 64) return;
        if (!isAllowLabel(label)) return;
        if (el.closest('nav, header, footer')) return;
        let score = 10;
        if (/always allow/i.test(label)) score += 30;
        if (/^allow$/i.test(label)) score += 40;
        if (el.closest('[role="dialog"], [class*="modal" i], [class*="popover" i], [class*="layer" i]')) score += 35;
        if (/wants to talk to/i.test(el.parentElement?.innerText || '')) score += 25;
        matches.push({ el, label, score, order: domOrderScore(el) });
      });
    });
    matches.sort((a, b) => b.order - a.order || b.score - a.score);
    return matches.map((m) => m.el);
  }

  function clickAllowButtons() {
    const buttons = findAllowButtons();
    if (!buttons.length) {
      return { clicked: 0, labels: [], allowButtonCount: 0, allowClicked: false, ...scrapePageState() };
    }
    const btn = buttons[0];
    clickElement(btn);
    const label = getClickableLabel(btn);
    return {
      clicked: 1,
      labels: [label],
      allowClicked: true,
      clickedLabel: label,
      allowButtonCount: buttons.length,
      ...scrapePageState(),
    };
  }

  let allowAutoWatchActive = false;
  let allowAutoWatchObserver = null;
  let allowAutoWatchTimer = null;

  function stopAllowAutoWatch() {
    allowAutoWatchActive = false;
    if (allowAutoWatchTimer) {
      clearTimeout(allowAutoWatchTimer);
      allowAutoWatchTimer = null;
    }
    try {
      allowAutoWatchObserver?.disconnect();
    } catch {
      // ignore
    }
    allowAutoWatchObserver = null;
  }

  function scheduleAllowAutoClick() {
    if (!allowAutoWatchActive) return;
    if (allowAutoWatchTimer) clearTimeout(allowAutoWatchTimer);
    allowAutoWatchTimer = setTimeout(() => {
      allowAutoWatchTimer = null;
      if (!allowAutoWatchActive) return;
      const result = clickAllowButtons();
      if (result.clicked > 0) {
        chrome.runtime.sendMessage({
          type: 'GPT_ALLOW_AUTO_CLICKED',
          ...result,
        }).catch(() => {});
      }
    }, 350);
  }

  function startAllowAutoWatch() {
    if (allowAutoWatchActive) return { ok: true, already: true };
    allowAutoWatchActive = true;
    scheduleAllowAutoClick();
    const observeRoot = document.body || document.documentElement;
    allowAutoWatchObserver = new MutationObserver(scheduleAllowAutoClick);
    allowAutoWatchObserver.observe(observeRoot, {
      childList: true,
      subtree: true,
    });
    return { ok: true, started: true };
  }

  async function clickConversationStarter(taskId, message) {
    const tid = taskId || parseTaskId(message);
    const msg = cleanText(message) || (tid ? `PROCESS_TASK: ${tid}` : '');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const starter = findConversationStarter(tid, msg);
      if (starter) {
        clickElement(starter);
        await sleep(800);
        return {
          ok: true,
          sent: true,
          attempt,
          method: 'conversation_starter',
          label: getClickableLabel(starter),
          taskId: tid,
        };
      }
      await sleep(350);
    }
    return { ok: false, sent: false, taskId: tid, found: false };
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

  function isConnectedVisible(el) {
    if (!el || !el.isConnected || el.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 40 && rect.height > 12;
  }

  function findPromptEditor() {
    const selectors = [
      'div#prompt-textarea[contenteditable="true"]',
      '#prompt-textarea',
      'div[contenteditable="true"][data-id]',
      'div[role="textbox"][contenteditable="true"]',
      '[data-testid="message-input"]',
      '[data-testid="composer-text-input"]',
      'form[data-type="unified-composer"] [contenteditable="true"]',
      'form div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'main div[contenteditable="true"]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Message" i]',
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        const editable = resolveEditable(el);
        if (editable && isConnectedVisible(editable)) return editable;
      } catch {
        // ignore
      }
    }

    const positioned = [];
    document.querySelectorAll('div[contenteditable="true"], textarea').forEach((el) => {
      if (!isConnectedVisible(el)) return;
      if (el.closest('nav, header, aside, [role="navigation"]')) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < window.innerHeight * 0.45) return;
      positioned.push({ el, score: rect.bottom * 2 + rect.width });
    });
    positioned.sort((a, b) => b.score - a.score);
    if (positioned[0]?.el) return resolveEditable(positioned[0].el) || positioned[0].el;

    const askNode = Array.from(document.querySelectorAll('p, div, span')).find((node) => (
      /ask anything|message chatgpt|ask chatgpt/i.test(String(node.textContent || node.getAttribute?.('data-placeholder') || ''))
    ));
    if (askNode instanceof HTMLElement) {
      askNode.click();
      const editable = resolveEditable(askNode) || askNode.closest?.('[contenteditable="true"]');
      if (editable instanceof HTMLElement) return editable;
    }

    return null;
  }

  function activateComposer() {
    const editor = findPromptEditor();
    if (!editor) return null;
    try {
      editor.scrollIntoView({ block: 'center', behavior: 'auto' });
    } catch {
      editor.scrollIntoView?.();
    }
    editor.click();
    editor.focus();
    return editor;
  }

  async function runHandoffStep(text) {
    const message = cleanText(text);
    if (!message) return { ok: false, sent: false, phase: 'empty', error: 'Empty message.' };

    const runUnified = window.__qtsChatGptComposerHandoff?.runUnifiedComposerHandoff;
    if (!runUnified) {
      return { ok: false, sent: false, phase: 'no_module', error: 'Composer handoff module not loaded.' };
    }

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = runUnified(message);
      if (result?.submitAttempted || result?.sent) {
        lockTaskSubmit(parseTaskId(message));
      }
      if (result?.phase !== 'no_editor') return result;
      await sleep(300);
    }

    return { ok: false, sent: false, phase: 'no_editor', error: 'Waiting for ChatGPT composer…' };
  }

  const GPT_STATUS_HOST_ID = 'qts-gpt-status-host';
  const GPT_STATUS_STYLE_ID = 'qts-gpt-status-style';
  const GPT_STATUS_FINISH_MS = 4500;

  const GPT_PIPELINE_STEPS = [
    { id: 'loaded', label: 'Page loaded successfully' },
    { id: 'scraping', label: 'Scanning page' },
    { id: 'typing', label: 'Typing PROCESS_TASK' },
    { id: 'sending', label: 'Sending message' },
    { id: 'allowing', label: 'Allowing Actions' },
    { id: 'finished', label: 'Task finished' },
  ];

  const SCANNER_PIPELINE_STEPS = [
    { id: 'scanner-opening', label: 'Opening ChatGPT' },
    { id: 'scanner-composer', label: 'Waiting for ChatGPT composer' },
    { id: 'scanner-typing', label: 'Typing Scanner prompt' },
    { id: 'scanner-sending', label: 'Sending prompt' },
    { id: 'scanner-generating', label: 'Waiting for ChatGPT response' },
    { id: 'scanner-reading', label: 'Reading response' },
    { id: 'scanner-saving', label: 'Saving answer package' },
    { id: 'scanner-complete', label: 'Answer package saved' },
  ];

  const GPT_PHASE_STEP_INDEX = {
    loading: 0,
    loaded: 0,
    scraping: 1,
    typing: 2,
    sending: 3,
    allowing: 4,
    thinking: 4,
    running: 4,
    finished: 5,
    error: -1,
    'scanner-opening': 0,
    'scanner-composer': 1,
    'scanner-typing': 2,
    'scanner-sending': 3,
    'scanner-generating': 4,
    'scanner-reading': 5,
    'scanner-saving': 6,
    'scanner-complete': 7,
  };

  const GPT_STATUS_PHASES = {
    loading: { message: 'Loading Custom GPT…', type: 'info', label: 'Loading' },
    loaded: { message: 'Page loaded successfully', type: 'info', label: 'Ready' },
    scraping: { message: 'Scanning page…', type: 'info', label: 'Scanning' },
    typing: { message: 'Typing PROCESS_TASK…', type: 'info', label: 'Typing' },
    sending: { message: 'Sending message…', type: 'info', label: 'Sending' },
    allowing: { message: 'Waiting for Action approval…', type: 'warn', label: 'Allowing' },
    thinking: { message: 'Custom GPT is thinking…', type: 'info', label: 'Thinking' },
    running: { message: 'Running GPT Actions…', type: 'info', label: 'Running' },
    finished: { message: 'Task finished successfully', type: 'success', label: 'Done' },
    error: { message: 'Task failed', type: 'error', label: 'Error' },
    'scanner-opening': { message: 'Opening ChatGPT…', type: 'info', label: 'Scanner' },
    'scanner-composer': { message: 'Waiting for ChatGPT composer…', type: 'info', label: 'Scanner' },
    'scanner-typing': { message: 'Typing Scanner prompt…', type: 'info', label: 'Scanner' },
    'scanner-sending': { message: 'Sending Scanner prompt…', type: 'info', label: 'Scanner' },
    'scanner-generating': { message: 'ChatGPT is generating a response…', type: 'info', label: 'Scanner' },
    'scanner-reading': { message: 'Reading ChatGPT response…', type: 'info', label: 'Scanner' },
    'scanner-saving': { message: 'Saving answer package…', type: 'info', label: 'Scanner' },
    'scanner-complete': { message: 'Answer package saved. Return to the application to review it.', type: 'success', label: 'Scanner' },
    'scanner-error': { message: 'Scanner could not complete the ChatGPT step.', type: 'error', label: 'Scanner error' },
  };

  let gptStatusFinishTimer = null;
  let gptStatusTaskId = null;
  let gptStatusActiveIndex = 0;
  const gptCompletedSteps = new Set();

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getPhaseStepIndex(phase) {
    return GPT_PHASE_STEP_INDEX[String(phase || '').toLowerCase()] ?? 0;
  }

  function getStatusPipeline(phase) {
    return String(phase || '').startsWith('scanner-')
      ? SCANNER_PIPELINE_STEPS
      : GPT_PIPELINE_STEPS;
  }

  function syncCompletedSteps(phase, taskId) {
    if (taskId && taskId !== gptStatusTaskId) {
      gptStatusTaskId = taskId;
      gptStatusActiveIndex = 0;
      gptCompletedSteps.clear();
      if (window.__qtsGptToastedPhases) {
        window.__qtsGptToastedPhases.clear();
      }
    }
    const pipeline = getStatusPipeline(phase);
    const idx = getPhaseStepIndex(phase);
    if (phase === 'finished' || phase === 'scanner-complete') {
      gptStatusActiveIndex = pipeline.length - 1;
      pipeline.forEach((step) => gptCompletedSteps.add(step.id));
      return gptStatusActiveIndex;
    }
    if (phase === 'error' || phase === 'scanner-error') {
      return gptStatusActiveIndex;
    }
    gptStatusActiveIndex = Math.max(gptStatusActiveIndex, idx);
    for (let i = 0; i < idx; i += 1) {
      gptCompletedSteps.add(pipeline[i].id);
    }
    return idx;
  }

  function renderStepIcon(state) {
    if (state === 'done') {
      return `<span class="qts-gpt-step-icon qts-gpt-step-icon--done" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
          <circle cx="8" cy="8" r="8" fill="#22c55e"></circle>
          <path d="M4.5 8.2 L7 10.7 L11.5 5.8" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
      </span>`;
    }
    if (state === 'active') {
      return '<span class="qts-gpt-step-icon qts-gpt-step-icon--active" aria-hidden="true"></span>';
    }
    if (state === 'error') {
      return `<span class="qts-gpt-step-icon qts-gpt-step-icon--error" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
          <circle cx="8" cy="8" r="8" fill="#ef4444"></circle>
          <path d="M5.2 5.2 L10.8 10.8 M10.8 5.2 L5.2 10.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"></path>
        </svg>
      </span>`;
    }
    return '<span class="qts-gpt-step-icon qts-gpt-step-icon--pending" aria-hidden="true"></span>';
  }

  function renderStepList(phase, message) {
    const pipeline = getStatusPipeline(phase);
    const idx = phase === 'error' || phase === 'scanner-error'
      ? gptStatusActiveIndex
      : getPhaseStepIndex(phase);
    const isFinished = phase === 'finished' || phase === 'scanner-complete';
    const isError = phase === 'error' || phase === 'scanner-error';

    const items = pipeline.map((step, stepIdx) => {
      let state = 'pending';
      if (isFinished || gptCompletedSteps.has(step.id)) {
        state = 'done';
      } else if (isError && stepIdx === idx) {
        state = 'error';
      } else if (stepIdx === idx) {
        state = 'active';
      } else if (stepIdx < idx) {
        state = 'done';
      }

      const label = (state === 'active' || state === 'error') && message ? message : step.label;
      return `<li class="qts-gpt-step qts-gpt-step--${state}">
        ${renderStepIcon(state)}
        <span class="qts-gpt-step-text">${escapeHtml(label)}</span>
      </li>`;
    }).join('');

    return `<ol class="qts-gpt-status-steps">${items}</ol>`;
  }

  function ensureGptStatusStyles() {
    if (document.getElementById(GPT_STATUS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = GPT_STATUS_STYLE_ID;
    style.textContent = `
      #${GPT_STATUS_HOST_ID} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        max-width: min(400px, calc(100vw - 32px));
        padding: 14px 16px;
        border-radius: 12px;
        font: 600 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: #fff;
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28);
        pointer-events: none;
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;
      }
      #${GPT_STATUS_HOST_ID}.is-visible {
        opacity: 1;
        transform: translateY(0);
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-status-body { min-width: 0; }
      #${GPT_STATUS_HOST_ID} .qts-gpt-status-summary {
        margin-top: 10px;
        padding-top: 9px;
        border-top: 1px solid rgba(255,255,255,0.3);
        font-size: 13px;
        font-weight: 600;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-status-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        opacity: 0.88;
        margin-bottom: 10px;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-status-steps {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        line-height: 1.35;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step-text {
        font-size: 13px;
        font-weight: 600;
        word-break: break-word;
        padding-top: 1px;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step--done .qts-gpt-step-text {
        opacity: 0.92;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step--pending .qts-gpt-step-text {
        opacity: 0.45;
        font-weight: 500;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step--active .qts-gpt-step-text {
        opacity: 1;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step--error .qts-gpt-step-text {
        opacity: 1;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step-icon {
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        margin-top: 1px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step-icon--pending {
        border: 2px solid rgba(255,255,255,0.28);
        border-radius: 50%;
        box-sizing: border-box;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step-icon--active {
        border: 2px solid rgba(255,255,255,0.35);
        border-top-color: #fff;
        border-radius: 50%;
        box-sizing: border-box;
        animation: qts-gpt-spin 0.8s linear infinite;
      }
      #${GPT_STATUS_HOST_ID} .qts-gpt-step-icon--done svg,
      #${GPT_STATUS_HOST_ID} .qts-gpt-step-icon--error svg {
        display: block;
      }
      #${GPT_STATUS_HOST_ID}.qts-gpt-status--success { background: #15803d; border: 1px solid #166534; }
      #${GPT_STATUS_HOST_ID}.qts-gpt-status--error { background: #b91c1c; border: 1px solid #991b1b; }
      #${GPT_STATUS_HOST_ID}.qts-gpt-status--warn { background: #b45309; border: 1px solid #92400e; }
      #${GPT_STATUS_HOST_ID}.qts-gpt-status--info { background: #1d4ed8; border: 1px solid #1e40af; }
      @keyframes qts-gpt-spin { to { transform: rotate(360deg); } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function showNumberedStepToast(message, type = 'info') {
    if (typeof window.__showQtsDetectToast === 'function') {
      window.__showQtsDetectToast(message, type);
      return true;
    }
    return false;
  }

  function dismissGptLiveStatus() {
    clearTimeout(gptStatusFinishTimer);
    gptStatusFinishTimer = null;
    gptStatusTaskId = null;
    gptStatusActiveIndex = 0;
    gptCompletedSteps.clear();
    const host = document.getElementById(GPT_STATUS_HOST_ID);
    if (!host) return;
    host.classList.remove('is-visible');
    window.setTimeout(() => host.remove(), 220);
  }

  function showGptLiveStatus(options = {}) {
    const phase = String(options.phase || 'info').toLowerCase();
    const defaults = GPT_STATUS_PHASES[phase] || GPT_STATUS_PHASES.running;
    const message = cleanText(options.message || defaults.message || 'Working…');
    const type = options.type || defaults.type || 'info';
    const label = cleanText(options.label || defaults.label || 'QTS');
    const taskId = cleanText(options.taskId || '');
    const persistent = options.persistent !== false
      && phase !== 'finished'
      && phase !== 'scanner-complete'
      && phase !== 'error'
      && phase !== 'thinking'
      && phase !== 'allowing'
      && phase !== 'running';

    const toastKey = `${taskId || gptStatusTaskId || 'default'}:${phase}`;
    if (!window.__qtsGptToastedPhases) {
      window.__qtsGptToastedPhases = new Set();
    }
    if (!window.__qtsGptToastedPhases.has(toastKey)) {
      window.__qtsGptToastedPhases.add(toastKey);
    }

    syncCompletedSteps(phase, taskId || gptStatusTaskId);

    ensureGptStatusStyles();
    clearTimeout(gptStatusFinishTimer);
    gptStatusFinishTimer = null;

    let host = document.getElementById(GPT_STATUS_HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = GPT_STATUS_HOST_ID;
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(host);
    }

    host.className = `qts-gpt-status--${type}`;
    host.innerHTML = `
      <div class="qts-gpt-status-body">
        <div class="qts-gpt-status-label">QTS Job Tracking${label && label !== 'QTS' ? ` · ${escapeHtml(label)}` : ''}${taskId ? ` · ${escapeHtml(taskId)}` : ''}</div>
        ${renderStepList(phase, message)}
        ${phase === 'finished' || phase === 'scanner-complete'
          ? `<div class="qts-gpt-status-summary">${escapeHtml(message)}</div>`
          : ''}
      </div>
    `;

    requestAnimationFrame(() => {
      host.classList.add('is-visible');
    });

    if (!persistent) {
      gptStatusFinishTimer = window.setTimeout(dismissGptLiveStatus, GPT_STATUS_FINISH_MS);
    }

    return { ok: true, phase, persistent };
  }

  function showHandoffToast(message, type) {
    const toastType = type === 'success' ? 'success' : type === 'error' ? 'error' : 'warn';
    if (showNumberedStepToast(message, toastType)) return;
    showGptLiveStatus({
      phase: toastType === 'success' ? 'finished' : toastType === 'error' ? 'error' : 'running',
      message,
      type: toastType,
      persistent: false,
    });
  }

  async function waitForComposer(maxMs = 45000) {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const editor = findPromptEditor();
      if (editor) return editor;
      await sleep(400);
    }
    return null;
  }

  function readEditorText(editor) {
    if (!editor) return '';
    if (editor instanceof HTMLTextAreaElement) return String(editor.value || '').trim();
    return cleanText(editor.textContent || '');
  }

  function insertTextIntoEditor(editor, text) {
    const target = resolveEditable(editor) || editor;
    if (!target) return false;

    try {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    } catch {
      target.scrollIntoView?.();
    }

    target.focus();
    clickElement(target);

    if (target instanceof HTMLTextAreaElement) {
      target.value = text;
      target.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text,
        composed: true,
      }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
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

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch {
      inserted = false;
    }

    if (!inserted || !readEditorText(target).includes(text.slice(0, 8))) {
      try {
        target.textContent = text;
        target.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: text,
        }));
        inserted = readEditorText(target).length > 0;
      } catch {
        inserted = false;
      }
    }

    return inserted && readEditorText(target).length > 0;
  }

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[type="submit"]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLButtonElement && isVisible(el) && !el.disabled) return el;
    }
    return null;
  }

  async function performSubmitWithFallback(editor, taskId = null) {
    lockTaskSubmit(taskId || parseTaskId(readEditorText(editor)));
    const sendBtn = findSendButton();
    if (sendBtn) {
      clickElement(sendBtn);
    } else {
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }

    for (let i = 0; i < 12; i += 1) {
      await sleep(250);
      if (readEditorText(editor) === '') {
        return { sent: true, method: sendBtn ? 'composer_send' : 'composer_enter', submitAttempted: true };
      }
    }

    return {
      sent: false,
      method: sendBtn ? 'composer_send_pending' : 'composer_enter_pending',
      submitAttempted: true,
    };
  }

  async function trySendFromComposer(message, { maxWaitMs = 45000, taskId = null } = {}) {
    const text = cleanText(message);
    if (!text) return { ok: false, sent: false, error: 'Empty PROCESS_TASK message.' };
    const tid = taskId || parseTaskId(text);

    if (countTaskMessagesInChat(tid, text) >= 1) {
      return finishSuccessfulSend(tid, text, 'already_in_chat');
    }

    if (isTaskSubmitLocked(tid)) {
      if (await waitForTaskInChat(tid, text, 8000)) {
        return finishSuccessfulSend(tid, text, 'confirmed_after_submit_lock');
      }
    }

    showGptLiveStatus({ phase: 'scraping', taskId: tid, message: 'Scanning page for composer…' });

    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const editor = window.__qtsChatGptComposerHandoff?.findUnifiedComposerEditor?.()
        || findPromptEditor();
      if (editor) break;
      if (countTaskMessagesInChat(tid, text) >= 1) {
        return finishSuccessfulSend(tid, text, 'already_in_chat');
      }
      await sleep(400);
    }

    showGptLiveStatus({ phase: 'typing', taskId: tid, message: 'Typing PROCESS_TASK…' });
    const stepResult = await runHandoffStep(text);

    if (await waitForTaskInChat(tid, text, 15000)) {
      return finishSuccessfulSend(tid, text, stepResult?.method || 'unified_composer');
    }

    if (countTaskMessagesInChat(tid, text) >= 1) {
      return finishSuccessfulSend(tid, text, stepResult?.method || 'unified_composer');
    }

    const submitWasAttempted = handoffStepAttemptedSubmit(stepResult);
    if (submitWasAttempted || isTaskSubmitLocked(tid)) {
      showGptLiveStatus({ phase: 'sending', taskId: tid, message: 'Confirming message in chat…' });
      if (await waitForTaskInChat(tid, text, 15000)) {
        return finishSuccessfulSend(tid, text, stepResult?.method || 'unified_composer');
      }
    }

    const editor = window.__qtsChatGptComposerHandoff?.findUnifiedComposerEditor?.()
      || findPromptEditor();

    if (composerHasTaskMessage(tid, text) && editor) {
      showGptLiveStatus({ phase: 'sending', taskId: tid, message: 'Sending message…' });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (countTaskMessagesInChat(tid, text) >= 1) {
          return finishSuccessfulSend(tid, text, 'already_in_chat', { attempt });
        }
        if (!composerHasTaskMessage(tid, text)) break;
        const submit = await performSubmitWithFallback(editor, tid);
        if (submit.submitAttempted) lockTaskSubmit(tid);
        if (await waitForTaskInChat(tid, text, 3000)) {
          return finishSuccessfulSend(tid, text, submit.method, { attempt });
        }
        await sleep(500);
      }
    }

    if (await waitForTaskInChat(tid, text, 8000)) {
      return finishSuccessfulSend(tid, text, 'confirmed_late');
    }

    if (submitWasAttempted || isTaskSubmitLocked(tid)) {
      showGptLiveStatus({
        phase: 'error',
        taskId: tid,
        message: 'PROCESS_TASK may have sent — check chat before retrying.',
        type: 'error',
        persistent: false,
      });
      return {
        ok: true,
        sent: false,
        needsManualSend: true,
        method: 'unconfirmed_send',
        message: text,
        error: 'PROCESS_TASK submit was attempted but not confirmed in chat.',
        taskId: tid,
      };
    }

    if (!editor) {
      showGptLiveStatus({ phase: 'error', taskId: tid, message: 'ChatGPT composer not ready yet.' });
      return { ok: false, sent: false, error: 'ChatGPT composer not ready yet.' };
    }

    showGptLiveStatus({
      phase: 'error',
      taskId: tid,
      message: 'Could not send PROCESS_TASK — click Send in the composer.',
      type: 'error',
      persistent: false,
    });
    return {
      ok: true,
      sent: false,
      method: 'composer_needs_manual_send',
      needsManualSend: true,
      message: text,
      error: 'PROCESS_TASK is in the composer but was not sent. Click Send manually.',
      taskId: tid,
    };
  }

  async function runHandoff({ taskId, message, preferStarter = true, composerWaitMs = 45000 } = {}) {
    const tid = taskId || parseTaskId(message);
    const fullMessage = cleanText(message) || (tid ? `PROCESS_TASK: ${tid}` : '');

    if (countTaskMessagesInChat(tid, fullMessage) >= 1) {
      return { ok: true, sent: true, method: 'already_in_chat', taskId: tid };
    }

    if (handoffInFlightByTask.has(tid)) {
      return handoffInFlightByTask.get(tid);
    }

    const flight = (async () => {
      if (preferStarter && tid) {
        const starterResult = await clickConversationStarter(tid, fullMessage);
        if (starterResult.sent) return starterResult;
      }

      const composerResult = await trySendFromComposer(fullMessage, {
        maxWaitMs: composerWaitMs,
        taskId: tid,
      });
      if (composerResult?.sent) {
        return { ...composerResult, taskId: tid };
      }
      if (composerResult?.needsManualSend) {
        return { ...composerResult, taskId: tid };
      }

      return {
        ok: false,
        sent: false,
        error: composerResult?.error || 'ChatGPT composer not ready — paste PROCESS_TASK manually.',
        taskId: tid,
      };
    })().finally(() => {
      handoffInFlightByTask.delete(tid);
    });

    handoffInFlightByTask.set(tid, flight);
    return flight;
  }

  async function insertTaskMessage(message, options = {}) {
    return runHandoff({
      taskId: options.taskId,
      message,
      preferStarter: options.preferStarter !== false,
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'QTS_GPT_HANDOFF_STEP') {
        runHandoffStep(msg.message)
          .then(sendResponse)
          .catch((e) => sendResponse({ ok: false, error: e.message, phase: 'error' }));
        return true;
      }
      if (msg.type === 'QTS_GPT_SHOW_TOAST') {
        showHandoffToast(msg.message, msg.toastType || 'warn');
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'QTS_GPT_SET_STATUS') {
        sendResponse(showGptLiveStatus({
          phase: msg.phase,
          message: msg.message,
          type: msg.statusType,
          label: msg.label,
          taskId: msg.taskId,
          persistent: msg.persistent,
        }));
        return false;
      }
      if (msg.type === 'QTS_GPT_CLEAR_STATUS') {
        dismissGptLiveStatus();
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'QTS_GPT_RUN_HANDOFF') {
        runHandoff({
          taskId: msg.taskId,
          message: msg.message,
          preferStarter: msg.preferStarter === true,
          composerWaitMs: msg.composerWaitMs || 45000,
        }).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
      }
      if (msg.type === 'QTS_GPT_PING') {
        sendResponse({ ok: true, allowWatch: allowAutoWatchActive });
        return false;
      }
      if (msg.type === 'QTS_GPT_START_ALLOW_WATCH') {
        sendResponse(startAllowAutoWatch());
        return false;
      }
      if (msg.type === 'QTS_GPT_STOP_ALLOW_WATCH') {
        stopAllowAutoWatch();
        sendResponse({ ok: true });
        return false;
      }
      if (msg.type === 'QTS_GPT_CLICK_ALLOW') {
        const result = clickAllowButtons();
        sendResponse({ ok: true, ...result });
        return false;
      }
      if (msg.type === 'QTS_GPT_SNAPSHOT') {
        sendResponse({ ok: true, ...scrapePageState(), allowWatch: allowAutoWatchActive });
        return false;
      }
      if (msg.type === 'QTS_GPT_TASK_IN_CHAT') {
        const tid = cleanText(msg.taskId || parseTaskId(msg.message) || '');
        const count = countTaskMessagesInChat(tid, msg.message);
        sendResponse({
          ok: true,
          inChat: count >= 1,
          count,
          taskId: tid,
        });
        return false;
      }
      return false;
    });
  }

  window.__qtsChatGptHandoff = {
    insertTaskMessage,
    runHandoff,
    runHandoffStep,
    showHandoffToast,
    showGptLiveStatus,
    dismissGptLiveStatus,
    clickConversationStarter,
    clickAllowButtons,
    startAllowAutoWatch,
    stopAllowAutoWatch,
    scrapePageState,
    findConversationStarter,
    findPromptEditor,
    waitForComposer,
    parseTaskId,
  };
})();
