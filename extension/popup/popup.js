// popup.js — capture window UI logic

const global = globalThis;

let candidates = [];
let managerTeams = [];
let managerJobAccounts = [];
let jobCategories = [];
let selectedJobAccountIds = new Set();
let existingJobAccountIds = new Set();
let hasManuallyChangedJobAccounts = false;
let jobAssignmentOptionsPromise = null;
let candidateStatuses = {};
let candidateAppliedAt = {};
let candidateLocked = {};
let existingJobId = null;
let scannerSetupPending = false;
let scannerSelectedAccountId = null;
let scannerApplyMode = false;
let currentTabUrl = '';
let pageHighlightStorageKey = '';
let pageHighlightRules = [];
let pageHighlightMigrationMessage = '';
let selectedPageHighlightRuleId = null;
let pageHighlightsReturnView = null;
let pageExclusionsReturnView = null;
let managerPageExclusions = [];
let managerExtensionFeatures = {
  canManageTextHighlights: false,
  canManagePageExclusions: false,
  canUseScanner: false,
  canUseApply: false,
};
let managerExtensionFeaturesError = '';
let currentSource = '';
let targetTabId = null;
let sourceWindowId = null;
let jobSavedInBackend = false;
let currentUser = null;
let pendingGetJdPreview = null;
let candidateStacks = [];
let managerCustomGptAssigned = false;
const expandedCandidateIds = new Set();
let activeApplicationId = null;
let activeTaskId = null;
let detectedApplyTemplate = null;
let gptPipelineRunning = false;
let lastGptTaskStatus = null;
let gptDispatchSent = false;
let gptAppliedToForm = false;
let lastDevCapture = null;
let gptHandoffInProgress = false;
const gptDispatchWaiters = new Map();
let defaultCandidateId = null;
let filterCandidatesTimer = null;
let lastWorkspaceFetchAt = 0;

const CANDIDATE_CACHE_TTL_MS = 5 * 60 * 1000;
const WORKSPACE_BACKGROUND_REFRESH_MIN_MS = 45 * 1000;
const CANDIDATE_CACHE_KEY = 'qtsCandidateCache';
const SESSION_USER_KEY = 'qtsSessionUser';
const DEFAULT_CANDIDATE_KEY = 'qtsDefaultCandidateByAccount';
const LEGACY_DEFAULT_CANDIDATE_KEY = 'qtsDefaultCandidateByBidder';
const AUTO_APPLY_ENABLED_KEY = 'qtsAutoApplyEnabled';
const SELECTED_ACTION_KEY = 'qtsSelectedAction';
const EXTENSION_STATUS_KEY = 'qtsExtensionStatus';
const ACTION_BUTTON_IDS = ['btn-get-jd', 'btn-custom-apply'];
const HIGHLIGHT_COLOR_PALETTE = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Yellow', value: '#facc15' },
  { name: 'Green', value: '#10b981' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Violet', value: '#a855f7' },
  { name: 'Brown', value: '#8b5e34' },
  { name: 'Gray', value: '#6b7280' },
  { name: 'Black', value: '#111827' },
  { name: 'White', value: '#ffffff' },
  { name: 'Soft yellow', value: '#fef08a' },
];

function updateSelectedAction(actionId) {
  for (const buttonId of ACTION_BUTTON_IDS) {
    const button = document.getElementById(buttonId);
    if (!button) continue;
    const isSelected = buttonId === actionId;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  }
}

async function selectAction(actionId) {
  updateSelectedAction(actionId);
  await chrome.storage.local.set({ [getSelectedActionStorageKey()]: actionId });
}

function getSelectedActionStorageKey() {
  return sourceWindowId == null ? SELECTED_ACTION_KEY : `${SELECTED_ACTION_KEY}:window:${sourceWindowId}`;
}

async function restoreSelectedAction() {
  const storageKey = getSelectedActionStorageKey();
  const legacyTabKey = targetTabId == null ? null : `${SELECTED_ACTION_KEY}:${targetTabId}`;
  const keys = [storageKey, SELECTED_ACTION_KEY, ...(legacyTabKey ? [legacyTabKey] : [])];
  const stored = await chrome.storage.local.get(keys);
  const actionId = stored[storageKey] ?? stored[legacyTabKey] ?? stored[SELECTED_ACTION_KEY];
  if (stored[storageKey] == null && actionId != null && sourceWindowId != null) {
    await chrome.storage.local.set({ [storageKey]: actionId });
    if (stored[legacyTabKey] == null && stored[SELECTED_ACTION_KEY] != null) {
      await chrome.storage.local.remove([SELECTED_ACTION_KEY]);
    }
  }
  const selectedAction = ACTION_BUTTON_IDS.includes(actionId) ? actionId : null;
  updateSelectedAction(selectedAction);
  return selectedAction;
}

