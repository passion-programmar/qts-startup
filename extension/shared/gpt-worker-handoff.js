// QTS Custom GPT worker — same flow as qts_gpt_worker_extension:
// 1) open/focus GPT tab  2) wait for page load  3) scrape composer  4) type  5) click Send
(function initQtsGptWorkerHandoff(global) {
  if (global.__qtsGptWorkerHandoff) return;

  const CHATGPT_TAB_URL_PATTERNS = [
    'https://chatgpt.com/*',
    'https://www.chatgpt.com/*',
    'https://chat.openai.com/*',
  ];

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getGptConfig() {
    const gpt = global.__qtsCustomGpt;
    if (!gpt?.CUSTOM_GPT_URL) {
      throw new Error('Custom GPT URL is not configured in extension/shared/custom-gpt.js');
    }
    const url = typeof gpt.getCanonicalGptUrl === 'function'
      ? gpt.getCanonicalGptUrl()
      : String(gpt.CUSTOM_GPT_URL).replace(/\/+$/, '');
    const part = typeof gpt.getGptPathname === 'function'
      ? gpt.getGptPathname()
      : `/g/${gpt.CUSTOM_GPT_ID}-qts-job-tracking`;
    return { url, part, gptId: gpt.CUSTOM_GPT_ID || null };
  }

  function isCustomGptTabUrl(url, pendingUrl) {
    const candidates = [url, pendingUrl].filter(Boolean);
    if (!candidates.length) return false;
    const gpt = global.__qtsCustomGpt;
    const gptId = gpt?.CUSTOM_GPT_ID;
    const { part } = getGptConfig();
    return candidates.some((candidate) => {
      if (gptId && candidate.includes(gptId)) return true;
      try {
        const path = new URL(candidate).pathname.replace(/\/+$/, '');
        if (part && (path === part || path.startsWith(`${part}/`))) return true;
      } catch {
        if (part && candidate.includes(part)) return true;
      }
      return false;
    });
  }

  function isChatGptHost(url, pendingUrl) {
    const candidates = [url, pendingUrl].filter(Boolean);
    return candidates.some((candidate) => {
      try {
        const host = new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
        return host === 'chatgpt.com' || host === 'chat.openai.com';
      } catch {
        return /chatgpt\.com|chat\.openai\.com/i.test(candidate);
      }
    });
  }

  function isQtsGptTab(tab) {
    if (!tab) return false;
    if (isCustomGptTabUrl(tab.url || '', tab.pendingUrl || '')) return true;
    const title = String(tab.title || '');
    return /qts[- ]job[- ]tracking/i.test(title);
  }

  let cachedGptTabId = null;
  let findOrCreateGptTabLock = null;
  const sendLocksByTaskId = new Map();
  const completedHandoffsByTaskId = new Map();
  const recentHandoffs = new Map();

  async function persistGptTabId(storageKey, tabId) {
    if (!tabId) return;
    cachedGptTabId = tabId;
    if (storageKey) {
      await chrome.storage.local.set({ [storageKey]: tabId });
    }
  }

  async function resolvePinnedGptTab(tabId) {
    if (!tabId) return null;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.id && isChatGptHost(tab.url || '', tab.pendingUrl || '')) {
        return tab;
      }
    } catch {
      // tab closed or inaccessible
    }
    return null;
  }

  async function findExistingGptTabs() {
    const tabs = await chrome.tabs.query({ url: CHATGPT_TAB_URL_PATTERNS });
    const qtsTabs = tabs.filter((tab) => isQtsGptTab(tab));
    if (qtsTabs.length) return qtsTabs;

    const chatGptTabs = tabs.filter((tab) => isChatGptHost(tab.url || '', tab.pendingUrl || ''));
    if (chatGptTabs.length === 1) return chatGptTabs;
    return [];
  }

  async function consolidateDuplicateGptTabs(keepTabId) {
    if (!keepTabId) return;
    const tabs = await chrome.tabs.query({ url: CHATGPT_TAB_URL_PATTERNS });
    for (const tab of tabs) {
      if (!tab?.id || tab.id === keepTabId) continue;
      if (!isQtsGptTab(tab)) continue;
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // tab may already be closed
      }
    }
  }

  async function readPinnedGptTabId(storageKey) {
    if (cachedGptTabId) return cachedGptTabId;
    if (!storageKey) return null;
    try {
      const stored = await chrome.storage.local.get([storageKey]);
      const tabId = stored[storageKey];
      return Number.isFinite(tabId) ? tabId : null;
    } catch {
      return null;
    }
  }

  async function isPinnedGptTabId(tabId, storageKey) {
    const id = Number(tabId);
    if (!Number.isFinite(id)) return false;
    const pinnedId = await readPinnedGptTabId(storageKey);
    if (pinnedId === id) return true;
    try {
      const tab = await chrome.tabs.get(id);
      return Boolean(tab?.id && isQtsGptTab(tab));
    } catch {
      return false;
    }
  }

  async function ensurePinnedGptTab({
    storageKey,
    focus = false,
    preparePage = true,
    taskId = null,
    loadTimeoutMs = 45000,
    pinInBrowser = true,
  } = {}) {
    const tab = await findOrCreateGptTab({ storageKey, focus, pinInBrowser });
    if (!tab?.id) throw new Error('Could not open Custom GPT tab.');
    await consolidateDuplicateGptTabs(tab.id);
    if (pinInBrowser) await ensureBrowserTabPinned(tab.id);
    if (preparePage) {
      await ensureGptPageReady(tab.id, { loadTimeoutMs, focus, taskId });
    }
    return { ok: true, tabId: tab.id, tab };
  }

  function pickPreferredGptTab(tabs, preferredIds = []) {
    const list = Array.isArray(tabs) ? tabs : [];
    for (const preferredId of preferredIds) {
      const match = list.find((tab) => tab.id === preferredId);
      if (match) return match;
    }
    return list.find((tab) => tab.active) || list[0] || null;
  }

  function normalizeTaskId(taskIdOrMessage) {
    return String(taskIdOrMessage || '')
      .trim()
      .replace(/^PROCESS_TASK:\s*/i, '');
  }

  function buildProcessTaskMessage(taskIdOrMessage) {
    const id = normalizeTaskId(taskIdOrMessage);
    return id ? `PROCESS_TASK: ${id}` : '';
  }

  function waitForTabComplete(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('GPT tab load timeout'));
      }, timeoutMs);

      function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }

      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.get(tabId).then((tab) => {
        if (tab?.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }).catch(() => {});
    });
  }

  async function ensureBrowserTabPinned(tabId) {
    if (!tabId) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.id || !isQtsGptTab(tab) || tab.pinned) return;
      await chrome.tabs.update(tabId, { pinned: true });
    } catch {
      // tab may be closed or pinning unsupported
    }
  }

  async function findOrCreateGptTabInternal({ storageKey, focus = true, pinInBrowser = false } = {}) {
    const { url } = getGptConfig();
    const preferredIds = [];

    if (storageKey) {
      try {
        const stored = await chrome.storage.local.get([storageKey]);
        const storedId = stored[storageKey];
        if (storedId) preferredIds.push(storedId);
      } catch {
        // ignore storage read errors
      }
    }
    if (cachedGptTabId) preferredIds.push(cachedGptTabId);

    for (const tabId of preferredIds) {
      const tab = await resolvePinnedGptTab(tabId);
      if (tab) {
        await persistGptTabId(storageKey, tab.id);
        await consolidateDuplicateGptTabs(tab.id);
        if (pinInBrowser) await ensureBrowserTabPinned(tab.id);
        if (focus) {
          await chrome.tabs.update(tab.id, { active: true });
        }
        return tab;
      }
    }

    const existingTabs = await findExistingGptTabs();
    const tab = pickPreferredGptTab(existingTabs, preferredIds);

    if (tab?.id) {
      await persistGptTabId(storageKey, tab.id);
      await consolidateDuplicateGptTabs(tab.id);
      if (pinInBrowser) await ensureBrowserTabPinned(tab.id);
      if (focus) {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.status !== 'complete') {
          await waitForTabComplete(tab.id, 30000);
        }
      }
      return tab;
    }

    const created = await chrome.tabs.create({ url, active: focus, pinned: pinInBrowser });
    if (created?.id) {
      await persistGptTabId(storageKey, created.id);
      await consolidateDuplicateGptTabs(created.id);
      if (pinInBrowser && !created.pinned) await ensureBrowserTabPinned(created.id);
      await waitForTabComplete(created.id, 30000);
    }
    return created;
  }

  async function findOrCreateGptTab({ storageKey, focus = true, pinInBrowser = false } = {}) {
    if (!findOrCreateGptTabLock) {
      findOrCreateGptTabLock = findOrCreateGptTabInternal({ storageKey, focus, pinInBrowser })
        .finally(() => {
          findOrCreateGptTabLock = null;
        });
      return findOrCreateGptTabLock;
    }

    const tab = await findOrCreateGptTabLock;
    if (focus && tab?.id) {
      try {
        await chrome.tabs.update(tab.id, { active: true });
      } catch {
        // tab may have been closed
      }
    }
    return tab;
  }

  async function ensureGptPageReady(tabId, { loadTimeoutMs = 45000, focus = true, taskId = null } = {}) {
    const { url } = getGptConfig();
    let tab = await chrome.tabs.get(tabId);
    if (!tab?.id) throw new Error('Custom GPT tab not found');

    await setGptTabStatus(tabId, { phase: 'loading', taskId, message: 'Loading Custom GPT…' });

    const gpt = global.__qtsCustomGpt;
    const onCanonicalGpt = typeof gpt?.isCustomGptBaseUrl === 'function'
      ? gpt.isCustomGptBaseUrl(tab.url || '')
      : isCustomGptTabUrl(tab.url || '', tab.pendingUrl || '');
    const needsFresh = typeof gpt?.needsFreshGptConversation === 'function'
      ? gpt.needsFreshGptConversation(tab.url || '')
      : !onCanonicalGpt;

    if (!isChatGptHost(tab.url || '', tab.pendingUrl || '') || needsFresh) {
      await chrome.tabs.update(tabId, { url, active: focus });
    }

    await waitForTabComplete(tabId, loadTimeoutMs);
    await sleep(500);
    await setGptTabStatus(tabId, { phase: 'loaded', taskId, message: 'Page loaded successfully' });
    return tab;
  }

  async function runInGptTab(tabId, taskIdOrMessage, { composerTimeoutMs = 30000, sendTimeoutMs = 15000 } = {}) {
    const taskId = normalizeTaskId(taskIdOrMessage);
    if (!taskId) {
      throw new Error('Missing task id');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [taskId, composerTimeoutMs, sendTimeoutMs],
      func: async (taskIdFromExtension, composerWaitMs, sendWaitMs) => {
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));

        async function waitForComposer(timeoutMs) {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const composer =
              document.querySelector('#prompt-textarea.ProseMirror[contenteditable="true"]') ||
              document.querySelector('div[contenteditable="true"][aria-label="Chat with ChatGPT"]') ||
              document.querySelector('#prompt-textarea') ||
              document.querySelector('textarea[name="prompt-textarea"]');

            if (composer) return composer;
            await delay(500);
          }
          throw new Error('Composer not found');
        }

        function setComposerText(composer, text) {
          composer.focus();

          if (composer.tagName === 'TEXTAREA') {
            composer.value = text;
            composer.dispatchEvent(new Event('input', { bubbles: true }));
            composer.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }

          composer.innerHTML = '';
          const p = document.createElement('p');
          p.textContent = text;
          composer.appendChild(p);
          composer.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text,
          }));
        }

        async function waitForSendButton(timeoutMs) {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const buttons = [...document.querySelectorAll('button')];
            const btn =
              document.querySelector('[data-testid="send-button"]') ||
              buttons.find((b) => /send/i.test(b.getAttribute('aria-label') || '')) ||
              buttons.find((b) => /submit/i.test(b.getAttribute('aria-label') || ''));

            if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return btn;
            await delay(300);
          }
          throw new Error('Send button not ready');
        }

        const normalizedTaskId = String(taskIdFromExtension || '').trim().replace(/^PROCESS_TASK:\s*/i, '');
        const message = `PROCESS_TASK: ${normalizedTaskId}`;

        const composer = await waitForComposer(composerWaitMs);
        setComposerText(composer, message);
        await delay(700);
        const sendButton = await waitForSendButton(sendWaitMs);
        sendButton.click();

        return {
          ok: true,
          sent: true,
          method: 'gpt_worker_dom',
          phase: 'typed_and_sent',
          message,
          title: document.title,
          url: location.href,
        };
      },
    });

    const result = results?.[0]?.result;
    if (!result) {
      throw new Error('GPT handoff script returned no result');
    }
    return result;
  }

  async function focusGptBrowserWindow(tabId, options = {}) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
      }
      await chrome.tabs.update(tabId, { active: true });
      if (options.defocusWindowId != null) {
        try {
          await chrome.windows.update(options.defocusWindowId, { focused: false });
        } catch {
          // ignore
        }
      }
      await sleep(options.focusDelayMs || 350);
    } catch {
      // ignore focus errors
    }
  }

  const CHATGPT_HANDOFF_FILES = [
    'shared/chatgpt-composer-handoff.js',
    'content/chatgpt-handoff.js',
  ];

  async function ensureChatGptHandoff(tabId) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: 'QTS_GPT_PING' });
      if (ping?.ok) return true;
    } catch {
      // not injected yet
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CHATGPT_HANDOFF_FILES,
      });
      await sleep(200);
      return true;
    } catch {
      return false;
    }
  }

  async function setGptTabStatus(tabId, options = {}) {
    if (!tabId) return false;
    await ensureChatGptHandoff(tabId);
    const payload = {
      type: 'QTS_GPT_SET_STATUS',
      phase: options.phase,
      message: options.message,
      statusType: options.type,
      label: options.label,
      taskId: options.taskId || null,
      persistent: options.persistent,
    };
    try {
      await chrome.tabs.sendMessage(tabId, payload);
      return true;
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (status) => window.__qtsChatGptHandoff?.showGptLiveStatus?.(status),
          args: [{
            phase: status.phase,
            message: status.message,
            type: status.statusType,
            label: status.label,
            taskId: status.taskId,
            persistent: status.persistent,
          }],
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  async function dismissGptTabStatus(tabId) {
    if (!tabId) return;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'QTS_GPT_CLEAR_STATUS' });
    } catch {
      // ignore
    }
  }

  function statusFromGptSnapshot(snap, taskId) {
    if (!snap) return null;
    if (snap.taskSaved) {
      return {
        phase: 'finished',
        taskId,
        message: `Task ${taskId} finished successfully`,
        type: 'success',
        persistent: false,
      };
    }
    if (snap.allowClicked && snap.clickedLabel) {
      const action = snap.hasSubmitTaskPackage
        ? 'submitTaskPackage'
        : (snap.hasGetTaskContext ? 'getTaskContext' : 'GPT Action');
      return {
        phase: 'allowing',
        taskId,
        message: `Clicked Allow (${snap.clickedLabel}) for ${action}…`,
        type: 'warn',
      };
    }
    if (snap.hasApprovalDialog) {
      return {
        phase: 'allowing',
        taskId,
        message: snap.allowButtonCount
          ? 'Approval dialog visible — clicking Allow…'
          : 'Approval dialog visible — searching for Allow…',
        type: 'warn',
      };
    }
    if (snap.thinking) {
      return { phase: 'thinking', taskId, message: 'Custom GPT is thinking…', type: 'info' };
    }
    if (snap.hasGetTaskContext || snap.hasSubmitTaskPackage) {
      return { phase: 'running', taskId, message: 'Running GPT Actions…', type: 'info' };
    }
    return null;
  }

  async function sendHandoffViaContentScript(tabId, message, { taskId, composerTimeoutMs } = {}) {
    await setGptTabStatus(tabId, { phase: 'scraping', taskId, message: 'Scanning page…' });
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: 'QTS_GPT_RUN_HANDOFF',
        taskId,
        message,
        preferStarter: false,
        composerWaitMs: composerTimeoutMs || 30000,
      });
      if (result?.sent) {
        return result;
      }
      if (result?.error) {
        await setGptTabStatus(tabId, {
          phase: 'error',
          taskId,
          message: result.error,
          type: 'error',
          persistent: false,
        });
      }
      return result;
    } catch {
      return null;
    }
  }

  async function taskAlreadyVisibleInTab(tabId, taskId) {
    const tid = normalizeTaskId(taskId);
    if (!tabId || !tid) return false;

    try {
      const ping = await chrome.tabs.sendMessage(tabId, {
        type: 'QTS_GPT_TASK_IN_CHAT',
        taskId: tid,
        message: buildProcessTaskMessage(tid),
      });
      if (ping?.inChat) return true;
    } catch {
      // fall through to executeScript probe
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        args: [tid],
        func: (normalizedTaskId) => {
          const escaped = normalizedTaskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pattern = new RegExp(`PROCESS_TASK:\\s*${escaped}`, 'i');
          const editor = document.querySelector(
            '#prompt-textarea[contenteditable="true"], div[contenteditable="true"]#prompt-textarea, textarea[name="prompt-textarea"]'
          );
          const composerText = String(editor?.innerText || editor?.value || '').replace(/\s+/g, ' ').trim();
          if (composerText && pattern.test(composerText)) return false;
          const userNodes = document.querySelectorAll(
            '[data-message-author-role="user"],' +
            'article[data-turn="user"],' +
            '[data-testid*="conversation-turn-user"],' +
            '[data-testid="user-message"]'
          );
          let count = 0;
          for (const node of userNodes) {
            if (pattern.test(String(node.innerText || '').replace(/\s+/g, ' ').trim())) count += 1;
          }
          return count >= 1;
        },
      });
      return Boolean(results?.[0]?.result);
    } catch {
      return false;
    }
  }

  function markTaskHandoffSent(tabId, taskId) {
    const tid = normalizeTaskId(taskId);
    if (!tabId || !tid) return;
    recentHandoffs.set(`${tabId}:${tid}`, Date.now());
  }

  async function waitForTaskInChatOnTab(tabId, taskId, message, timeoutMs = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await taskAlreadyVisibleInTab(tabId, taskId)) return true;
      await sleep(300);
    }
    return taskAlreadyVisibleInTab(tabId, taskId);
  }

  async function runDomHandoffFallback(tabId, message, { taskId, composerTimeoutMs, sendTimeoutMs } = {}) {
    if (await taskAlreadyVisibleInTab(tabId, taskId)) {
      return {
        ok: true,
        sent: true,
        method: 'already_sent',
        phase: 'skipped_duplicate',
        message,
      };
    }
    await setGptTabStatus(tabId, { phase: 'typing', taskId, message: 'Typing PROCESS_TASK…' });
    const result = await runInGptTab(tabId, message, { composerTimeoutMs, sendTimeoutMs });
    if (result?.sent) {
      await setGptTabStatus(tabId, { phase: 'sending', taskId, message: 'Sending message…' });
      markTaskHandoffSent(tabId, taskId);
    }
    return result;
  }

  async function startAllowWatchInTab(tabId) {
    await ensureChatGptHandoff(tabId);
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'QTS_GPT_START_ALLOW_WATCH' });
      return true;
    } catch {
      return false;
    }
  }

  async function stopAllowWatchInTab(tabId) {
    if (!tabId) return;
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'QTS_GPT_STOP_ALLOW_WATCH' });
    } catch {
      // tab may be closed or script missing
    }
  }

  async function clickAllowViaContentScript(tabId, options = {}) {
    if (options.focus !== false) {
      await focusGptBrowserWindow(tabId, options);
    }
    await ensureChatGptHandoff(tabId);
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: options.snapshotOnly ? 'QTS_GPT_SNAPSHOT' : 'QTS_GPT_CLICK_ALLOW',
      });
      if (result) {
        return {
          allowClicked: Boolean(result.allowClicked || result.clicked),
          clickedLabel: result.clickedLabel || result.labels?.[0] || null,
          allowButtonCount: result.allowButtonCount || result.clicked || 0,
          hasApprovalDialog: result.hasApprovalDialog,
          hasGetTaskContext: result.hasGetTaskContext,
          hasSubmitTaskPackage: result.hasSubmitTaskPackage,
          taskSaved: result.taskSaved,
          thinking: result.thinking,
          stoppedThinking: result.stoppedThinking,
          snippet: result.snippet,
          method: options.snapshotOnly ? 'content_snapshot' : 'content_script',
        };
      }
    } catch {
      if (options.allowScrapeFallback) {
        return scrapeAndClickAllowInTab(tabId);
      }
    }
    return null;
  }

  async function scrapeAndClickAllowInTab(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

        function visitRoots(visitor) {
          const seen = new Set();
          const walk = (root, depth = 0) => {
            if (!root || seen.has(root) || depth > 3) return;
            seen.add(root);
            visitor(root);
            if (depth >= 3) return;
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

        function collectClickables() {
          const elements = new Set();
          visitRoots((root) => {
            root.querySelectorAll('button, [role="button"]').forEach((el) => {
              elements.add(el);
            });
          });
          return [...elements];
        }

        function isVisible(el) {
          if (!el?.isConnected) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
            return false;
          }
          const rect = el.getBoundingClientRect();
          return rect.width > 4 && rect.height > 4;
        }

        function labelOf(el) {
          return clean(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
        }

        function clickEl(el) {
          try {
            el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
          } catch {
            el.scrollIntoView();
          }
          el.focus?.();
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          if (typeof el.click === 'function') el.click();
        }

        const bodyText = clean(document.body?.innerText || '');
        const allowCandidates = [];
        collectClickables().forEach((el) => {
          if (!isVisible(el)) return;
          if (el.closest('nav, header, footer')) return;
          const label = labelOf(el);
          if (!label || label.length > 64) return;
          if (!/\ballow\b/i.test(label) || /\bdeny\b/i.test(label)) return;
          let score = 10;
          if (/^allow$/i.test(label)) score += 50;
          if (/^always allow/i.test(label)) score += 30;
          if (el.closest('[role="dialog"], [class*="modal" i], [class*="popover" i], [class*="layer" i]')) score += 35;
          if (/wants to talk to/i.test(el.parentElement?.innerText || '')) score += 25;
          const rect = el.getBoundingClientRect();
          const order = rect.top * 10000 + rect.left;
          allowCandidates.push({ el, label, score, order });
        });
        allowCandidates.sort((a, b) => b.order - a.order || b.score - a.score);

        let allowClicked = false;
        let clickedLabel = null;
        if (allowCandidates.length) {
          const pick = allowCandidates[0];
          clickEl(pick.el);
          allowClicked = true;
          clickedLabel = pick.label;
        }

        return {
          allowClicked,
          clickedLabel,
          allowButtonCount: allowCandidates.length,
          hasApprovalDialog: /wants to talk to/i.test(bodyText),
          hasGetTaskContext: /getTaskContext/i.test(bodyText),
          hasSubmitTaskPackage: /submitTaskPackage/i.test(bodyText),
          taskSaved: /task\s+task_[\w-]+\s+saved/i.test(bodyText)
            || /Extension will apply answers/i.test(bodyText)
            || /(?:^|\n)\s*Confirmed\.?\s*(?:\n|$)/im.test(bodyText),
          thinking: /\bThinking\b/i.test(bodyText),
          stoppedThinking: /Stopped thinking/i.test(bodyText),
          snippet: bodyText.slice(0, 600),
        };
      },
    });

    const frames = results || [];
    return frames.map((entry) => entry?.result).find((snap) => snap?.allowClicked)
      || frames.map((entry) => entry?.result).find((snap) => snap?.allowButtonCount)
      || frames[0]?.result
      || null;
  }

  async function watchGptTabAfterSend(tabId, taskId, options = {}) {
    const timeoutMs = options.timeoutMs || 180000;
    const pollMs = options.pollMs || 2800;
    const started = Date.now();
    let totalAllowClicks = 0;
    let idlePolls = 0;
    const history = [];
    let lastSnap = null;
    let nextServerStatusCheckAt = started;
    let lastServerStatusWarningAt = 0;

    await setGptTabStatus(tabId, {
      phase: 'allowing',
      taskId,
      message: 'PROCESS_TASK sent — watching for GPT Actions…',
      type: 'warn',
    });

    if (options.focus !== false) {
      await focusGptBrowserWindow(tabId, {
        defocusWindowId: options.defocusWindowId,
        focusDelayMs: 400,
      });
    }
    await startAllowWatchInTab(tabId);

    while (Date.now() - started < timeoutMs) {
      if (typeof options.getTaskStatus === 'function' && Date.now() >= nextServerStatusCheckAt) {
        nextServerStatusCheckAt = Date.now() + 5000;
        try {
          const serverStatus = await options.getTaskStatus();
          if (serverStatus?.success && serverStatus.status === 'ready') {
            await setGptTabStatus(tabId, {
              phase: 'finished',
              taskId,
              message: 'Answer package confirmed by the server',
              type: 'success',
              persistent: false,
            });
            return {
              ok: true,
              phase: 'task_ready',
              taskId,
              tabId,
              totalAllowClicks,
              serverStatus: serverStatus.status,
              history,
            };
          }
          if (serverStatus?.success && ['failed', 'completed'].includes(serverStatus.status)) {
            await setGptTabStatus(tabId, {
              phase: 'error',
              taskId,
              message: `Server task ended unexpectedly (${serverStatus.status})`,
              type: 'error',
              persistent: false,
            });
            return {
              ok: false,
              phase: 'task_ended',
              taskId,
              tabId,
              totalAllowClicks,
              serverStatus: serverStatus.status,
              history,
            };
          }
        } catch (error) {
          if (Date.now() - lastServerStatusWarningAt >= 30000) {
            console.warn('[QTS GPT] Could not check server task status while watching ChatGPT:', error);
            lastServerStatusWarningAt = Date.now();
          }
        }
      }

      const snap = await clickAllowViaContentScript(tabId, {
        focus: false,
        snapshotOnly: true,
      });
      if (!snap) break;
      lastSnap = snap;

      const statusUpdate = statusFromGptSnapshot(snap, taskId);
      if (statusUpdate) {
        await setGptTabStatus(tabId, statusUpdate);
      }

      history.push({ at: Date.now(), ...snap });
      if (snap.allowClicked) {
        totalAllowClicks += 1;
        idlePolls = 0;
      } else {
        idlePolls += 1;
      }

      if (typeof options.onStatus === 'function') {
        try {
          options.onStatus({ taskId, tabId, totalAllowClicks, ...snap });
        } catch {
          // ignore status callback errors
        }
      }

      if (snap.taskSaved) {
        await setGptTabStatus(tabId, {
          phase: 'finished',
          taskId,
          message: `Task ${taskId} finished successfully`,
          type: 'success',
          persistent: false,
        });
        return {
          ok: true,
          phase: 'task_saved',
          taskId,
          tabId,
          totalAllowClicks,
          snapshot: snap,
          history,
        };
      }

      if (totalAllowClicks > 0 && idlePolls >= 6 && snap.stoppedThinking && !snap.allowButtonCount) {
        await setGptTabStatus(tabId, {
          phase: 'finished',
          taskId,
          message: 'GPT Actions complete',
          type: 'success',
          persistent: false,
        });
        return {
          ok: true,
          phase: 'actions_complete',
          taskId,
          tabId,
          totalAllowClicks,
          snapshot: snap,
          history,
        };
      }

      await sleep(pollMs);
    }

    await stopAllowWatchInTab(tabId);

    await setGptTabStatus(tabId, {
      phase: 'error',
      taskId,
      message: 'Timed out waiting for Custom GPT task',
      type: 'error',
      persistent: false,
    });

    return {
      ok: false,
      phase: 'timeout',
      taskId,
      tabId,
      totalAllowClicks,
      history,
    };
  }

  async function sendTaskToCustomGpt(taskIdOrMessage, options = {}) {
    const message = buildProcessTaskMessage(taskIdOrMessage);
    const taskId = normalizeTaskId(taskIdOrMessage);
    if (!message) {
      return {
        ok: false,
        error: 'Missing task id',
        handoff: { ok: false, sent: false, error: 'Missing task id' },
      };
    }

    const cached = completedHandoffsByTaskId.get(taskId);
    if (cached?.handoff?.sent) {
      return cached;
    }

    const inFlight = sendLocksByTaskId.get(taskId);
    if (inFlight) {
      return inFlight;
    }

    const runSend = async () => {
      const loadTimeoutMs = options.loadTimeoutMs || 45000;
      const composerTimeoutMs = options.composerTimeoutMs || 30000;
      const sendTimeoutMs = options.sendTimeoutMs || 15000;
      const focus = options.focus !== false;

      const pinned = await ensurePinnedGptTab({
        storageKey: options.storageKey,
        focus,
        preparePage: true,
        taskId,
        loadTimeoutMs,
        pinInBrowser: true,
      });
      const tab = pinned.tab;
      if (!tab?.id) throw new Error('Could not open Custom GPT tab');

      if (await taskAlreadyVisibleInTab(tab.id, taskId)) {
        return {
          ok: true,
          tabId: tab.id,
          message,
          handoff: {
            ok: true,
            sent: true,
            method: 'already_sent',
            phase: 'skipped_duplicate',
            message,
          },
        };
      }

      await chrome.tabs.update(tab.id, { active: true });
      await sleep(400);

      await ensureChatGptHandoff(tab.id);

      let result = await sendHandoffViaContentScript(tab.id, message, { taskId, composerTimeoutMs });

      if (result?.needsManualSend || (result !== null && !result?.sent)) {
        if (await waitForTaskInChatOnTab(tab.id, taskId, message, 15000)) {
          result = {
            ok: true,
            sent: true,
            method: 'confirmed_after_handoff',
            phase: 'typed_and_sent',
            message,
          };
        }
      }

      if (result === null) {
        if (!(await taskAlreadyVisibleInTab(tab.id, taskId))) {
          result = await runDomHandoffFallback(tab.id, message, {
            taskId,
            composerTimeoutMs,
            sendTimeoutMs,
          });
        } else {
          result = {
            ok: true,
            sent: true,
            method: 'already_sent',
            phase: 'skipped_duplicate',
            message,
          };
        }
      } else if (!result?.sent && !result?.needsManualSend) {
        if (await taskAlreadyVisibleInTab(tab.id, taskId)) {
          result = {
            ok: true,
            sent: true,
            method: 'already_sent',
            phase: 'skipped_duplicate',
            message,
          };
        }
      }

      if (result?.sent) {
        const confirmed = await waitForTaskInChatOnTab(tab.id, taskId, message, 8000)
          || await taskAlreadyVisibleInTab(tab.id, taskId);
        if (confirmed) {
          markTaskHandoffSent(tab.id, taskId);
        } else {
          result = {
            ok: true,
            sent: false,
            needsManualSend: true,
            method: result.method || 'unconfirmed_send',
            message,
            error: 'PROCESS_TASK typed but not confirmed in chat. Click Send manually.',
          };
        }
      } else if (!result?.sent) {
        await setGptTabStatus(tab.id, {
          phase: 'error',
          taskId,
          message: result?.error || 'Could not send PROCESS_TASK',
          type: 'error',
          persistent: false,
        });
      }

      return {
        ok: true,
        tabId: tab.id,
        message: result?.message || message,
        handoff: result,
      };
    };

    const promise = (async () => {
      try {
        const outcome = await runSend();
        if (outcome?.handoff?.sent && outcome.tabId) {
          const confirmed = await taskAlreadyVisibleInTab(outcome.tabId, taskId);
          if (confirmed) {
            completedHandoffsByTaskId.set(taskId, outcome);
          } else if (outcome.handoff) {
            outcome.handoff.sent = false;
            outcome.handoff.needsManualSend = true;
            outcome.handoff.error = outcome.handoff.error
              || 'PROCESS_TASK not confirmed in chat. Click Send in the GPT tab.';
          }
        }
        return outcome;
      } catch (err) {
        const error = err?.message || String(err);
        if (options.tabId) {
          await setGptTabStatus(options.tabId, {
            phase: 'error',
            message: error,
            type: 'error',
            persistent: false,
          }).catch(() => {});
        }
        return {
          ok: false,
          error,
          handoff: {
            ok: false,
            sent: false,
            method: 'gpt_worker_dom',
            phase: 'failed',
            error,
            message,
          },
        };
      }
    })().finally(() => {
      sendLocksByTaskId.delete(taskId);
    });

    sendLocksByTaskId.set(taskId, promise);
    return promise;
  }

  if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (cachedGptTabId === tabId) cachedGptTabId = null;
    });
  }

  global.__qtsGptWorkerHandoff = {
    getGptConfig,
    isCustomGptTabUrl,
    isChatGptHost,
    isQtsGptTab,
    readPinnedGptTabId,
    isPinnedGptTabId,
    ensurePinnedGptTab,
    consolidateDuplicateGptTabs,
    normalizeTaskId,
    buildProcessTaskMessage,
    waitForTabComplete,
    findOrCreateGptTab,
    ensureGptPageReady,
    focusGptBrowserWindow,
    ensureChatGptHandoff,
    setGptTabStatus,
    dismissGptTabStatus,
    startAllowWatchInTab,
    stopAllowWatchInTab,
    clickAllowViaContentScript,
    runInGptTab,
    scrapeAndClickAllowInTab,
    watchGptTabAfterSend,
    sendTaskToCustomGpt,
  };
})(typeof self !== 'undefined' ? self : globalThis);