function setPageHighlightStatus(message, isError = false) {
  const status = document.getElementById('page-highlights-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function setPageExclusionsStatus(message, isError = false) {
  const status = document.getElementById('page-exclusions-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

async function refreshPageExclusions() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_MANAGER_PAGE_EXCLUSIONS' });
  if (!response?.ok || !Array.isArray(response.exclusions)) {
    throw new Error(response?.error || 'Could not load excluded URLs.');
  }
  managerPageExclusions = response.exclusions.filter((entry) =>
    entry && typeof entry.id === 'string' && typeof entry.url === 'string',
  );
  const list = document.getElementById('page-exclusion-list');
  if (!list) return;
  list.replaceChildren();
  if (!managerPageExclusions.length) {
    const empty = document.createElement('li');
    empty.className = 'page-highlight-list-empty';
    empty.textContent = 'No website URLs are excluded.';
    list.appendChild(empty);
  } else {
    for (const exclusion of managerPageExclusions) {
      const item = document.createElement('li');
      item.className = 'page-exclusion-list-item';
      const url = document.createElement('span');
      url.textContent = exclusion.url;
      const remove = document.createElement('button');
      remove.className = 'btn btn-ghost btn-sm';
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove excluded URL ${exclusion.url}`);
      remove.addEventListener('click', () => {
        removePageExclusion(exclusion.id).catch((error) => {
          setPageExclusionsStatus(error.message || 'Could not remove this URL.', true);
        });
      });
      item.append(url, remove);
      list.appendChild(item);
    }
  }
  setPageExclusionsStatus(
    managerPageExclusions.length
      ? `${managerPageExclusions.length} excluded URL(s) are active for this Manager.`
      : 'No excluded URLs are configured.',
  );
  scheduleFitPopup();
}

async function addPageExclusion(url) {
  const response = await chrome.runtime.sendMessage({
    type: 'ADD_MANAGER_PAGE_EXCLUSION',
    url,
  });
  if (!response?.ok) throw new Error(response?.error || 'Could not exclude this URL.');
  managerPageExclusions = response.exclusions || [];
  document.getElementById('page-exclusion-url').value = '';
  await refreshPageExclusions();
}

async function removePageExclusion(exclusionId) {
  const response = await chrome.runtime.sendMessage({
    type: 'DELETE_MANAGER_PAGE_EXCLUSION',
    exclusionId,
  });
  if (!response?.ok) throw new Error(response?.error || 'Could not remove this URL.');
  managerPageExclusions = response.exclusions || [];
  await refreshPageExclusions();
}

function createHighlightColorInput(label, value, inputId = '') {
  const wrapper = document.createElement('fieldset');
  wrapper.className = 'page-highlight-field page-highlight-color-field';
  const caption = document.createElement('legend');
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : HIGHLIGHT_COLOR_PALETTE[0].value;
  if (inputId) input.id = inputId;
  const options = document.createElement('div');
  options.className = 'page-highlight-color-options';
  options.setAttribute('role', 'radiogroup');
  options.setAttribute('aria-label', label);
  const currentColor = input.value.toLowerCase();
  const colors = HIGHLIGHT_COLOR_PALETTE.some((color) => color.value === currentColor)
    ? HIGHLIGHT_COLOR_PALETTE
    : [{ name: 'Current color', value: input.value }, ...HIGHLIGHT_COLOR_PALETTE];
  const buttons = [];

  function selectColor(button, focus = false) {
    input.value = button.dataset.color;
    for (const option of buttons) {
      const selected = option === button;
      option.setAttribute('aria-checked', String(selected));
      option.tabIndex = selected ? 0 : -1;
      option.classList.toggle('is-selected', selected);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (focus) button.focus();
  }

  for (const color of colors) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'page-highlight-color-option';
    button.dataset.color = color.value;
    button.style.setProperty('--highlight-color', color.value);
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', `${label}: ${color.name} (${color.value})`);
    button.title = `${color.name} (${color.value})`;
    const selected = color.value.toLowerCase() === currentColor;
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.classList.toggle('is-selected', selected);
    button.addEventListener('click', () => selectColor(button));
    button.addEventListener('keydown', (event) => {
      const currentIndex = buttons.indexOf(button);
      let nextIndex;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % buttons.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = buttons.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      selectColor(buttons[nextIndex], true);
    });
    buttons.push(button);
    options.append(button);
  }

  wrapper.append(caption, options, input);
  return { wrapper, input };
}

function initializePageHighlightColorPickers() {
  const textColorSlot = document.getElementById('page-highlight-text-color-picker');
  const backgroundColorSlot = document.getElementById('page-highlight-background-color-picker');
  if (textColorSlot) {
    const picker = createHighlightColorInput('Text color', '#111827', 'page-highlight-text-color');
    textColorSlot.replaceWith(picker.wrapper);
  }
  if (backgroundColorSlot) {
    const picker = createHighlightColorInput('Background color', '#fef08a', 'page-highlight-background-color');
    backgroundColorSlot.replaceWith(picker.wrapper);
  }
}

function initializePageHighlightPreview() {
  const previewSlot = document.getElementById('page-highlight-form-preview');
  const text = document.getElementById('page-highlight-text');
  if (!previewSlot || !text) return;
  const preview = createHighlightPreview(
    text.value,
    document.getElementById('page-highlight-text-color')?.value || '#111827',
    document.getElementById('page-highlight-background-color')?.value || '#fef08a'
  );
  previewSlot.replaceWith(preview);
  document.getElementById('page-highlight-form')?.addEventListener('input', () => {
    updatePageHighlightEditorPreview();
  });
}

function createHighlightPreview(text, textColor, backgroundColor) {
  const preview = document.createElement('div');
  preview.className = 'page-highlight-preview';
  const label = document.createElement('span');
  label.className = 'page-highlight-preview-label';
  label.textContent = 'Live preview';
  const sample = document.createElement('p');
  sample.className = 'page-highlight-preview-sample';
  const leadIn = document.createElement('span');
  leadIn.textContent = 'Example: ';
  const mark = document.createElement('mark');
  mark.className = 'page-highlight-preview-mark';
  const phrase = String(text || '').trim();
  mark.textContent = phrase || 'Your text';
  mark.style.color = textColor;
  mark.style.backgroundColor = backgroundColor;
  mark.classList.toggle('is-placeholder', !phrase);
  sample.append(leadIn, mark);
  preview.append(label, sample);
  return preview;
}

function updateHighlightPreview(preview, text, textColor, backgroundColor) {
  const sample = preview?.querySelector('.page-highlight-preview-sample');
  const mark = preview?.querySelector('.page-highlight-preview-mark');
  if (!sample || !mark) return;
  const phrase = String(text.value || '').trim();
  mark.textContent = phrase || 'Your text';
  mark.style.color = textColor.value;
  mark.style.backgroundColor = backgroundColor.value;
  mark.classList.toggle('is-placeholder', !phrase);
  sample.setAttribute('aria-label', `Live preview: ${phrase || 'Your text'}`);
}

function updatePageHighlightEditorPreview() {
  const preview = document.querySelector('#page-highlight-form .page-highlight-preview');
  const text = document.getElementById('page-highlight-text');
  const textColor = document.getElementById('page-highlight-text-color');
  const backgroundColor = document.getElementById('page-highlight-background-color');
  if (!text || !textColor || !backgroundColor) return;
  updateHighlightPreview(preview, text, textColor, backgroundColor);
}

function setPageHighlightColor(inputId, value) {
  const input = document.getElementById(inputId);
  const wrapper = input?.closest('.page-highlight-color-field');
  if (!wrapper) return;
  const label = wrapper.querySelector('legend')?.textContent || 'Color';
  const picker = createHighlightColorInput(label, value, inputId);
  wrapper.replaceWith(picker.wrapper);
}

function pageHighlightEditorHasUnsavedChanges() {
  const selectedRule = pageHighlightRules.find((rule) => rule.id === selectedPageHighlightRuleId);
  if (!selectedRule) return false;
  return document.getElementById('page-highlight-text')?.value !== selectedRule.text ||
    document.getElementById('page-highlight-text-color')?.value !== selectedRule.textColor ||
    document.getElementById('page-highlight-background-color')?.value !== selectedRule.backgroundColor;
}

function confirmDiscardPageHighlightChanges() {
  return !pageHighlightEditorHasUnsavedChanges() ||
    window.confirm('Discard unsaved changes to this highlight rule?');
}

function syncPageHighlightEditor() {
  let selectedRule = pageHighlightRules.find((rule) => rule.id === selectedPageHighlightRuleId);
  if (!selectedRule) {
    selectedPageHighlightRuleId = null;
    selectedRule = null;
  }
  const textInput = document.getElementById('page-highlight-text');
  const submitButton = document.getElementById('page-highlight-submit');
  const cancelButton = document.getElementById('page-highlight-cancel');
  const deleteButton = document.getElementById('page-highlight-delete');
  if (!textInput || !submitButton || !cancelButton || !deleteButton) return;

  if (selectedRule) {
    textInput.value = selectedRule.text;
    setPageHighlightColor('page-highlight-text-color', selectedRule.textColor);
    setPageHighlightColor('page-highlight-background-color', selectedRule.backgroundColor);
    submitButton.textContent = 'Save changes';
    cancelButton.classList.remove('hidden');
    deleteButton.classList.remove('hidden');
  } else {
    textInput.value = '';
    setPageHighlightColor('page-highlight-text-color', '#111827');
    setPageHighlightColor('page-highlight-background-color', '#fef08a');
    submitButton.textContent = 'Add rule';
    cancelButton.classList.add('hidden');
    deleteButton.classList.add('hidden');
  }
  updatePageHighlightEditorPreview();
  document.querySelectorAll('.page-highlight-rule-select').forEach((button) => {
    const selected = button.dataset.ruleId === selectedPageHighlightRuleId;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('is-selected', selected);
  });
}

function renderPageHighlightRules() {
  const list = document.getElementById('page-highlight-list');
  if (!list) return;
  list.replaceChildren();
  for (const rule of pageHighlightRules) {
    const item = document.createElement('li');
    item.className = 'page-highlight-rule';
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'page-highlight-rule-select';
    select.dataset.ruleId = rule.id;
    select.setAttribute('aria-pressed', String(rule.id === selectedPageHighlightRuleId));
    select.classList.toggle('is-selected', rule.id === selectedPageHighlightRuleId);
    select.setAttribute('aria-label', `Edit highlight rule: ${rule.text}`);
    const mark = document.createElement('mark');
    mark.className = 'page-highlight-rule-text';
    mark.textContent = rule.text;
    mark.style.color = rule.textColor;
    mark.style.backgroundColor = rule.backgroundColor;
    const editLabel = document.createElement('span');
    editLabel.className = 'page-highlight-rule-edit-label';
    editLabel.textContent = 'Edit';
    select.append(mark, editLabel);
    select.addEventListener('click', () => {
      if (selectedPageHighlightRuleId === rule.id) return;
      if (!confirmDiscardPageHighlightChanges()) return;
      selectedPageHighlightRuleId = rule.id;
      syncPageHighlightEditor();
      setPageHighlightStatus(`Editing “${rule.text}”. Preview changes, then save them.`);
      document.getElementById('page-highlight-text')?.focus();
    });
    item.append(select);
    list.append(item);
  }
  if (!pageHighlightRules.length) {
    const empty = document.createElement('li');
    empty.className = 'page-highlight-list-empty';
    empty.textContent = 'No shared highlight rules saved yet.';
    list.append(empty);
  }
  syncPageHighlightEditor();
}

async function ensurePageHighlightContext() {
  if (currentUser?.role !== 'manager' || !managerExtensionFeatures.canManageTextHighlights) {
    throw new Error('Super must assign text highlight management to this Manager account.');
  }
  if (!targetTabId) {
    throw new Error('No current web page is selected. Open the extension from a web page and try again.');
  }
  const tab = await chrome.tabs.get(targetTabId);
  const pageUrl = new URL(tab.url || '');
  if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
    throw new Error('Text highlights are available on HTTP and HTTPS pages only.');
  }
  pageHighlightStorageKey = window.__qtsTextHighlighting.getGlobalStorageKey();
  const stored = await chrome.storage.local.get(null);
  const migration = window.__qtsTextHighlighting.migratePageRules(stored);
  const response = await window.api.getGlobalTextHighlights();
  if (!response.success || !Array.isArray(response.rules)) {
    throw new Error(response.message || 'Could not load shared text highlight rules.');
  }
  pageHighlightRules = window.__qtsTextHighlighting.normalizeRules(response.rules);
  pageHighlightMigrationMessage = '';

  if (migration.rules.length && window.confirm(
    `Found ${migration.rules.length} text highlight rule(s) saved only in this Chrome profile. Import them into the shared database so all Managers can see them?`
  )) {
    const importedTexts = new Set(pageHighlightRules.map((rule) => rule.text.toLocaleLowerCase()));
    const existingIds = new Set(pageHighlightRules.map((rule) => rule.id));
    for (const legacyRule of migration.rules) {
      const textKey = legacyRule.text.toLocaleLowerCase();
      if (importedTexts.has(textKey)) continue;
      const rule = {
        ...legacyRule,
        id: existingIds.has(legacyRule.id) ? crypto.randomUUID() : legacyRule.id,
      };
      const imported = await window.api.createGlobalTextHighlight(rule);
      if (!imported.success || !Array.isArray(imported.rules)) {
        if (imported._httpStatus === 409) {
          const latest = await window.api.getGlobalTextHighlights();
          if (latest.success && Array.isArray(latest.rules) &&
              latest.rules.some((saved) => String(saved.text).toLocaleLowerCase() === textKey)) {
            pageHighlightRules = window.__qtsTextHighlighting.normalizeRules(latest.rules);
            importedTexts.add(textKey);
            continue;
          }
        }
        throw new Error(imported.message || `Could not import the saved rule “${legacyRule.text}”.`);
      }
      pageHighlightRules = window.__qtsTextHighlighting.normalizeRules(imported.rules);
      importedTexts.add(textKey);
      existingIds.add(rule.id);
    }
    if (migration.legacyKeys.length) await chrome.storage.local.remove(migration.legacyKeys);
    pageHighlightMigrationMessage = ' Existing local rules were imported into the shared database.';
  } else if (migration.rules.length) {
    pageHighlightMigrationMessage = ' Existing local-only rules were kept; import them later from this panel.';
  }
  await chrome.storage.local.set({
    [pageHighlightStorageKey]: pageHighlightRules,
    [window.__qtsTextHighlighting.getGlobalStorageTimestampKey()]: Date.now(),
  });
  renderPageHighlightRules();
}

async function persistPageHighlightRules(response, successMessage, selectedRuleId = null) {
  if (!response.success || !Array.isArray(response.rules)) {
    throw new Error(response.message || 'Could not save shared text highlight rules.');
  }
  pageHighlightRules = window.__qtsTextHighlighting.normalizeRules(response.rules);
  selectedPageHighlightRuleId = pageHighlightRules.some((rule) => rule.id === selectedRuleId)
    ? selectedRuleId
    : null;
  await chrome.storage.local.set({
    [pageHighlightStorageKey]: pageHighlightRules,
    [window.__qtsTextHighlighting.getGlobalStorageTimestampKey()]: Date.now(),
  });
  renderPageHighlightRules();
  setPageHighlightStatus(`${successMessage}${pageHighlightMigrationMessage}`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ['shared/text-highlighting.js', 'content/text-highlighter.js'],
    });
  } catch (error) {
    throw new Error(`Rule saved, but it could not be applied to this page: ${error.message || 'page access was denied.'}`);
  }
}

async function savePageHighlightRule(ruleId, updatedRule) {
  if (!pageHighlightStorageKey) await ensurePageHighlightContext();
  if (!pageHighlightRules.some((rule) => rule.id === ruleId)) throw new Error('This highlight rule no longer exists. Refresh the rule list.');
  const response = await window.api.updateGlobalTextHighlight(ruleId, {
    text: updatedRule.text,
    textColor: updatedRule.textColor,
    backgroundColor: updatedRule.backgroundColor,
  });
  await persistPageHighlightRules(response, 'Shared highlight rule updated.', ruleId);
}

async function deletePageHighlightRule(ruleId) {
  if (!pageHighlightStorageKey) await ensurePageHighlightContext();
  if (!pageHighlightRules.some((rule) => rule.id === ruleId)) throw new Error('This highlight rule no longer exists. Refresh the rule list.');
  const response = await window.api.deleteGlobalTextHighlight(ruleId);
  await persistPageHighlightRules(response, 'Shared highlight rule deleted.');
}

async function addPageHighlightRule(rule) {
  if (!pageHighlightStorageKey) await ensurePageHighlightContext();
  const response = await window.api.createGlobalTextHighlight(rule);
  await persistPageHighlightRules(response, 'Shared highlight rule added.');
}

async function showPageHighlights() {
  const panel = document.getElementById('page-highlights');
  if (!panel) return;
  if (currentUser?.role !== 'manager' || !managerExtensionFeatures.canManageTextHighlights) {
    hidePageHighlights();
    return;
  }
  if (!pageHighlightsReturnView) {
    pageHighlightsReturnView = document.getElementById('job-section')?.classList.contains('hidden')
      ? 'action'
      : 'job';
  }
  document.getElementById('login-section')?.classList.add('hidden');
  document.getElementById('action-section')?.classList.add('hidden');
  document.getElementById('job-section')?.classList.add('hidden');
  document.getElementById('action-bar')?.classList.add('hidden');
  document.getElementById('page-exclusions')?.classList.add('hidden');
  panel.classList.remove('hidden');
  document.querySelectorAll('.btn-text-highlights').forEach((button) => {
    button.setAttribute('aria-expanded', 'true');
  });
  panel.scrollIntoView({ block: 'start' });
  scheduleFitPopup();
  setPageHighlightStatus('Loading shared database rules…');
  try {
    await ensurePageHighlightContext();
    await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ['shared/text-highlighting.js', 'content/text-highlighter.js'],
    });
    const status = pageHighlightRules.length
      ? `${pageHighlightRules.length} shared rule(s) loaded from the database.`
      : 'No shared highlight rules saved yet.';
    setPageHighlightStatus(`${status}${pageHighlightMigrationMessage}`);
  } catch (error) {
    setPageHighlightStatus(error.message || 'Could not load global highlights.', true);
  } finally {
    scheduleFitPopup();
  }

}

function hidePageHighlights() {
  document.getElementById('page-highlights')?.classList.add('hidden');
  document.querySelectorAll('.btn-text-highlights').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function returnFromPageHighlights() {
  if (new URLSearchParams(window.location.search).get('panel') === 'text-highlights') {
    window.parent.postMessage({ type: 'QTS_CLOSE_TEXT_HIGHLIGHTS' }, '*');
    return;
  }
  const returnView = pageHighlightsReturnView;
  pageHighlightsReturnView = null;
  hidePageHighlights();
  document.getElementById('login-section')?.classList.add('hidden');
  if (returnView === 'job') {
    document.getElementById('action-section')?.classList.add('hidden');
    document.getElementById('job-section')?.classList.remove('hidden');
    document.getElementById('action-bar')?.classList.remove('hidden');
  } else {
    document.getElementById('job-section')?.classList.add('hidden');
    document.getElementById('action-section')?.classList.remove('hidden');
    document.getElementById('action-bar')?.classList.add('hidden');
  }
  scheduleFitPopup();
}

async function showPageExclusions() {
  const panel = document.getElementById('page-exclusions');
  if (!panel) return;
  await refreshManagerExtensionFeatures();
  if (currentUser?.role !== 'manager' || !managerExtensionFeatures.canManagePageExclusions) {
    hidePageExclusions();
    const alertId = document.getElementById('job-section')?.classList.contains('hidden')
      ? 'action-alert'
      : 'main-alert';
    showAlert(
      alertId,
      managerExtensionFeaturesError || 'Super must assign page exclusion management to this Manager account.',
      'error',
    );
    return;
  }
  if (!pageExclusionsReturnView) {
    pageExclusionsReturnView = document.getElementById('job-section')?.classList.contains('hidden')
      ? 'action'
      : 'job';
  }
  document.getElementById('login-section')?.classList.add('hidden');
  document.getElementById('action-section')?.classList.add('hidden');
  document.getElementById('job-section')?.classList.add('hidden');
  document.getElementById('action-bar')?.classList.add('hidden');
  document.getElementById('page-highlights')?.classList.add('hidden');
  panel.classList.remove('hidden');
  document.querySelectorAll('.btn-page-exclusions').forEach((button) => {
    button.setAttribute('aria-expanded', 'true');
  });
  setPageExclusionsStatus('Loading excluded URLs…');
  try {
    await refreshPageExclusions();
  } catch (error) {
    setPageExclusionsStatus(error.message || 'Could not load excluded URLs.', true);
  } finally {
    panel.scrollIntoView({ block: 'start' });
    scheduleFitPopup();
  }
}

function hidePageExclusions() {
  document.getElementById('page-exclusions')?.classList.add('hidden');
  document.querySelectorAll('.btn-page-exclusions').forEach((button) => {
    button.setAttribute('aria-expanded', 'false');
  });
}

function returnFromPageExclusions() {
  if (new URLSearchParams(window.location.search).get('panel') === 'page-exclusions') {
    window.parent.postMessage({ type: 'QTS_CLOSE_TEXT_HIGHLIGHTS' }, '*');
    return;
  }
  const returnView = pageExclusionsReturnView;
  pageExclusionsReturnView = null;
  hidePageExclusions();
  document.getElementById('login-section')?.classList.add('hidden');
  if (returnView === 'job') {
    document.getElementById('action-section')?.classList.add('hidden');
    document.getElementById('job-section')?.classList.remove('hidden');
    document.getElementById('action-bar')?.classList.remove('hidden');
  } else {
    document.getElementById('job-section')?.classList.add('hidden');
    document.getElementById('action-section')?.classList.remove('hidden');
    document.getElementById('action-bar')?.classList.add('hidden');
  }
  scheduleFitPopup();
}

async function openPageHighlights() {
  const panel = document.getElementById('page-highlights');
  if (!panel) return;
  await refreshManagerExtensionFeatures();
  if (!managerExtensionFeatures.canManageTextHighlights) {
    if (!panel.classList.contains('hidden')) returnFromPageHighlights();
    else hidePageHighlights();
    const alertId = document.getElementById('job-section')?.classList.contains('hidden')
      ? 'action-alert'
      : 'main-alert';
    showAlert(
      alertId,
      managerExtensionFeaturesError || 'Super must assign text highlight management to this Manager account.',
      'error'
    );
    return;
  }
  await showPageHighlights();
}

function confirmGetJobDetails() {
  const dialog = document.getElementById('get-jd-confirmation');
  if (!dialog) {
    throw new Error('Get JD confirmation dialog is unavailable. Reload the extension.');
  }

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'yes');
    }, { once: true });
    dialog.showModal();
  });
}

async function hydrateApplySessionStore() {
  const store = global.__qtsApplySessionStore;
  if (!store?.hydrate) return;
  await store.hydrate();
  const active = store.getActive();
  if (!active) return;
  if (active.applicationId != null) activeApplicationId = active.applicationId;
  if (active.taskId != null) activeTaskId = active.taskId;
}

async function persistActiveApplySession(patch) {
  const store = global.__qtsApplySessionStore;
  if (!store?.setActive) return null;
  const active = await store.setActive(patch);
  if (active?.applicationId != null) activeApplicationId = active.applicationId;
  if (active?.taskId != null) activeTaskId = active.taskId;
  return active;
}

let loadingCount = 0;

function showLoading(message = 'Loading…') {
  loadingCount += 1;
  const overlay = document.getElementById('loading-overlay');
  const text = document.getElementById('loading-text');
  if (text) text.textContent = message;
  if (overlay) {
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-busy', 'true');
  }
}

function hideLoading(force = false) {
  if (force) loadingCount = 0;
  else loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount > 0) return;

  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-busy', 'false');
}

async function withLoading(task, message = 'Loading…') {
  showLoading(message);
  try {
    return await task();
  } finally {
    hideLoading();
  }
}

function applyPopupScrollArea() {
  const scroll = document.querySelector('.popup-scroll');
  if (!scroll) return;
  const top = document.querySelector('.popup-top')?.offsetHeight || 0;
  const actionBar = document.getElementById('action-bar');
  const actions = actionBar?.classList.contains('hidden') ? 0 : (actionBar?.offsetHeight || 0);
  scroll.style.maxHeight = `${Math.max(120, window.innerHeight - top - actions - 8)}px`;
}

function fitPopupWindow() {
  applyPopupScrollArea();
}

let fitPopupQueued = false;
function scheduleFitPopup() {
  if (fitPopupQueued) return;
  fitPopupQueued = true;
  requestAnimationFrame(() => {
    fitPopupQueued = false;
    fitPopupWindow();
  });
}

function getQueryTabId() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('tabId');
  if (!raw) return null;
  const tabId = parseInt(raw, 10);
  return Number.isFinite(tabId) ? tabId : null;
}

async function scanAndSaveSiteDiscoveryStep() {
  const button = document.getElementById('btn-discover-site-step');
  const status = document.getElementById('site-discovery-status');
  if (button) button.disabled = true;
  const isManagerScanner = currentUser?.role === 'manager';
  if (status) status.textContent = isManagerScanner
    ? 'Scanning the current application step…'
    : 'Scanning the current page read-only…';

  try {
    if (!targetTabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      targetTabId = activeTab?.id || null;
    }
    if (!targetTabId) throw new Error('No source tab is selected. Open the application step and retry.');

    if (isManagerScanner) {
      await prepareManagerScannerJob(targetTabId, status, scannerApplyMode);
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'DISCOVER_APPLICATION_FORM',
      tabId: targetTabId,
      openApplyForm: false,
      expandDynamic: false,
      mode: 'DISCOVERY',
      readOnly: true,
    });
    if (!response?.success) {
      throw new Error(response?.error || 'The current page could not be scanned.');
    }

    const stepCount = response.templateSave?.checkpoint?.steps?.length || 1;
    if (!response.templateSave?.success) {
      const error = response.templateSave?.message || 'Template checkpoint could not be persisted.';
      if (status) status.textContent = `Scanned ${response.discovery?.fields?.length || 0} field(s), but saving failed: ${error}`;
      return;
    }

    const fieldCount = response.discovery?.fields?.length || 0;
    const reused = response.templateReuse?.found
      ? ` Existing ${response.templateReuse.status} template was rechecked with the generic scanner.`
      : '';
    const lookupWarning = response.templateLookupError
      ? ` Template lookup warning: ${response.templateLookupError}`
      : '';
    if (status) {
      status.textContent = `Saved structural checkpoint: ${stepCount} observed step(s), ${fieldCount} field(s) on this page. No values or DOM were saved; no page action was activated.${reused}${lookupWarning}`;
    }
  } catch (error) {
    if (status) status.textContent = error?.message || 'Could not scan and save this discovery step.';
    if (isManagerScanner) {
      scannerSetupPending = false;
      scannerSelectedAccountId = null;
      scannerApplyMode = false;
      document.getElementById('btn-save-and-scan')?.classList.add('hidden');
      const saveStatus = document.getElementById('scanner-save-status');
      if (saveStatus) {
        saveStatus.classList.remove('hidden');
        saveStatus.textContent = error?.message || 'Could not prepare Scanner.';
      }
      if (targetTabId) {
        notifyScannerStage(targetTabId, saveStatus, error?.message || 'Could not prepare Scanner.', 'error', 12000)
          .catch((noticeError) => console.warn('Could not display the Scanner setup error on the job page:', noticeError));
      }
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function scannerSemanticKey(question) {
  return String(question || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 100);
}

function scannerAccountProfileChoices(account) {
  const choices = [
    ['profile.first_name', 'First name', account.first_name],
    ['profile.last_name', 'Last name', account.last_name],
    ['profile.email', 'Email', account.email],
    ['profile.phone', 'Phone', account.phone],
    ['profile.address', 'Address', account.address],
    ['profile.city', 'City', account.city],
    ['profile.country', 'Country', account.country],
    ['profile.sex', 'Sex', account.sex],
    ['profile.birthday', 'Date of birth', account.birthday],
  ];
  const customAnswers = Array.isArray(account.custom_answers) ? account.custom_answers : [];
  customAnswers.forEach((item, index) => {
    if (!item || typeof item !== 'object' || !item.answer) return;
    choices.push([
      `account_custom:${String(item.topic || index).slice(0, 80)}`,
      `Account Q&A: ${String(item.question || item.topic || 'Saved answer').slice(0, 90)}`,
      item.answer,
    ]);
  });
  return choices;
}

function scannerResolveProfileValue(account, profileFieldKey) {
  if (!profileFieldKey) return '';
  if (profileFieldKey.startsWith('profile.')) {
    const field = profileFieldKey.slice('profile.'.length);
    const value = account[field];
    return value == null || typeof value === 'object' ? '' : String(value);
  }
  if (profileFieldKey.startsWith('account_custom:')) {
    const topic = profileFieldKey.slice('account_custom:'.length);
    const match = (Array.isArray(account.custom_answers) ? account.custom_answers : [])
      .find((entry) => String(entry?.topic || '') === topic);
    return typeof match?.answer === 'string' ? match.answer : '';
  }
  return '';
}

function scannerFieldSnapshot(field) {
  const capture = field.scannerCapture || {};
  return {
    fieldType: String(field.fieldType || 'unknown'),
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options.map((item) => String(item).slice(0, 300)).slice(0, 100) : [],
    validation: window.__qtsScannerCapture.captureValidation(field),
    section: String(field.sectionHeading || '').slice(0, 200),
    selectorHints: window.__qtsScannerCapture?.captureEvidence(field)?.selectorHints || {},
    domEvidence: window.__qtsScannerCapture?.captureEvidence(field)?.domEvidence || null,
    captureCount: Number(capture.captureCount || 1),
    captureVerified: capture.captureVerified === true,
    managerReviewed: capture.managerReviewed === true,
    fieldIdentityConfirmed: capture.fieldIdentityConfirmed === true,
    observations: Array.isArray(capture.observations) ? capture.observations : [],
    fieldSnapshots: Array.isArray(capture.fieldSnapshots) ? capture.fieldSnapshots : [],
  };
}

function scannerRuleChanged(rule, field) {
  const oldQuestion = String(rule.question || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const newQuestion = String(field.label || field.question || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const oldSnapshot = rule.field_snapshot || {};
  const newSnapshot = scannerFieldSnapshot(field);
  const evidenceChanges = window.__qtsScannerCapture.meaningfulFieldChanges({
    label: rule.question,
    fieldType: oldSnapshot.fieldType,
    required: oldSnapshot.required,
    options: oldSnapshot.options,
    validation: oldSnapshot.validation,
    sectionHeading: oldSnapshot.section,
    selectorHints: oldSnapshot.selectorHints,
    domEvidence: oldSnapshot.domEvidence,
  }, field).changes;
  const locatorChanged = evidenceChanges.some((change) => (
    oldSnapshot.domEvidence || !['DOM structure', 'class-based locator evidence'].includes(change)
  ));
  return oldQuestion !== newQuestion
    || String(oldSnapshot.fieldType || '') !== newSnapshot.fieldType
    || Boolean(oldSnapshot.required) !== newSnapshot.required
    || JSON.stringify(oldSnapshot.options || []) !== JSON.stringify(newSnapshot.options)
    || JSON.stringify(oldSnapshot.validation || {}) !== JSON.stringify(newSnapshot.validation)
    || String(oldSnapshot.section || '') !== newSnapshot.section
    || locatorChanged;
}

function scannerDescribeCaptureField(field) {
  if (!field) return '(field not observed)';
  const hints = field.selectorHints || {};
  const classes = (field.domEvidence?.control?.classNames || []).join(' ') || '(none)';
  return [
    `Question: ${field.label || '(no label)'}`,
    `Type: ${field.fieldType || 'unknown'}; required: ${Boolean(field.required)}`,
    `Locator: ${hints.name ? `name=${hints.name}` : ''}${hints.id ? ` id=${hints.id}` : ''}${hints.testId ? ` testId=${hints.testId}` : ''}`.trim(),
    `Control classes (weak evidence): ${classes}`,
  ].join('\n');
}

async function verifyManagerScannerCapture(tabId, fields, rules, statusElement, automatic = false) {
  const scannerCapture = window.__qtsScannerCapture;
  if (!scannerCapture) throw new Error('Scanner capture reconciliation helper is unavailable.');
  if (!scannerCapture.requiresSecondCapture(fields, rules)) {
    return { fields, outcomes: [], evidenceFields: [], verifiedSecondCapture: false };
  }

  await notifyScannerStage(tabId, statusElement, 'New or changed fields found. Verifying this step with a second read-only capture…');
  const verification = await chrome.runtime.sendMessage({
    type: 'CAPTURE_APPLICATION_STEP',
    tabId,
    managerScanner: !automatic,
    managerApply: automatic,
  });
  if (!verification?.success || !verification.scan) {
    throw new Error(verification?.error || 'Scanner’s second capture failed; no uncertain fields were used.');
  }

  const reconciliation = scannerCapture.reconcileCaptures(fields, verification.scan.fields || []);
  const acceptedFields = [...reconciliation.fields];
  const evidenceFields = [...reconciliation.fields];
  const outcomes = [];
  if (automatic && reconciliation.discrepancies.length) {
    const uncertainIds = new Set(reconciliation.discrepancies.flatMap((discrepancy) => [
      discrepancy.first?.stableFieldId || discrepancy.first?.fieldId,
      discrepancy.second?.stableFieldId || discrepancy.second?.fieldId,
    ].filter(Boolean).map(String)));
    for (const discrepancy of reconciliation.discrepancies) {
      const field = discrepancy.second || discrepancy.first;
      outcomes.push(`${field?.label || 'A field'}: capture is uncertain; Apply paused for Manager review.`);
    }
    return {
      fields: acceptedFields.filter((field) => (
        !uncertainIds.has(String(field.stableFieldId || field.fieldId || ''))
      )),
      outcomes,
      evidenceFields,
      verifiedSecondCapture: true,
    };
  }
  for (const discrepancy of reconciliation.discrepancies) {
    if (discrepancy.kind === 'missing_on_second') {
      evidenceFields.push({
        ...discrepancy.first,
        scannerCapture: {
          captureCount: 2,
          captureVerified: false,
          managerReviewed: false,
          observations: [scannerCapture.captureEvidence(discrepancy.first), null],
          fieldSnapshots: [scannerCapture.captureFieldSnapshot(discrepancy.first), null],
          issues: ['missing_on_second'],
        },
      });
      window.alert(
        `Scanner did not find this field in its second capture, so it will remain untouched:\n\n${scannerDescribeCaptureField(discrepancy.first)}`
      );
      outcomes.push(`${discrepancy.first?.label || 'A field'}: inconsistent between captures; left untouched.`);
      continue;
    }
    if (discrepancy.kind === 'new_on_second') {
      const field = discrepancy.second;
      const reviewedField = scannerCapture.acceptReviewedObservation(field);
      evidenceFields.push({
        ...reviewedField,
        scannerCapture: {
          ...reviewedField.scannerCapture,
          managerReviewed: false,
          issues: ['new_on_second'],
        },
      });
      const accept = window.confirm(
        `This field appeared only in Scanner’s second capture. Review its evidence and confirm whether it is a real field on the current step:\n\n${scannerDescribeCaptureField(field)}\n\nUse this field for Scanner review?`
      );
      if (accept) {
        const accepted = scannerCapture.acceptReviewedObservation(field);
        acceptedFields.push(accepted);
        evidenceFields[evidenceFields.length - 1] = accepted;
      }
      else outcomes.push(`${field?.label || 'A field'}: appeared in only one capture; left untouched.`);
      continue;
    }

    const firstDescription = scannerDescribeCaptureField(discrepancy.first);
    const secondDescription = scannerDescribeCaptureField(discrepancy.second);
    const reviewedField = scannerCapture.acceptReviewedObservation(discrepancy.second, discrepancy.first);
    evidenceFields.push({
      ...reviewedField,
      scannerCapture: {
        ...reviewedField.scannerCapture,
        managerReviewed: false,
        issues: discrepancy.changes || ['changed_between_captures'],
      },
    });
    const accept = window.confirm(
      `Scanner captures disagree (${(discrepancy.changes || []).join(', ')}).\n\nFirst capture:\n${firstDescription}\n\nSecond capture:\n${secondDescription}\n\nUse the second capture for this step? If you choose No, this field remains untouched.`
    );
    if (accept) {
      const accepted = scannerCapture.acceptReviewedObservation(discrepancy.second, discrepancy.first);
      acceptedFields.push(accepted);
      evidenceFields[evidenceFields.length - 1] = accepted;
    }
    else outcomes.push(`${discrepancy.second?.label || discrepancy.first?.label || 'A field'}: capture disagreement; left untouched.`);
  }
  return { fields: acceptedFields, outcomes, evidenceFields, verifiedSecondCapture: true };
}

async function selectScannerAccountForJob() {
  await loadJobAssignmentOptions();
  const accounts = managerJobAccounts.filter((account) => account && Number.isSafeInteger(Number(account.id)) && account.id > 0);
  if (!accounts.length) throw new Error('No active Accounts are assigned to this Manager.');
  const options = accounts.map((account, index) => (
    `${index + 1}. ${account.name || `Account ${account.id}`}${account.username ? ` (${account.username})` : ''}`
  ));
  const answer = window.prompt(`Choose the Account for this application:\n${options.join('\n')}\n\nThe job will be saved for this Account and started for Apply or Scanner.`, '1');
  if (answer == null) throw new Error('Application cancelled; no Account was selected.');
  const selectedIndex = Number(answer) - 1;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= accounts.length) {
    throw new Error('Choose a valid Account number.');
  }
  return accounts[selectedIndex];
}

async function refreshAccountMailboxStatus(accountUserId) {
  const status = document.getElementById('account-mailbox-status');
  const connectButton = document.getElementById('btn-connect-account-mailbox');
  if (!status || !connectButton) return { success: false, connected: false };
  status.classList.remove('hidden');
  status.textContent = 'Checking the selected Account’s Gmail connection…';
  const result = await window.api.getAccountMailboxStatus(accountUserId);
  if (!result.success) {
    connectButton.classList.add('hidden');
    status.textContent = result.message || 'Could not check the Account mailbox connection.';
    return result;
  }
  connectButton.classList.toggle('hidden', result.connected === true);
  status.textContent = result.connected
    ? `Gmail connected read-only: ${result.mailboxEmail || 'verified Account mailbox'}.`
    : 'Gmail is not connected. You can connect it with read-only access to check for application confirmations.';
  return result;
}

async function connectSelectedAccountMailbox() {
  const accountUserId = scannerSelectedAccountId;
  if (!Number.isSafeInteger(accountUserId) || accountUserId <= 0) {
    throw new Error('Select an Account in Apply setup before connecting Gmail.');
  }
  const result = await window.api.startAccountMailboxGoogleConnect(accountUserId);
  if (!result.success || typeof result.authorizationUrl !== 'string') {
    throw new Error(result.message || 'Could not start Account Gmail authorization.');
  }
  const authorizationUrl = new URL(result.authorizationUrl);
  if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== 'accounts.google.com') {
    throw new Error('The server returned an unexpected Gmail authorization URL.');
  }
  await chrome.tabs.create({ url: authorizationUrl.href });
  const status = document.getElementById('account-mailbox-status');
  if (status) {
    status.classList.remove('hidden');
    status.textContent = 'Complete Google authorization with the Account’s matching email address, then return to Apply.';
  }
}

async function prepareManagerScannerJob(tabId, statusElement, autoApply = false) {
  if (currentUser?.role !== 'manager') throw new Error('Only Managers can start Apply or Scanner.');
  if (autoApply) {
    await refreshManagerExtensionFeatures();
    if (!managerExtensionFeatures.canUseApply) {
      throw new Error(managerExtensionFeaturesError || 'Apply is available only to signed-in Managers.');
    }
  } else {
    await assertScannerOutputDirectoryReady();
    await requireScannerFeatureAccess();
  }
  await selectAction('btn-get-jd');
  showJobSection();
  const scanStatus = document.getElementById('scanner-save-status');
  scanStatus?.classList.remove('hidden');
  await notifyScannerStage(
    tabId,
    statusElement,
    autoApply ? 'Preparing Apply: loading job details using Get JD…' : 'Loading job details using Get JD…'
  );
  if (scanStatus) scanStatus.textContent = 'Loading job details using Get JD…';
  await loadCurrentTab({ preferCache: false, allowExtract: true });
  await notifyScannerStage(tabId, statusElement, 'Job details loaded. Checking this Manager’s active Accounts…');

  const account = await selectScannerAccountForJob();
  scannerSelectedAccountId = Number(account.id);
  if (autoApply) {
    await refreshAccountMailboxStatus(scannerSelectedAccountId);
    document.getElementById('btn-connect-account-mailbox')?.classList.toggle(
      'hidden',
      managerExtensionFeatures.canUseApply !== true
    );
  } else {
    document.getElementById('account-mailbox-status')?.classList.add('hidden');
    document.getElementById('btn-connect-account-mailbox')?.classList.add('hidden');
  }
  selectedJobAccountIds = new Set([
    ...existingJobAccountIds,
    scannerSelectedAccountId,
  ]);
  hasManuallyChangedJobAccounts = true;
  renderJobAccountGroups();
  scannerSetupPending = true;

  const scanButton = document.getElementById('btn-save-and-scan');
  if (scanButton) {
    scanButton.classList.remove('hidden');
    scanButton.disabled = false;
    scanButton.textContent = autoApply ? 'Save Job & Apply' : 'Save Job & Scan';
  }
  if (scanStatus) {
    scanStatus.textContent = autoApply
      ? 'Review the extracted job details and selected Account, then choose Save Job & Apply. Apply uses GPT for supported answers, submits only through a unique recognized control, and pauses for unresolved or protected steps.'
      : 'Review the extracted job details and selected Account, then choose Save Job & Scan to save the job and start this Account’s application row.';
  }
  if (statusElement) {
    statusElement.textContent = autoApply
      ? 'Review the job details and Account assignment below, then click Save Job & Apply.'
      : 'Review the job details and Account assignment below, then click Save Job & Scan.';
  }
  await notifyScannerStage(
    tabId,
    statusElement,
    autoApply
      ? 'Review the job details and selected Account in the extension, then choose Save Job & Apply.'
      : 'Review the job details and selected Account in the extension, then choose Save Job & Scan.'
  );
}

async function saveJobAndStartScanner() {
  const autoApply = scannerApplyMode;
  const button = document.getElementById('btn-save-and-scan');
  const applyButton = document.getElementById('btn-apply');
  const status = document.getElementById('scanner-save-status');
  if (!scannerSetupPending || !scannerSelectedAccountId) {
    throw new Error('Scanner setup has expired. Click Scan current step again.');
  }
  if (button) button.disabled = true;
  if (applyButton) applyButton.disabled = true;
  try {
    if (autoApply) {
      await refreshManagerExtensionFeatures();
      if (!managerExtensionFeatures.canUseApply) throw new Error(managerExtensionFeaturesError || 'Apply is unavailable.');
    } else {
      await requireScannerFeatureAccess();
    }
    await notifyScannerStage(targetTabId, status, 'Saving the reviewed job details…');
    const saveResult = await doSave();
    if (!saveResult?.success || !saveResult.job) {
      await notifyScannerStage(targetTabId, status, 'Job was not saved. Scanner did not start.', 'warn');
      return;
    }
    await notifyScannerStage(targetTabId, status, 'Job saved. Checking the selected Account’s application row…');

    const assignedRow = (saveResult.job.selected_accounts || []).find((item) => (
      Number(item.account_user_id) === scannerSelectedAccountId
    ));
    if (!assignedRow?.job_id) {
      throw new Error('The saved job response did not include the selected Account’s job row.');
    }
    const account = managerJobAccounts.find((item) => item.id === scannerSelectedAccountId);
    if (!account) throw new Error('The selected Account is no longer active for this Manager.');
    await saveScannerJobContext(
      saveResult.job,
      account,
      document.getElementById('f-desc')?.value?.trim() || ''
    );
    let jobId = Number(assignedRow.job_id);
    let applyRunId;
    if (assignedRow.status === 'todo') {
      if (!global.crypto?.randomUUID) throw new Error('Secure Apply run IDs are unavailable in this browser.');
      applyRunId = global.crypto.randomUUID();
    } else if (assignedRow.status === 'processing') {
      const runStorageKey = `qtsScannerApplyRun:${scannerSelectedAccountId}:${jobId}`;
      const storedRun = await chrome.storage.local.get(runStorageKey);
      applyRunId = storedRun[runStorageKey];
      if (typeof applyRunId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applyRunId)) {
        throw new Error('This Account row is already processing without a saved Scanner run. Resolve the active run before starting Scanner.');
      }
      const confirmed = await confirmOnJobPage(
        targetTabId,
        autoApply
          ? 'Resume this Account’s existing Apply run on the visible page? A pending submit attempt will only be checked for confirmation; Apply will not click Submit again.'
          : 'You have moved to another application step. Scan only the currently visible step? Scanner will not click Next, change pages, or submit the application.',
        autoApply ? 'Confirm Apply resume' : 'Confirm next step scan'
      );
      if (!confirmed) {
        await notifyScannerStage(targetTabId, status, autoApply
          ? 'Apply resume cancelled. No fields were scanned or filled.'
          : 'Step scan cancelled. No fields were scanned or filled.', 'warn');
        return;
      }
    } else {
      throw new Error(`The selected Account’s job row is ${assignedRow.status}. Set it back to todo before starting Scanner.`);
    }
    const runStorageKey = `qtsScannerApplyRun:${scannerSelectedAccountId}:${jobId}`;
    await chrome.storage.local.set({ [runStorageKey]: applyRunId });
    const claim = await window.api.claimScannerJob({
      jobId,
      accountUserId: scannerSelectedAccountId,
      applyRunId,
      supportedTypes: [saveResult.job.application_type],
      applicationMode: autoApply ? 'apply' : 'scanner',
    });
    if (!claim.success || !claim.claimed || !claim.job?.id) {
      throw new Error(claim.message || 'Could not start or resume the selected Account’s job row for Scanner.');
    }
    jobId = Number(claim.job.id);

    const job = { ...saveResult.job, id: jobId, status: 'processing' };
    scannerSetupPending = false;
    if (button) button.classList.add('hidden');
    await notifyScannerStage(
      targetTabId,
      status,
      autoApply
        ? 'Account application row is ready. Apply will use GPT for supported fields, then submit through a unique recognized control and verify the result.'
        : 'Account application row is ready. Scanning only the visible step; Scanner will not navigate or submit.'
    );
    if (autoApply) {
      const pendingSubmissionKey = `qtsApplySubmissionPending:${account.id}:${jobId}`;
      const pendingSubmission = await chrome.storage.local.get(pendingSubmissionKey);
      if (pendingSubmission[pendingSubmissionKey]) {
        const pending = pendingSubmission[pendingSubmissionKey];
        const confirmation = await resolveApplySubmissionConfirmation(
          account,
          job,
          pending.applyRunId || applyRunId,
          pendingSubmissionKey,
          targetTabId,
          pending.submittedAt,
          pending.submissionConfirmed === true
        );
        const message = confirmation.confirmed
          ? confirmation.message
          : `Apply already clicked Submit for this Account job, but submission is still unconfirmed. ${confirmation.message} Apply will not click Submit again.`;
        await notifyScannerStage(
          targetTabId,
          status,
          message,
          confirmation.confirmed ? 'success' : 'warn',
          15000
        );
        if (status) status.textContent = message;
        return;
      }
      await runManagerApply(targetTabId, status, account, job, applyRunId);
    } else {
      await runManagerScanner(targetTabId, status, account, job);
    }
  } finally {
    scannerApplyMode = false;
    if (button) button.textContent = 'Save Job & Scan';
    if (applyButton) applyButton.disabled = false;
    if (button && scannerSetupPending) button.disabled = false;
  }
}

function scannerTaskField(field, documentSlot) {
  return {
    stableFieldId: String(field.stableFieldId || field.fieldId || '').slice(0, 300),
    label: String(field.label || field.question || 'Application field').slice(0, 1000),
    fieldType: String(field.fieldType || 'text').slice(0, 100),
    validation: window.__qtsScannerCapture.captureValidation(field),
    fieldKey: String(field.nameAttr || field.fieldKey || '').slice(0, 300) || undefined,
    section: String(field.sectionHeading || '').slice(0, 200) || undefined,
    ...(documentSlot ? { documentSlot } : {}),
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options.map((item) => String(item).slice(0, 500)).slice(0, 100) : [],
    ...(field.reusableAnswerContext ? {
      reusableAnswerContext: {
        question: String(field.reusableAnswerContext.question || '').slice(0, 1000),
        answer: String(field.reusableAnswerContext.answer || '').slice(0, 4000),
      },
    } : {}),
    placeholder: String(field.placeholder || '').slice(0, 1000) || undefined,
    manualReview: true,
  };
}

function scannerValidationSummary(field) {
  const validation = window.__qtsScannerCapture.captureValidation(field);
  const requirements = [
    validation.inputType ? `type=${validation.inputType}` : '',
    validation.inputMode ? `input mode=${validation.inputMode}` : '',
    validation.numericOnly ? 'digits only' : '',
    validation.min !== undefined ? `minimum=${validation.min}` : '',
    validation.max !== undefined ? `maximum=${validation.max}` : '',
    validation.step !== undefined ? `step=${validation.step}` : '',
    validation.pattern ? `pattern=${validation.pattern}` : '',
    validation.minLength !== undefined ? `minimum length=${validation.minLength}` : '',
    validation.maxLength !== undefined ? `maximum length=${validation.maxLength}` : '',
    validation.hint ? `page hint=${validation.hint}` : '',
  ].filter(Boolean);
  return requirements.length
    ? `Detected page input requirements: ${requirements.join('; ')}.`
    : 'No explicit input-format constraints were detected.';
}

function scannerTaskPageMatches(existingPage, pageUrl, fields) {
  if (!existingPage || existingPage.pageUrl !== pageUrl || !Array.isArray(existingPage.fields)) return false;
  const projectFields = (items) => items
    .map((field) => ({
      stableFieldId: String(field.stableFieldId || ''),
      label: String(field.label || ''),
      fieldType: String(field.fieldType || ''),
      validation: field.validation || {},
      reusableAnswerContext: field.reusableAnswerContext || null,
      documentSlot: field.documentSlot || null,
      required: Boolean(field.required),
      options: Array.isArray(field.options) ? field.options.map(String) : [],
    }))
    .sort((left, right) => left.stableFieldId.localeCompare(right.stableFieldId));
  return JSON.stringify(projectFields(existingPage.fields)) === JSON.stringify(projectFields(fields));
}

function scannerFieldDocumentSlot(field) {
  return inferFileDocumentType(field) === 'cover-letter' ? 'cover_letter' : 'resume';
}

function scannerChoiceOptions(field) {
  if (!Array.isArray(field?.options)) return [];
  const seen = new Set();
  return field.options
    .map((option) => String(option || '').trim())
    .filter((option) => {
      const key = option.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function scannerIsChoiceField(field) {
  return ['select', 'combobox', 'listbox', 'radio'].includes(String(field?.fieldType || '').toLowerCase());
}

async function reviewScannerAnswer(question, generated, currentValue = '', options = [], validationSummary = '') {
  const dialog = document.getElementById('scanner-answer-review');
  const description = document.getElementById('scanner-answer-review-description');
  const answerInput = document.getElementById('scanner-answer-review-value');
  const choiceInput = document.getElementById('scanner-answer-review-options');
  const answerLabel = document.getElementById('scanner-answer-review-label');
  const approveButton = dialog?.querySelector('button[value="approve"]');
  if (!dialog || !description || !answerInput || !choiceInput || !answerLabel || !approveButton
    || typeof dialog.showModal !== 'function') {
    throw new Error('Generated answer review dialog is unavailable. Reload the extension and try again.');
  }

  const choices = scannerChoiceOptions({ options });
  answerInput.hidden = choices.length > 0;
  choiceInput.hidden = choices.length === 0;
  answerLabel.htmlFor = choices.length ? choiceInput.id : answerInput.id;
  choiceInput.replaceChildren();
  if (choices.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose an available answer';
    placeholder.disabled = true;
    placeholder.selected = true;
    choiceInput.append(placeholder);
    choices.forEach((choice) => {
      const option = document.createElement('option');
      option.value = choice;
      option.textContent = choice;
      choiceInput.append(option);
    });
  }
  const normalizedGenerated = String(generated || '').trim().toLowerCase();
  const exactChoices = choices.filter((choice) => choice.toLowerCase() === normalizedGenerated);
  if (exactChoices.length === 1) choiceInput.value = exactChoices[0];

  const reviewDetails = [
    currentValue ? 'This field already has a value. Approving will replace it.' : '',
    validationSummary,
  ].filter(Boolean).join(' ');
  description.textContent = `${question}${reviewDetails ? ` — ${reviewDetails}` : ''}`;
  answerLabel.textContent = choices.length
    ? 'Choose one of the options found on the application page, then approve it.'
    : 'Edit the answer if needed, then approve it to fill this field.';
  answerInput.value = generated;
  approveButton.textContent = choices.length ? 'Approve selection' : 'Approve answer';
  dialog.returnValue = 'skip';

  const approved = await new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(dialog.returnValue === 'approve');
    };
    dialog.addEventListener('close', onClose);
    try {
      dialog.showModal();
      (choices.length ? choiceInput : answerInput).focus();
    } catch (error) {
      dialog.removeEventListener('close', onClose);
      throw error;
    }
  });

  return approved ? (choices.length ? choiceInput.value : answerInput.value) : null;
}

async function reviewScannerDocument(documentFile, documentType, account, fieldQuestion) {
  const dialog = document.getElementById('scanner-document-review');
  const title = document.getElementById('scanner-document-review-title');
  const description = document.getElementById('scanner-document-review-description');
  const preview = document.getElementById('scanner-document-preview');
  if (!dialog || !title || !description || !preview || typeof dialog.showModal !== 'function') {
    throw new Error('Generated document review dialog is unavailable. Reload the extension and try again.');
  }

  const binary = atob(documentFile.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const previewUrl = URL.createObjectURL(new Blob([bytes], { type: documentFile.mimeType || 'application/pdf' }));
  title.textContent = `Review generated ${documentType === 'cover_letter' ? 'cover letter' : 'resume'}`;
  description.textContent = `${documentFile.fileName} downloaded to ${documentFile.localPath || 'this computer'} for ${account.name || `Account ${account.u_id}`} — requested by: ${fieldQuestion}`;
  preview.src = previewUrl;
  dialog.returnValue = 'reject';

  try {
    const approved = await new Promise((resolve) => {
      const onClose = () => {
        dialog.removeEventListener('close', onClose);
        resolve(dialog.returnValue === 'approve');
      };
      dialog.addEventListener('close', onClose);
      try {
        dialog.showModal();
      } catch (error) {
        dialog.removeEventListener('close', onClose);
        throw error;
      }
    });
    return approved;
  } finally {
    preview.removeAttribute('src');
    setTimeout(() => URL.revokeObjectURL(previewUrl), 30000);
  }
}

const SCANNER_OUTPUT_DIRECTORY_SETTING = 'scannerOutputDirectoryV2';

async function getScannerOutputDirectoryHandle() {
  const store = window.__qtsScannerDocumentStore;
  if (!store?.getSetting) throw new Error('Scanner output-folder storage is unavailable. Reload the extension.');
  const stored = await store.getSetting(SCANNER_OUTPUT_DIRECTORY_SETTING);
  return stored?.value || null;
}

async function selectScannerOutputDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('This Chrome version does not support choosing a Scanner output folder.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new Error('Write access was not granted for the selected Scanner output folder.');
  }
  await window.__qtsScannerDocumentStore.putSetting(SCANNER_OUTPUT_DIRECTORY_SETTING, handle);
  updateScannerOutputFolderStatus(handle);
}

function updateScannerOutputFolderStatus(handle) {
  const status = document.getElementById('scanner-output-folder-status');
  if (!status) return;
  status.classList.remove('hidden');
  if (handle) {
    status.textContent = `Generated files: ${handle.name}/QTS_Startup/${currentUser ? window.__qtsScannerOutputPaths.managerFolder(currentUser) : '<Manager name>'}/<Account name>/<date_time_job_company>/`;
    return;
  }
  status.textContent = `Generated files: Chrome Downloads/QTS_Startup/${currentUser ? window.__qtsScannerOutputPaths.managerFolder(currentUser) : '<Manager name>'}/<Account name>/<date_time_job_company>/. Choose another folder only if needed.`;
}

async function restoreScannerOutputFolderStatus() {
  const handle = await getScannerOutputDirectoryHandle();
  updateScannerOutputFolderStatus(handle);
}

async function assertScannerOutputDirectoryReady() {
  const handle = await getScannerOutputDirectoryHandle();
  if (!handle) {
    if (!chrome.downloads?.download || !chrome.downloads?.onChanged || !chrome.downloads?.search) {
      throw new Error('Chrome Downloads access is unavailable. Reload the extension and allow its Downloads permission.');
    }
    return;
  }
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('Scanner needs write access to the selected folder. Choose it again using “Choose files folder”.');
  }
}

function waitForChromeDownload(downloadId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (error) reject(error);
      else resolve();
    };
    const inspect = (item) => {
      if (item?.state === 'complete') finish();
      else if (item?.state === 'interrupted') {
        finish(new Error(`Chrome could not save Scanner output: ${item.error || 'download interrupted'}.`));
      }
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') finish();
      else if (delta.state?.current === 'interrupted' || delta.error?.current) {
        finish(new Error(`Chrome could not save Scanner output: ${delta.error?.current || 'download interrupted'}.`));
      }
    };
    const timeout = setTimeout(
      () => finish(new Error('Timed out while waiting for Chrome to save Scanner output.')),
      120000
    );
    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        finish(new Error(`Could not check Scanner download status: ${error.message}`));
        return;
      }
      inspect(items?.[0]);
    });
  });
}

async function saveScannerFileToChromeDownloads(path, contents, mimeType) {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: objectUrl,
        filename: path,
        saveAs: false,
        conflictAction: 'overwrite',
      }, (id) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(`Chrome could not start the Scanner download: ${error.message}`));
        else resolve(id);
      });
    });
    await waitForChromeDownload(downloadId);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function createScannerOutputFile(taskId, account, jobContext, type, contents, mimeType) {
  const handle = await getScannerOutputDirectoryHandle();
  const outputPaths = window.__qtsScannerOutputPaths;
  if (!outputPaths?.artifactName || !outputPaths?.downloadPath || !outputPaths?.relativePath) {
    throw new Error('Scanner output filename helper is unavailable. Reload the extension and retry.');
  }

  const timestampKey = `qtsScannerOutputTimestamp:${taskId}`;
  const storedTimestamp = await chrome.storage.local.get(timestampKey);
  const timestamp = storedTimestamp[timestampKey] || new Date().toISOString();
  if (!storedTimestamp[timestampKey]) {
    await chrome.storage.local.set({ [timestampKey]: timestamp });
  }
  const fileName = outputPaths.artifactName(jobContext, type, account);
  let localPath;
  if (handle) {
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      throw new Error('Scanner no longer has write access to the selected folder. Choose it again and retry.');
    }
    const rootFolder = await handle.getDirectoryHandle('QTS_Startup', { create: true });
    const managerFolderName = outputPaths.managerFolder(currentUser);
    const managerFolderHandle = await rootFolder.getDirectoryHandle(managerFolderName, { create: true });
    const accountFolderName = outputPaths.accountFolder(account);
    const accountFolderHandle = await managerFolderHandle.getDirectoryHandle(accountFolderName, { create: true });
    const jobFolderName = outputPaths.jobFolder(jobContext, timestamp);
    const jobFolderHandle = await accountFolderHandle.getDirectoryHandle(jobFolderName, { create: true });
    const fileHandle = await jobFolderHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(new Blob([contents], { type: mimeType }));
    } catch (error) {
      await writable.abort();
      throw error;
    }
    await writable.close();
    localPath = outputPaths.relativePath(handle.name, currentUser, account, jobContext, timestamp, type);
  } else {
    const downloadPath = outputPaths.downloadPath(currentUser, account, jobContext, timestamp, type);
    await saveScannerFileToChromeDownloads(downloadPath, contents, mimeType);
    localPath = outputPaths.relativePath('Downloads', currentUser, account, jobContext, timestamp, type);
  }
  return { fileName, localPath };
}

async function saveScannerJobContext(job, account, jobDescription = '') {
  const contextStore = window.__qtsScannerJobContext;
  if (!contextStore?.createSnapshot || !contextStore?.storageKey) {
    throw new Error('Local Scanner job-context storage is unavailable. Reload the extension and retry.');
  }
  const current = contextStore.createSnapshot({
    job,
    account,
    managerId: currentUser?.id,
    jobDescription,
  });
  const key = contextStore.storageKey(current);
  const stored = await chrome.storage.local.get(key);
  const snapshot = contextStore.mergeSnapshot(stored[key], current);
  await chrome.storage.local.set({ [key]: snapshot });
  return snapshot;
}

async function resolveScannerJobContext(job, account, taskJobContext, jobDescription = '') {
  const saved = await saveScannerJobContext(job, account, jobDescription);
  const taskContext = taskJobContext || {};
  const taskSnapshot = window.__qtsScannerJobContext.createSnapshot({
    job: {
      id: job.id || job.j_id || taskContext.jobId,
      title: taskContext.jobTitle || job.title,
      company: taskContext.company || job.company,
      url: taskContext.jobUrl || job.url,
      application_type: taskContext.platform || job.application_type,
      description: taskContext.jobDescription || '',
    },
    account,
    managerId: currentUser?.id,
    jobDescription: taskContext.jobDescription || jobDescription,
  });
  const resolved = window.__qtsScannerJobContext.mergeSnapshot(saved, taskSnapshot);
  const key = window.__qtsScannerJobContext.storageKey(resolved);
  await chrome.storage.local.set({ [key]: resolved });
  return resolved;
}

async function downloadScannerJobDetails(taskId, account, jobContext) {
  const contextStore = window.__qtsScannerJobContext;
  if (!contextStore?.formatText) throw new Error('Scanner job-details export helper is unavailable. Reload the extension and retry.');
  return createScannerOutputFile(
    taskId,
    account,
    jobContext,
    'job_details',
    `\uFEFF${contextStore.formatText(jobContext)}`,
    'text/plain;charset=utf-8'
  );
}

async function ensureScannerDocumentsDownloaded(taskId, packageData, tabId, statusElement, jobContext, account) {
  if (!packageData?.documents?.resume || !packageData?.documents?.coverLetter) {
    throw new Error('ChatGPT did not return both the resume and cover letter. The Scanner package cannot continue.');
  }
  const store = window.__qtsScannerDocumentStore;
  if (!store?.get || !store?.put) {
    throw new Error('Local Scanner document storage is unavailable. Reload the extension and retry.');
  }
  const packageHash = typeof packageData.submissionHash === 'string'
    ? packageData.submissionHash
    : '';

  const documents = [];
  const documentFiles = new Map();
  for (const documentType of ['resume', 'cover_letter']) {
    let document = await store.get(taskId, documentType);
    if (!document?.base64 || !packageHash || document.packageHash !== packageHash) {
      const fetched = await window.api.fetchManagerGptTaskDocument(taskId, documentType);
      if (!fetched.success) {
        throw new Error(fetched.message || `Could not generate the ${documentType} PDF.`);
      }
      document = {
        taskId,
        documentType,
        fileName: fetched.fileName,
        mimeType: fetched.mimeType || 'application/pdf',
        base64: fetched.base64,
        packageHash,
        localPath: '',
      };
      await store.put(document);
    }
    if (!document.localPath || document.outputVersion !== 4) {
      await notifyScannerStage(
        tabId,
        statusElement,
        `Saving the generated ${documentType === 'cover_letter' ? 'cover letter' : 'resume'} to the selected folder…`
      );
      const binary = atob(document.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const artifact = await createScannerOutputFile(
        taskId,
        account,
        jobContext,
        documentType,
        new Blob([bytes], { type: document.mimeType || 'application/pdf' }),
        document.mimeType || 'application/pdf'
      );
      document.fileName = artifact.fileName;
      document.localPath = artifact.localPath;
      document.outputVersion = 4;
      await store.put(document);
    }
    documents.push({
      documentType,
      fileName: document.fileName,
      localPath: document.localPath,
    });
    documentFiles.set(documentType, document);
  }

  const saved = await window.api.recordManagerGptTaskDownloads(
    taskId,
    documents.filter((document) => document.documentType === 'resume')
  );
  if (!saved.success) {
    throw new Error(saved.message || 'The generated resume path could not be saved to the Scanner task.');
  }
  await notifyScannerStage(tabId, statusElement, 'Saving the job details TXT file beside the generated PDFs…');
  await downloadScannerJobDetails(taskId, account, jobContext);
  return documentFiles;
}

async function getScannerGptTaskResult(taskId) {
  const startedAt = Date.now();
  const timeoutMs = 270000;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await window.api.getManagerGptTaskStatus(taskId);
    if (!response.success) throw new Error(response.message || 'Could not read the Scanner task status.');
    if (response.status === 'failed' || response.status === 'completed') {
      throw new Error(`Scanner task is ${response.status}; choose a different processing job row or restart it.`);
    }
    const packageData = response.package || {};
    const submitted = Array.isArray(packageData.answers)
      || Array.isArray(packageData.unresolvedFields)
      || Boolean(packageData.documents?.resume)
      || Boolean(packageData.documents?.coverLetter);
    if (response.status === 'ready' || submitted) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error('Timed out waiting for ChatGPT to return the Scanner package. Check the ChatGPT tab and try again.');
}

async function runManagerScannerGptTask({
  job,
  account,
  tabId,
  generatedFields,
  documentFields,
  statusElement,
  autoApply = false,
}) {
  const pageFields = [
    ...generatedFields.map((field) => scannerTaskField(field)),
    ...documentFields.map((field) => scannerTaskField(field, scannerFieldDocumentSlot(field))),
  ];
  if (!pageFields.length) {
    return { fillFields: [], fillOutcomeByFieldId: new Map(), outcomes: [] };
  }
  if (!window.__qtsScannerChatGpt?.buildPrompt) throw new Error('ChatGPT Scanner helper is not loaded.');

  let jobContext = await resolveScannerJobContext(
    job,
    account,
    {},
    document.getElementById('f-desc')?.value?.trim() || ''
  );
  await notifyScannerStage(tabId, statusElement, 'Preparing a job-specific Scanner task for the selected application…');
  const createResponse = await window.api.createManagerGptTaskForJob(job.id, {
    sourcePlatform: job.application_type,
    jobDescription: jobContext.description || undefined,
    applicationMode: autoApply ? 'apply' : 'scanner',
  });
  const activeTaskReturned = createResponse._httpStatus === 409 && Boolean(createResponse.taskId);
  if ((!createResponse.success && !activeTaskReturned) || !createResponse.taskId) {
    throw new Error(createResponse.message || 'Could not create a Scanner task for the selected processing job row.');
  }
  const taskId = createResponse.taskId;
  const currentTask = await window.api.getManagerGptTaskStatus(taskId);
  if (!currentTask.success) throw new Error(currentTask.message || 'Could not verify the selected job’s Scanner task.');
  jobContext = await resolveScannerJobContext(job, account, currentTask.jobContext, jobContext.description);

  const tab = await chrome.tabs.get(tabId);
  const pageUrl = String(tab?.url || '');
  let normalizedPageUrl;
  try {
    normalizedPageUrl = new URL(pageUrl).href;
  } catch {
    throw new Error('Could not read the current application page URL for the Scanner task.');
  }
  const samePage = scannerTaskPageMatches(currentTask.page, normalizedPageUrl, pageFields);
  let retryCurrentPage = false;
  let acknowledgedPreviousPage = false;
  let result;
  if (currentTask.status === 'waiting_for_gpt') {
    const existingPackage = currentTask.package || {};
    const packageSubmitted = Array.isArray(existingPackage.answers)
      || Array.isArray(existingPackage.unresolvedFields)
      || Boolean(existingPackage.documents?.resume)
      || Boolean(existingPackage.documents?.coverLetter);
    if (!samePage && !packageSubmitted) {
      const previousPage = currentTask.page?.pageTitle
        ? `"${currentTask.page.pageTitle}"`
        : `page ${Math.max(1, Number(currentTask.pageNumber || 1))}`;
      throw new Error(
        `This job still has a ChatGPT request for ${previousPage}, but no answer package has been saved yet. Return to that application page and wait for ChatGPT to finish before scanning another page.`
      );
    }
    if (!samePage && packageSubmitted) {
      const previousPage = currentTask.page?.pageTitle
        ? `"${currentTask.page.pageTitle}"`
        : `page ${Math.max(1, Number(currentTask.pageNumber || 1))}`;
      if (!window.confirm(
        `A ChatGPT package is saved for ${previousPage}, not the page currently open. Scanner will not apply that package to this page. Continuing will skip the previous page's answers and replace its active package when this page is scanned. Downloaded PDFs already saved in Downloads will remain there. To review or use the previous answers, cancel and return to that page. Skip the previous page and scan this one?`
      )) {
        throw new Error('The previous Scanner page was left unchanged. Return to it to review its saved ChatGPT package.');
      }
      const acknowledgeResponse = await window.api.acknowledgeManagerGptTaskPage(taskId);
      if (!acknowledgeResponse.success) {
        throw new Error(acknowledgeResponse.message || 'The previous Scanner page could not be acknowledged.');
      }
      acknowledgedPreviousPage = true;
    } else if (packageSubmitted) {
      result = currentTask;
    } else {
      if (!window.confirm(
        'This Scanner task is still waiting for ChatGPT and has no saved package. Retry only if you confirmed the previous prompt was not submitted and ChatGPT is not generating. Scanner will reuse its prior ChatGPT tab when possible. If the send state is uncertain, choose Cancel to avoid a duplicate request.'
      )) {
        throw new Error('Scanner retry canceled. The active task was left unchanged; check ChatGPT before retrying.');
      }
      const acknowledgeResponse = await window.api.acknowledgeManagerGptTaskPage(taskId);
      if (!acknowledgeResponse.success) {
        throw new Error(acknowledgeResponse.message || 'The active Scanner task could not be reset for a confirmed unsent retry.');
      }
      retryCurrentPage = true;
    }
  }
  if (!result && currentTask.status === 'ready' && samePage) {
    result = currentTask;
  } else if (!result && (
    ['waiting_for_page', 'ready'].includes(currentTask.status)
    || retryCurrentPage
    || acknowledgedPreviousPage
  )) {
    let jobDescription = String(
      jobContext.description || currentTask.jobContext?.jobDescription || document.getElementById('f-desc')?.value || ''
    ).trim();
    if (!jobDescription) {
      jobDescription = (window.prompt(
        `Enter or paste the job description for ${job.title || 'this job'} at ${job.company || 'the selected company'}. ChatGPT needs it to generate job-specific answers and documents.`
      ) || '').trim();
    }
    if (!jobDescription) throw new Error('A job description is required for Generated Answers, resume, or cover-letter generation.');
    jobContext = await resolveScannerJobContext(
      job,
      account,
      { ...currentTask.jobContext, jobDescription },
      jobDescription
    );

    const pageResponse = await window.api.setManagerGptTaskPage(taskId, {
      pageUrl: normalizedPageUrl,
      pageTitle: String(tab?.title || job.title || 'Application form').slice(0, 500),
      pageNumber: retryCurrentPage
        ? Math.max(1, Number(currentTask.pageNumber || 1))
        : Math.max(1, Number(currentTask.pageNumber || 0) + 1),
      fields: pageFields,
      jobDescription,
    });
    if (!pageResponse.success) throw new Error(pageResponse.message || 'Could not add the scanned fields to the Scanner task.');

    await chrome.storage.local.set({ qtsJobSourceTabId: tabId });
    await notifyScannerStage(
      tabId,
      statusElement,
      `Page context saved for task ${taskId}. Sending ${generatedFields.length} answer field(s) and requesting a tailored resume and cover letter from ChatGPT. Existing page-field contents are not sent.`,
      'info',
      6000,
      true
    );
    const promptContext = await window.api.getManagerGptTaskStatus(taskId);
    if (!promptContext.success) {
      throw new Error(promptContext.message || 'Could not load the saved Scanner context for ChatGPT.');
    }
    const prompt = window.__qtsScannerChatGpt.buildPrompt(promptContext);
    const handoff = await sendScannerChatGptTask({
      taskId,
      jobTabId: tabId,
      prompt,
    });
    await notifyScannerStage(
      tabId,
      statusElement,
      `Scanner context sent to ChatGPT for task ${taskId}. Waiting for its answer package…`,
      'info',
      6000,
      true
    );
    const taskResult = getScannerGptTaskResult(taskId);
    const dispatchError = handoff.dispatchWaiter.then(
      () => new Promise(() => {}),
      (error) => { throw error; }
    );
    result = await Promise.race([taskResult, dispatchError]);
  } else if (!result) {
    throw new Error(`The selected job’s Scanner task is ${currentTask.status}; Scanner will not overwrite an active or closed task.`);
  }

  await notifyScannerStage(tabId, statusElement, 'Preparing the generated resume and cover letter for local download and review…');
  const generatedDocuments = await ensureScannerDocumentsDownloaded(
    taskId,
    result.package,
    tabId,
    statusElement,
    jobContext,
    account
  );

  if (generatedFields.length || documentFields.length) {
    const answerCount = Array.isArray(result.package?.answers) ? result.package.answers.length : 0;
    const unresolvedCount = Array.isArray(result.package?.unresolvedFields) ? result.package.unresolvedFields.length : 0;
    const resumeReady = Boolean(result.package?.documents?.resume);
    const coverLetterReady = Boolean(result.package?.documents?.coverLetter);
    const documentCount = Number(resumeReady) + Number(coverLetterReady);
    const packageReceivedMessage = `Package received from ChatGPT for task ${taskId}: ${answerCount} answer(s), ${documentCount} generated document(s) downloaded locally, ${unresolvedCount} unresolved field(s).`;
    if (statusElement) statusElement.textContent = packageReceivedMessage;
    await clearPageNotice(tabId, 'scanner-progress');
    await clearPageNotice(tabId, 'scanner-package-received');
    await showPageNotice(tabId, packageReceivedMessage, 'success', {
      durationMs: 10000,
      alertId: 'scanner-package-received',
    });
  }
  const answers = new Map(
    (Array.isArray(result.package?.answers) ? result.package.answers : [])
      .map((answer) => [String(answer.stableFieldId), String(answer.answer || '')])
  );
  const outcomes = [];
  const fillFields = [];
  const fillOutcomeByFieldId = new Map();

  let generatedAnswerNumber = 0;
  for (const field of generatedFields) {
    const fieldId = String(field.stableFieldId || field.fieldId || '');
    const question = String(field.label || field.question || 'Application field').trim();
    const options = scannerChoiceOptions(field);
    const generated = answers.get(fieldId);
    if (field.status !== 'matched') {
      outcomes.push(`${question}: field locator is uncertain; left unresolved.`);
      continue;
    }
    if (!generated && !(field.required && options.length)) {
      outcomes.push(`${question}: GPT did not return an answer; left unresolved.`);
      continue;
    }
    if (generated) {
      const answerValidation = window.__qtsScannerCapture.validateAnswerForField(field, generated);
      if (answerValidation.status === 'invalid') {
        outcomes.push(`${question}: GPT answer does not meet page validation (${answerValidation.reason}); left unresolved.`);
        continue;
      }
    }
    if (scannerIsChoiceField(field) && !options.length) {
      outcomes.push(`${question}: available choices were not captured; left unresolved rather than guessing.`);
      continue;
    }
    if (autoApply) {
      if (!generated) {
        outcomes.push(`${question}: GPT did not return an answer; left unresolved.`);
        continue;
      }
      if (String(field.currentValue || '').trim()) {
        outcomes.push(`${question}: existing page value was preserved.`);
        continue;
      }
      if (options.length && !options.some((option) => option.toLowerCase() === generated.trim().toLowerCase())) {
        outcomes.push(`${question}: GPT answer did not exactly match an available page option; left unresolved.`);
        continue;
      }
      outcomes.push(`${question}: validated GPT answer queued.`);
      fillFields.push({ ...field, fillValue: generated.trim(), fillStatus: 'ready_to_fill' });
      fillOutcomeByFieldId.set(fieldId, outcomes.length - 1);
      continue;
    }
    generatedAnswerNumber += 1;
    await notifyScannerStage(
      tabId,
      statusElement,
      `${generated ? 'Reviewing generated answer' : 'Choosing a required answer'} ${generatedAnswerNumber}: ${question}. Approve or skip it in the Scanner panel.`,
      'info',
      6000,
      true
    );
    const reviewed = await reviewScannerAnswer(
      question,
      generated || '',
      String(field.currentValue || '').trim(),
      options,
      scannerValidationSummary(field)
    );
    if (reviewed == null || !reviewed.trim()) {
      outcomes.push(`${question}: answer was skipped or left blank.`);
      continue;
    }
    const reviewedValidation = window.__qtsScannerCapture.validateAnswerForField(field, reviewed);
    if (reviewedValidation.status === 'invalid') {
      outcomes.push(`${question}: reviewed answer does not meet page validation (${reviewedValidation.reason}); left unresolved.`);
      continue;
    }
    outcomes.push(`${question}: ${generated ? 'Manager-reviewed GPT answer' : 'Manager-selected required option'} queued.`);
    fillFields.push({ ...field, fillValue: reviewed.trim(), fillStatus: 'ready_to_fill' });
    fillOutcomeByFieldId.set(fieldId, outcomes.length - 1);
  }

  const returnedDocuments = result.package?.documents || {};
  for (const field of documentFields) {
    const question = String(field.label || field.question || 'Document upload').trim();
    const documentType = scannerFieldDocumentSlot(field);
    const documentKey = documentType === 'cover_letter' ? 'coverLetter' : 'resume';
    if (!returnedDocuments[documentKey]) {
      outcomes.push(`${question}: GPT did not return the requested ${documentType === 'cover_letter' ? 'cover letter' : 'resume'}; left unresolved.`);
      continue;
    }
    if (field.status !== 'matched') {
      outcomes.push(`${question}: generated document is ready, but the upload field locator is uncertain; left unresolved.`);
      continue;
    }
    if (String(field.currentValue || '').trim()) {
      if (!autoApply && !window.confirm(`This upload field already contains a file:\n${question}\n\nReplace it with the GPT-generated ${documentType === 'cover_letter' ? 'cover letter' : 'resume'}?`)) {
        outcomes.push(`${question}: kept existing uploaded file.`);
        continue;
      }
    }
    const document = await generatedDocuments.get(documentType);
    if (!document?.base64) throw new Error(`The locally saved generated ${documentType} PDF is unavailable.`);
    const approved = autoApply
      || await reviewScannerDocument(document, documentType, account, question);
    if (!approved) {
      outcomes.push(`${question}: generated document was not approved.`);
      continue;
    }
    outcomes.push(`${question}: ${autoApply ? 'generated document' : 'Manager-approved generated document'} queued for upload.`);
    fillFields.push({
      ...field,
      category: 'document_upload',
      fillStatus: 'filled',
      fillValue: document.fileName,
      upload: {
        fileName: document.fileName,
        mimeType: document.mimeType,
        base64: document.base64,
      },
    });
    fillOutcomeByFieldId.set(String(field.stableFieldId || field.fieldId || ''), outcomes.length - 1);
  }
  return { fillFields, fillOutcomeByFieldId, outcomes, taskId };
}

async function resolveApplySubmissionConfirmation(
  account,
  job,
  applyRunId,
  pendingSubmissionKey,
  tabId,
  submittedAt,
  pageConfirmed = false
) {
  const pageStatus = await chrome.runtime.sendMessage({
    type: 'CHECK_APPLICATION_SUBMISSION_STATUS',
    tabId,
  });
  let submissionConfirmed = pageConfirmed || pageStatus?.submissionConfirmed === true;
  let mailboxMessage = 'No connected Account mailbox was available to check for confirmation.';
  if (pageStatus?.success === false) {
    mailboxMessage = pageStatus.error || 'Could not check the application page for confirmation.';
  }
  const mailbox = await window.api.getAccountMailboxStatus(account.id);
  if (mailbox.success && mailbox.connected) {
    const confirmation = await window.api.findAccountApplicationConfirmation(account.id, {
      submittedAt,
      company: job.company,
      title: job.title,
    });
    if (confirmation.success && confirmation.found) {
      submissionConfirmed = true;
      mailboxMessage = `Gmail confirmation found: ${confirmation.subject || 'matching application email'}.`;
    } else {
      mailboxMessage = confirmation.message || 'No matching confirmation email was found yet.';
    }
  } else if (mailbox.success) {
    mailboxMessage = 'Connect the Account’s matching Gmail mailbox to check for confirmation.';
  } else {
    mailboxMessage = mailbox.message || 'Could not check the Account mailbox.';
  }

  if (!submissionConfirmed) {
    return { confirmed: false, message: mailboxMessage };
  }
  const updated = await window.api.updateJobApplicationStatus(job.id, {
    status: 'did',
    applyRunId,
  });
  if (!updated.success) {
    throw new Error(updated.message || 'Submission was confirmed, but the Account job status could not be updated.');
  }
  await chrome.storage.local.remove([
    pendingSubmissionKey,
    `qtsScannerApplyRun:${account.id}:${job.id}`,
  ]);
  return { confirmed: true, message: `Application submission confirmed. ${mailboxMessage}` };
}

async function runManagerApply(tabId, statusElement, account, job, applyRunId) {
  const visitedSteps = new Set();
  for (let stepNumber = 1; stepNumber <= 20; stepNumber += 1) {
    const result = await runManagerScanner(tabId, statusElement, account, job, true, visitedSteps);
    if (result.state === 'submitted') {
      const pendingSubmissionKey = `qtsApplySubmissionPending:${account.id}:${job.id}`;
      await chrome.storage.local.set({
        [pendingSubmissionKey]: {
          accountUserId: account.id,
          jobId: job.id,
          applyRunId,
          submittedAt: result.submittedAt,
          submissionConfirmed: result.submissionConfirmed === true,
          company: job.company,
          title: job.title,
        },
      });
      const confirmation = await resolveApplySubmissionConfirmation(
        account,
        job,
        applyRunId,
        pendingSubmissionKey,
        tabId,
        result.submittedAt,
        result.submissionConfirmed === true
      );
      if (confirmation.confirmed) {
        const message = confirmation.message;
        await notifyScannerStage(tabId, statusElement, message, 'success', 15000);
        if (statusElement) statusElement.textContent = message;
        return { state: 'submitted', confirmed: true, message };
      }

      const message = `Apply clicked the recognized submit control, but submission is unconfirmed. ${confirmation.message} Review the page and mailbox before changing the job status.`;
      await notifyScannerStage(tabId, statusElement, message, 'warn', 15000);
      if (statusElement) statusElement.textContent = message;
      return { state: 'unconfirmed', message };
    }
    if (result.state !== 'advanced') return result;
  }
  const message = 'Apply paused after 20 steps. Review the current application page manually before continuing.';
  await notifyScannerStage(tabId, statusElement, message, 'warn', 12000);
  if (statusElement) statusElement.textContent = message;
  return { state: 'paused', message };
}

async function runManagerScanner(tabId, statusElement, account, job, autoApply = false, visitedSteps = null) {
  await clearPageNotice(tabId, 'scanner-package-received');
  await notifyScannerStage(
    tabId,
    statusElement,
    autoApply ? 'Apply is reading the current application step.' : 'Reading the current application step. No page controls will be activated.'
  );
  const response = await chrome.runtime.sendMessage({
    type: 'DISCOVER_APPLICATION_FORM',
    tabId,
    managerScanner: !autoApply,
    managerApply: autoApply,
    openApplyForm: false,
    expandDynamic: false,
    mode: autoApply ? 'REAL_APPLICATION' : 'DISCOVERY',
    readOnly: true,
  });
  if (!response?.success) throw new Error(response?.error || 'The current application step could not be scanned.');
  const rawDiscoveredFields = Array.isArray(response.scan?.fields) ? response.scan.fields : [];
  await notifyScannerStage(
    tabId,
    statusElement,
    `Detected ${rawDiscoveredFields.length} field(s) on this step. Checking saved Manager decisions…`
  );

  const templateId = Number(response.templateSave?.template?.id);
  if (!autoApply && (!response.templateSave?.success || !Number.isSafeInteger(templateId) || templateId <= 0)) {
    throw new Error(response.templateSave?.message || 'The site template could not be saved; no answer rules were changed.');
  }

  await notifyScannerStage(tabId, statusElement, 'Loading this Manager’s saved field strategies…');
  const rulesResponse = autoApply ? { success: true, rules: [] } : await window.api.getManagerScannerRules(templateId);
  if (!rulesResponse.success) throw new Error(rulesResponse.message || 'Could not load this Manager’s Scanner rules.');
  const rules = Array.isArray(rulesResponse.rules) ? rulesResponse.rules : [];
  await notifyScannerStage(tabId, statusElement, `Loaded ${rules.length} saved field decision(s). Checking capture consistency…`);
  const scannerStepKey = window.__qtsScannerCapture.deriveStepKey(rawDiscoveredFields);
  const genericCheckpointFields = response.templateSave?.checkpoint?.steps
    ?.find((step) => step.stepId === response.templateSave?.checkpoint?.currentStepId)?.fields || [];
  const discoveredFields = rawDiscoveredFields.map((field) => ({
    ...field,
    scannerStepKey,
    previousScannerCapture: genericCheckpointFields.find((savedField) => (
      String(savedField.fieldId || '') === String(field.stableFieldId || '')
    ))?.scannerCapture,
  }));
  const captureVerification = await verifyManagerScannerCapture(
    tabId,
    discoveredFields,
    rules,
    statusElement,
    autoApply
  );
  const fields = captureVerification.fields;
  if (!autoApply && captureVerification.verifiedSecondCapture) {
    await notifyScannerStage(tabId, statusElement, 'Saving the second-capture evidence for this step…');
    const evidenceSave = await chrome.runtime.sendMessage({
      type: 'SAVE_SCANNER_STEP_EVIDENCE',
      tabId,
      managerScanner: !autoApply,
      managerApply: autoApply,
      metadata: {
        siteKey: response.discovery?.siteKey,
        platform: response.discovery?.platform,
        host: response.discovery?.host,
        pageSignature: response.discovery?.pageSignature,
        pageStep: response.scan?.pageStep,
        pageUrl: response.scan?.pageUrl,
      },
      fields: captureVerification.evidenceFields.map((field) => ({
        stableFieldId: field.stableFieldId,
        label: field.label,
        fieldType: field.fieldType,
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options.slice(0, 100) : [],
        sectionHeading: field.sectionHeading,
        matchMethod: field.matchMethod,
        confidence: field.confidence,
        status: field.status,
        selectorHints: field.selectorHints,
        domEvidence: field.domEvidence,
        scannerCapture: field.scannerCapture,
      })),
    });
    if (!evidenceSave?.success) {
      throw new Error(evidenceSave?.message || 'Verified Scanner capture evidence could not be saved.');
    }
  }
  if (!fields.length) {
    if (autoApply) {
      const message = captureVerification.outcomes[0]
        || 'Apply paused because no stable fields could be confirmed on this step.';
      await notifyScannerStage(tabId, statusElement, message, 'warn', 12000);
      if (statusElement) statusElement.textContent = message;
      return { state: 'paused', message };
    }
    throw new Error('No fields were consistently detected or confirmed on this step. Wait for the page to settle and scan again.');
  }

  await notifyScannerStage(
    tabId,
    statusElement,
    `Reviewing ${fields.length} field(s). Scanner will ask before using new strategies or replacing existing values.`
  );
  const profileChoices = scannerAccountProfileChoices(account);
  const profileLabel = account.name || `Account ${account.u_id}`;
  const groupMap = new Map();
  rules.forEach((rule) => {
    const key = String(rule.semantic_key || '');
    if (key && !groupMap.has(key)) groupMap.set(key, rule);
  });

  const fillFields = [];
  const generatedFields = [];
  const documentFields = [];
  const outcomes = [...captureVerification.outcomes];
  const fillOutcomeByFieldId = new Map();
  let fillFailures = 0;
  for (const field of fields) {
    const fieldId = String(field.stableFieldId || field.fieldId || '');
    const question = String(field.label || field.question || 'Application field').trim();
    const detectedOptions = scannerChoiceOptions(field);
    if (autoApply) {
      if (!fieldId) {
        outcomes.push(`${question}: skipped because the field has no stable identifier; Apply paused.`);
      } else if (field.status !== 'matched') {
        outcomes.push(`${question}: field identity is uncertain; Apply paused for Manager review.`);
      } else if (String(field.currentValue || '').trim()) {
        outcomes.push(`${question}: existing page value was preserved.`);
      } else if (scannerIsChoiceField(field) && !detectedOptions.length) {
        outcomes.push(`${question}: available choices were not captured; Apply paused rather than guessing.`);
      } else if (field.fieldType === 'file') {
        documentFields.push(field);
      } else if (/\b(work authorization|authorized to work|visa|sponsorship|salary|compensation|pay range|relocation|notice period|start date|availability|criminal record|background check|disability|veteran|ethnicity|race|gender|nationality|date of birth|referral)\b/i.test(question)) {
        outcomes.push(`${question}: this Account-specific answer needs Manager input; Apply will not infer it with GPT.`);
      } else {
        generatedFields.push(field);
      }
      continue;
    }
    let reusableDelegatedToGpt = false;
    if (!fieldId) {
      outcomes.push(`${question}: skipped (no stable field identifier).`);
      continue;
    }
    if (field.fieldType === 'file') {
      documentFields.push(field);
      continue;
    }
    if (scannerIsChoiceField(field) && !detectedOptions.length) {
      outcomes.push(`${question}: available choices were not captured; left unresolved rather than guessing.`);
      continue;
    }

    let rule = window.__qtsScannerCapture.findMatchingRule(field, rules);
    let matchedExactRule = Boolean(rule);
    let semanticKey = rule?.semantic_key || scannerSemanticKey(question);
    let isNewRule = !rule;
    let changed = Boolean(rule && scannerRuleChanged(rule, field));

    if (isNewRule && groupMap.size) {
      const groups = [...groupMap.entries()];
      const groupList = groups.map(([key, item], index) => `${index + 1}. ${item.question} [${key}]`);
      const groupAnswer = window.prompt(
        `New field:\n${question}\n\nIf this means the same thing as an existing confirmed field, enter its number. Enter 0 to treat it as a new meaning.\n${groupList.join('\n')}`,
        '0'
      );
      if (groupAnswer == null) {
        outcomes.push(`${question}: left unresolved (decision cancelled).`);
        continue;
      }
      const groupIndex = Number(groupAnswer) - 1;
      if (groupAnswer !== '0' && (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex >= groups.length)) {
        outcomes.push(`${question}: left unresolved (invalid meaning selection).`);
        continue;
      }
      if (groupAnswer !== '0') {
        semanticKey = groups[groupIndex][0];
        rule = groups[groupIndex][1];
        matchedExactRule = false;
      }
    }

    if (changed) {
      const sameMeaning = window.confirm(
        `This saved field changed.\n\nSaved: ${rule.question}\nCurrent: ${question}\n\nField type/options/required state may also have changed.\n\nDo these still have the same meaning?`
      );
      if (!sameMeaning) {
        rule = null;
        matchedExactRule = false;
        isNewRule = true;
        changed = false;
        semanticKey = scannerSemanticKey(question);
      }
    }

    if (matchedExactRule && rule && !changed
      && window.__qtsScannerCapture.hasManagerConfirmedFieldIdentity(field, rule)) {
      field.status = 'matched';
      field.scannerCapture = {
        ...(field.scannerCapture || {}),
        fieldIdentityConfirmed: true,
      };
    }
    const selectTypes = new Set(['select', 'combobox', 'listbox']);
    const canConfirmDropdown = field.status !== 'matched'
      && selectTypes.has(String(field.fieldType || '').toLowerCase())
      && Boolean(field.selectorHints?.id)
      && Array.isArray(field.options)
      && field.options.length > 0;
    if (canConfirmDropdown) {
      const confirmedDropdown = window.confirm(
        `Scanner found a dropdown for:\n${question}\n\nIts label association is uncertain, but the control has a stable element ID (${field.selectorHints.id}) and detected options. Confirm that this is the exact question shown on the page. Scanner will then review your answer and select only a unique matching option. Continue?`
      );
      if (!confirmedDropdown) {
        outcomes.push(`${question}: field identity was not confirmed; left unresolved.`);
        continue;
      }
      field.status = 'matched';
      field.scannerCapture = {
        ...(field.scannerCapture || {}),
        fieldIdentityConfirmed: true,
      };
    }

    let strategy = rule?.strategy || '';
    if (isNewRule) {
      const choiceContext = detectedOptions.length
        ? `\n\nChoices detected on the page:\n${detectedOptions.map((option) => `• ${option}`).join('\n')}`
        : '';
      const selected = window.prompt(
        `Choose how to handle:\n${question}\n${scannerValidationSummary(field)}${choiceContext}\n\n1 = Profile Answer (selected Account)\n2 = Reusable Answer (save Manager Q&A)\n3 = Generated Answer (GPT)\n4 = Manual / leave unresolved`,
        '1'
      );
      if (selected == null || !['1', '2', '3', '4'].includes(selected.trim())) {
        outcomes.push(`${question}: left unresolved (no answer strategy selected).`);
        continue;
      }
      strategy = ({ '1': 'profile', '2': 'reusable', '3': 'generated', '4': 'manual' })[selected.trim()];
    }

    let profileFieldKey = rule?.profile_field_key || null;
    let reusableAnswerId = rule?.reusable_answer_id == null ? null : Number(rule.reusable_answer_id);
    let reusableAnswer = typeof rule?.reusable_answer === 'string' ? rule.reusable_answer : '';
    let fillValue = '';
    let optionReviewed = false;

    if (strategy === 'profile') {
      if (isNewRule || !profileFieldKey) {
        if (!profileChoices.length) {
          outcomes.push(`${question}: no Account profile values are available; left unresolved.`);
          continue;
        }
        const options = profileChoices.map(([key, label, value], index) =>
          `${index + 1}. ${label}: ${String(value || '(not set)').slice(0, 100)}`
        );
        const selected = window.prompt(
          `Map this question to a profile value for ${profileLabel}:\n${question}\n\n${options.join('\n')}\n\nEnter a number.`,
          '1'
        );
        if (selected == null) {
          outcomes.push(`${question}: left unresolved (profile mapping cancelled).`);
          continue;
        }
        const choiceIndex = Number(selected) - 1;
        if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= profileChoices.length) {
          outcomes.push(`${question}: left unresolved (invalid profile mapping).`);
          continue;
        }
        profileFieldKey = profileChoices[choiceIndex][0];
      }
      fillValue = scannerResolveProfileValue(account, profileFieldKey);
      if (!fillValue) {
        fillValue = window.prompt(
          `The selected Account profile has no value for this field:\n${question}\n\nEnter a value to use once for this application. It will not be saved to the profile or reusable answers.`
        ) || '';
      }
    } else if (strategy === 'reusable') {
      if (isNewRule || !reusableAnswer) {
        reusableAnswer = window.prompt(
          `Enter or confirm the reusable answer for:\n${question}\n\n${scannerValidationSummary(field)}\n\nThis will be saved to the Manager’s reusable Q&A for this semantic field. If it does not fit the detected format, Scanner will send it to GPT as context and request a compliant answer.`
        ) || '';
      }
      if (!reusableAnswer) {
        outcomes.push(`${question}: left unresolved (reusable answer was not provided).`);
        continue;
      }
      if (detectedOptions.length) {
        const reviewed = await reviewScannerAnswer(
          question,
          reusableAnswer,
          String(field.currentValue || '').trim(),
          detectedOptions,
          scannerValidationSummary(field)
        );
        if (reviewed == null || !reviewed.trim()) {
          outcomes.push(`${question}: reusable answer was skipped or left blank.`);
          continue;
        }
        reusableAnswer = reviewed.trim();
        optionReviewed = true;
      }
      const answerValidation = window.__qtsScannerCapture.validateAnswerForField(field, reusableAnswer);
      if (answerValidation.status !== 'valid') {
        generatedFields.push({
          ...field,
          reusableAnswerContext: {
            question: rule?.question || question,
            answer: reusableAnswer,
          },
        });
        reusableDelegatedToGpt = true;
      }
    } else if (strategy === 'generated') {
      generatedFields.push(field);
    }

    if (isNewRule || changed) {
      const saveResult = await window.api.saveManagerScannerRule({
        templateId,
        fieldId: window.__qtsScannerCapture.getRuleFieldId(field, isNewRule ? null : rule),
        semanticKey,
        question,
        strategy,
        profileFieldKey: strategy === 'profile' ? profileFieldKey : null,
        reusableAnswerId: strategy === 'reusable' ? reusableAnswerId : null,
        reusableAnswer: strategy === 'reusable' && !reusableAnswerId ? reusableAnswer : null,
        context: {
          section: String(field.sectionHeading || '').slice(0, 300),
          pageStep: String(field.pageStep || '').slice(0, 300),
          stepKey: String(field.scannerStepKey || '').slice(0, 80),
        },
        fieldSnapshot: scannerFieldSnapshot(field),
      });
      if (!saveResult.success) {
        throw new Error(saveResult.message || `Could not save Scanner decision for "${question}".`);
      }
      rule = saveResult.rule;
      if (strategy === 'reusable' && !reusableAnswerId) {
        reusableAnswerId = Number(rule?.reusable_answer_id);
      }
    } else if (rule && field.scannerCapture) {
      const evidenceResult = await window.api.updateManagerScannerRuleEvidence({
        templateId,
        fieldId: String(rule.field_id),
        fieldSnapshot: scannerFieldSnapshot(field),
      });
      if (!evidenceResult.success) {
        throw new Error(evidenceResult.message || `Could not save verified locator evidence for "${question}".`);
      }
    }

    if (strategy === 'manual') {
      if (field.required && detectedOptions.length && field.status === 'matched') {
        const reviewed = await reviewScannerAnswer(
          question,
          '',
          String(field.currentValue || '').trim(),
          detectedOptions,
          scannerValidationSummary(field)
        );
        if (reviewed && reviewed.trim()) {
          outcomes.push(`${question}: Manager-selected required option queued.`);
          fillFields.push({ ...field, fillValue: reviewed.trim(), fillStatus: 'ready_to_fill' });
          fillOutcomeByFieldId.set(fieldId, outcomes.length - 1);
        } else {
          outcomes.push(`${question}: required field left unresolved (no option selected).`);
        }
      } else {
        outcomes.push(`${question}: left for manual completion.`);
      }
      continue;
    }

    if (reusableDelegatedToGpt) continue;

    if (!['profile', 'reusable'].includes(strategy) || !fillValue && strategy === 'profile') {
      if (strategy === 'profile') outcomes.push(`${question}: profile value unavailable; used no persistent fallback.`);
      continue;
    }
    if (strategy === 'reusable' && !fillValue) fillValue = reusableAnswer;
    if (!fillValue) continue;
    const fillValidation = window.__qtsScannerCapture.validateAnswerForField(field, fillValue);
    if (fillValidation.status === 'invalid') {
      outcomes.push(`${question}: selected answer does not meet page validation (${fillValidation.reason}); left unresolved.`);
      continue;
    }
    if (detectedOptions.length && !optionReviewed) {
      const reviewed = await reviewScannerAnswer(
        question,
        fillValue,
        String(field.currentValue || '').trim(),
        detectedOptions,
        scannerValidationSummary(field)
      );
      if (reviewed == null || !reviewed.trim()) {
        outcomes.push(`${question}: answer was skipped or left blank.`);
        continue;
      }
      fillValue = reviewed.trim();
      optionReviewed = true;
    }
    if (String(field.currentValue || '').trim()) {
      const overwrite = window.confirm(
        `This field already contains a value:\n${question}\n\nReplace it with the confirmed ${strategy === 'profile' ? 'Account profile' : 'reusable'} answer?`
      );
      if (!overwrite) {
        outcomes.push(`${question}: kept existing page value.`);
        continue;
      }
    }
    if (field.status !== 'matched') {
      outcomes.push(`${question}: mapping confirmed but field locator is uncertain; left unresolved.`);
      continue;
    }
    outcomes.push(`${question}: ${optionReviewed ? 'Manager-approved available option' : `queued from ${strategy === 'profile' ? 'Account profile' : 'reusable answer'}`}.`);
    fillFields.push({
      ...field,
      fillValue,
      fillStatus: 'ready_to_fill',
    });
    fillOutcomeByFieldId.set(fieldId, outcomes.length - 1);
  }

  if (generatedFields.length || documentFields.length) {
    await notifyScannerStage(
      tabId,
      statusElement,
      `Preparing reviewed job-specific assistance for ${generatedFields.length} generated answer(s) and ${documentFields.length} document field(s)…`,
      'info',
      6000
    );
  }
  const gptResult = await runManagerScannerGptTask({
    job,
    account,
    tabId,
    generatedFields,
    documentFields,
    statusElement,
    autoApply,
  });
  fillFields.push(...gptResult.fillFields);
  const gptOutcomeOffset = outcomes.length;
  for (const [fieldId, outcomeIndex] of gptResult.fillOutcomeByFieldId) {
    fillOutcomeByFieldId.set(fieldId, gptOutcomeOffset + outcomeIndex);
  }
  outcomes.push(...gptResult.outcomes);

  let fillSummary = 'No fields were filled.';
  if (fillFields.length) {
    await notifyScannerStage(
      tabId,
      statusElement,
      autoApply
        ? `Applying ${fillFields.length} validated GPT value(s) to this step…`
        : `Applying ${fillFields.length} Manager-approved value(s) to this visible step…`
    );
    const fillResponse = await chrome.runtime.sendMessage({
      type: 'FILL_APPLICATION_FORM',
      tabId,
      fields: fillFields,
      mode: 'REAL_APPLICATION',
      allowUserApprovedFill: true,
      managerScanner: !autoApply,
      managerApply: autoApply,
    });
    if (fillResponse?.error || fillResponse?.success === false) {
      throw new Error(fillResponse?.error || 'Confirmed Scanner answers could not be applied.');
    }
    const results = fillResponse?.fill?.results || [];
    const resultByFieldId = new Map(results.map((item) => [String(item.stableFieldId || ''), item]));
    const filled = fillFields.filter((field) => (
      resultByFieldId.get(String(field.stableFieldId || field.fieldId || ''))?.ok
    )).length;
    const failed = fillFields.length - filled;
    fillFailures = failed;
    for (const field of fillFields) {
      const fieldId = String(field.stableFieldId || field.fieldId || '');
      const result = resultByFieldId.get(fieldId);
      const question = String(field.label || field.question || 'Application field').trim();
      const outcomeIndex = fillOutcomeByFieldId.get(fieldId);
      if (!Number.isInteger(outcomeIndex)) continue;
      if (!result?.ok) {
        const reason = {
          option_not_found: 'no matching option was available',
          option_disabled: 'the matching option is disabled',
          selection_not_applied: 'the page did not confirm the selected value',
          constraint_validation_failed: 'the browser rejected the value against this field’s constraints',
          value_not_applied: 'the page did not retain the value',
          element_not_found: 'the field could not be located',
        }[result?.reason] || 'the field could not be filled';
        outcomes[outcomeIndex] = `${question}: could not be filled (${reason}); complete it manually.`;
      } else if (outcomes[outcomeIndex].includes('queued from Account profile')) {
        outcomes[outcomeIndex] = outcomes[outcomeIndex].replace('queued from Account profile', 'filled from Account profile');
      } else if (outcomes[outcomeIndex].includes('validated GPT answer queued')) {
        outcomes[outcomeIndex] = outcomes[outcomeIndex].replace('validated GPT answer queued', 'validated GPT answer filled');
      } else if (outcomes[outcomeIndex].includes('Manager-reviewed GPT answer queued')) {
        outcomes[outcomeIndex] = outcomes[outcomeIndex].replace('Manager-reviewed GPT answer queued', 'Manager-reviewed GPT answer filled');
      } else if (outcomes[outcomeIndex].includes('generated document queued for upload')) {
        outcomes[outcomeIndex] = outcomes[outcomeIndex].replace(
          'generated document queued for upload',
          'generated document uploaded'
        );
      } else if (outcomes[outcomeIndex].includes('Manager-approved generated document queued for upload')) {
        outcomes[outcomeIndex] = outcomes[outcomeIndex].replace(
          'Manager-approved generated document queued for upload',
          'Manager-approved generated document uploaded'
        );
      }
    }
    fillSummary = `Filled ${filled} field(s); ${failed} could not be filled.`;
  }
  const managerResolutionItems = outcomes.filter((outcome) => (
    /Apply paused|left unresolved|field identity is uncertain|no stable identifier|GPT did not return|does not meet page validation|did not exactly match|could not be filled|choices were not captured|inconsistent between captures|capture disagreement/i
      .test(outcome)
  ));
  if (autoApply && (managerResolutionItems.length || fillFailures)) {
    const detail = managerResolutionItems.slice(0, 5).join(' ');
    const message = `Apply paused for Manager input. ${detail || `${fillFailures} field(s) could not be filled.`} Complete or review these fields on the application page, then choose Apply again to resume.`;
    await notifyScannerStage(tabId, statusElement, message, 'warn', 12000);
    if (statusElement) statusElement.textContent = `${message} ${fillSummary}`;
    return { state: 'paused', message };
  }
  if (gptResult.taskId) {
    const acknowledgeResponse = await window.api.acknowledgeManagerGptTaskPage(gptResult.taskId);
    if (!acknowledgeResponse.success) {
      throw new Error(acknowledgeResponse.message || 'The reviewed GPT page could not be acknowledged for this job.');
    }
  }
  if (autoApply) {
    const pageKey = [
      response.scan?.pageUrl || '',
      response.scan?.pageStep || '',
      fields.map((field) => String(field.stableFieldId || field.fieldId || '')).sort().join('|'),
    ].join('::');
    if (visitedSteps?.has(pageKey)) {
      const message = 'Apply paused because the page did not change after a Next action. Review the application manually.';
      await notifyScannerStage(tabId, statusElement, message, 'warn', 12000);
      if (statusElement) statusElement.textContent = message;
      return { state: 'paused', message };
    }
    visitedSteps?.add(pageKey);
    const advance = await chrome.runtime.sendMessage({
      type: 'ADVANCE_MANAGER_APPLICATION_STEP',
      tabId,
      managerApply: true,
    });
    if (!advance?.success) throw new Error(advance?.error || 'Could not safely advance the application.');
    if (advance.submitted) {
      return {
        state: 'submitted',
        submissionConfirmed: advance.submissionConfirmed === true,
        submittedAt: advance.submittedAt || Date.now(),
      };
    }
    if (!advance.advanced) {
      const message = advance.reason
        || 'Apply stopped because there is no unique, recognized next-step control. Review the page manually.';
      const state = advance.finalSubmitFound ? 'ready-for-manager' : 'paused';
      await notifyScannerStage(
        tabId,
        statusElement,
        message,
        advance.finalSubmitFound ? 'success' : 'warn',
        12000
      );
      if (statusElement) statusElement.textContent = message;
      return { state, message, pageKey };
    }
    await notifyScannerStage(
      tabId,
      statusElement,
      `Filled this step and advanced using the unique “${advance.label}” control. Reading the next step…`,
      'success',
      8000
    );
    return { state: 'advanced', pageKey };
  }
  await notifyScannerStage(
    tabId,
    statusElement,
    `Current step complete. ${fillSummary} Scanner did not navigate or submit. Manually advance, then choose Scan current step to continue.`,
    'success',
    10000
  );
  if (statusElement) {
    statusElement.textContent = `Job: ${job.title || 'Untitled job'} — ${profileLabel}. ${fillSummary} ${outcomes.join(' ')}`;
  }
}

function settleGptDispatchWaiter(msg) {
  const taskId = msg?.taskId;
  if (!taskId) return false;
  const waiter = gptDispatchWaiters.get(taskId);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  gptDispatchWaiters.delete(taskId);
  if (msg.ok && msg.handoff?.sent !== false) {
    waiter.resolve(msg);
  } else {
    waiter.reject(new Error(msg.handoff?.error || msg.error || 'GPT handoff failed.'));
  }
  return true;
}

function waitForGptDispatchFinished(taskId, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      gptDispatchWaiters.delete(taskId);
      reject(new Error('Timed out waiting for the GPT handoff to finish.'));
    }, timeoutMs);
    gptDispatchWaiters.set(taskId, { resolve, reject, timer });
  });
}

function sendGptTaskViaPort({ taskId, jobTabId, applicationId, pollAndApply, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let port = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onBroadcast);
      try {
        port?.disconnect();
      } catch {
        // ignore
      }
      fn(value);
    };

    const onBroadcast = (msg) => {
      if (msg?.type !== 'GPT_DISPATCH_FINISHED') return;
      if (msg.taskId && taskId && msg.taskId !== taskId) return;
      if (msg.ok && msg.handoff?.sent !== false) {
        finish(resolve, msg);
        return;
      }
      finish(reject, new Error(msg.handoff?.error || msg.error || 'GPT handoff failed.'));
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Timed out waiting for Custom GPT handoff.'));
    }, timeoutMs);

    chrome.runtime.onMessage.addListener(onBroadcast);

    try {
      port = chrome.runtime.connect({ name: 'qts-gpt-handoff' });
    } catch (connectErr) {
      finish(reject, connectErr);
      return;
    }

    port.onMessage.addListener((msg) => {
      if (msg?.type !== 'GPT_HANDOFF_RESULT') return;
      if (msg.taskId && taskId && msg.taskId !== taskId) return;
      if (msg.ok && msg.handoff?.sent !== false) {
        finish(resolve, msg);
        return;
      }
      finish(reject, new Error(msg.handoff?.error || msg.error || 'GPT handoff failed.'));
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      const errText = chrome.runtime.lastError?.message;
      if (errText) {
        finish(reject, new Error(errText));
      }
    });

    port.postMessage({
      type: 'SEND_GPT_TASK',
      taskId,
      jobTabId,
      applicationId,
      pollAndApply,
    });
  });
}

async function sendGptTaskToBackground({ taskId, jobTabId, applicationId, pollAndApply }) {
  const dispatchWaiter = waitForGptDispatchFinished(taskId);
  try {
    const startRes = await chrome.runtime.sendMessage({
      type: 'SEND_GPT_TASK',
      taskId,
      jobTabId,
      applicationId,
      pollAndApply,
      async: true,
    });
    if (!startRes?.started && !startRes?.ok) {
      throw new Error(startRes?.error || 'Could not start GPT handoff.');
    }
    return dispatchWaiter;
  } catch (messageErr) {
    try {
      return await sendGptTaskViaPort({ taskId, jobTabId, applicationId, pollAndApply });
    } catch (portErr) {
      throw new Error(portErr?.message || messageErr?.message || 'Could not start GPT handoff.');
    }
  }
}

async function sendScannerChatGptTask({ taskId, jobTabId, prompt }) {
  const dispatchWaiter = waitForGptDispatchFinished(taskId, 300000);
  dispatchWaiter.catch(() => {});
  try {
    const started = await chrome.runtime.sendMessage({
      type: 'SEND_SCANNER_CHATGPT_TASK',
      taskId,
      jobTabId,
      prompt,
      async: true,
    });
    if (!started?.started) {
      throw new Error(started?.error || 'Could not start the ChatGPT Scanner handoff.');
    }
    return { dispatchWaiter };
  } catch (error) {
    const waiter = gptDispatchWaiters.get(taskId);
    if (waiter) {
      clearTimeout(waiter.timer);
      gptDispatchWaiters.delete(taskId);
    }
    throw error;
  }
}

async function resolveTargetTabOnLoad() {
  const fromQuery = getQueryTabId();
  if (fromQuery) return fromQuery;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_URL' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const tabId = res?.tabId;
      const url = res?.url || '';
      if (!tabId || !url) {
        resolve(null);
        return;
      }
      if (url.includes('chatgpt.com') || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        resolve(null);
        return;
      }
      resolve(tabId);
    });
  });
}

// ---- Init ----
function applyGptDispatchResult(msg) {
  const handoff = msg.handoff || {};
  if (!msg.ok) {
    const detail = handoff.error || msg.error || 'Could not send PROCESS_TASK to Custom GPT.';
    setGptPipelineState('error', detail);
    showAlert('main-alert', detail, 'error');
    return { ok: false, error: detail };
  }
  if (!handoff.sent) {
    const prompt = window.__qtsCustomGpt?.buildPrompt?.(msg.taskId || activeTaskId);
    if (prompt) copyTextToClipboard(prompt);
    const detail = handoff.error || 'Could not send PROCESS_TASK automatically.';
    setGptPipelineState('waiting', 'GPT handoff failed — click GPT task to copy PROCESS_TASK, paste in Custom GPT tab.');
    showAlert('main-alert', `GPT auto-send failed: ${detail}. Copy PROCESS_TASK from GPT task button and paste manually.`, 'warn');
    updateCustomGptButton();
    return { ok: false, error: detail };
  } else {
    setGptPipelineState('waiting', 'Waiting for Custom GPT. Extension is clicking Allow automatically.');
    showAlert('main-alert', 'PROCESS_TASK sent. Extension will click Allow and monitor GPT Actions.', 'success');
  }
  updateCustomGptButton();
  return { ok: true, handoff };
}

document.addEventListener('DOMContentLoaded', async () => {
  initializePageHighlightColorPickers();
  initializePageHighlightPreview();
  if (new URLSearchParams(window.location.search).get('embedded') === '1') {
    document.documentElement.style.width = '100%';
    document.documentElement.style.height = '100%';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
  }
  const logoEl = document.getElementById('header-logo');
  if (logoEl) logoEl.src = chrome.runtime.getURL('assets/account-logo.png');
  targetTabId = getQueryTabId() || await resolveTargetTabOnLoad();
  if (targetTabId) {
    try {
      const sourceTab = await chrome.tabs.get(targetTabId);
      sourceWindowId = sourceTab.windowId ?? null;
    } catch (e) {
      console.warn('Could not resolve source browser window:', e);
    }
    await chrome.storage.local.set({ qtsJobSourceTabId: targetTabId });
    chrome.runtime.sendMessage({ type: 'REGISTER_JOB_TAB', tabId: targetTabId }).catch(() => {});
  }
  try {
    await window.api.ensureServerUrl();
    await bootstrapPopupFast();
    if (
      new URLSearchParams(window.location.search).get('panel') === 'text-highlights'
      && currentUser?.role === 'manager'
    ) {
      await openPageHighlights();
      if (!managerExtensionFeatures.canManageTextHighlights) {
        window.parent.postMessage({ type: 'QTS_CLOSE_TEXT_HIGHLIGHTS' }, '*');
      }
    }
    if (
      new URLSearchParams(window.location.search).get('panel') === 'page-exclusions'
      && currentUser?.role === 'manager'
    ) {
      await showPageExclusions();
      if (!managerExtensionFeatures.canManagePageExclusions) {
        window.parent.postMessage({ type: 'QTS_CLOSE_TEXT_HIGHLIGHTS' }, '*');
      }
    }
    checkConnection().catch(() => {});
  } catch {
    hideLoading(true);
    await showLogin();
  }

  const loginForm = document.getElementById('login-form');
  const loginUser = document.getElementById('login-user');
  const loginPassword = document.getElementById('login-pass');
  const submitCompletedLogin = () => {
    if (loginUser.value.trim() && loginPassword.value) doLogin();
  };
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCompletedLogin();
  });
  loginUser.addEventListener('change', submitCompletedLogin);
  loginPassword.addEventListener('change', submitCompletedLogin);
  document.getElementById('login-default-candidate')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      startAutoApplyFromLoginStep().catch((err) => {
        showAlert('login-alert', err?.message || 'Could not start auto-apply.', 'error');
      });
    }
  });
  document.getElementById('btn-extension-logout')?.addEventListener('click', doLogout);
  document.getElementById('btn-get-jd-mode')?.addEventListener('click', startGetJdPreview);
  document.getElementById('btn-get-jd-back-home')?.addEventListener('click', backHomeFromGetJd);
  document.getElementById('btn-get-jd-check')?.addEventListener('click', confirmGetJdMode);
  document.getElementById('btn-get-jd-preview-back')?.addEventListener('click', backHomeFromGetJd);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[EXTENSION_STATUS_KEY]) {
      refreshGetJdView().catch((error) => {
        console.error('[QTS Get JD] Could not refresh the popup result:', error);
      });
    }
  });
  document.querySelectorAll('.btn-text-highlights').forEach((button) => {
    button.addEventListener('click', () => {
      openPageHighlights().catch((error) => {
        setPageHighlightStatus(error.message || 'Could not open text highlight management.', true);
      });
    });
  });
  document.querySelectorAll('.btn-page-exclusions').forEach((button) => {
    button.addEventListener('click', () => {
      showPageExclusions().catch((error) => {
        setPageExclusionsStatus(error.message || 'Could not open excluded URL settings.', true);
      });
    });
  });
  document.getElementById('btn-close-page-highlights')?.addEventListener('click', returnFromPageHighlights);
  document.getElementById('btn-close-page-exclusions')?.addEventListener('click', returnFromPageExclusions);
  document.getElementById('page-exclusion-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('page-exclusion-url');
    const submit = document.getElementById('page-exclusion-submit');
    submit.disabled = true;
    setPageExclusionsStatus('Saving excluded URL…');
    addPageExclusion(input.value.trim())
      .catch((error) => setPageExclusionsStatus(error.message || 'Could not save this URL.', true))
      .finally(() => {
        submit.disabled = false;
      });
  });
  document.getElementById('page-highlight-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = document.getElementById('page-highlight-text');
    const textColor = document.getElementById('page-highlight-text-color');
    const backgroundColor = document.getElementById('page-highlight-background-color');
    const ruleId = selectedPageHighlightRuleId;
    const rule = {
      id: ruleId || crypto.randomUUID(),
      text: text.value,
      textColor: textColor.value,
      backgroundColor: backgroundColor.value,
    };
    const save = ruleId
      ? savePageHighlightRule(ruleId, rule)
      : addPageHighlightRule(rule);
    save.catch((error) => setPageHighlightStatus(error.message || 'Could not save this rule.', true));
  });
  document.getElementById('page-highlight-cancel')?.addEventListener('click', () => {
    if (!confirmDiscardPageHighlightChanges()) return;
    selectedPageHighlightRuleId = null;
    syncPageHighlightEditor();
    setPageHighlightStatus('Ready to add a new highlight rule.');
  });
  document.getElementById('page-highlight-delete')?.addEventListener('click', () => {
    if (!selectedPageHighlightRuleId) return;
    deletePageHighlightRule(selectedPageHighlightRuleId)
      .catch((error) => setPageHighlightStatus(error.message || 'Could not delete this rule.', true));
  });
  document.getElementById('btn-change-team')?.addEventListener('click', async () => {
    if (currentUser?.role !== 'manager') return;
    if (!managerTeams.length) {
      const workspace = await window.api.extensionBootstrap();
      managerTeams = workspace.teams || [];
    }
    await showManagerTeamStep(currentUser);
  });
  document.getElementById('btn-select-team')?.addEventListener('click', () => {
    selectManagerTeam().catch((e) => {
      showAlert('login-alert', e?.message || 'Could not load Account team.', 'error');
    });
  });
  document.getElementById('btn-start-auto-apply')?.addEventListener('click', () => {
    continueToActionScreen().catch((e) => {
      showAlert('login-alert', e?.message || 'Could not continue.', 'error');
    });
  });
  document.getElementById('btn-setup-not-now')?.addEventListener('click', () => {
    continueToActionScreen().catch((e) => {
      showAlert('login-alert', e?.message || 'Could not continue.', 'error');
    });
  });
  document.getElementById('login-default-candidate')?.addEventListener('change', (event) => {
    const nextId = parseInt(event.target.value, 10);
    if (Number.isFinite(nextId)) expandedCandidateIds.add(nextId);
  });
  document.getElementById('main-default-candidate')?.addEventListener('change', (event) => {
    onMainDefaultCandidateChange(event).catch((e) => {
      showAlert('main-alert', e?.message || 'Could not update default candidate.', 'error');
    });
  });
  document.getElementById('btn-start-default-candidate')?.addEventListener('click', () => {
    startApplicationWithDefault().catch((e) => {
      console.error('startApplicationWithDefault error:', e);
      showAlert('main-alert', e?.message || 'Could not start application.', 'error');
    });
  });
  document.getElementById('btn-toggle-auto-apply')?.addEventListener('click', () => {
    toggleAutoApplyFromPopup().catch((e) => {
      showAlert('main-alert', e?.message || 'Could not update auto-apply.', 'error');
    });
  });
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-action-logout').addEventListener('click', doLogout);
  document.getElementById('btn-change-mode').addEventListener('click', () => {
    if (!currentUser) return;
    showActionScreen(currentUser).catch((e) => {
      showAlert('main-alert', e?.message || 'Could not change mode.', 'error');
    });
  });
  document.getElementById('btn-get-jd').addEventListener('click', async () => {
    try {
      await selectAction('btn-get-jd');
      const confirmed = await confirmGetJobDetails();
      if (!confirmed) {
        showAlert('main-alert', 'Get JD cancelled. No job details were read.', 'info');
        return;
      }
    } catch (e) {
      showAlert('main-alert', e?.message || 'Could not save selected action.', 'error');
      return;
    }
    clearAlert('main-alert');
    showJobSection();
    showLoading('Reading job details from this tab…');
    loadCurrentTab({ preferCache: true, allowExtract: true }).catch((e) => {
      showAlert('main-alert', e?.message || 'Could not load the job description.', 'error');
    }).finally(() => {
      hideLoading();
    });
  });
  document.getElementById('btn-discover-site-step')?.addEventListener('click', () => {
    scannerApplyMode = false;
    scanAndSaveSiteDiscoveryStep();
  });
  document.getElementById('btn-apply')?.addEventListener('click', () => {
    if (currentUser?.role !== 'manager' || !managerExtensionFeatures.canUseScanner) {
      showAlert('main-alert', managerExtensionFeaturesError || 'Apply is available only to signed-in Managers.', 'error');
      return;
    }
    scannerApplyMode = true;
    const button = document.getElementById('btn-apply');
    if (button) button.disabled = true;
    scanAndSaveSiteDiscoveryStep().finally(() => {
      if (button) button.disabled = false;
    });
    document.getElementById('btn-connect-account-mailbox')?.addEventListener('click', () => {
      connectSelectedAccountMailbox().catch((error) => {
        const status = document.getElementById('account-mailbox-status');
        if (status) {
          status.classList.remove('hidden');
          status.textContent = error?.message || 'Could not connect the Account Gmail mailbox.';
        }
      });
    });
  });
  document.getElementById('btn-scanner-output-folder')?.addEventListener('click', () => {
    selectScannerOutputDirectory().catch((error) => {
      if (error?.name === 'AbortError') return;
      const status = document.getElementById('scanner-output-folder-status');
      if (status) {
        status.classList.remove('hidden');
        status.textContent = error?.message || 'Could not select the generated-files folder.';
      }
    });
  });
  document.getElementById('btn-save-and-scan')?.addEventListener('click', () => {
    saveJobAndStartScanner().catch((error) => {
      const errorMessage = error?.message || 'Could not save and start Scanner.';
      if (currentUser?.role === 'manager' && !managerExtensionFeatures.canUseScanner) {
        showAlert('main-alert', errorMessage, 'error');
        return;
      }
      const status = document.getElementById('site-discovery-status');
      if (status) status.textContent = errorMessage;
      const saveStatus = document.getElementById('scanner-save-status');
      if (saveStatus) {
        saveStatus.classList.remove('hidden');
        saveStatus.textContent = errorMessage;
      }
      const button = document.getElementById('btn-save-and-scan');
      if (button && scannerSetupPending) button.disabled = false;
      if (targetTabId) {
        notifyScannerStage(targetTabId, saveStatus, errorMessage, 'error', 12000)
          .catch((noticeError) => console.warn('Could not display the Scanner error on the job page:', noticeError));
      }
    });
  });
  document.getElementById('btn-custom-apply').addEventListener('click', async () => {
    try {
      if (currentUser?.role === 'manager') {
        throw new Error('Managers apply through the assigned job list using the Apply button.');
      }
      await selectAction('btn-custom-apply');
    } catch (e) {
      showAlert('main-alert', e?.message || 'Could not save selected action.', 'error');
      return;
    }
    try {
      requireManagerCustomGpt();
    } catch (e) {
      showAlert('main-alert', e?.message || 'Contact your Admin for a Custom GPT assignment.', 'warn');
      return;
    }
    dispatchGptTask(activeApplicationId, { pollAndApply: true }).catch((e) => {
      showAlert('main-alert', e?.message || 'Could not start Custom Apply.', 'error');
    });
  });
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('job-account-groups')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[data-job-account-id]');
    if (!checkbox) return;
    const accountId = Number(checkbox.dataset.jobAccountId);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return;
    hasManuallyChangedJobAccounts = true;
    if (checkbox.checked) selectedJobAccountIds.add(accountId);
    else selectedJobAccountIds.delete(accountId);
    updateJobAccountSelectionStatus();
  });
  document.getElementById('btn-refresh').addEventListener('click', doRefresh);
  document.getElementById('btn-refresh-application')?.addEventListener('click', () => {
    refreshApplicationStatus().catch(() => {
      showAlert('main-alert', 'Could not refresh application session.', 'error');
    });
  });
  document.getElementById('application-session-id')?.addEventListener('click', () => {
    if (activeApplicationId) copyTextToClipboard(String(activeApplicationId));
  });
  document.getElementById('application-task-id')?.addEventListener('click', () => {
    if (activeTaskId && window.__qtsCustomGpt?.buildPrompt) {
      copyTextToClipboard(window.__qtsCustomGpt.buildPrompt(activeTaskId));
    }
  });
  document.getElementById('btn-open-custom-gpt')?.addEventListener('click', () => {
    try {
      requireManagerCustomGpt();
    } catch (e) {
      showAlert('main-alert', e?.message || 'Contact your Admin for a Custom GPT assignment.', 'warn');
      return;
    }
    dispatchGptTask(activeApplicationId, { pollAndApply: true }).catch((e) => {
      console.error('dispatchGptTask error:', e);
      showAlert('main-alert', e?.message || 'Could not send task to Custom GPT.', 'error');
    });
  });
  document.getElementById('btn-apply-gpt-package')?.addEventListener('click', () => {
    try {
      requireManagerCustomGpt();
    } catch (e) {
      showAlert('main-alert', e?.message || 'Contact your Admin for a Custom GPT assignment.', 'warn');
      return;
    }
    chrome.runtime.sendMessage({
      type: 'APPLY_GPT_PACKAGE_TO_TAB',
      applicationId: activeApplicationId,
      jobTabId: targetTabId,
    }).then((res) => {
      if (!res?.ok) {
        throw new Error(res?.error || 'Could not apply GPT package.');
      }
      gptAppliedToForm = true;
      const uploadNote = res.uploadedCount ? ` Uploaded ${res.uploadedCount} PDF(s).` : '';
      setGptPipelineState('ready', `Applied ${res.filledCount || 0} field(s) to the form.${uploadNote} Review before submit.`);
      renderGptActionSteps(lastGptTaskStatus);
      showAlert('main-alert', `Applied ${res.filledCount || 0} field(s).${uploadNote} Review the form before submitting.`, 'success');
      refreshApplicationStatus().catch(() => {});
    }).catch((e) => {
      console.error('applyGptAnswersToForm error:', e);
      showAlert('main-alert', e?.message || 'Could not apply GPT answers.', 'error');
    });
  });
  document.getElementById('btn-copy-dev-summary')?.addEventListener('click', () => {
    const el = document.getElementById('dev-capture-summary');
    if (el?.value) copyTextToClipboard(el.value);
  });
  document.getElementById('btn-copy-dev-raw')?.addEventListener('click', () => {
    const el = document.getElementById('dev-capture-raw');
    if (el?.value) copyTextToClipboard(el.value);
  });
  document.getElementById('cand-filter').addEventListener('input', () => filterCandidates());
  document.getElementById('cand-stack-filter').addEventListener('change', () => filterCandidates());
  document.getElementById('cand-list').addEventListener('change', onCandidateStatusChange);
  document.getElementById('cand-list').addEventListener('click', onCandidateCardClick);
  ['f-title', 'f-company', 'f-url'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      if (id === 'f-title') autoSelectJobAccountsForTitle();
      updateJobSummary();
    });
  });
  document.getElementById('f-desc').addEventListener('input', updateJobSummary);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'AUTH_SESSION_EXPIRED') {
      clearAuthState()
        .then(() => {
          showAlert('login-alert', 'Session expired (24 hours). Please log in again.', 'warn');
          return showLogin();
        })
        .catch(() => {});
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_DISPATCH_FINISHED') {
      if (settleGptDispatchWaiter(msg)) {
        sendResponse?.({ ok: true });
        return;
      }
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (gptHandoffInProgress) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      hideLoading(true);
      applyGptDispatchResult(msg);
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'QTS_SCANNER_JOB_PROGRESS') {
      if (Number(msg.jobTabId) === Number(targetTabId)) {
        if (typeof msg.message === 'string') {
          for (const id of ['scanner-save-status', 'site-discovery-status']) {
            const status = document.getElementById(id);
            if (!status) continue;
            status.textContent = msg.message;
            status.classList.remove('hidden');
          }
        }
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_ACTION_APPROVAL_NEEDED') {
      setGptPipelineState('waiting', msg.message || 'Custom GPT Actions — auto-clicking Allow…');
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_PAGE_STATUS') {
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (msg.allowClicked && msg.clickedLabel) {
        const action = msg.hasSubmitTaskPackage ? 'submitTaskPackage' : (msg.hasGetTaskContext ? 'getTaskContext' : 'GPT Action');
        setGptPipelineState('waiting', `Clicked Allow (${msg.clickedLabel}) for ${action}…`);
      } else if (msg.hasApprovalDialog && !msg.allowButtonCount) {
        setGptPipelineState('waiting', 'Approval dialog visible — searching for Allow button…');
      } else if (msg.hasApprovalDialog) {
        setGptPipelineState('waiting', 'Approval dialog visible — clicking Allow…');
      } else if (msg.thinking) {
        setGptPipelineState('waiting', 'Custom GPT is thinking…');
      } else if (msg.taskSaved) {
        setGptPipelineState('waiting', 'GPT package saved — waiting for server…');
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_PAGE_WATCH_FINISHED') {
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (msg.ok) {
        setGptPipelineState('waiting', `GPT Actions complete (${msg.totalAllowClicks || 0} Allow click(s)). Polling server…`);
      } else if (msg.error) {
        setGptPipelineState('error', msg.error);
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'GPT_APPLY_FINISHED') {
      if (msg.taskId && activeTaskId && msg.taskId !== activeTaskId) {
        sendResponse?.({ ok: true, ignored: true });
        return;
      }
      if (msg.success) {
        gptAppliedToForm = true;
        const uploadNote = msg.uploadedCount ? ` Uploaded ${msg.uploadedCount} PDF(s).` : '';
        setGptPipelineState('ready', `Applied ${msg.filledCount || 0} field(s) to the form.${uploadNote} Review before submit.`);
        renderGptActionSteps(lastGptTaskStatus);
        showAlert('main-alert', `GPT package applied to the job form.${uploadNote}`, 'success');
        refreshApplicationStatus().catch(() => {});
      } else if (msg.error) {
        setGptPipelineState('error', msg.error);
        showAlert('main-alert', msg.error, 'error');
      }
      sendResponse?.({ ok: true });
      return;
    }
    if (msg.type === 'APPLY_TEMPLATE_DETECTED' && msg.tabId) {
      if (Number(msg.tabId) === Number(targetTabId)) {
        loadApplyTemplateForTab(msg.tabId)
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
        return true;
      }
      sendResponse({ ok: false, ignored: true });
      return false;
    }
    if (msg.type === 'JOB_DETECTED_UPDATE' && msg.tabId) {
      if (Number(msg.tabId) === Number(targetTabId)) {
        loadCurrentTab({ preferCache: true, allowExtract: false })
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: e?.message || 'Failed' }));
        return true;
      }
      sendResponse({ ok: false, ignored: true });
      return false;
    }
  });
});

async function bootstrapPopupFast() {
  const hydrated = await global.__qtsAccountAuth?.hydratePopupAuth?.();
  if (!hydrated) {
    hideLoading(true);
    await showLogin();
    return;
  }

  const token = await getStoredToken();
  if (!token) {
    hideLoading(true);
    await showLogin();
    return;
  }

  showLoading('Checking your Manager account…');
  try {
    const user = await window.api.me();
    setStatus(user.success && user.username ? 'connected' : 'disconnected');
    if (!user.success || !user.username) {
      if (user._httpStatus === 401 || user._httpStatus === 403) {
        await clearAuthState();
      }
      await showLogin();
      showAlert('login-alert', user.message || 'Could not verify your login. Try again.', 'error');
      return;
    }
    if (user.role !== 'manager') {
      await clearAuthState();
      await showLogin();
      showAlert('login-alert', 'Only Manager accounts can sign in to the extension.', 'error');
      return;
    }
    const sessionUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    };
    await storeSessionUser(sessionUser);
    showAuthenticatedScreen(sessionUser);
  } finally {
    hideLoading(true);
  }
}

async function refreshWorkspaceInBackground() {
  try {
    const cached = await readCandidateCache();
    if (cached?.savedAt && Date.now() - cached.savedAt < WORKSPACE_BACKGROUND_REFRESH_MIN_MS) {
      return;
    }
    const workspace = await fetchWorkspaceData(true);
    if (workspace?.success && workspace.user) {
      defaultCandidateId = await readDefaultCandidateId(workspace.user.accountId);
      renderCandidates();
      updateJobSummary();
      updateDefaultCandidateUi();
    }
  } catch { /* non-fatal */ }
}

async function verifySavedJobOnServer(urls) {
  const saved = await findSavedJobByUrls(urls, { skipCache: true, showSpinner: true });
  if (!saved) return false;

  loadExistingJob(saved, { silent: true });
  renderCandidates();
  updateJobSummary();
  scheduleFitPopup();
  return true;
}

async function ensurePageNotificationHost(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/capture-panel.js'],
  });
}

async function showPageNotice(tabId, message, toastType = 'info', options = {}) {
  await ensurePageNotificationHost(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'QTS_SHOW_PAGE_TOAST',
    message,
    toastType,
    durationMs: options.durationMs,
    persistUntilCleared: options.persistUntilCleared === true,
    closeTabAfterMs: options.closeTabAfterMs,
    alertId: options.alertId,
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not display the notice on the job page.');
  }
}

async function notifyScannerStage(
  tabId,
  statusElement,
  message,
  toastType = 'info',
  durationMs = 6000,
  persistUntilCleared = false
) {
  if (statusElement) statusElement.textContent = message;
  await clearPageNotice(tabId, 'scanner-progress');
  await showPageNotice(tabId, message, toastType, {
    durationMs,
    persistUntilCleared,
    alertId: 'scanner-progress',
  });
}

async function clearPageNotice(tabId, alertId) {
  await ensurePageNotificationHost(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'QTS_CLEAR_PAGE_ALERT',
    alertId,
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not clear the page notice.');
  }
}

async function confirmOnJobPage(tabId, message, title = 'Job already saved') {
  await ensurePageNotificationHost(tabId);
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'QTS_CONFIRM_PAGE',
    title,
    message,
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'Could not show the confirmation on the job page.');
  }
  return Boolean(response.confirmed);
}

async function checkCurrentJobUrl(url) {
  const response = await window.api.checkJobByUrl(url);
  if (!response.success) {
    throw new Error(response.message || 'Could not check this job URL.');
  }
  return response;
}

async function handleGetJdUrlStatus(tabId, url) {
  const status = await checkCurrentJobUrl(url);
  if (status.alreadyApplied) {
    await clearPageNotice(tabId, 'job-url-status');
    await showPageNotice(
      tabId,
      'You have already applied to this job.',
      'warn',
      { durationMs: 3000, closeTabAfterMs: 3000, alertId: 'job-url-status' }
    );
    return { stop: true, job: null };
  }

  if (!status.job) return { stop: false, job: null };

  await clearPageNotice(tabId, 'job-url-status');
  await showPageNotice(tabId, 'This job is already on your list.', 'info', {
    alertId: 'job-url-status',
  });
  if (status.job.status === 'failed') {
    await showPageNotice(
      tabId,
      'This application did not succeed. You can try applying again.',
      'warn'
    );
  }
  const addAnotherAccount = await confirmOnJobPage(
    tabId,
    'Would you like to add another account to this job?'
  );
  return { stop: !addAnotherAccount, job: addAnotherAccount ? status.job : null };
}

// ---- Connection ----
async function checkConnection() {
  setStatus('checking');
  try {
    const r = await window.api.health();
    setStatus(r.success ? 'connected' : 'disconnected');
  } catch {
    setStatus('disconnected');
  }
}

function setStatus(state) {
  const el = document.getElementById('connection-status');
  const txt = document.getElementById('status-text');
  el.className = `status-pill status-${state}`;
  txt.textContent = state === 'connected' ? 'Connected' : state === 'checking' ? 'Checking…' : 'Disconnected';
}

// ---- Auth ----
function isAccountSession(user) {
  if (!user || (user.role !== 'account' && user.role !== 'manager')) return false;
  const accountId = Number(user.accountId);
  return Number.isFinite(accountId) && accountId > 0;
}

function normalizeCandidateRecord(candidate) {
  if (!candidate) return null;
  const id = Number(candidate.id);
  if (!Number.isFinite(id)) return null;
  const rawActive = candidate.is_active ?? candidate.isActive;
  const isActive = rawActive !== false && rawActive !== 0 && rawActive !== 'f' && rawActive !== 'false';
  return { ...candidate, id, is_active: isActive };
}

function normalizeCandidateList(list) {
  return (list || [])
    .map(normalizeCandidateRecord)
    .filter((candidate) => candidate && candidate.is_active !== false);
}

function getAccountIdFromUser(user) {
  const accountId = Number(user?.accountId);
  return Number.isFinite(accountId) && accountId > 0 ? accountId : null;
}

async function readDefaultCandidateMap() {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(
      [DEFAULT_CANDIDATE_KEY, LEGACY_DEFAULT_CANDIDATE_KEY],
      (result) => resolve(result)
    );
  });
  const legacyMap = stored[LEGACY_DEFAULT_CANDIDATE_KEY];
  const currentMap = stored[DEFAULT_CANDIDATE_KEY];
  if (legacyMap && typeof legacyMap === 'object') {
    const merged = { ...legacyMap, ...(currentMap || {}) };
    await new Promise((resolve) => {
      chrome.storage.local.set({ [DEFAULT_CANDIDATE_KEY]: merged }, resolve);
    });
    await new Promise((resolve) => {
      chrome.storage.local.remove(LEGACY_DEFAULT_CANDIDATE_KEY, resolve);
    });
    return merged;
  }
  return currentMap && typeof currentMap === 'object' ? currentMap : {};
}

async function readDefaultCandidateId(accountId) {
  const id = getAccountIdFromUser({ accountId });
  if (!id) return null;
  const map = await readDefaultCandidateMap();
  const candidateId = Number(map[String(id)]);
  return Number.isFinite(candidateId) ? candidateId : null;
}

async function storeDefaultCandidateId(accountId, candidateId) {
  const id = getAccountIdFromUser({ accountId });
  if (!id) throw new Error('Select an Account team first.');
  const numericCandidateId = Number(candidateId);
  if (!Number.isFinite(numericCandidateId)) throw new Error('Select a candidate.');
  const map = await readDefaultCandidateMap();
  map[String(id)] = numericCandidateId;
  await new Promise((resolve) => {
    chrome.storage.local.set({ [DEFAULT_CANDIDATE_KEY]: map }, resolve);
  });
  defaultCandidateId = numericCandidateId;
}

async function readAutoApplyEnabled() {
  const stored = await chrome.storage.local.get([AUTO_APPLY_ENABLED_KEY]);
  return stored[AUTO_APPLY_ENABLED_KEY] === true;
}

async function setAutoApplyEnabled(enabled) {
  if (enabled && !managerCustomGptAssigned) {
    throw new Error('No Custom GPT is assigned to your Manager account. Contact your Admin.');
  }
  await new Promise((resolve) => {
    chrome.storage.local.set({ [AUTO_APPLY_ENABLED_KEY]: Boolean(enabled) }, resolve);
  });
  if (enabled) {
    await global.__qtsAccountAuth?.armWorkerAuth?.();
  } else {
    await global.__qtsAccountAuth?.disarmWorkerAuth?.();
    chrome.runtime.sendMessage({ type: 'RESET_AUTO_PIPELINE_STATE' }).catch(() => {});
  }
  updateAutoApplyBarUi();
}

function getDefaultCandidate() {
  if (!defaultCandidateId) return null;
  return candidates.find((c) => Number(c.id) === Number(defaultCandidateId)) || null;
}

function isValidDefaultCandidateId(candidateId) {
  const id = Number(candidateId);
  if (!Number.isFinite(id)) return false;
  const candidate = candidates.find((c) => Number(c.id) === id);
  return Boolean(candidate && candidate.is_active !== false);
}

async function needsDefaultCandidateSelection(user) {
  const accountId = getAccountIdFromUser(user);
  if (!accountId) return false;
  const savedId = await readDefaultCandidateId(accountId);
  if (!savedId) return true;
  if (!candidates.length) {
    defaultCandidateId = savedId;
    return false;
  }
  return !isValidDefaultCandidateId(savedId);
}

function populateDefaultCandidateSelect(selectEl, { includePlaceholder = true } = {}) {
  if (!selectEl) return;
  const previous = selectEl.value;
  const options = [];
  if (includePlaceholder) {
    options.push('<option value="">— Select candidate —</option>');
  } else {
    options.push('<option value="">Default…</option>');
  }
  candidates.forEach((candidate) => {
    const label = `${candidate.name}${candidate.stack ? ` (${candidate.stack})` : ''}`;
    options.push(`<option value="${candidate.id}">${escHtml(label)}</option>`);
  });
  selectEl.innerHTML = options.join('');
  if (previous && [...selectEl.options].some((opt) => opt.value === previous)) {
    selectEl.value = previous;
  } else if (defaultCandidateId) {
    selectEl.value = String(defaultCandidateId);
  }
}

function resetLoginFormView() {
  document.getElementById('login-form')?.classList.remove('hidden');
  document.getElementById('login-candidate-step')?.classList.add('hidden');
  document.getElementById('login-team-step')?.classList.add('hidden');
  document.getElementById('login-candidate-fields')?.classList.remove('hidden');
  const signedInEl = document.getElementById('login-signed-in-as');
  if (signedInEl) signedInEl.textContent = '';
}

function populateManagerTeamSelect() {
  const select = document.getElementById('login-team');
  if (!select) return;
  select.innerHTML = [
    '<option value="">— Select Account —</option>',
    ...managerTeams.map((team) => `<option value="${Number(team.id)}">${escHtml(team.name)}</option>`),
  ].join('');
  const activeAccountId = Number(currentUser?.accountId);
  if (Number.isFinite(activeAccountId) && managerTeams.some((team) => Number(team.id) === activeAccountId)) {
    select.value = String(activeAccountId);
  }
}

async function showManagerTeamStep(user) {
  setSession(user);
  document.getElementById('login-section')?.classList.remove('hidden');
  document.getElementById('job-section')?.classList.add('hidden');
  document.getElementById('action-bar')?.classList.add('hidden');
  document.getElementById('login-form')?.classList.add('hidden');
  document.getElementById('login-candidate-step')?.classList.remove('hidden');
  document.getElementById('login-team-step')?.classList.remove('hidden');
  document.getElementById('login-candidate-fields')?.classList.add('hidden');
  const signedInEl = document.getElementById('login-signed-in-as');
  if (signedInEl) signedInEl.textContent = `Signed in as Manager ${user.username}`;
  populateManagerTeamSelect();
  if (!managerTeams.length) {
    showAlert('login-alert', 'No active Account teams are assigned to your Manager account. Ask an Admin to assign one.', 'error');
  }
  scheduleFitPopup();
}

async function selectManagerTeam() {
  const select = document.getElementById('login-team');
  const accountId = Number(select?.value);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    showAlert('login-alert', 'Select an Account team first.', 'error');
    return;
  }
  showLoading('Loading Account team…');
  try {
    const workspace = await window.api.extensionBootstrap(accountId);
    if (!workspace.success || !workspace.user || !workspace.token) {
      showAlert('login-alert', workspace.message || 'Could not load that Account team.', 'error');
      return;
    }
    managerTeams = workspace.teams || managerTeams;
    const sessionSnapshot = workspace.user;
    await global.__qtsAccountAuth.storePopupAuth(workspace.token, sessionSnapshot, workspace.expiresAt);
    window.api.setCachedToken(workspace.token);
    await storeSessionUser(sessionSnapshot);
    applyCandidatesData(workspace.candidates || [], workspace.stacks || []);
    await applyOptionalWorkspaceCustomGpt(sessionSnapshot);
    await writeCandidateCache(workspace.candidates || [], workspace.stacks || [], sessionSnapshot);
    document.getElementById('login-team-step')?.classList.add('hidden');
    document.getElementById('login-candidate-step')?.classList.add('hidden');
    document.getElementById('login-candidate-fields')?.classList.add('hidden');
    setSession(sessionSnapshot);
    defaultCandidateId = null;
    await showActionScreen(sessionSnapshot);
  } finally {
    hideLoading();
  }
}

async function showDefaultCandidateStep(user, { armOnly = false } = {}) {
  setSession(user);
  document.getElementById('login-section')?.classList.remove('hidden');
  document.getElementById('job-section')?.classList.add('hidden');
  document.getElementById('action-bar')?.classList.add('hidden');
  document.getElementById('login-form')?.classList.add('hidden');
  document.getElementById('login-candidate-step')?.classList.remove('hidden');

  const signedInEl = document.getElementById('login-signed-in-as');
  if (signedInEl) {
    const label = (user?.username || user?.accountName || 'Account').trim();
    signedInEl.textContent = armOnly
      ? `Signed in as ${label} — press Start when you are ready to apply on job pages`
      : `Signed in as ${label}`;
  }

  if (!candidates.length) {
    showLoading('Loading candidates…');
    try {
      await fetchWorkspaceData(true);
    } finally {
      hideLoading(true);
    }
  }

  defaultCandidateId = await readDefaultCandidateId(user?.accountId);
  const select = document.getElementById('login-default-candidate');
  populateDefaultCandidateSelect(select, { includePlaceholder: true });
  if (defaultCandidateId && isValidDefaultCandidateId(defaultCandidateId)) {
    select.value = String(defaultCandidateId);
  } else if (candidates.length === 1) {
    select.value = String(candidates[0].id);
  }

  clearAlert('login-alert');
  scheduleFitPopup();
}

function readSelectedDefaultCandidateId() {
  const select = document.getElementById('login-default-candidate');
  const candidateId = parseInt(select?.value, 10);
  if (!Number.isFinite(candidateId) || !isValidDefaultCandidateId(candidateId)) {
    throw new Error('Choose a default candidate first.');
  }
  return candidateId;
}

async function armAutoApplyOnCurrentJobTab() {
  const tabId = targetTabId || await resolveTargetTabOnLoad();
  if (!tabId) {
    throw new Error('Open a job page in your browser first.');
  }
  await chrome.storage.local.set({ qtsJobSourceTabId: tabId });
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'START_AUTO_APPLY_ON_TAB', jobTabId: tabId }, (res) => {
      if (chrome.runtime.lastError) {
        resolve(tabId);
        return;
      }
      if (res?.ok === false) {
        reject(new Error(res.error || 'Could not start auto-apply on the job page.'));
        return;
      }
      resolve(tabId);
    });
  });
}

async function continueToActionScreen() {
  const user = currentUser || await readSessionUser();
  if (!user || !isAccountSession(user)) {
    throw new Error('Sign in first.');
  }
  if (user.role === 'manager') {
    await showActionScreen(user);
    return;
  }
  const select = document.getElementById('login-default-candidate');
  const candidateId = parseInt(select?.value, 10);
  if (!Number.isFinite(candidateId) || !isValidDefaultCandidateId(candidateId)) {
    throw new Error('Choose a candidate before continuing.');
  }
  await storeDefaultCandidateId(user.accountId, candidateId);
  defaultCandidateId = candidateId;
  await showActionScreen(user);
}

async function toggleAutoApplyFromPopup() {
  requireManagerCustomGpt();
  const user = currentUser || await readSessionUser();
  if (!user || !isAccountSession(user)) {
    throw new Error('Sign in first.');
  }
  if (user.role === 'manager') {
    throw new Error('Managers apply through the assigned job list using the Apply button.');
  }
  if (!(await readAutoApplyEnabled())) {
    const select = document.getElementById('main-default-candidate');
    const fromMain = parseInt(select?.value, 10);
    if (Number.isFinite(fromMain) && isValidDefaultCandidateId(fromMain)) {
      await storeDefaultCandidateId(user.accountId, fromMain);
    }
    if (!defaultCandidateId || !isValidDefaultCandidateId(defaultCandidateId)) {
      await showDefaultCandidateStep(user);
      throw new Error('Choose a default candidate, then press Start applying on job pages.');
    }
    await setAutoApplyEnabled(true);
    await armAutoApplyOnCurrentJobTab();
    return;
  }
  await setAutoApplyEnabled(false);
  chrome.runtime.sendMessage({ type: 'RESET_AUTO_PIPELINE_STATE' }).catch(() => {});
  showToast('Auto-apply stopped. Job pages will not run until you press Start again.', 'info');
}

function updateAutoApplyBarUi() {
  const bar = document.getElementById('auto-apply-bar');
  const statusEl = document.getElementById('auto-apply-status');
  const toggleBtn = document.getElementById('btn-toggle-auto-apply');
  if (!bar || !statusEl || !toggleBtn) return;
  if (currentUser?.role === 'manager') {
    bar.classList.add('hidden');
    return;
  }

  readAutoApplyEnabled().then((enabled) => {
    bar.classList.remove('hidden');
    const changeTeamButton = document.getElementById('btn-change-team');
    if (changeTeamButton) {
      changeTeamButton.classList.toggle('hidden', user.role !== 'manager');
    }
    bar.classList.toggle('is-active', enabled);
    const def = getDefaultCandidate();
    if (enabled) {
      statusEl.textContent = def
        ? `Auto-apply: on (${def.name})`
        : 'Auto-apply: on';
      toggleBtn.textContent = 'Stop on job pages';
      toggleBtn.className = 'btn btn-ghost btn-sm';
    } else {
      statusEl.textContent = def
        ? `Auto-apply: off — default ${def.name}`
        : 'Auto-apply: off';
      toggleBtn.textContent = 'Start on job pages';
      toggleBtn.className = 'btn btn-primary btn-sm';
    }
  }).catch(() => {});
}

async function onMainDefaultCandidateChange(event) {
  const user = currentUser;
  if (!user || !isAccountSession(user)) return;
  const candidateId = parseInt(event.target.value, 10);
  if (!Number.isFinite(candidateId)) return;
  if (!isValidDefaultCandidateId(candidateId)) {
    event.target.value = defaultCandidateId ? String(defaultCandidateId) : '';
    throw new Error('That candidate is not available.');
  }
  await storeDefaultCandidateId(user.accountId, candidateId);
  expandedCandidateIds.add(candidateId);
  renderCandidates();
  updateDefaultCandidateUi();
  showToast(`Default candidate: ${getDefaultCandidate()?.name || 'updated'}`, 'success');
}

function updateDefaultCandidateUi() {
  const quickBtn = document.getElementById('btn-start-default-candidate');
  const mainSelect = document.getElementById('main-default-candidate');
  const def = getDefaultCandidate();
  const managerMode = currentUser?.role === 'manager';
  mainSelect?.classList.toggle('hidden', managerMode || !candidates.length);
  quickBtn?.classList.toggle('hidden', managerMode);
  document.getElementById('cand-list')?.classList.toggle('hidden', managerMode);
  document.getElementById('cand-empty')?.classList.toggle('hidden', managerMode);
  document.querySelector('.cand-header')?.classList.toggle('hidden', managerMode);
  if (managerMode) return;

  if (mainSelect) {
    if (candidates.length) {
      mainSelect.classList.remove('hidden');
      populateDefaultCandidateSelect(mainSelect, { includePlaceholder: false });
      mainSelect.value = defaultCandidateId ? String(defaultCandidateId) : '';
    } else {
      mainSelect.classList.add('hidden');
    }
  }

  if (quickBtn) {
    if (def && !isCandidateLocked(def.id)) {
      quickBtn.classList.remove('hidden');
      quickBtn.textContent = `Start Application (${def.name})`;
    } else {
      quickBtn.classList.add('hidden');
    }
  }
}

async function startApplicationWithDefault() {
  if (currentUser?.role === 'manager') {
    throw new Error('Managers apply through the assigned job list using the Apply button.');
  }
  requireManagerCustomGpt();
  const def = getDefaultCandidate();
  if (!def) {
    throw new Error('Choose a default candidate on the login screen or from the Candidates dropdown.');
  }
  if (isCandidateLocked(def.id)) {
    throw new Error(`${def.name} is already marked applied for this job.`);
  }
  await startApplication(def.id);
}

async function ensureWorkspaceReady(user) {
  if (!user || !isAccountSession(user)) return false;
  if (user.role === 'manager') {
    defaultCandidateId = null;
    return true;
  }
  if (await needsDefaultCandidateSelection(user)) {
    await showDefaultCandidateStep(user);
    return false;
  }
  defaultCandidateId = await readDefaultCandidateId(user.accountId);
  updateAutoApplyBarUi();
  return true;
}

function setSession(user) {
  currentUser = user;
  const bar = document.getElementById('session-bar');
  const orgEl = document.getElementById('session-account');
  const userEl = document.getElementById('session-user');
  if (!user || !bar || !orgEl || !userEl) return;

  const username = (user.username || '—').trim();
  const accountId = Number(user.accountId);
  const hasAccount = Number.isFinite(accountId) && accountId > 0;
  const orgLabel = (user.accountName || (hasAccount ? `Organization #${accountId}` : username)).trim();
  const showBoth = hasAccount && orgLabel.toLowerCase() !== username.toLowerCase();

  if (showBoth) {
    orgEl.textContent = orgLabel;
    userEl.textContent = username;
    userEl.classList.remove('hidden');
  } else {
    orgEl.textContent = username;
    userEl.textContent = '';
    userEl.classList.add('hidden');
  }

  bar.classList.remove('hidden');
}

function clearSession() {
  currentUser = null;
  managerExtensionFeatures = {
    canManageTextHighlights: false,
    canManagePageExclusions: false,
    canUseScanner: false,
    canUseApply: false,
  };
  managerExtensionFeaturesError = '';
  scannerSelectedAccountId = null;
  scannerApplyMode = false;
  document.getElementById('btn-connect-account-mailbox')?.classList.add('hidden');
  document.getElementById('account-mailbox-status')?.classList.add('hidden');
  defaultCandidateId = null;
  const bar = document.getElementById('session-bar');
  if (bar) bar.classList.add('hidden');
}

async function doLogout() {
  await chrome.storage.local.set({ [EXTENSION_STATUS_KEY]: null });
  await clearAuthState();
  await showLogin();
}

async function checkAuth() {
  return bootstrapPopupFast();
}

let loginInFlight = false;

async function doLogin() {
  if (loginInFlight) return;
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) {
    showAlert('login-alert', 'Username and password are required.', 'error');
    return;
  }

  loginInFlight = true;
  showLoading('Signing in…');
  try {
    await window.api.ensureServerUrl();
    if (!global.__qtsAccountAuth?.storePopupAuth) {
      throw new Error('Extension auth module not loaded. Reload the extension in chrome://extensions.');
    }
    const r = await window.api.login(username, password);
    if (r._httpStatus === 0) {
      showAlert('login-alert', `Cannot reach QTS at ${window.api.DEFAULT_SERVER}. Check your internet connection and try again.`, 'error');
      return;
    }
    if (r.success && r.role === 'manager' && r.token) {
      await clearCandidateCache();
      const sessionSnapshot = {
        id: r.id,
        username: r.username,
        role: r.role,
        name: r.name || r.username,
      };
      await global.__qtsAccountAuth.storePopupAuth(r.token, sessionSnapshot, r.expiresAt);
      window.api.setCachedToken(r.token);
      document.getElementById('login-pass').value = '';
      clearAlert('login-alert');
      showAuthenticatedScreen(sessionSnapshot);
    } else if (r.success) {
      showAlert(
        'login-alert',
        'Only Manager accounts can sign in to the extension.',
        'error'
      );
    } else {
      showAlert('login-alert', r.message || 'Login failed.', 'error');
    }
  } catch (err) {
    console.error('doLogin error:', err);
    const detail = err instanceof Error ? err.message : String(err);
    showAlert(
      'login-alert',
      detail.includes('auth module')
        ? detail
        : `Login error: ${detail}. Check your connection to ${window.api.DEFAULT_SERVER}.`,
      'error'
    );
  } finally {
    loginInFlight = false;
    hideLoading(true);
  }
}

// ---- Load all data ----
async function loadAll(forceRefreshCandidates = false) {
  await fetchWorkspaceData(forceRefreshCandidates);
  await loadCurrentTab();
  updateJobSummary();
  scheduleFitPopup();
}

async function switchSourceTab(tabId) {
  targetTabId = tabId;
  await chrome.storage.local.set({ qtsJobSourceTabId: tabId });
  chrome.runtime.sendMessage({ type: 'REGISTER_JOB_TAB', tabId }).catch(() => {});
  await restoreSelectedAction();
  const url = new URL(window.location.href);
  url.searchParams.set('tabId', String(tabId));
  window.history.replaceState(null, '', url.toString());
  document.getElementById('main-alert').innerHTML = '';
  existingJobId = null;
  existingJobAccountIds.clear();
  jobSavedInBackend = false;
  selectedJobAccountIds.clear();
  hasManuallyChangedJobAccounts = false;
  document.getElementById('job-account-assignment')?.classList.add('hidden');
  currentSource = '';
  ['f-title', 'f-company', 'f-url', 'f-desc'].forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });
  await loadCurrentTab({ preferCache: true, allowExtract: false });
  await loadApplyTemplateForTab(tabId);
  updateJobSummary();
  scheduleFitPopup();
}

function applyCandidatesData(nextCandidates, nextStacks) {
  candidates = normalizeCandidateList(nextCandidates);
  candidateStacks = nextStacks || [];
  candidateStatuses = {};
  candidateAppliedAt = {};
  candidateLocked = {};
  for (const c of candidates) {
    candidateStatuses[c.id] = 'none';
    candidateLocked[c.id] = false;
  }
  if (defaultCandidateId && isValidDefaultCandidateId(defaultCandidateId)) {
    expandedCandidateIds.add(defaultCandidateId);
  }
  populateStackFilter();
  renderCandidates();
  updateDefaultCandidateUi();
}

async function applyWorkspaceCustomGpt(customGpt, user) {
  managerCustomGptAssigned = Boolean(customGpt?.url);
  if (managerCustomGptAssigned) {
    await global.__qtsCustomGpt?.persistCustomGptConfig?.({
      url: customGpt.url,
      id: customGpt.id,
      source: customGpt.source || 'super_assignment',
      accountId: user?.accountId ?? null,
    });
  } else {
    await new Promise((resolve) => {
      chrome.storage.local.remove(['qtsCustomGptConfig', 'qtsCustomGptTabId'], resolve);
    });
    global.__qtsCustomGpt?.applyCustomGptConfig?.(null);
    await new Promise((resolve) => {
      chrome.storage.local.remove([AUTO_APPLY_ENABLED_KEY], resolve);
    });
    await chrome.runtime.sendMessage({ type: 'RESET_AUTO_PIPELINE_STATE' }).catch(() => {});
  }
  await chrome.runtime.sendMessage({
    type: 'SET_CUSTOM_GPT_CONFIG',
    customGpt: managerCustomGptAssigned ? customGpt : null,
  });
}

async function applyOptionalWorkspaceCustomGpt(user) {
  const assignedGpt = await window.api.getAssignedCustomGpt();
  if (!assignedGpt.success) {
    await applyWorkspaceCustomGpt(null, user);
    console.warn(
      '[QTS_Startup] Legacy Custom GPT assignment could not be loaded:',
      assignedGpt.message || 'Unknown API error.'
    );
    return false;
  }
  await applyWorkspaceCustomGpt(assignedGpt.customGpt, user);
  return true;
}

function requireManagerCustomGpt() {
  if (!managerCustomGptAssigned) {
    throw new Error('No Custom GPT is assigned to your Manager account. Contact your Admin.');
  }
}

async function fetchWorkspaceFromApi() {
  const boot = await window.api.extensionBootstrap();
  if (boot.success && boot.user) {
    return {
      success: true,
      user: boot.user,
      candidates: normalizeCandidateList(boot.candidates),
      stacks: boot.stacks || [],
      customGpt: boot.customGpt || null,
      teams: boot.teams || [],
      _httpStatus: boot._httpStatus,
    };
  }

  const [meRes, candidatesRes, stacksRes] = await Promise.all([
    window.api.me(),
    window.api.getCandidates(),
    window.api.getCandidateStacks(),
  ]);

  if (!meRes.success || !isAccountSession(meRes)) {
    return {
      success: false,
      message: boot.message || meRes.message || 'Could not load account workspace.',
      _httpStatus: boot._httpStatus || meRes._httpStatus,
    };
  }

  return {
    success: true,
    user: meRes,
    candidates: normalizeCandidateList(candidatesRes.success ? candidatesRes.candidates : []),
    stacks: stacksRes.success ? (stacksRes.stacks || []) : [],
    _httpStatus: 200,
  };
}

async function fetchWorkspaceData(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await readCandidateCache();
    if (cached?.user && Array.isArray(cached.candidates) && cached.candidates.length > 0) {
      applyCandidatesData(cached.candidates, cached.stacks || []);
      return { success: true, user: cached.user, fromCache: true, teams: managerTeams };
    }
  }

  const workspace = await fetchWorkspaceFromApi();
  if (!workspace.success) return workspace;

  if (workspace.user?.role === 'manager') {
    await applyOptionalWorkspaceCustomGpt(workspace.user);
  }
  managerTeams = workspace.teams || managerTeams;
  lastWorkspaceFetchAt = Date.now();
  applyCandidatesData(workspace.candidates, workspace.stacks);
  if (workspace.user) await storeSessionUser(workspace.user);
  if (workspace.candidates.length) {
    await writeCandidateCache(workspace.candidates, workspace.stacks, workspace.user);
  } else {
    await clearCandidateCache();
  }
  return workspace;
}

async function readCandidateCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([CANDIDATE_CACHE_KEY], (result) => {
      const cache = result[CANDIDATE_CACHE_KEY];
      if (!cache || !cache.savedAt) {
        resolve(null);
        return;
      }
      if (Date.now() - cache.savedAt > CANDIDATE_CACHE_TTL_MS) {
        resolve(null);
        return;
      }
      resolve(cache);
    });
  });
}

async function writeCandidateCache(nextCandidates, nextStacks, user) {
  return new Promise(resolve => {
    chrome.storage.local.set({
      [CANDIDATE_CACHE_KEY]: {
        savedAt: Date.now(),
        user: user || null,
        candidates: nextCandidates || [],
        stacks: nextStacks || [],
      },
    }, resolve);
  });
}

async function clearCandidateCache() {
  return new Promise(resolve => {
    chrome.storage.local.remove([CANDIDATE_CACHE_KEY], resolve);
  });
}

async function enterJobWorkspace(user, { skipBackgroundRefresh = false } = {}) {
  if (!(await ensureWorkspaceReady(user))) return;
  setSession(user);
  showJobSection();
  resetLoginFormView();
  hideLoading(true);
  await loadCurrentTab({ preferCache: true, allowExtract: false });
  updateJobSummary();
  renderCandidates();
  updateDefaultCandidateUi();
  updateAutoApplyBarUi();
  scheduleFitPopup();
  if (!skipBackgroundRefresh) {
    refreshWorkspaceInBackground();
  }
}

async function persistSession(user, nextCandidates, nextStacks) {
  if (user) await storeSessionUser(user);
  if (Array.isArray(nextCandidates)) {
    const normalized = normalizeCandidateList(nextCandidates);
    applyCandidatesData(normalized, nextStacks || []);
    if (normalized.length) {
      await writeCandidateCache(normalized, nextStacks || [], user);
    }
  }
}

async function readSessionUser() {
  if (global.__qtsAccountAuth?.readPopupSessionUser) {
    return global.__qtsAccountAuth.readPopupSessionUser();
  }
  return null;
}

async function storeSessionUser(user) {
  if (!user) return;
  const snapshot = {
    id: user.id,
    username: user.username,
    role: user.role,
    accountId: user.accountId != null ? Number(user.accountId) : null,
    accountName: user.accountName ?? null,
  };
  if (global.__qtsAccountAuth?.storeSessionUser) {
    await global.__qtsAccountAuth.storeSessionUser(snapshot);
    return;
  }
}

async function clearSessionUser() {
  // cleared via clearAuthState()
}

async function clearAuthState() {
  managerCustomGptAssigned = false;
  await clearToken();
  await global.__qtsAccountAuth?.clearAuth?.();
  await clearCandidateCache();
  await global.__qtsApplySessionStore?.clearActive?.();
  const stored = await chrome.storage.local.get(null);
  const selectedActionKeys = Object.keys(stored)
    .filter((key) => key === SELECTED_ACTION_KEY || key.startsWith(`${SELECTED_ACTION_KEY}:`));
  await new Promise((resolve) => {
    chrome.storage.local.remove([AUTO_APPLY_ENABLED_KEY, ...selectedActionKeys], resolve);
  });
  await new Promise((resolve) => {
    chrome.storage.local.remove(['qtsCustomGptConfig', 'qtsCustomGptTabId'], resolve);
  });
  global.__qtsCustomGpt?.applyCustomGptConfig?.(null);
  chrome.runtime.sendMessage({ type: 'RESET_AUTO_PIPELINE_STATE' }).catch(() => {});
  clearSession();
}

async function loadCandidates(forceRefresh = false) {
  try {
    await fetchWorkspaceData(forceRefresh);
  } catch { /* non-fatal */ }
}

function populateStackFilter() {
  const select = document.getElementById('cand-stack-filter');
  if (!select) return;

  const previous = select.value;
  const fromCandidates = candidates.map((c) => c.stack).filter(Boolean);
  const allStacks = [...new Set([...candidateStacks, ...fromCandidates])]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  select.innerHTML = '<option value="">All stacks</option>' +
    allStacks.map((stack) => `<option value="${escAttr(stack)}">${escHtml(stack)}</option>`).join('');

  if ([...select.options].some((opt) => opt.value === previous)) {
    select.value = previous;
  }
}

function getCandidateFilters() {
  return {
    text: (document.getElementById('cand-filter')?.value || '').trim(),
    stack: document.getElementById('cand-stack-filter')?.value || '',
  };
}

function candidateMatchesFilters(candidate, filters) {
  const stack = (candidate.stack || '').trim();
  const matchesStack = !filters.stack
    || stack.toLowerCase() === filters.stack.toLowerCase();

  if (!filters.text) return matchesStack;

  const text = filters.text.toLowerCase();
  const matchesText = candidate.name.toLowerCase().includes(text)
    || (candidate.email || '').toLowerCase().includes(text)
    || stack.toLowerCase().includes(text);

  return matchesStack && matchesText;
}

async function loadCurrentTab({ preferCache = false, allowExtract = true } = {}) {
  try {
    let tab = null;
    if (targetTabId) {
      tab = await chrome.tabs.get(targetTabId);
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = activeTab;
    }
    if (!tab) return;

    currentTabUrl = tab.url || '';
    document.getElementById('f-url').value = currentTabUrl;

    const urlCandidates = [currentTabUrl, document.getElementById('f-url').value.trim()];
    const getJdActive = document.getElementById('btn-get-jd')?.classList.contains('is-selected');
    let checkedJob = null;
    const checkedJobUrlKeys = new Set();
    let showedNewJobNotice = false;

    if (getJdActive && /^https?:\/\//i.test(currentTabUrl)) {
      const result = await handleGetJdUrlStatus(tab.id, currentTabUrl);
      checkedJobUrlKeys.add(normalizeJobUrl(currentTabUrl));
      if (result.stop) return;
      checkedJob = result.job;
      if (!checkedJob) {
        await showPageNotice(tab.id, 'New job', 'new-job', {
          alertId: 'job-url-status',
        });
        showedNewJobNotice = true;
      }
      if (checkedJob) {
        loadExistingJob(checkedJob, { silent: true });
        renderCandidates();
      }
    }

    if (!getJdActive && preferCache) {
      const cachedSaved = await findSavedJobByUrls(urlCandidates, { cacheOnly: true });
      if (cachedSaved) {
        loadExistingJob(cachedSaved, { silent: true });
        renderCandidates();
      }
    } else if (!getJdActive) {
      const saved = await findSavedJobByUrls(urlCandidates, { showSpinner: true });
      if (saved) {
        loadExistingJob(saved, { silent: true });
        renderCandidates();
        if (allowExtract && hasMissingJobDetails() && isExtractablePageUrl(currentTabUrl)) {
          await extractFromPage(tab.id, currentTabUrl, { onlyMissing: true });
        }
        return;
      }
    }

    if (existingJobId && allowExtract && hasMissingJobDetails() && isExtractablePageUrl(currentTabUrl)) {
      await extractFromPage(tab.id, currentTabUrl, { onlyMissing: true });
    }

    if (!existingJobId) {
      jobSavedInBackend = false;
      candidateLocked = {};
      for (const c of candidates) {
        candidateStatuses[c.id] = 'none';
        candidateAppliedAt[c.id] = null;
        candidateLocked[c.id] = false;
      }

      if (isExtractablePageUrl(currentTabUrl)) {
        const applied = await applyDetectedJobForTab(tab.id, currentTabUrl, { allowExtract, silent: true });
        if (!applied && allowExtract) {
          await extractFromPage(tab.id, currentTabUrl, { silent: true });
        }
      }
    }

    renderCandidates();
    document.getElementById('btn-save').textContent = existingJobId ? 'Update Job' : 'Save Job';

    await loadApplyTemplateForTab(tab.id);

    const resolvedJobUrls = [
      currentTabUrl,
      document.getElementById('f-url')?.value?.trim() || '',
    ];
    if (getJdActive && !checkedJob) {
      for (const url of resolvedJobUrls) {
        if (!/^https?:\/\//i.test(url)) continue;
        const key = normalizeJobUrl(url);
        if (checkedJobUrlKeys.has(key)) continue;
        const result = await handleGetJdUrlStatus(tab.id, url);
        checkedJobUrlKeys.add(key);
        if (result.stop) return;
        if (result.job) {
          checkedJob = result.job;
          loadExistingJob(checkedJob, { silent: true });
          renderCandidates();
          break;
        }
      }
      if (!checkedJob && checkedJobUrlKeys.size > 0 && !showedNewJobNotice) {
        await showPageNotice(tab.id, 'New job', 'new-job', {
          alertId: 'job-url-status',
        });
      }
    }
    if (!getJdActive && resolvedJobUrls.some((url) => url.startsWith('http'))) {
      await verifySavedJobOnServer(resolvedJobUrls);
    }
  } catch (e) {
    console.error('loadCurrentTab error:', e);
    if (
      document.getElementById('btn-get-jd')?.classList.contains('is-selected')
      && targetTabId
      && /^https?:\/\//i.test(currentTabUrl)
    ) {
      try {
        await showPageNotice(
          targetTabId,
          e instanceof Error ? e.message : 'Could not check this job page.',
          'error'
        );
      } catch (noticeError) {
        console.error('Could not show the URL-check error on the job page:', noticeError);
      }
    }
  }
}

async function applyDetectedJobForTab(tabId, pageUrl, { allowExtract = true, silent = false } = {}) {
  const normalizedPageUrl = normalizeJobUrl(pageUrl);
  const detected = await getDetectedJobForTab(tabId);
  if (detected && detected.url === normalizedPageUrl) {
    if (detected.valid && detected.data) {
      populateForm(detected.data);
      if (!silent) {
        const jobLabel = [detected.data.title, detected.data.company].filter(Boolean).join(' — ');
        showAlert(
          'main-alert',
          jobLabel ? `Job details detected: ${jobLabel}. Review before saving.` : 'Job details detected. Review before saving.',
          'success'
        );
      }
      onJobDetected();
      return true;
    }
    if (allowExtract) return false;
    if (!silent) {
      showAlert('main-alert', 'Could not confidently detect the job details. Review the fields and enter or correct them before saving.', 'warn');
    }
    onJobDetected();
    return true;
  }

  if (!allowExtract) return false;
  await extractFromPage(tabId, pageUrl, { silent });
  return true;
}

async function findSavedJobByUrls(urls, { cacheOnly = false, skipCache = false, showSpinner = false } = {}) {
  const seen = new Set();
  const uniqueUrls = [];
  for (const raw of urls) {
    const url = (raw || '').trim();
    if (!url || !url.startsWith('http')) continue;
    const key = typeof normalizeJobUrl === 'function' ? normalizeJobUrl(url) : url;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueUrls.push(url);
  }

  if (!skipCache) {
    for (const url of uniqueUrls) {
      const cached = await readSavedJobFromCache(url);
      if (cached) return cached;
    }
    if (cacheOnly) return null;
  }

  if (!uniqueUrls.length) return null;

  if (showSpinner) showLoading('Checking if this job is saved…');
  try {
    for (const url of uniqueUrls) {
      const saved = await fetchJobByUrl(url);
      if (saved) {
        await writeSavedJobToCache(url, saved);
        return saved;
      }
      if (!cacheOnly) {
        await writeSavedJobToCache(url, null);
      }
    }
    return null;
  } finally {
    if (showSpinner) hideLoading();
  }
}

async function fetchJobByUrl(url) {
  try {
    const response = await window.api.checkJobByUrl(url);
    if (!response.success) throw new Error(response.message || 'Could not check the Job List.');
    return response.job || null;
  } catch (e) {
    console.warn('fetchJobByUrl error:', e);
    throw e;
  }
}

async function extractFromPage(tabId, pageUrl, { silent = false, onlyMissing = false } = {}) {
  if (!isExtractablePageUrl(pageUrl)) {
    if (!silent) showAlert('main-alert', restrictedPageMessage(pageUrl), 'info');
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'EXTRACT_JOB', tabId });
    if (response?.error) {
      if (!response.manualOnly) console.warn('Extraction failed:', response.error);
      if (response.manualOnly) {
        if (!silent) showAlert('main-alert', response.error, 'info');
      } else {
        if (!silent) showAlert('main-alert', response.error || 'Could not detect job details. Review the fields and enter missing information.', 'warn');
        onJobDetected();
      }
      return;
    }

    if (onlyMissing && response?.data && typeof response.data === 'object') {
      const partial = usablePartialJobDetails(response.data, response.url || pageUrl);
      const detected = partial.data;
      const filledFields = populateMissingJobDetails(detected);
      const hasDetectedDetails = partial.hasDetails;
      if (!silent) {
        showAlert(
          'main-alert',
          filledFields.length
            ? `Recovered missing job details (${filledFields.join(', ')}) for this Scanner session.`
            : hasDetectedDetails
              ? 'Job details were extracted, but the saved job already has values for the detected fields.'
              : 'Could not extract additional job details from this page. Check the page or enter the missing details manually.',
          filledFields.length ? 'success' : hasDetectedDetails ? 'info' : 'warn'
        );
      }
      onJobDetected();
      return;
    }

    const valid = Boolean(response?.detected);
    if (valid && response?.data) {
      const detected = normalizeDetectedJobData(response.data, response.url || pageUrl);
      populateForm(detected);
      const jobLabel = [detected.title, detected.company].filter(Boolean).join(' — ');
      if (!silent) {
        showAlert('main-alert', jobLabel
          ? `Job details detected: ${jobLabel}. Review before saving.`
          : 'Job details detected. Review before saving.', 'success');
      }
      onJobDetected();
      return;
    }

    const partial = usablePartialJobDetails(response?.data, response?.url || pageUrl);
    if (partial.hasDetails) populateForm(partial.data);
    if (!silent) {
      showAlert(
        'main-alert',
        partial.hasDetails
          ? 'Some job details were extracted. Review them and fill any missing fields before saving.'
          : 'Could not confidently detect the job details. Review the fields and enter or correct them before saving.',
        'warn'
      );
    }
    onJobDetected();
  } catch (e) {
    console.warn('Extraction failed:', e);
    if (!silent) {
      showAlert('main-alert', 'Could not read this page for job details. Check the page and try Refresh, or enter the details manually.', 'error');
    }
    onJobDetected();
  }
}

function populateMissingJobDetails(data) {
  const fields = {
    title: document.getElementById('f-title'),
    company: document.getElementById('f-company'),
    description: document.getElementById('f-desc'),
    url: document.getElementById('f-url'),
  };
  const current = {
    title: fields.title?.value || '',
    company: fields.company?.value || '',
    description: fields.description?.value || '',
    url: fields.url?.value || '',
    source: currentSource,
  };
  const merged = mergeMissingJobDetails(current, data);
  const filledFields = [];
  for (const key of ['title', 'company', 'description', 'url']) {
    if (fields[key] && !String(current[key] || '').trim() && merged[key]) {
      fields[key].value = merged[key];
      filledFields.push(key);
    }
  }
  if (!currentSource && merged.source) currentSource = merged.source;
  if (filledFields.length) updateJobSummary();
  return filledFields;
}

function hasMissingJobDetails() {
  return ['f-title', 'f-company', 'f-desc'].some((id) => (
    !String(document.getElementById(id)?.value || '').trim()
  ));
}

function populateForm(data) {
  if (data.title) document.getElementById('f-title').value = data.title;
  if (data.company) document.getElementById('f-company').value = data.company;
  if (data.url) document.getElementById('f-url').value = data.url;
  if (data.description) document.getElementById('f-desc').value = data.description;
  currentSource = data.source || '';
  autoSelectJobAccountsForTitle();
  updateJobSummary();
}

function loadExistingJob(job, { silent = false } = {}) {
  existingJobId = job.id;
  jobSavedInBackend = true;
  existingJobAccountIds = new Set(
    (job.selected_account_u_ids || job.selectedAccountUserIds || [])
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );
  selectedJobAccountIds = new Set(existingJobAccountIds);
  document.getElementById('f-title').value = job.title || '';
  document.getElementById('f-company').value = job.company || '';
  document.getElementById('f-url').value = job.url || '';
  document.getElementById('f-desc').value = job.description || '';
  currentSource = job.source || '';
  syncCandidateStatusesFromJob(job.candidateStatuses || []);
  updateJobSummary();
  onJobDetected();

  if (!silent) {
    const appliedCount = Object.values(candidateStatuses).filter(s => s === 'applied').length;
    const editableCount = candidates.length - appliedCount;
    let msg = 'That job URL has already been added.';
    if (appliedCount > 0) {
      msg += ` ${appliedCount} candidate(s) already applied (locked).`;
    }
    if (editableCount > 0) {
      msg += ` You can mark the remaining ${editableCount} as applied.`;
    }
    showAlert('main-alert', msg, 'info');
  }
  document.getElementById('btn-save').textContent = 'Update Job';
}

function syncCandidateStatusesFromJob(statuses) {
  for (const c of candidates) {
    candidateStatuses[c.id] = 'none';
    candidateAppliedAt[c.id] = null;
    candidateLocked[c.id] = false;
  }

  for (const cs of statuses) {
    const status = cs.status || 'none';
    candidateStatuses[cs.candidate_id] = status;
    candidateAppliedAt[cs.candidate_id] = cs.applied_at || null;
    candidateLocked[cs.candidate_id] = status === 'applied';
  }
}

function isCandidateLocked(candidateId) {
  return !!candidateLocked[candidateId];
}

function updateApplyTemplateSummary() {
  const el = document.getElementById('summary-apply-template');
  if (!el) return;
  if (!detectedApplyTemplate?.applyMethod && !detectedApplyTemplate?.templateName) {
    el.textContent = '—';
    el.title = '';
    return;
  }
  const method = detectedApplyTemplate.applyMethodLabel
    || detectedApplyTemplate.templateName
    || '—';
  const flowNote = detectedApplyTemplate.flowTypeLabel
    ? ` · ${detectedApplyTemplate.flowTypeLabel}`
    : '';
  const formNote = (detectedApplyTemplate.formOpen || detectedApplyTemplate.signals?.applyModalConfirmed)
    ? ' · form open'
    : '';
  const stepNote = detectedApplyTemplate.stepHints?.isMultiStep
    ? ` · step ${detectedApplyTemplate.stepHints.currentStep || '?'}/${detectedApplyTemplate.stepHints.totalSteps || '?'}`
    : '';
  el.textContent = `${method}${flowNote}${formNote}${stepNote}`;
  const titleParts = [
    detectedApplyTemplate.applyMethodDescription,
    detectedApplyTemplate.templateDescription,
    detectedApplyTemplate.templateId,
    detectedApplyTemplate.externalUrl ? `External: ${detectedApplyTemplate.externalUrl}` : '',
  ].filter(Boolean);
  el.title = titleParts.join(' — ');
}

async function loadApplyTemplateForTab(tabId) {
  if (!tabId) {
    detectedApplyTemplate = null;
    updateApplyTemplateSummary();
    return null;
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_APPLY_TEMPLATE', tabId });
    detectedApplyTemplate = res?.detection || null;
  } catch {
    detectedApplyTemplate = null;
  }
  updateApplyTemplateSummary();
  return detectedApplyTemplate;
}

function updateJobSummary() {
  const summary = document.getElementById('job-summary');
  if (!summary) return;
  summary.classList.remove('hidden');
  document.getElementById('summary-source').textContent = currentSource || '—';
  updateApplyTemplateSummary();

  const isSaved = !!existingJobId;
  const statusEl = document.getElementById('summary-status');
  statusEl.textContent = isSaved ? 'Saved' : 'New';
  statusEl.className = `job-summary-status-pill ${isSaved ? 'is-saved' : 'is-new'}`;

  const appliedCount = Object.values(candidateStatuses).filter(s => s === 'applied').length;
  const noneCount = candidates.length - appliedCount;
  document.getElementById('summary-applied').textContent = String(appliedCount);
  document.getElementById('summary-not-applied').textContent = String(noneCount);
}

function pickCandidateColor(candidate, index = 0) {
  return normalizeCandidateColor(candidate?.color, Number(candidate?.id) || index);
}

function formatCopyableDetailValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `<button type="button" class="cand-copyable" data-copy-value="${escAttr(text)}" title="Hover and click to copy" aria-label="Copy ${escAttr(text)}">${escHtml(text)}</button>`;
}

function formatCandidateDetails(candidate, status, appliedAt, locked) {
  const rows = [];

  if (candidate.email) {
    rows.push(['Email', formatCopyableDetailValue(candidate.email)]);
  }
  if (candidate.phone) {
    rows.push(['Phone', formatCopyableDetailValue(candidate.phone)]);
  }
  if (candidate.linkedin_url) {
    rows.push(['LinkedIn', formatCopyableDetailValue(candidate.linkedin_url)]);
  }
  if (candidate.stack) {
    rows.push(['Stack', escHtml(candidate.stack)]);
  }
  if (candidate.notes) {
    rows.push(['Notes', escHtml(candidate.notes)]);
  }

  const statusText = status === 'applied'
    ? (locked ? 'Applied (locked)' : 'Applied')
    : 'Not applied';
  rows.push(['Application', escHtml(statusText)]);
  if (status === 'applied' && appliedAt) {
    rows.push(['Applied at', escHtml(formatDate(appliedAt))]);
  }

  if (!rows.length) {
    return '<p class="cand-details-empty">No additional information.</p>';
  }

  return rows.map(([label, value]) => `
    <div class="cand-detail-row">
      <span class="cand-detail-label">${label}</span>
      <span class="cand-detail-value">${value}</span>
    </div>`).join('');
}

// ---- Candidates ----
function collapseAllCandidateCards() {
  expandedCandidateIds.clear();
  document.querySelectorAll('.cand-card.is-expanded').forEach((card) => {
    card.classList.remove('is-expanded');
    const btn = card.querySelector('.cand-expand-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

function onJobDetected() {
  collapseAllCandidateCards();
  renderCandidates();
  showJobAccountAssignment();
}

function showJobAccountAssignment() {
  const assignmentSection = document.getElementById('job-account-assignment');
  assignmentSection?.classList.remove('hidden');
  loadJobAssignmentOptions().catch((error) => {
    console.error('Could not load Manager Accounts for job assignment:', error);
  });
}

async function loadJobAssignmentOptions() {
  if (jobAssignmentOptionsPromise) return jobAssignmentOptionsPromise;
  jobAssignmentOptionsPromise = (async () => {
    const managerId = Number(currentUser?.id);
    if (currentUser?.role !== 'manager' || !Number.isSafeInteger(managerId) || managerId <= 0) {
      throw new Error('Sign in as a Manager to load assigned Accounts.');
    }

    const [accountResponse, categoryResponse] = await Promise.all([
      window.api.getManagerAccounts(),
      window.api.getJobCategories(),
    ]);
    if (!accountResponse.success) {
      throw new Error(accountResponse.message || 'Could not load your Accounts.');
    }
    if (!categoryResponse.success) {
      throw new Error(categoryResponse.message || 'Could not load job Categories.');
    }

    managerJobAccounts = (accountResponse.accounts || [])
      .filter((account) => (
        account.role === 'account'
        && Number(account.parent_user_id) === managerId
        && account.blocked_date == null
      ))
      .map((account) => ({
        ...account,
        id: Number(account.u_id),
        categoryId: Number(account.category_id),
      }))
      .filter((account) => Number.isSafeInteger(account.id) && account.id > 0);
    jobCategories = categoryResponse.categories || [];
    const activeAccountIds = new Set(managerJobAccounts.map((account) => account.id));
    selectedJobAccountIds = new Set(
      [...selectedJobAccountIds].filter((id) => activeAccountIds.has(id))
    );
    autoSelectJobAccountsForTitle();
    renderJobAccountGroups();
    return true;
  })();

  try {
    return await jobAssignmentOptionsPromise;
  } finally {
    jobAssignmentOptionsPromise = null;
  }
}

function renderJobAccountGroups() {
  const groupsElement = document.getElementById('job-account-groups');
  if (!groupsElement) return;
  const assignmentHint = document.getElementById('job-account-assignment-hint');
  if (assignmentHint) {
    const managerLabel = currentUser?.name || currentUser?.username || 'your Manager account';
    assignmentHint.textContent = `Accounts assigned to ${managerLabel}. Select which should receive this job; Accounts are grouped by Category.`;
  }
  if (!managerJobAccounts.length) {
    groupsElement.innerHTML = '<p class="job-account-assignment-status">No active Accounts are assigned to your Manager account.</p>';
    updateJobAccountSelectionStatus();
    return;
  }

  const categoryNames = new Map(
    jobCategories.map((category) => [
      Number(category.category_id),
      category.category_title || 'Uncategorized',
    ])
  );
  const groupedAccounts = new Map();
  for (const account of managerJobAccounts) {
    const categoryId = account.categoryId;
    const categoryName = categoryNames.get(categoryId) || 'Uncategorized';
    const key = categoryNames.has(categoryId) ? String(categoryId) : 'uncategorized';
    if (!groupedAccounts.has(key)) {
      groupedAccounts.set(key, { name: categoryName, accounts: [] });
    }
    groupedAccounts.get(key).accounts.push(account);
  }

  groupsElement.innerHTML = [...groupedAccounts.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((group) => `
      <section class="job-account-category">
        <h4 class="job-account-category-title">${escHtml(group.name)}</h4>
        ${group.accounts.map((account) => {
          const accountName = account.name || account.username || `Account ${account.id}`;
          const loginName = account.username && account.username !== accountName
            ? `<small>${escHtml(account.username)}</small>`
            : '';
          return `
            <label class="job-account-option">
              <input type="checkbox" data-job-account-id="${account.id}"${selectedJobAccountIds.has(account.id) ? ' checked' : ''}>
              <span>${escHtml(accountName)}${loginName}</span>
            </label>`;
        }).join('')}
      </section>`)
    .join('');
  updateJobAccountSelectionStatus();
}

function autoSelectJobAccountsForTitle() {
  if (existingJobId || hasManuallyChangedJobAccounts || !managerJobAccounts.length) return;

  const titleWords = new Set(
    (document.getElementById('f-title')?.value || '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []
  );
  const matchingCategoryIds = new Set(
    jobCategories
      .filter((category) => {
        const categoryWords = (category.category_title || '')
          .toLowerCase()
          .match(/[a-z0-9]+/g) || [];
        return categoryWords.length > 0 && categoryWords.every((word) => titleWords.has(word));
      })
      .map((category) => Number(category.category_id))
  );

  selectedJobAccountIds = new Set(
    managerJobAccounts
      .filter((account) => matchingCategoryIds.has(account.categoryId))
      .map((account) => account.id)
  );
  renderJobAccountGroups();
}

function updateJobAccountSelectionStatus() {
  const status = document.getElementById('job-account-selection-status');
  if (!status) return;
  const count = selectedJobAccountIds.size;
  status.textContent = count
    ? `${count} Account${count === 1 ? '' : 's'} selected.`
    : 'No Accounts selected.';
}

function getSelectedJobAssignments() {
  const accountsById = new Map(managerJobAccounts.map((account) => [account.id, account]));
  const selectedAccounts = [...selectedJobAccountIds]
    .map((id) => accountsById.get(id))
    .filter(Boolean);
  if (!selectedAccounts.length) {
    throw new Error('Select at least one Account for this job.');
  }
  const categoryIds = [...new Set(selectedAccounts.map((account) => account.categoryId))]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b);
  if (!categoryIds.length) {
    throw new Error('The selected Accounts do not have a valid Category.');
  }
  return {
    categoryIds,
    selectedAccountUserIds: selectedAccounts.map((account) => account.id),
  };
}

async function copyTextToClipboard(text) {
  const value = String(text || '').trim();
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(`Copied: ${value}`, 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast(`Copied: ${value}`, 'success');
  }
}

async function dispatchGptTask(applicationId, { pollAndApply = false, taskId: explicitTaskId } = {}) {
  requireManagerCustomGpt();
  const gpt = window.__qtsCustomGpt;
  if (!gpt?.buildPrompt) {
    throw new Error('Custom GPT helper not loaded.');
  }
  const id = Number(applicationId);
  if (!id) {
    throw new Error('No application session yet. Click Start Application first.');
  }

  activeTaskId = explicitTaskId || activeTaskId;
  if (!activeTaskId) {
    throw new Error('No GPT task ID yet. Click Start Application first.');
  }
  const taskId = activeTaskId;
  const prompt = gpt.buildPrompt(taskId);

  if (targetTabId) {
    await chrome.storage.local.set({ qtsJobSourceTabId: targetTabId });
  }

  const dispatchRes = await window.api.dispatchApplicationTask(taskId);
  if (!dispatchRes.success) {
    throw new Error(dispatchRes.message || 'Could not register GPT task on server.');
  }

  setGptPipelineState('dispatching', `Sending ${taskId} to Custom GPT…`);
  gptDispatchSent = true;
  renderGptActionSteps(lastGptTaskStatus);
  hideLoading(true);

  let handoffResult;
  gptHandoffInProgress = true;
  try {
    handoffResult = await sendGptTaskToBackground({
      taskId,
      jobTabId: targetTabId,
      applicationId: id,
      pollAndApply,
    });
  } catch (sendErr) {
    throw new Error(sendErr?.message || 'Could not send PROCESS_TASK to Custom GPT.');
  } finally {
    gptHandoffInProgress = false;
  }

  if (!handoffResult?.ok || handoffResult?.handoff?.sent === false) {
    throw new Error(handoffResult?.handoff?.error || handoffResult?.error || 'GPT handoff failed.');
  }

  applyGptDispatchResult({ ...handoffResult, taskId });
  updateCustomGptButton();

  return { taskId, prompt, ...handoffResult };
}

async function pollTaskUntilReady(taskId, { timeoutMs = 180000, intervalMs = 3000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await window.api.getApplicationTaskStatus(taskId);
    if (!status.success) {
      throw new Error(status.message || 'Could not read GPT task status.');
    }
    if (status.gptTaskStatus === 'ready' || status.readyToApply) {
      lastGptTaskStatus = status;
      renderGptActionSteps(status);
      updateCustomGptButton(status);
      return status;
    }
    if (status.gptTaskStatus === 'error') {
      lastGptTaskStatus = status;
      renderGptActionSteps(status);
      throw new Error(status.error || 'GPT task failed on server.');
    }
    lastGptTaskStatus = status;
    renderGptActionSteps(status);
    setGptPipelineState('waiting', `GPT Actions: getTaskContext → submitTaskPackage (${taskId})…`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for Custom GPT. Check the pinned GPT tab and try again.');
}

function inferFileDocumentType(field) {
  const slot = String(field.generatedAnswer || field.documentSlot || field.fillValue || '').toLowerCase();
  if (slot.includes('cover')) return 'cover-letter';
  const text = `${field.label || ''} ${field.nameAttr || ''} ${field.placeholder || ''}`.toLowerCase();
  if (/cover|message|letter/.test(text)) return 'cover-letter';
  return 'resume';
}

async function buildFileUploadFields(applicationId, fields) {
  const fileFields = (fields || []).filter((field) => field.fieldType === 'file');
  if (!fileFields.length) return [];

  const uploads = [];
  for (const field of fileFields) {
    const docType = inferFileDocumentType(field);
    const doc = await window.api.fetchApplicationDocument(applicationId, docType);
    if (!doc.success) {
      throw new Error(doc.message || `Could not load ${docType} PDF from server.`);
    }
    uploads.push({
      ...field,
      category: 'document_upload',
      fillStatus: 'filled',
      fillValue: doc.fileName,
      upload: {
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        base64: doc.base64,
      },
    });
  }
  return uploads;
}

async function applyGptAnswersToForm(applicationId, { skipPreview = false } = {}) {
  requireManagerCustomGpt();
  const id = Number(applicationId);
  if (!id) throw new Error('No application session to apply.');

  showLoading('Applying GPT answers to form…');
  try {
    const stored = await chrome.storage.local.get(['qtsJobSourceTabId']);
    const jobTabId = stored.qtsJobSourceTabId || targetTabId;
    if (jobTabId) {
      try {
        await chrome.tabs.update(jobTabId, { active: true });
        targetTabId = jobTabId;
      } catch {
        // keep current targetTabId
      }
    }

    const result = await window.api.getApplicationResult(id);
    if (!result.success) {
      throw new Error(result.message || 'Could not load application result.');
    }

    const fillFields = (result.fields || [])
      .filter((field) => field.category === 'ai_generation' && field.generatedAnswer)
      .map((field) => ({
        ...field,
        fillValue: field.generatedAnswer,
        fillStatus: 'filled',
      }));

    const HUMAN_REVIEW_SAVED_KEYS = new Set([
      'terms_accepted', 'gdpr_consent', 'marketing_opt_in', 'cover_message',
    ]);
    const remainingFields = (result.fields || [])
      .filter((field) => field.fieldType !== 'file'
        && field.category !== 'ai_generation'
        && field.category !== 'candidate_profile'
        && !HUMAN_REVIEW_SAVED_KEYS.has(field.savedAnswerKey)
        && field.generatedAnswer
        && field.fillStatus !== 'filled')
      .map((field) => ({
        ...field,
        fillValue: field.generatedAnswer,
        fillStatus: 'filled',
      }));

    const allFill = [...fillFields, ...remainingFields];
    const fileUploadFields = await buildFileUploadFields(id, result.fields || []);
    const payload = [...allFill, ...fileUploadFields];

    if (!payload.length) {
      throw new Error('No GPT answers or documents found on server yet.');
    }

    await chrome.runtime.sendMessage({
      type: 'SCAN_APPLICATION_FORM',
      tabId: targetTabId,
      openApplyForm: true,
    });

    let confirmedPayload = payload;
    if (!skipPreview) {
      const previewFields = payload.map((field) => ({
        ...field,
        category: field.category || (field.upload ? 'document_upload' : 'ai_generation'),
        label: field.label || field.stableFieldId,
      }));
      const previewResult = await showApplicationPreview(
        { flowType: 'modal', warnings: ['GPT package ready — confirm before writing to the job form.'] },
        previewFields
      );
      if (!previewResult.confirmed || !previewResult.fields) {
        throw new Error('Apply cancelled — form was not updated.');
      }
      confirmedPayload = previewResult.fields;
    }

    const fillResponse = await chrome.runtime.sendMessage({
      type: 'FILL_APPLICATION_FORM',
      tabId: targetTabId,
      fields: confirmedPayload,
    });

    if (fillResponse?.error) {
      throw new Error(fillResponse.error);
    }

    const filledCount = fillResponse?.fill?.results?.filter((item) => item.ok)?.length || 0;
    const uploadedCount = fillResponse?.fill?.results?.filter((item) => item.ok && fileUploadFields.some((f) => f.stableFieldId === item.stableFieldId))?.length || 0;
    gptAppliedToForm = true;
    const uploadNote = uploadedCount ? ` Uploaded ${uploadedCount} PDF(s).` : '';
    setGptPipelineState('ready', `Applied ${filledCount} field(s) to the form.${uploadNote} Review before submit.`);
    renderGptActionSteps(lastGptTaskStatus);
    showAlert('main-alert', `Applied ${filledCount} field(s).${uploadNote} Review the form before submitting.`, 'success');
    await refreshApplicationStatus();
    return fillResponse;
  } finally {
    hideLoading(true);
  }
}

async function runGptTaskPipeline(applicationId, taskId) {
  if (gptPipelineRunning) return;
  gptPipelineRunning = true;
  try {
    setGptPipelineState('waiting', `Waiting for Custom GPT to finish ${taskId}…`);
    await pollTaskUntilReady(taskId);
    setGptPipelineState('applying', `GPT package ready — filling form…`);
    await applyGptAnswersToForm(applicationId);
  } finally {
    gptPipelineRunning = false;
    chrome.runtime.sendMessage({ type: 'STOP_GPT_APPROVAL_WATCH' }).catch(() => {});
  }
}

function setGptPipelineState(state, message) {
  const el = document.getElementById('application-gpt-pipeline');
  if (!el) return;
  if (!message) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.textContent = message;
  el.dataset.state = state || '';
}

function formatGptTaskStatusLabel(status) {
  const map = {
    waiting_for_gpt: 'Waiting for GPT',
    pending_gpt: 'Pending GPT',
    ready: 'Ready',
    error: 'Error',
  };
  return map[status] || (status ? String(status) : '—');
}

function resolveGptActionStepState(stepId, taskStatus) {
  const gptStatus = taskStatus?.gptTaskStatus || lastGptTaskStatus?.gptTaskStatus;
  const ready = taskStatus?.readyToApply || gptStatus === 'ready';
  const errored = gptStatus === 'error';

  switch (stepId) {
    case 'dispatch':
      if (errored && !gptDispatchSent) return 'error';
      return gptDispatchSent ? 'done' : 'pending';
    case 'getTaskContext':
      if (errored) return gptDispatchSent ? 'error' : 'pending';
      if (ready) return 'done';
      return gptDispatchSent ? 'active' : 'pending';
    case 'submitTaskPackage':
      if (errored) return gptDispatchSent ? 'error' : 'pending';
      if (ready) return 'done';
      return gptDispatchSent ? 'active' : 'pending';
    case 'getTaskStatus':
      if (errored) return 'error';
      if (ready) return 'done';
      return gptDispatchSent ? 'active' : 'pending';
    case 'apply':
      if (gptAppliedToForm) return 'done';
      if (ready) return 'active';
      return 'pending';
    default:
      return 'pending';
  }
}

function renderGptActionSteps(taskStatus) {
  const wrap = document.getElementById('application-gpt-steps');
  const list = document.getElementById('application-gpt-steps-list');
  const steps = window.__qtsCustomGpt?.ACTION_STEPS || [];
  if (!wrap || !list || !activeTaskId || !steps.length) {
    wrap?.classList.add('hidden');
    if (list) list.innerHTML = '';
    return;
  }

  const iconFor = (state) => {
    if (state === 'done') return '✓';
    if (state === 'active') return '…';
    if (state === 'error') return '✕';
    return '○';
  };

  list.innerHTML = steps.map((step) => {
    const state = resolveGptActionStepState(step.id, taskStatus);
    const actor = step.actor === 'gpt' ? 'GPT Action' : 'Extension';
    return `<li class="application-gpt-step is-${state}">
      <span class="application-gpt-step-icon">${iconFor(state)}</span>
      <span><strong>${escHtml(step.label)}</strong> <span class="text-muted">(${escHtml(actor)})</span></span>
    </li>`;
  }).join('');

  wrap.classList.remove('hidden');
}

function syncTaskIdDisplay() {
  const taskEl = document.getElementById('application-task-id');
  if (!taskEl) return;
  if (activeTaskId) {
    taskEl.textContent = activeTaskId;
    taskEl.title = `Click to copy: PROCESS_TASK: ${activeTaskId}`;
  } else if (activeApplicationId) {
    taskEl.textContent = '…';
    taskEl.title = 'Task ID loads after session is created';
  } else {
    taskEl.textContent = '—';
    taskEl.title = 'Task id appears after Start Application';
  }
}

async function fetchAndSyncGptTaskStatus() {
  if (!activeTaskId) return null;
  const status = await window.api.getApplicationTaskStatus(activeTaskId);
  if (status?.success) {
    lastGptTaskStatus = status;
    renderGptActionSteps(status);
    updateCustomGptButton(status);
  }
  return status;
}

function updateCustomGptButton(taskStatus) {
  const openBtn = document.getElementById('btn-open-custom-gpt');
  const applyBtn = document.getElementById('btn-apply-gpt-package');
  const visible = Boolean(activeApplicationId);
  const ready = taskStatus?.readyToApply || taskStatus?.gptTaskStatus === 'ready'
    || lastGptTaskStatus?.readyToApply || lastGptTaskStatus?.gptTaskStatus === 'ready';

  openBtn?.classList.toggle('hidden', !visible);
  applyBtn?.classList.toggle('hidden', !visible || !ready);
}

function renderCandidates() {
  const list = document.getElementById('cand-list');
  const empty = document.getElementById('cand-empty');
  if (currentUser?.role === 'manager') {
    list.classList.add('hidden');
    empty.classList.add('hidden');
    document.querySelector('.cand-header')?.classList.add('hidden');
    scheduleFitPopup();
    return;
  }

  const filters = getCandidateFilters();
  const filtered = candidates.filter((c) => candidateMatchesFilters(c, filters));

  if (!candidates.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    scheduleFitPopup();
    return;
  }

  empty.classList.add('hidden');

  if (!filtered.length) {
    list.innerHTML = '<div style="color:#9ca3af;padding:8px 0;font-size:12px">No candidates match your filter.</div>';
    scheduleFitPopup();
    return;
  }

  list.innerHTML = filtered.map((c, i) => {
    const status = candidateStatuses[c.id] || 'none';
    const locked = isCandidateLocked(c.id);
    const appliedAt = candidateAppliedAt[c.id];
    const nameColor = pickCandidateColor(c, i);
    const isExpanded = expandedCandidateIds.has(c.id);
    const isDefault = Number(defaultCandidateId) === Number(c.id);
    const defaultBadge = isDefault ? '<span class="cand-default-badge">DEFAULT</span>' : '';

    const statusLabel = locked ? 'APPLIED' : (status === 'applied' ? 'APPLIED' : 'NOT APPLIED');

    const statusControl = locked
      ? `<label class="status-toggle is-locked is-on" title="Already applied — cannot be changed">
          <span class="status-toggle-text">${statusLabel}</span>
          <input type="checkbox" class="status-toggle-input" data-cid="${c.id}" checked disabled aria-label="Applied (locked)" />
          <span class="status-toggle-track" aria-hidden="true"></span>
        </label>`
      : `<label class="status-toggle ${status === 'applied' ? 'is-on' : ''}" title="Toggle applied status">
          <span class="status-toggle-text">${statusLabel}</span>
          <input type="checkbox" class="status-toggle-input" data-cid="${c.id}" ${status === 'applied' ? 'checked' : ''} aria-label="Mark ${escAttr(c.name)} as applied" />
          <span class="status-toggle-track" aria-hidden="true"></span>
        </label>`;

    const stackHtml = c.stack
      ? `<span class="cand-stack">${escHtml(c.stack)}</span>`
      : '';

    return `
      <div class="cand-card ${locked ? 'locked' : ''} ${isExpanded ? 'is-expanded' : ''}" data-cid="${c.id}">
        <div class="cand-card-head">
          <button type="button" class="cand-expand-btn" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-label="Show details for ${escAttr(c.name)}">
            <span class="cand-expand-icon" aria-hidden="true">▸</span>
            <span class="cand-info">
              <span class="cand-name-line">
                <span class="cand-name" style="color:${nameColor}">${escHtml(c.name)}</span>${defaultBadge}${stackHtml}
              </span>
            </span>
          </button>
          <div class="cand-status-wrap" onclick="event.stopPropagation()">
            ${statusControl}
          </div>
        </div>
        <div class="cand-card-details">
          ${formatCandidateDetails(c, status, appliedAt, locked)}
          <div class="cand-actions">
            <button type="button" class="btn btn-primary btn-start-application" data-cid="${c.id}">
              Start Application
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
  scheduleFitPopup();
}

function onCandidateCardClick(event) {
  if (event.target.closest('.status-toggle')) return;

  const startBtn = event.target.closest('.btn-start-application');
  if (startBtn) {
    event.stopPropagation();
    event.preventDefault();
    const candidateId = parseInt(startBtn.dataset.cid, 10);
    if (Number.isFinite(candidateId)) {
      startApplication(candidateId).catch((e) => {
        console.error('startApplication error:', e);
        showAlert('main-alert', 'Could not start application workflow.', 'error');
      });
    }
    return;
  }

  const copyBtn = event.target.closest('.cand-copyable');
  if (copyBtn) {
    event.stopPropagation();
    event.preventDefault();
    copyTextToClipboard(copyBtn.dataset.copyValue || copyBtn.textContent || '');
    return;
  }

  if (event.target.closest('.cand-card-details')) return;

  const head = event.target.closest('.cand-card-head');
  if (!head) return;

  const card = head.closest('.cand-card');
  if (!card) return;

  const candidateId = parseInt(card.dataset.cid, 10);
  if (!Number.isFinite(candidateId)) return;

  const isExpanded = card.classList.toggle('is-expanded');
  if (isExpanded) expandedCandidateIds.add(candidateId);
  else expandedCandidateIds.delete(candidateId);

  const btn = card.querySelector('.cand-expand-btn');
  if (btn) btn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');

  scheduleFitPopup();
}

function onCandidateStatusChange(event) {
  const input = event.target;
  if (!input.classList.contains('status-toggle-input')) return;

  const candidateId = parseInt(input.dataset.cid, 10);
  if (isCandidateLocked(candidateId)) {
    input.checked = true;
    return;
  }

  const newStatus = input.checked ? 'applied' : 'none';
  if (newStatus === 'none' && jobSavedInBackend) {
    input.checked = candidateStatuses[candidateId] === 'applied';
    return;
  }

  candidateStatuses[candidateId] = newStatus;

  if (newStatus === 'applied') {
    if (!candidateAppliedAt[candidateId]) {
      candidateAppliedAt[candidateId] = new Date().toISOString();
    }
  } else {
    candidateAppliedAt[candidateId] = null;
  }

  const label = input.closest('.status-toggle');
  const textEl = label?.querySelector('.status-toggle-text');
  if (label) {
    label.classList.toggle('is-on', newStatus === 'applied');
  }
  if (textEl) {
    textEl.textContent = newStatus === 'applied' ? 'APPLIED' : 'NOT APPLIED';
  }

  const card = input.closest('.cand-card');
  if (card && card.classList.contains('is-expanded')) {
    const details = card.querySelector('.cand-card-details');
    const candidate = candidates.find((c) => Number(c.id) === candidateId);
    if (details && candidate) {
      details.innerHTML = formatCandidateDetails(
        candidate,
        newStatus,
        candidateAppliedAt[candidateId],
        isCandidateLocked(candidateId)
      );
    }
  }

  updateJobSummary();
}

function filterCandidates() {
  if (filterCandidatesTimer) clearTimeout(filterCandidatesTimer);
  filterCandidatesTimer = setTimeout(() => {
    filterCandidatesTimer = null;
    renderCandidates();
  }, 180);
}

function formatApiError(response) {
  if (response?.errors?.length) {
    return response.errors.map(e => `${e.field}: ${e.message}`).join(' · ');
  }
  return response?.message || 'Could not save the job.';
}

function detectPlatformFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('linkedin.com')) return 'linkedin';
    if (host.includes('indeed.com')) return 'indeed';
    if (host.includes('glassdoor.com')) return 'glassdoor';
    if (host.includes('greenhouse.io')) return 'greenhouse';
    if (host.includes('lever.co')) return 'lever';
    if (host.includes('workable.com')) return 'workable';
    if (host.includes('smartrecruiters.com')) return 'smartrecruiters';
    if (host.includes('ashbyhq.com')) return 'ashby';
    if (host.includes('justjoin.it')) return 'justjoin';
    return host;
  } catch {
    return currentSource || 'unknown';
  }
}

function renderApplicationStatus(result, taskStatus) {
  const panel = document.getElementById('application-status');
  const sessionIdEl = document.getElementById('application-session-id');
  const gridEl = document.getElementById('application-status-grid');
  const pendingWrap = document.getElementById('application-pending-wrap');
  const pendingList = document.getElementById('application-pending-list');
  const hintEl = document.getElementById('application-status-hint');
  if (!panel || !gridEl || !sessionIdEl) return;

  const summary = result?.summary || {};
  const session = result?.session || {};
  const pendingAiFields = result?.pendingAiFields || [];
  const ts = taskStatus || lastGptTaskStatus;

  activeApplicationId = session.applicationId || activeApplicationId;
  if (taskStatus?.taskId) {
    activeTaskId = taskStatus.taskId;
  }
  persistActiveApplySession({
    applicationId: activeApplicationId,
    taskId: activeTaskId,
    status: ts?.gptTaskStatus || null,
  }).catch(() => {});
  sessionIdEl.textContent = activeApplicationId ? `#${activeApplicationId}` : '—';
  syncTaskIdDisplay();

  const gptLabel = formatGptTaskStatusLabel(ts?.gptTaskStatus);
  gridEl.innerHTML = [
    ['Filled', summary.filled ?? 0],
    ['AI pending', summary.aiPending ?? 0],
    ['GPT status', gptLabel],
  ].map(([label, value]) => `
    <div class="application-stat">
      <span class="application-stat-value">${escHtml(String(value))}</span>
      <span class="application-stat-label">${escHtml(label)}</span>
    </div>`).join('');

  if (pendingAiFields.length && pendingList && pendingWrap) {
    pendingWrap.classList.remove('hidden');
    pendingList.innerHTML = pendingAiFields.map((field) => {
      const label = field.label || field.stableFieldId || 'Untitled question';
      const required = field.required ? ' (required)' : '';
      return `<li>${escHtml(label)}${escHtml(required)}</li>`;
    }).join('');
  } else if (pendingWrap) {
    pendingWrap.classList.add('hidden');
    if (pendingList) pendingList.innerHTML = '';
  }

  if (hintEl) {
    if (ts?.readyToApply || ts?.gptTaskStatus === 'ready') {
      hintEl.textContent = 'GPT Actions complete (submitTaskPackage). Click Apply answers or wait for auto-fill.';
    } else if ((summary.aiPending ?? 0) > 0) {
      hintEl.textContent = `Extension sends PROCESS_TASK: ${activeTaskId || 'task_?'} → GPT runs getTaskContext + submitTaskPackage.`;
    } else if ((summary.totalFields ?? 0) > 0) {
      hintEl.textContent = 'All detected fields were profile/saved answers, or no narrative AI questions were found on this page.';
    } else {
      hintEl.textContent = 'No fields were saved for this session.';
    }
  }

  renderGptActionSteps(ts);
  updateCustomGptButton(ts);
  panel.classList.remove('hidden');
  scheduleFitPopup();
}

function formatDevFieldLine(field, index) {
  const category = field.category || 'unknown';
  const status = field.fillStatus || 'pending';
  const type = field.fieldType || '?';
  const label = (field.label || field.placeholder || field.stableFieldId || 'no label').slice(0, 80);
  const required = field.required ? 'required' : 'optional';
  const parts = [
    `[${index + 1}] ${category}`,
    status.toUpperCase(),
    type,
    `"${label}"`,
    required,
  ];
  if (field.profileKey) parts.push(`profile→${field.profileKey}`);
  if (field.savedAnswerKey) parts.push(`saved→${field.savedAnswerKey}`);
  if (field.fillValue) parts.push(`fill→${String(field.fillValue).slice(0, 60)}`);
  if (field.currentValue) parts.push(`page→${String(field.currentValue).slice(0, 40)}`);
  if (field.stableFieldId) parts.push(`id:${field.stableFieldId}`);
  return parts.join(' | ');
}

function buildDevCaptureSummary(capture) {
  if (!capture) return '';
  const lines = [];
  lines.push(`Session #${capture.applicationId ?? '—'} | ${capture.platform || 'unknown'} | ${capture.pageUrl || '—'}`);
  lines.push(`Scanned: ${capture.scannedCount ?? 0} | Saved to server: ${capture.fields?.length ?? 0}`);
  lines.push(`Filled: ${capture.counts?.filled ?? 0} | AI pending: ${capture.counts?.aiPending ?? 0} | Unknown: ${capture.counts?.unknown ?? 0} | Errors: ${capture.counts?.errors ?? 0}`);
  lines.push('---');
  (capture.fields || []).forEach((field, index) => {
    lines.push(formatDevFieldLine(field, index));
  });
  if (!capture.fields?.length) {
    lines.push('(no fields captured)');
  }
  return lines.join('\n');
}

function renderDevCaptureDebug(capture) {
  const panel = document.getElementById('dev-capture-debug');
  const summaryEl = document.getElementById('dev-capture-summary');
  const rawEl = document.getElementById('dev-capture-raw');
  if (!panel || !summaryEl || !rawEl) return;

  if (!capture) {
    panel.classList.add('hidden');
    summaryEl.value = '';
    rawEl.value = '';
    return;
  }

  lastDevCapture = capture;
  summaryEl.value = buildDevCaptureSummary(capture);
  rawEl.value = JSON.stringify(capture, null, 2);
  panel.classList.remove('hidden');
  scheduleFitPopup();
}

function buildDevCaptureFromWorkflow({
  applicationId,
  platform,
  scanMeta,
  scannedFields,
  classifiedFields,
  fillResults,
  serverResult,
  discovery,
}) {
  const fields = serverResult?.fields || classifiedFields || [];
  const counts = {
    filled: fields.filter((f) => f.fillStatus === 'filled').length,
    aiPending: fields.filter(
      (f) => (f.category === 'ai_generation' || f.category === 'document_upload')
        && (f.fillStatus === 'pending' || f.fillStatus === 'awaiting_answer')
    ).length,
    unknown: fields.filter((f) => f.category === 'unknown').length,
    errors: fields.filter((f) => f.fillStatus === 'error').length,
    profile: fields.filter((f) => f.category === 'candidate_profile').length,
    saved: fields.filter((f) => f.category === 'saved_answer').length,
    ai: fields.filter((f) => f.category === 'ai_generation').length,
    upload: fields.filter((f) => f.category === 'document_upload' || f.fieldType === 'file').length,
  };

  return {
    capturedAt: new Date().toISOString(),
    applicationId,
    platform,
    flowType: discovery?.flowType || null,
    pageUrl: scanMeta?.pageUrl || null,
    pageTitle: scanMeta?.pageTitle || null,
    pageStep: scanMeta?.pageStep || null,
    scannedCount: scannedFields?.length ?? 0,
    counts,
    fields,
    discovery: discovery || null,
    fillResults: fillResults || [],
    serverSummary: serverResult?.summary || null,
    _devNote: 'Temporary debug payload — remove dev-capture-debug UI before production',
  };
}

function showApplicationPreview(discovery, classifiedFields, fillPolicy = null, fillPolicyContext = null, options = {}) {
  const preview = window.__qtsApplicationPreview;
  return new Promise((resolve) => {
    const panel = document.getElementById('application-preview');
    const flowEl = document.getElementById('application-preview-flow');
    const statsEl = document.getElementById('application-preview-stats');
    const warningsEl = document.getElementById('application-preview-warnings');
    const noteEl = document.getElementById('application-preview-note');
    const bodyEl = document.getElementById('application-preview-body');
    const confirmBtn = document.getElementById('btn-preview-confirm');
    const cancelBtn = document.getElementById('btn-preview-cancel');
    if (!panel || !bodyEl || !confirmBtn || !cancelBtn) {
      resolve({ confirmed: true, fields: classifiedFields });
      return;
    }

    hideLoading(true);
    const flow = window.__qtsApplicationFlow;
    const counts = flow?.summarizeDiscoveryCounts(classifiedFields) || { total: classifiedFields.length };
    const willUseCustomGpt = options.willUseCustomGpt !== false
      && (options.willUseCustomGpt === true || needsCustomGptHandoff(classifiedFields));

    if (willUseCustomGpt) {
      prewarmCustomGptTab();
      if (noteEl) {
        noteEl.textContent = 'Review discovered fields, then click Confirm. Custom GPT is preloading in the background for resume/PDF generation. After confirm, profile fields fill on the job page, then PROCESS_TASK is sent automatically.';
      }
    } else if (noteEl) {
      noteEl.textContent = 'Review discovered fields, then click Confirm. Profile fields fill on the job page. You submit manually on the job site.';
    }
    if (flowEl) {
      const templateLabel = discovery?.templateName ? `${discovery.templateName} · ` : '';
      flowEl.textContent = `${templateLabel}${flow?.formatFlowType(discovery?.flowType) || 'Application form'}`;
    }
    if (statsEl) {
      statsEl.innerHTML = [
        `<span class="application-preview-stat">${counts.total} fields</span>`,
        `<span class="application-preview-stat">${counts.required || 0} required</span>`,
        `<span class="application-preview-stat">${counts.profile || 0} profile</span>`,
        `<span class="application-preview-stat">${counts.upload || 0} uploads</span>`,
        `<span class="application-preview-stat">${counts.ai || 0} AI</span>`,
      ].join('');
    }

    const warnings = discovery?.warnings || [];
    if (warningsEl) {
      if (warnings.length) {
        warningsEl.innerHTML = warnings.map((w) => `<li>${escHtml(w)}</li>`).join('');
        warningsEl.classList.remove('hidden');
      } else {
        warningsEl.innerHTML = '';
        warningsEl.classList.add('hidden');
      }
    }

    bodyEl.innerHTML = classifiedFields.map((field, index) => {
      const label = escHtml((field.label || field.placeholder || field.stableFieldId || 'Field').slice(0, 100));
      const type = escHtml(flow?.formatFieldType(field.fieldType) || field.fieldType || 'Field');
      const category = escHtml(flow?.formatCategory(field.category) || field.category || 'Unknown');
      const required = field.required ? ' *' : '';
      const valueCell = preview?.renderPreviewInput(field, index, escHtml, escAttr)
        || `<span class="application-preview-readonly">—</span>`;
      return `<tr>
        <td>${label}${required}</td>
        <td>${type}</td>
        <td>${category}</td>
        <td>${valueCell}</td>
      </tr>`;
    }).join('');

    if (!classifiedFields.length) {
      bodyEl.innerHTML = `<tr><td colspan="4" class="application-preview-readonly">No fields captured yet. ${escHtml(discovery?.externalUrl ? `Open external apply page: ${discovery.externalUrl}` : 'Open the apply form on the job tab and try again.')}</td></tr>`;
    }

    const cleanup = () => {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };

    const onCancel = () => {
      cleanup();
      resolve({ confirmed: false, fields: null });
    };

    const onConfirm = () => {
      if (willUseCustomGpt) {
        prewarmCustomGptTab();
      }
      let nextFields = preview?.applyPreviewEdits(classifiedFields) || classifiedFields;
      if (fillPolicy && window.__qtsFillPolicy?.applyFillPolicy) {
        nextFields = window.__qtsFillPolicy.applyFillPolicy(nextFields, fillPolicy, fillPolicyContext || {});
      }
      cleanup();
      resolve({ confirmed: true, fields: nextFields });
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
    scheduleFitPopup();
  });
}

async function refreshApplicationStatus() {
  if (!activeApplicationId) {
    showAlert('main-alert', 'No application session yet. Click Start Application first.', 'info');
    return;
  }
  showLoading('Checking application session…');
  try {
    const [result, taskStatus] = await Promise.all([
      window.api.getApplicationResult(activeApplicationId),
      activeTaskId ? window.api.getApplicationTaskStatus(activeTaskId) : Promise.resolve(null),
    ]);
    if (!result.success) {
      showAlert('main-alert', result.message || 'Could not load application session.', 'error');
      return;
    }
    if (taskStatus?.success) {
      lastGptTaskStatus = taskStatus;
    }
    renderApplicationStatus(result, taskStatus?.success ? taskStatus : null);
    if (global.__qtsLearningReviewPanel?.refresh) {
      await global.__qtsLearningReviewPanel.refresh(activeApplicationId);
    }
    if (lastDevCapture) {
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: lastDevCapture.platform,
        scanMeta: {
          pageUrl: lastDevCapture.pageUrl,
          pageTitle: lastDevCapture.pageTitle,
          pageStep: lastDevCapture.pageStep,
        },
        scannedFields: lastDevCapture.fields,
        classifiedFields: result.fields,
        fillResults: lastDevCapture.fillResults,
        serverResult: result,
      }));
    } else {
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: result.session?.platform,
        scanMeta: { pageUrl: result.session?.jobUrl },
        classifiedFields: result.fields,
        serverResult: result,
      }));
    }
    const pending = result.summary?.aiPending ?? 0;
    const filled = result.summary?.filled ?? 0;
    const gpt = lastGptTaskStatus?.gptTaskStatus ? `, GPT ${lastGptTaskStatus.gptTaskStatus}` : '';
    showAlert('main-alert', `Session #${activeApplicationId} (${activeTaskId || '—'}): ${filled} filled, ${pending} AI pending${gpt}.`, 'success');
  } finally {
    hideLoading(true);
  }
}

function needsCustomGptHandoff(fields) {
  return (fields || []).some((field) => field.category === 'ai_generation'
    || field.category === 'document_upload'
    || field.fieldType === 'file');
}

function prewarmCustomGptTab() {
  chrome.runtime.sendMessage({ type: 'PREWARM_CUSTOM_GPT_TAB', background: true }).catch(() => {});
}

async function startApplication(candidateId) {
  requireManagerCustomGpt();
  const candidate = candidates.find((c) => Number(c.id) === Number(candidateId));
  if (!candidate) {
    showAlert('main-alert', 'Candidate not found.', 'error');
    return;
  }

  const jobUrl = document.getElementById('f-url')?.value?.trim() || currentTabUrl;
  const jobTitle = document.getElementById('f-title')?.value?.trim();
  const company = document.getElementById('f-company')?.value?.trim();
  const jobDescription = document.getElementById('f-desc')?.value?.trim() || '';

  if (!jobUrl || !jobUrl.startsWith('http')) {
    showAlert('main-alert', 'Open a job application page and ensure the URL is filled in first.', 'error');
    return;
  }

  showLoading('Loading candidate profile…');
  try {
    if (targetTabId) {
      await chrome.storage.local.set({ qtsJobSourceTabId: targetTabId });
    }

    const profileRes = await window.api.getCandidate(candidateId);
    if (!profileRes.success || !profileRes.candidate) {
      showAlert('main-alert', window.api.formatApiMessage(profileRes, 'Could not load candidate profile.'), 'error');
      return;
    }

    const fullCandidate = profileRes.candidate;

    showLoading('Discovering application form…');
    hideLoading(true);
    const discoverResponse = await chrome.runtime.sendMessage({
      type: 'DISCOVER_APPLICATION_FORM',
      tabId: targetTabId,
      openApplyForm: true,
      expandDynamic: false,
      mode: 'REAL_APPLICATION',
      readOnly: true,
    });

    if (discoverResponse?.error) {
      const debugNote = discoverResponse.debug
        ? ` (${JSON.stringify(discoverResponse.debug)})`
        : '';
      showAlert('main-alert', `${discoverResponse.error}${debugNote}`, 'error');
      return;
    }

    await chrome.runtime.sendMessage({ type: 'DETECT_APPLY_TEMPLATE', tabId: targetTabId }).catch(() => {});
    await loadApplyTemplateForTab(targetTabId);

    const discovery = discoverResponse.discovery || {};
    const scanMeta = discoverResponse.scan || discovery.scanMeta || {};
    const scannedFields = discoverResponse.scan?.fields || discovery.fields || [];
    const templateNotices = [];
    if (discoverResponse.templateSave) {
      if (discoverResponse.templateSave.success) {
        const savedSteps = discoverResponse.templateSave.checkpoint?.steps?.length || 1;
        templateNotices.push(`Discovery checkpoint saved (${savedSteps} observed step(s)).`);
      } else {
        templateNotices.push(`Template draft was not saved: ${discoverResponse.templateSave.message || 'unknown persistence error'}`);
      }
    }
    if (discoverResponse.templateLookupError) {
      templateNotices.push(`Template lookup failed; generic scan was used: ${discoverResponse.templateLookupError}`);
    }
    if (discoverResponse.templateReuse?.found) {
      templateNotices.push(`A ${discoverResponse.templateReuse.status} template was checked against this page; the generic scan remains authoritative.`);
    }
    const templateNotice = templateNotices.length ? ` ${templateNotices.join(' ')}` : '';

    if (discovery.flowType === 'external_redirect' && discovery.externalUrl) {
      showAlert(
        'main-alert',
        `This job applies on an external site: ${discovery.externalUrl}. Open that page and run Start Application there.`,
        'warn'
      );
      return;
    }

    if (!scannedFields.length) {
      const applyFlow = discovery.applyFlow || discoverResponse.applyFlow;
      if (applyFlow?.clicked && applyFlow?.formAppeared === false) {
        showAlert(
          'main-alert',
          `Clicked Apply but no application form appeared. Open the job page, click Apply to show the form, then try Start Application again.${templateNotice}`,
          'warn'
        );
      } else if (applyFlow?.reason === 'no_apply_button') {
        showAlert(
          'main-alert',
          `No Apply button found on this page. Open the application form manually and try again.${templateNotice}`,
          'warn'
        );
      } else {
        showAlert('main-alert', `No application fields detected on this page. Open the apply form and try again.${templateNotice}`, 'warn');
      }
      return;
    }

    showLoading('Creating application session…');
    const templateVersion = discovery.templateVersion || 'legacy-v1';
    const pageFingerprint = discovery.pageSignature || scanMeta.pageSignature || null;
    const sessionRes = await window.api.createApplicationSession({
      candidateId,
      jobId: existingJobId || null,
      jobUrl,
      jobTitle: jobTitle || null,
      company: company || null,
      jobDescription,
      platform: detectPlatformFromUrl(jobUrl),
      templateVersion,
      pageFingerprint,
      mode: 'REAL_APPLICATION',
      currentStep: 'scan',
      metadata: {
        sourceTabId: targetTabId,
        extensionVersion: chrome.runtime.getManifest().version,
        templateVersion,
        pageFingerprint,
        mode: 'REAL_APPLICATION',
      },
    });

    if (!sessionRes.success || !sessionRes.session) {
      showAlert('main-alert', window.api.formatApiMessage(sessionRes, 'Could not create application session.'), 'error');
      return;
    }

    activeApplicationId = sessionRes.session.applicationId;
    activeTaskId = sessionRes.session?.metadata?.publicTaskId
      || sessionRes.session?.metadata?.taskId
      || sessionRes.taskId
      || null;
    await persistActiveApplySession({
      applicationId: activeApplicationId,
      taskId: activeTaskId,
      jobTabId: targetTabId,
      jobUrl,
      candidateId,
      status: 'started',
    });
    if (!activeTaskId) {
      console.warn('Server did not return taskId for session', activeApplicationId);
    }
    gptDispatchSent = false;
    gptAppliedToForm = false;
    lastGptTaskStatus = null;
    const savedAnswers = sessionRes.savedAnswers || [];

    let classifiedFields = window.__qtsFieldClassifier.classifyFields(scannedFields);
    classifiedFields = window.__qtsCandidateMatcher.applyFieldClassificationFill(
      classifiedFields,
      fullCandidate,
      savedAnswers
    );

    const fillPolicy = window.__qtsFillPolicy?.getFillPolicyForTemplate?.(discovery.templateId);
    const fillPolicyContext = { candidate: fullCandidate, savedAnswers };
    if (fillPolicy) {
      classifiedFields = window.__qtsFillPolicy.applyFillPolicy(
        classifiedFields,
        fillPolicy,
        fillPolicyContext
      );
    }

    renderDevCaptureDebug(buildDevCaptureFromWorkflow({
      applicationId: activeApplicationId,
      platform: detectPlatformFromUrl(jobUrl),
      scanMeta,
      scannedFields,
      classifiedFields,
      discovery,
    }));
    const devPanel = document.getElementById('dev-capture-debug');
    if (devPanel && classifiedFields.length) {
      devPanel.classList.remove('hidden');
    }

    hideLoading(true);
    const willUseCustomGpt = needsCustomGptHandoff(classifiedFields);
    const previewResult = await showApplicationPreview(
      discovery,
      classifiedFields,
      fillPolicy,
      fillPolicyContext,
      { willUseCustomGpt }
    );
    if (!previewResult.confirmed || !previewResult.fields) {
      showAlert('main-alert', 'Application cancelled — nothing was filled on the job page.', 'info');
      return;
    }
    classifiedFields = previewResult.fields;

    if (willUseCustomGpt) {
      setGptPipelineState('dispatching', 'Fields confirmed — finishing profile fill, then Custom GPT…');
    }

    const fillableFields = classifiedFields.filter(
      (field) => field.category !== 'ai_generation'
        && field.category !== 'document_upload'
        && field.fillValue
        && field.fillStatus === 'filled'
    );

    showLoading('Filling confirmed fields…');
    const fillResponse = await chrome.runtime.sendMessage({
      type: 'FILL_APPLICATION_FORM',
      tabId: targetTabId,
      fields: fillableFields,
      mode: 'REAL_APPLICATION',
      allowUserApprovedFill: true,
    });

    const fillResults = fillResponse?.fill?.results || [];
    const fillResultById = new Map(fillResults.map((item) => [item.stableFieldId, item]));

    classifiedFields = classifiedFields.map((field) => {
      if (field.category === 'ai_generation' || field.category === 'document_upload') return field;
      const outcome = fillResultById.get(field.stableFieldId);
      if (!outcome) return field;
      if (outcome.ok) return { ...field, fillStatus: 'filled' };
      return { ...field, fillStatus: 'error' };
    });

    showLoading('Saving discovered fields…');
    const healthRes = await window.api.health();
    if (healthRes?.success && healthRes.features?.documentUploadCategory !== true) {
      showAlert(
        'main-alert',
        'Server is missing document upload support. Run stop-server.bat then start-server.bat (do not skip — old server must restart).',
        'error'
      );
      return;
    }

    const patchRes = await window.api.patchApplicationSessionFields(activeApplicationId, {
      fields: classifiedFields,
      currentStep: scanMeta.pageStep || 'scan',
      discoveredPages: (discovery.pages || [{
        pageUrl: scanMeta.pageUrl || jobUrl,
        pageTitle: scanMeta.pageTitle || '',
        pageStep: scanMeta.pageStep || '',
        scannedAt: scanMeta.scannedAt || new Date().toISOString(),
        fieldCount: classifiedFields.length,
        flowType: discovery.flowType,
      }]).map((page) => ({
        ...page,
        flowType: discovery.flowType,
      })),
      templateVersion: discovery.templateVersion || 'legacy-v1',
      pageFingerprint: discovery.pageSignature || scanMeta.pageSignature || null,
      mode: 'REAL_APPLICATION',
      status: 'awaiting_ai',
    });

    if (!patchRes.success) {
      showAlert('main-alert', window.api.formatApiMessage(patchRes, 'Could not save application fields.'), 'error');
      return;
    }

    const pendingRes = await window.api.getPendingApplicationFields(activeApplicationId);
    const pendingCount = pendingRes?.pendingFields?.length || patchRes.pendingAiCount || 0;
    const filledCount = classifiedFields.filter((field) => field.fillStatus === 'filled').length;

    const resultRes = await window.api.getApplicationResult(activeApplicationId);
    const taskStatusRes = activeTaskId
      ? await window.api.getApplicationTaskStatus(activeTaskId)
      : null;
    if (taskStatusRes?.success) lastGptTaskStatus = taskStatusRes;
    if (resultRes?.success) {
      renderApplicationStatus(resultRes, taskStatusRes?.success ? taskStatusRes : null);
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: detectPlatformFromUrl(jobUrl),
        scanMeta,
        scannedFields,
        classifiedFields,
        fillResults,
        serverResult: resultRes,
        discovery,
      }));
    } else {
      renderDevCaptureDebug(buildDevCaptureFromWorkflow({
        applicationId: activeApplicationId,
        platform: detectPlatformFromUrl(jobUrl),
        scanMeta,
        scannedFields,
        classifiedFields,
        fillResults,
        discovery,
      }));
    }

    const pendingUploadCount = (pendingRes?.pendingFields || []).filter(
      (field) => field.category === 'document_upload' || field.fieldType === 'file'
    ).length;
    const pendingTextCount = pendingCount - pendingUploadCount;

    if (willUseCustomGpt && activeTaskId) {
      try {
        await chrome.runtime.sendMessage({
          type: 'RELEASE_UI_FOR_GPT',
          jobTabId: targetTabId,
        }).catch(() => {});
        await dispatchGptTask(activeApplicationId, { pollAndApply: true, taskId: activeTaskId });
      } catch (e) {
        showAlert(
          'main-alert',
          `Session #${activeApplicationId} saved, but Custom GPT handoff failed: ${e?.message || e}. Use "Send PROCESS_TASK".${templateNotice}`,
          'warn'
        );
      }
    } else if (pendingCount > 0) {
      showAlert(
        'main-alert',
        `Session #${activeApplicationId}: ${filledCount} filled, ${pendingCount} field(s) still pending.${templateNotice}`,
        'warn'
      );
    } else {
      showAlert(
        'main-alert',
        `Session #${activeApplicationId}: filled ${filledCount}. No AI questions on this page.${templateNotice}`,
        discoverResponse.templateSave?.success === false || discoverResponse.templateLookupError ? 'warn' : 'success'
      );
    }
  } finally {
    hideLoading(true);
  }
}

// ---- Save / Update ----
async function doSave() {
  clearErrors();
  const title = document.getElementById('f-title').value.trim();
  const company = document.getElementById('f-company').value.trim();
  const url = document.getElementById('f-url').value.trim();
  let valid = true;
  if (!title) { showFieldError('err-title'); valid = false; }
  if (!company) { showFieldError('err-company'); valid = false; }
  if (!url) { showFieldError('err-url'); valid = false; }
  if (!valid) return { success: false };

  let assignments;
  try {
    assignments = getSelectedJobAssignments();
  } catch (error) {
    showAlert('main-alert', error.message || 'Select at least one Account for this job.', 'warn');
    return { success: false };
  }

  const payload = {
    title,
    company,
    url,
    ...assignments,
  };

  const saveBtn = document.getElementById('btn-save');
  let wasUpdate = !!existingJobId;
  const refreshBtn = document.getElementById('btn-refresh');

  showLoading(wasUpdate ? 'Updating job…' : 'Saving job…');
  try {
    saveBtn.disabled = true;
    if (refreshBtn) refreshBtn.disabled = true;
    if (!wasUpdate) {
      const checked = await window.api.checkJobByUrl(url);
      if (!checked.success) throw new Error(checked.message || 'Could not check whether this job is already saved.');
      if (checked.job) {
        const selectedBeforeLookup = new Set(assignments.selectedAccountUserIds);
        loadExistingJob(checked.job, { silent: true });
        selectedJobAccountIds = selectedBeforeLookup;
        const newAccountCount = [...selectedBeforeLookup]
          .filter((accountId) => !existingJobAccountIds.has(accountId)).length;
        wasUpdate = true;
        if (newAccountCount > 0 && !window.confirm(
          `This job is already in your list. Add it for ${newAccountCount} additional Account${newAccountCount === 1 ? '' : 's'}?`
        )) {
          return { success: false };
        }
      }
    } else {
      const newAccountCount = assignments.selectedAccountUserIds
        .filter((accountId) => !existingJobAccountIds.has(accountId)).length;
      if (newAccountCount > 0 && !window.confirm(
        `This job is already in your list. Add it for ${newAccountCount} additional Account${newAccountCount === 1 ? '' : 's'}?`
      )) {
        return { success: false };
      }
    }
    const r = wasUpdate
      ? await window.api.updateJob(existingJobId, payload)
      : await window.api.createJob(payload);

    if (r.success) {
      showAlert(
        'main-alert',
        r.message || (wasUpdate ? 'Job and Account rows updated!' : 'Job saved for selected Accounts!'),
        r.message ? 'warn' : 'success'
      );
      if (r.job) {
        existingJobId = r.job.id;
        jobSavedInBackend = true;
        existingJobAccountIds = new Set(
          (r.job.selected_account_u_ids || assignments.selectedAccountUserIds).map(Number)
        );
        selectedJobAccountIds = new Set(existingJobAccountIds);
        renderJobAccountGroups();
        currentSource = r.job.source || currentSource;
        updateJobSummary();
      }
      saveBtn.textContent = 'Update Job';
      return { success: true, job: r.job };
    } else {
      showAlert('main-alert', formatApiError(r), 'error');
      return { success: false };
    }
  } catch (e) {
    console.error('doSave error:', e);
    showAlert('main-alert', e?.message || 'Could not save the job to your Job List.', 'error');
    return { success: false };
  } finally {
    saveBtn.disabled = false;
    if (refreshBtn) refreshBtn.disabled = false;
    hideLoading(true);
  }
}

async function doRefresh() {
  const refreshBtn = document.getElementById('btn-refresh');
  const saveBtn = document.getElementById('btn-save');
  showLoading('Refreshing…');
  if (refreshBtn) refreshBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  try {
    existingJobId = null;
    existingJobAccountIds.clear();
    jobSavedInBackend = false;
    candidateStatuses = {};
    candidateAppliedAt = {};
    candidateLocked = {};
    currentSource = '';
    selectedJobAccountIds.clear();
    hasManuallyChangedJobAccounts = false;
    document.getElementById('job-account-assignment')?.classList.add('hidden');
    clearErrors();
    clearAlert('main-alert');
    document.getElementById('btn-save').textContent = 'Save Job';
    ['f-title', 'f-company', 'f-url', 'f-desc'].forEach(id => document.getElementById(id).value = '');
    updateJobSummary();
    await loadAll(true);
  } finally {
    if (refreshBtn) refreshBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
    hideLoading(true);
  }
}

// ---- UI helpers ----
function showLogin() {
  pageHighlightsReturnView = null;
  hidePageHighlights();
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('authenticated-section')?.classList.add('hidden');
  document.getElementById('action-section').classList.add('hidden');
  document.getElementById('job-section').classList.add('hidden');
  document.getElementById('action-bar').classList.add('hidden');
  clearSession();
  resetLoginFormView();
  scheduleFitPopup();
}

function showAuthenticatedScreen(user) {
  currentUser = user;
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('authenticated-section')?.classList.remove('hidden');
  document.getElementById('action-section').classList.add('hidden');
  document.getElementById('job-section').classList.add('hidden');
  document.getElementById('action-bar').classList.add('hidden');
  document.getElementById('authenticated-name').textContent = user.name || user.username;
  document.getElementById('authenticated-login').textContent = `@${user.username}`;
  refreshGetJdView().catch((error) => {
    console.error('[QTS Get JD] Could not restore mode state:', error);
  });
  scheduleFitPopup();
}

async function refreshGetJdView() {
  const stored = await chrome.storage.local.get([EXTENSION_STATUS_KEY]);
  const geminiEvaluationEnabled = window.__qtsRuntimeConfig?.features?.geminiEvaluation === true;
  const enabled = stored[EXTENSION_STATUS_KEY] === 'get_jd';
  const button = document.getElementById('btn-get-jd-mode');
  const status = document.getElementById('get-jd-mode-status');
  const preview = document.getElementById('get-jd-preview');
  const activeSection = document.getElementById('get-jd-active-section');
  if (button) {
    button.classList.toggle('hidden', enabled || !geminiEvaluationEnabled);
    button.setAttribute('aria-pressed', String(enabled));
  }
  activeSection?.classList.toggle('hidden', !enabled);
  status?.classList.toggle('hidden', enabled && geminiEvaluationEnabled);
  preview?.classList.add('hidden');
  if (status && !geminiEvaluationEnabled) {
    status.textContent = 'Use the floating QTS button on the current page. Get JD extracts a local preview without Gemini.';
  } else if (status && !enabled) {
    status.textContent = 'Preview the job details before turning on Get JD.';
  }
}

function setGetJdPreviewMessage(message, isError = false) {
  const element = document.getElementById('get-jd-preview-message');
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-error', isError);
}

async function startGetJdPreview() {
  const button = document.getElementById('btn-get-jd-mode');
  const preview = document.getElementById('get-jd-preview');
  const checkButton = document.getElementById('btn-get-jd-check');
  const backButton = document.getElementById('btn-get-jd-preview-back');
  if (button) button.disabled = true;
  pendingGetJdPreview = null;
  preview?.classList.remove('hidden');
  setGetJdPreviewMessage('Extracting job details from this page...');
  for (const id of [
    'get-jd-preview-title',
    'get-jd-preview-company',
    'get-jd-preview-url',
    'get-jd-preview-country',
    'get-jd-preview-employment-type',
    'get-jd-preview-workplace-type',
    'get-jd-preview-salary',
    'get-jd-preview-description',
  ]) {
    const field = document.getElementById(id);
    if (field) field.textContent = '';
  }
  if (checkButton) checkButton.disabled = true;
  if (backButton) backButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_JD_PREVIEW',
      tabId: targetTabId,
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Could not extract job details from this page.');
    }
    pendingGetJdPreview = response.job;
    document.getElementById('get-jd-preview-title').textContent = response.job.title || 'Not detected';
    document.getElementById('get-jd-preview-company').textContent = response.job.company || 'Not detected';
    document.getElementById('get-jd-preview-url').textContent = response.job.jobUrl || 'Not detected';
    document.getElementById('get-jd-preview-country').textContent = response.job.country || 'Not detected';
    document.getElementById('get-jd-preview-employment-type').textContent =
      response.job.employmentType || 'Not detected';
    document.getElementById('get-jd-preview-workplace-type').textContent =
      response.job.workplaceType || 'Not detected';
    document.getElementById('get-jd-preview-salary').textContent = response.job.salary || 'Not detected';
    document.getElementById('get-jd-preview-description').textContent =
      response.job.description || 'Not detected';
    setGetJdPreviewMessage('Review these details, then click Check to activate Get JD.');
    if (checkButton) checkButton.disabled = false;
  } catch (error) {
    setGetJdPreviewMessage(error?.message || 'Could not extract job details.', true);
  } finally {
    if (button) button.disabled = false;
    if (backButton) backButton.disabled = false;
  }
}

async function confirmGetJdMode() {
  const button = document.getElementById('btn-get-jd-check');
  if (!pendingGetJdPreview) {
    setGetJdPreviewMessage('Extract job details before starting Get JD.', true);
    return;
  }
  if (button) button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_EXTENSION_STATUS',
      status: 'get_jd',
      tabId: targetTabId,
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Could not activate Get JD mode.');
    }
  } catch (error) {
    setGetJdPreviewMessage(error?.message || 'Could not activate Get JD mode.', true);
    if (button) button.disabled = false;
  }
}

async function backHomeFromGetJd(event) {
  const button = event?.currentTarget
    || document.getElementById('btn-get-jd-back-home');
  const status = document.getElementById('get-jd-mode-status');
  if (button) button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_EXTENSION_STATUS',
      status: null,
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Could not return to Home.');
    }
    pendingGetJdPreview = null;
    await refreshGetJdView();
    setGetJdPreviewMessage('');
  } catch (error) {
    if (status) status.textContent = error?.message || 'Could not return to Home.';
  } finally {
    if (button) button.disabled = false;
  }
}

function updateFeatureGatedControls(user) {
  const runtimeFeatures = window.__qtsRuntimeConfig?.features || {};
  const managerMode = user?.role === 'manager';
  const scannerEnabled = runtimeFeatures.scanner === true;
  const applicationEnabled = runtimeFeatures.applicationAutomation === true;
  const highlightsEnabled = runtimeFeatures.textHighlights === true;
  const scannerUnavailable = managerMode
    && (!scannerEnabled || !managerExtensionFeatures.canUseScanner);
  const outputFolderButton = document.getElementById('btn-scanner-output-folder');
  outputFolderButton?.classList.toggle('hidden', !managerMode || scannerUnavailable);
  if (managerMode && !scannerUnavailable) {
    restoreScannerOutputFolderStatus().catch((error) => {
      console.warn('Could not restore the Scanner output-folder setting:', error);
    });
  } else {
    document.getElementById('scanner-output-folder-status')?.classList.add('hidden');
  }
  const canManageHighlights = highlightsEnabled
    && managerMode
    && managerExtensionFeatures.canManageTextHighlights;
  const canManagePageExclusions = managerMode
    && managerExtensionFeatures.canManagePageExclusions;
  const scannerSection = document.getElementById('site-discovery');
  scannerSection?.classList.toggle('hidden', !managerMode || (!scannerEnabled && !applicationEnabled));
  const scannerTitle = document.getElementById('site-discovery-title');
  if (scannerTitle) scannerTitle.textContent = scannerUnavailable ? 'Apply' : 'Apply & Scanner';
  const scannerButton = document.getElementById('btn-discover-site-step');
  scannerButton?.classList.toggle('hidden', scannerUnavailable);
  document.getElementById('btn-apply')?.classList.toggle(
    'hidden',
    !applicationEnabled || !managerMode || !managerExtensionFeatures.canUseApply
  );
  document.getElementById('btn-connect-account-mailbox')?.classList.toggle(
    'hidden',
    !applicationEnabled || !managerMode || !scannerApplyMode || !scannerSelectedAccountId || !managerExtensionFeatures.canUseApply
  );
  document.querySelectorAll('.btn-text-highlights').forEach((button) => {
    button.classList.toggle('hidden', !canManageHighlights);
  });
  document.querySelectorAll('.btn-page-exclusions').forEach((button) => {
    button.classList.toggle('hidden', !canManagePageExclusions);
  });
  if (!canManageHighlights) {
    if (!document.getElementById('page-highlights')?.classList.contains('hidden')) {
      returnFromPageHighlights();
    } else {
      hidePageHighlights();
    }
  }
  const saveAndScanButton = document.getElementById('btn-save-and-scan');
  if (scannerUnavailable && !managerExtensionFeatures.canUseApply) {
    saveAndScanButton?.classList.add('hidden');
    if (saveAndScanButton) saveAndScanButton.disabled = true;
    scannerSetupPending = false;
    scannerSelectedAccountId = null;
    document.getElementById('scanner-save-status')?.classList.add('hidden');
  }
  document.getElementById('application-disabled-note')?.classList.add('hidden');
  const subtitle = document.querySelector('.action-subtitle');
  if (subtitle) {
    subtitle.textContent = managerMode
      ? managerExtensionFeatures.canUseScanner
        ? 'Get JD saves a job to your Manager job list. Apply fills supported answers, advances recognized steps, and submits only when the page presents a unique recognized submit control.'
        : managerExtensionFeatures.canUseApply
          ? 'Get JD saves a job to your Manager job list. Apply handles supported application fields and pauses when human input is required.'
          : 'Get JD saves a job to your Manager job list.'
      : 'Select an action for the current job page.';
  }
}

async function refreshManagerExtensionFeatures() {
  managerExtensionFeatures = {
    canManageTextHighlights: false,
    canManagePageExclusions: false,
    canUseScanner: false,
    canUseApply: false,
  };
  managerExtensionFeaturesError = '';
  if (currentUser?.role !== 'manager') return managerExtensionFeatures;
  const runtimeFeatures = window.__qtsRuntimeConfig?.features || {};
  if (
    runtimeFeatures.scanner !== true
    && runtimeFeatures.applicationAutomation !== true
    && runtimeFeatures.textHighlights !== true
    && runtimeFeatures.pageExclusions !== true
  ) {
    updateFeatureGatedControls(currentUser);
    return managerExtensionFeatures;
  }
  const result = await window.api.getManagerExtensionFeatures();
  if (!result.success || !result.features) {
    managerExtensionFeaturesError = result.message || 'Could not verify this Manager’s extension permissions.';
    updateFeatureGatedControls(currentUser);
    return managerExtensionFeatures;
  }
  managerExtensionFeatures = {
    canManageTextHighlights: result.features.canManageTextHighlights === true,
    canManagePageExclusions: result.features.canManagePageExclusions === true,
    canUseScanner: result.features.canUseScanner === true,
    canUseApply: result.features.canUseApply === true,
  };
  updateFeatureGatedControls(currentUser);
  return managerExtensionFeatures;
}

async function requireScannerFeatureAccess() {
  await refreshManagerExtensionFeatures();
  if (managerExtensionFeatures.canUseScanner) return true;
  const message = managerExtensionFeaturesError
    ? `Scanner is unavailable because extension permissions could not be verified: ${managerExtensionFeaturesError}`
    : 'Super must assign job-site Scanner access to this Manager account.';
  throw new Error(message);
}

async function initializeManagerExtensionFeatures(user) {
  setSession(user);
  if (user?.role === 'manager') await refreshManagerExtensionFeatures();
  else managerExtensionFeatures = {
    canManageTextHighlights: false,
    canManagePageExclusions: false,
    canUseScanner: false,
    canUseApply: false,
  };
  if (window.__qtsRuntimeConfig?.isFeatureEnabled('textHighlights')) {
    try {
      const highlights = await chrome.runtime.sendMessage({ type: 'GET_GLOBAL_TEXT_HIGHLIGHTS' });
      if (!highlights?.success) {
        console.warn('[QTS text highlights] Shared rules were not refreshed after Manager sign-in:', highlights?.message);
      }
    } catch (error) {
      console.warn('[QTS text highlights] Could not refresh shared rules after sign-in:', error);
    }
  }
  updateFeatureGatedControls(user);
}

async function showActionScreen(user) {
  await initializeManagerExtensionFeatures(user);
  pageHighlightsReturnView = null;
  hidePageHighlights();
  await restoreSelectedAction();
  scannerSetupPending = false;
  scannerSelectedAccountId = null;
  document.getElementById('btn-save-and-scan')?.classList.add('hidden');
  const scannerSaveStatus = document.getElementById('scanner-save-status');
  scannerSaveStatus?.classList.add('hidden');
  if (scannerSaveStatus) scannerSaveStatus.textContent = '';
  const managerMode = user?.role === 'manager';
  document.getElementById('btn-custom-apply')?.classList.toggle('hidden', managerMode);
  updateDefaultCandidateUi();
  updateAutoApplyBarUi();
  document.getElementById('session-bar')?.classList.add('hidden');
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('action-section').classList.remove('hidden');
  document.getElementById('job-section').classList.add('hidden');
  document.getElementById('action-bar').classList.add('hidden');
  clearAlert('main-alert');
  scheduleFitPopup();
}

async function resumeSelectedMode(user) {
  const selectedAction = await restoreSelectedAction();
  if (selectedAction !== 'btn-get-jd') {
    await showActionScreen(user);
    return;
  }

  await initializeManagerExtensionFeatures(user);
  showJobSection();
  await loadCurrentTab({ preferCache: true, allowExtract: true });
}

function showJobSection() {
  pageHighlightsReturnView = null;
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('action-section').classList.add('hidden');
  document.getElementById('job-section').classList.remove('hidden');
  hidePageHighlights();
  document.getElementById('action-bar').classList.remove('hidden');
  showJobAccountAssignment();
  scheduleFitPopup();
}

let popupToastSeq = 0;
const popupToastTimers = new WeakMap();
const TOAST_AUTO_HIDE_MS = 3000;
const TOAST_MIN_HIDE_MS = 0;
const TOAST_MAX_VISIBLE = 8;
const TOAST_EXIT_MS = 320;

function normalizeToastType(type) {
  const value = String(type || 'info').toLowerCase();
  if (['success', 'fail', 'error', 'info', 'warn', 'applied'].includes(value)) return value;
  return 'info';
}

function dismissPopupToast(toast) {
  if (!toast || !toast.isConnected) return;
  const timer = popupToastTimers.get(toast);
  if (timer) clearTimeout(timer);
  popupToastTimers.delete(toast);
  toast.classList.remove('is-visible');
  toast.classList.add('is-leaving');
  setTimeout(() => toast.remove(), TOAST_EXIT_MS);
}

function trimPopupToastStack(host) {
  while (host.children.length > TOAST_MAX_VISIBLE) {
    dismissPopupToast(host.children[0]);
  }
}

function showToast(msg, type = 'info', durationMs = TOAST_AUTO_HIDE_MS, alertId = null) {
  const toastType = normalizeToastType(type);
  const hideMs = Number.isFinite(durationMs) && durationMs >= TOAST_MIN_HIDE_MS
    ? durationMs
    : TOAST_AUTO_HIDE_MS;
  const embedded = new URLSearchParams(window.location.search).get('embedded') === '1';

  if (embedded) {
    if (!targetTabId || !chrome.tabs?.sendMessage) {
      console.warn('Could not show notification on the job page: no target tab is available.');
      return;
    }
    try {
      chrome.tabs.sendMessage(targetTabId, {
        type: 'QTS_SHOW_PAGE_TOAST',
        message: String(msg || ''),
        toastType,
        durationMs: hideMs,
        alertId,
      }).then((response) => {
        if (!response?.ok) {
          console.warn('Could not show notification on the job page:', response?.error || 'No response.');
        }
      }).catch((error) => {
        console.warn('Could not show notification on the job page:', error);
      });
      return;
    } catch (error) {
      console.warn('Could not send notification to the job page:', error);
      return;
    }
  }

  renderPopupToast(msg, toastType, hideMs, alertId);
}

function renderPopupToast(msg, toastType, hideMs, alertId) {
  const host = document.getElementById('qts-toast-host');
  if (!host) return;

  popupToastSeq += 1;

  const toast = document.createElement('div');
  toast.className = `qts-toast qts-toast--${toastType}`;
  toast.setAttribute('role', 'alert');
  if (alertId) toast.dataset.alertId = alertId;

  const indexEl = document.createElement('span');
  indexEl.className = 'qts-toast-index';
  indexEl.textContent = String(popupToastSeq);

  const textEl = document.createElement('span');
  textEl.className = 'qts-toast-text';
  textEl.textContent = String(msg || '');

  toast.appendChild(indexEl);
  toast.appendChild(textEl);
  host.appendChild(toast);
  trimPopupToastStack(host);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('is-visible'));
  });

  const timer = setTimeout(() => dismissPopupToast(toast), hideMs);
  popupToastTimers.set(toast, timer);
}

function showAlert(id, msg, type = 'info') {
  showToast(msg, type, TOAST_AUTO_HIDE_MS, id);
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

function clearAlert(id) {
  if (
    new URLSearchParams(window.location.search).get('embedded') === '1'
    && targetTabId
    && chrome.tabs?.sendMessage
  ) {
    chrome.tabs.sendMessage(targetTabId, {
      type: 'QTS_CLEAR_PAGE_ALERT',
      alertId: id,
    }).catch((error) => {
      console.warn('Could not clear notification on the job page:', error);
    });
  }
  const host = document.getElementById('qts-toast-host');
  if (host) {
    [...host.children]
      .filter((toast) => toast.dataset.alertId === id)
      .forEach((toast) => dismissPopupToast(toast));
  }
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

function showFieldError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('visible');
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(e => e.classList.remove('visible'));
}

function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escAttr(s) {
  return escHtml(s).replace(/'/g, '&#39;');
}

async function storeToken(token) {
  window.api.setCachedToken(token);
  if (global.__qtsAccountAuth?.setPopupAuthToken) {
    return global.__qtsAccountAuth.setPopupAuthToken(token);
  }
  return global.__qtsAccountAuth?.setPopupCachedToken?.(token);
}

async function getStoredToken() {
  if (global.__qtsAccountAuth?.getPopupAuthToken) {
    const token = await global.__qtsAccountAuth.getPopupAuthToken();
    window.api.setCachedToken(token);
    return token;
  }
  return '';
}

function clearToken() {
  window.api.clearCachedToken();
  global.__qtsAccountAuth?.clearPopupCachedToken?.();
  return Promise.resolve();
}
