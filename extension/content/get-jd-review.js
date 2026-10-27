let getJdReviewInitialization = null;

function initializeGetJdReview() {
  if (globalThis.__qtsGetJdReview) return;
  if (getJdReviewInitialization) return getJdReviewInitialization;
  getJdReviewInitialization = initializeGetJdReviewOnce().finally(() => {
    getJdReviewInitialization = null;
  });
  return getJdReviewInitialization;
}

async function initializeGetJdReviewOnce() {
  try {
    if (!chrome?.runtime?.id) {
      document.querySelectorAll('[data-qts-get-jd-ui]').forEach((node) => node.remove());
      return;
    }
  } catch {
    document.querySelectorAll('[data-qts-get-jd-ui]').forEach((node) => node.remove());
    return;
  }
  if (globalThis.__qtsGetJdReview) return;
  const pageAccess = await chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_PAGE_ALLOWED' });
  if (!pageAccess?.ok || pageAccess.excluded) {
    globalThis.__qtsGetJdReview = { excluded: true };
    return;
  }

  const RESULT_MESSAGE = 'QTS_GET_JD_RESULT_UPDATED';
  let host = null;
  let root = null;
  let lastToastKey = '';
  let managerProfiles = [];
  let currentResult = null;
  let selectionUpdateInProgress = false;
  let extensionStatus = null;
  let signedIn = false;
  let profilesLoaded = false;
  let profileLoadError = '';
  let panelHideTimer = null;
  let managerSettingsOpen = false;
  let managerSettingsPermissions = {};
  let highlightRules = [];
  let selectedHighlightRuleId = null;
  let pageExclusionRules = [];
  let selectedPageExclusionId = null;
  let jobDetectionRules = [];
  let selectedJobDetectionRuleId = null;
  const highlightColorPalette = [
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

  function ensureRoot() {
    if (root) return root;
    host = document.createElement('div');
    host.setAttribute('data-qts-get-jd-ui', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });

    const dockStyle = document.createElement('style');
    dockStyle.textContent = `
      html[data-qts-get-jd-docked="true"] body {
        box-sizing: border-box !important;
        padding-right: min(400px, 48vw) !important;
      }
      html body { transition: padding-right .28s cubic-bezier(.2,.8,.2,1); }
    `;
    // A restored panel reuses the page-level dock style instead of appending another copy.
    dockStyle.setAttribute('data-qts-get-jd-dock-style', '');
    if (!document.querySelector('style[data-qts-get-jd-dock-style]')) {
      (document.head || document.documentElement).appendChild(dockStyle);
    }

    const style = document.createElement('style');
    style.textContent = `
      .panel {
        position: fixed; inset: 0 0 0 auto; z-index: 1; display: flex; flex-direction: column;
        width: min(400px, 48vw); height: 100vh; height: 100dvh; box-sizing: border-box;
        padding: 20px 18px 16px; border: 1px solid #dbe4f0; border-right: 0;
        border-radius: 18px 0 0 18px; background: linear-gradient(160deg, #fff 0%, #f8faff 100%);
        color: #172033; box-shadow: -16px 0 42px #0f172a24;
        font: 13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
        opacity: 0; transform: translateX(20px); visibility: hidden; pointer-events: none;
        transition: opacity .24s ease, transform .28s cubic-bezier(.2,.8,.2,1), visibility .28s;
      }
      .panel.is-visible { opacity: 1; transform: translateX(0); visibility: visible; pointer-events: auto; }
      .panel[hidden] { display: none; }
      .panel.is-manager-settings { padding: 0; overflow: hidden; }
      .manager-brand-header { display: grid; flex: 0 0 66px; grid-template-columns: 44px 1fr auto; align-items: center; gap: 10px; padding: 8px 12px; background: #0f172a; color: #fff; }
      .manager-brand-logo { width: 44px; height: 44px; border: 1px solid #273449; border-radius: 9px; object-fit: contain; background: #070b13; }
      .manager-brand-center { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
      .manager-brand-pill-row { display: flex; align-items: center; justify-content: center; gap: 3px; }
      .manager-brand-pill { padding: 4px 7px; border: 1px solid #334155; border-radius: 999px; background: #1e293b; font-size: 10px; font-weight: 700; line-height: 1; white-space: nowrap; }
      .manager-brand-pill--quality { color: #f5d78e; }
      .manager-brand-pill--time { color: #e2e8f0; }
      .manager-brand-pill--speed { color: #38bdf8; }
      .manager-brand-plus { color: #64748b; font-size: 9px; }
      .manager-brand-subline { color: #64748b; font-size: 7px; font-weight: 600; letter-spacing: .14em; text-align: center; text-transform: uppercase; white-space: nowrap; }
      .manager-brand-connected { display: inline-flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 999px; background: #1e293b; color: #e2e8f0; font-size: 10px; white-space: nowrap; }
      .manager-brand-connected::before { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; content: ""; }
      .manager-panel-content { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; }
      .manager-panel-content[hidden] { display: none; }
      .manager-settings { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; overflow: auto; padding: 20px; background: #f0faf7; scrollbar-color: #cbd5e1 transparent; scrollbar-width: thin; }
      .manager-settings[hidden], .manager-settings-view[hidden] { display: none; }
      .manager-settings-card { display: flex; flex: 1 0 auto; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; }
      .manager-settings-header { display: flex; flex: 0 0 auto; align-items: flex-start; justify-content: space-between; gap: 8px; }
      .manager-settings-header h2 { padding-top: 7px; font-size: 15px; }
      .manager-settings-hint { margin: 0; color: #64748b; font-size: 11px; line-height: 1.4; }
      .manager-settings-back { flex: 0 0 auto; min-height: 36px; padding: 0 12px; border: 0; border-radius: 9px; color: #334155; background: #e2e8f0; font-size: 11px; }
      .manager-settings-status { flex: 0 0 auto; margin: 0; color: #58708a; font-size: 10px; line-height: 1.45; }
      .manager-settings-status.is-error { color: #b91c1c; }
      .manager-settings-highlight-form { display: flex; flex-direction: column; gap: 10px; }
      .manager-settings-view { display: flex; flex-direction: column; gap: 12px; }
      .manager-settings-group { display: flex; flex-direction: column; gap: 9px; }
      .manager-settings-group h3 { margin: 0; color: #1f2937; font-size: 13px; font-weight: 750; }
      .manager-settings-group p { margin: 0; color: #64748b; font-size: 11px; line-height: 1.45; }
      .manager-settings-label { display: flex; flex-direction: column; gap: 5px; color: #475569; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
      .manager-settings-input { min-width: 0; width: 100%; min-height: 34px; box-sizing: border-box; padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #172033; font: 12px system-ui, sans-serif; letter-spacing: normal; text-transform: none; }
      .manager-settings-input:focus { outline: 2px solid #93c5fd; outline-offset: 1px; }
      .manager-settings-color-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .manager-settings-color-picker { min-width: 0; margin: 0; padding: 0; border: 0; }
      .manager-settings-color-picker legend { margin-bottom: 5px; padding: 0; color: #475569; font-size: 10px; font-weight: 700; }
      .manager-settings-color-options { display: grid; grid-template-columns: repeat(5, 22px); gap: 5px; }
      .manager-settings-color-option { display: grid; flex: 0 0 22px; width: 22px; min-width: 22px; height: 22px; min-height: 22px; box-sizing: border-box; place-items: center; padding: 2px; border: 1px solid #cbd5e1; border-radius: 50%; line-height: 0; background: #fff; cursor: pointer; }
      .manager-settings-color-option::before { width: 100%; height: 100%; border: 1px solid #0f172a2e; border-radius: 50%; background: var(--highlight-color); content: ""; }
      .manager-settings-color-option.is-selected { outline: 2px solid #2563eb; outline-offset: 2px; }
      .manager-settings-color-option:focus-visible { outline: 2px solid #0f172a; outline-offset: 3px; }
      .manager-settings-preview { min-width: 0; padding: 9px 10px; border: 1px solid #dbe4ef; border-radius: 9px; background: #f8fafc; }
      .manager-settings-preview-label { display: block; margin-bottom: 5px; color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
      .manager-settings-preview-sample { margin: 0; color: #334155; font-size: 12px; line-height: 1.65; }
      .manager-settings-preview-mark { padding: 2px 4px; border-radius: 3px; }
      .manager-settings-actions, .manager-settings-rule-actions { display: flex; flex-wrap: wrap; gap: 6px; }
      .manager-settings-actions button, .manager-settings-rule-actions button { min-height: 34px; padding: 0 10px; font-size: 11px; }
      .manager-settings-save { width: 100%; min-height: 38px !important; color: #fff; background: #00a884; }
      .manager-settings-save:hover:not(:disabled) { background: #008f70; }
      .manager-settings-suggest { width: 100%; min-height: 34px; margin: 0 0 10px; padding: 0 10px; border: 1px dashed #00a884; border-radius: 8px; color: #00795f; background: #f0fdf9; font: 700 11px/1 system-ui, sans-serif; cursor: pointer; }
      .manager-settings-suggest:hover:not(:disabled) { background: #dcfce7; }
      .manager-settings-suggest:disabled { opacity: .6; cursor: wait; }
      .manager-settings-delete { border: 1px solid #fecaca; color: #b91c1c; background: #fff; }
      .manager-settings-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
      .manager-settings-rule { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 9px; border: 1px solid #dbe4ef; border-radius: 8px; background: #fff; }
      .manager-settings-rule-value { min-width: 0; overflow-wrap: anywhere; padding: 2px 4px; border-radius: 3px; color: #111827; background: #fef08a; font-size: 11px; }
      .manager-settings-rule-edit { min-height: 26px !important; padding: 0 2px !important; color: #475569; background: transparent; font-size: 10px !important; font-weight: 600 !important; }
      .manager-settings-empty { padding: 9px; border: 1px dashed #cbd5e1; border-radius: 8px; color: #64748b; font-size: 11px; text-align: center; }
      .panel-header { flex: 0 0 auto; padding-bottom: 15px; border-bottom: 1px solid #e2e8f0; }
      h2 { margin: 0; color: #111827; font-size: 17px; font-weight: 750; letter-spacing: -.02em; }
      .status { position: relative; margin: 7px 0 0; color: #64748b; }
      .status.is-loading { display: flex; align-items: flex-start; gap: 8px; }
      .status.is-loading::before { content: ''; flex: 0 0 8px; width: 8px; height: 8px; margin-top: 5px; border-radius: 50%; background: #4f7cff; box-shadow: 0 0 0 4px #4f7cff18; animation: qts-status-pulse 1.4s ease-in-out infinite; }
      @keyframes qts-status-pulse { 50% { opacity: .45; box-shadow: 0 0 0 7px #4f7cff0a; } }
      .details { flex: 0 1 auto; max-height: 34vh; overflow: auto; margin: 0; padding: 0 0 12px; }
      .details[hidden] { display: none; }
      .details div { margin-top: 9px; overflow-wrap: anywhere; }
      .details dt { color: #718096; font-size: 10px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
      .details dd { margin: 2px 0 0; color: #273449; white-space: pre-wrap; overflow-wrap: anywhere; }
      .description { max-height: 130px; overflow: auto; padding: 10px; border: 1px solid #e5eaf2; border-radius: 10px; background: #f7f9fc; }
      .account-heading { display: flex; flex: 0 0 auto; justify-content: space-between; gap: 8px; padding: 13px 0 8px; color: #48566d; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      .account-count { display: inline-flex; min-width: 22px; height: 22px; align-items: center; justify-content: center; margin-top: -4px; border: 1px solid #dbe4f0; border-radius: 999px; background: #fff; color: #334155; font-size: 11px; letter-spacing: 0; }
      .profiles { flex: 1 1 auto; min-height: 100px; overflow: auto; margin: 0 0 8px; border-top: 1px solid #e2e8f0; scrollbar-color: #b8c4d6 transparent; scrollbar-width: thin; }
      .profile { display: flex; justify-content: space-between; gap: 12px; align-items: center; min-height: 58px; padding: 10px 3px; border-bottom: 1px solid #edf1f6; cursor: pointer; transition: background .16s ease, padding .16s ease; }
      .profile:hover { padding-right: 7px; padding-left: 7px; background: #f1f5ff; }
      .profile.unavailable, .profile.inactive { cursor: default; opacity: .68; }
      .profile input { flex: 0 0 auto; width: 18px; height: 18px; margin: 0 2px 0 0; accent-color: #4f6ef7; }
      .profile-name { min-width: 0; overflow-wrap: anywhere; color: #253149; font-weight: 700; }
      .profile small { display: block; margin-top: 3px; color: #8290a5; font-size: 11px; font-weight: 450; }
      .profile .saved { color: #15803d; }
      .profile .failed { color: #b91c1c; }
      .profiles-empty { padding: 14px 4px; color: #718096; font-size: 12px; }
      .profile-skeleton { height: 48px; margin: 8px 2px; border-radius: 9px; background: linear-gradient(90deg, #edf1f7 25%, #f7f9fc 40%, #edf1f7 65%); background-size: 300% 100%; animation: qts-skeleton 1.4s ease infinite; }
      @keyframes qts-skeleton { to { background-position: -150% 0; } }
      .message { flex: 0 0 auto; min-height: 18px; margin: 0 0 8px; color: #b91c1c; }
      .actions { display: flex; flex: 0 0 auto; gap: 8px; }
      button { min-height: 40px; padding: 0 15px; border: 0; border-radius: 10px; font: 700 12px system-ui, sans-serif; cursor: pointer; transition: transform .16s ease, background .16s ease, box-shadow .16s ease; }
      button:hover:not(:disabled) { transform: translateY(-1px); }
      button:disabled { opacity: .6; cursor: wait; }
      button[hidden] { display: none; }
      .save { flex: 1; color: #fff; background: linear-gradient(135deg, #4f6ef7, #6554d9); box-shadow: 0 5px 14px #4f6ef72e; }
      .save:hover:not(:disabled) { background: linear-gradient(135deg, #405fe8, #5745c7); box-shadow: 0 7px 18px #4f6ef744; }
      .cancel { border: 1px solid #dbe3ef; color: #475569; background: #fff; }
      .cancel:hover:not(:disabled) { background: #f1f5f9; }
      @media (max-width: 520px) {
        .panel { padding: 16px 14px 14px; border-radius: 14px 0 0 14px; }
        .details { max-height: 28vh; }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel, .profile, button, .status.is-loading::before, .profile-skeleton { transition: none; animation: none; }
      }
`;
    root.appendChild(style);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.hidden = true;
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Review job and candidate matches');
    const brandHeader = document.createElement('header');
    brandHeader.className = 'manager-brand-header';
    brandHeader.innerHTML = `
      <img class="manager-brand-logo" alt="WYS">
      <div class="manager-brand-center" aria-label="Quality, Time, Speed">
        <div class="manager-brand-pill-row">
          <span class="manager-brand-pill manager-brand-pill--quality">Q<span>uality</span></span>
          <span class="manager-brand-plus" aria-hidden="true">+</span>
          <span class="manager-brand-pill manager-brand-pill--time">T<span>ime</span></span>
          <span class="manager-brand-plus" aria-hidden="true">+</span>
          <span class="manager-brand-pill manager-brand-pill--speed">S<span>peed</span></span>
        </div>
        <span class="manager-brand-subline">Built for precision bidding</span>
      </div>
      <span class="manager-brand-connected">Connected</span>`;
    brandHeader.querySelector('img').src = chrome.runtime.getURL('assets/account-logo.png');
    const heading = document.createElement('h2');
    heading.textContent = 'QTS Candidate Accounts';
    const status = document.createElement('p');
    status.className = 'status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const details = document.createElement('dl');
    details.className = 'details';
    details.hidden = true;
    const accountHeading = document.createElement('div');
    accountHeading.className = 'account-heading';
    const accountLabel = document.createElement('span');
    accountLabel.textContent = 'Accounts';
    const accountCount = document.createElement('span');
    accountCount.className = 'account-count';
    accountHeading.append(accountLabel, accountCount);
    const profiles = document.createElement('div');
    profiles.className = 'profiles';
    profiles.setAttribute('aria-busy', 'true');
    const message = document.createElement('p');
    message.className = 'message';
    message.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'actions';
    const save = document.createElement('button');
    save.className = 'save';
    save.type = 'button';
    save.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.className = 'cancel';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    actions.append(save, cancel);
    const panelHeader = document.createElement('div');
    panelHeader.className = 'panel-header';
    panelHeader.append(heading, status);
    const panelContent = document.createElement('div');
    panelContent.className = 'manager-panel-content';
    panelContent.append(panelHeader, details, accountHeading, profiles, message, actions);
    const managerSettings = buildManagerSettingsView();
    panel.append(brandHeader, panelContent, managerSettings.root);
    root.appendChild(panel);
    host.__qtsElements = {
      panel, panelContent, managerSettings,
      heading, status, details, accountCount, profiles, message, save, cancel,
    };
    (document.documentElement || document.body).appendChild(host);
    return root;
  }

  function setPanelVisible(visible) {
    const shouldShow =
      signedIn && (
        managerSettingsOpen
        || (visible && profilesLoaded && extensionStatus === 'get_jd')
      );
    const panel = host?.__qtsElements?.panel;
    if (panel) {
      clearTimeout(panelHideTimer);
      if (shouldShow) {
        const wasHidden = panel.hidden;
        panel.hidden = false;
        panel.inert = false;
        panel.setAttribute('aria-hidden', 'false');
        if (wasHidden) requestAnimationFrame(() => panel.classList.add('is-visible'));
        else panel.classList.add('is-visible');
      } else {
        panel.classList.remove('is-visible');
        panel.inert = true;
        panel.setAttribute('aria-hidden', 'true');
        panelHideTimer = setTimeout(() => {
          if (!panel.classList.contains('is-visible')) panel.hidden = true;
        }, 300);
      }
    }
    if (shouldShow) {
      document.documentElement?.setAttribute('data-qts-get-jd-docked', 'true');
    } else {
      document.documentElement?.removeAttribute('data-qts-get-jd-docked');
    }
  }

  function buildManagerSettingsView() {
    const section = document.createElement('section');
    section.className = 'manager-settings';
    section.hidden = true;
    section.innerHTML = `
      <div class="manager-settings-card">
        <header class="manager-settings-header">
          <h2 data-settings-title>Manager settings</h2>
          <button type="button" class="manager-settings-back" data-settings-back>Back</button>
        </header>
        <p class="manager-settings-hint" data-settings-hint></p>
        <p class="manager-settings-status" data-settings-status role="status" aria-live="polite"></p>
        <div class="manager-settings-view" data-settings-view="text-highlights" hidden>
          <form class="manager-settings-highlight-form" data-highlight-form>
            <label class="manager-settings-label" for="qts-manager-highlight-text">Text or characters</label>
            <input class="manager-settings-input" id="qts-manager-highlight-text" name="text" maxlength="500" required>
            <div class="manager-settings-color-row">
              <div data-highlight-text-color></div>
              <div data-highlight-background-color></div>
            </div>
            <div class="manager-settings-preview">
              <span class="manager-settings-preview-label">Live preview</span>
              <p class="manager-settings-preview-sample" data-highlight-preview>
                Example: <mark class="manager-settings-preview-mark" data-highlight-preview-mark>Your text</mark>
              </p>
            </div>
            <div class="manager-settings-actions">
              <button type="submit" class="manager-settings-save" data-highlight-save>Add rule</button>
              <button type="button" class="manager-settings-delete" data-highlight-delete hidden>Delete rule</button>
              <button type="button" data-highlight-cancel hidden>Cancel edit</button>
            </div>
          </form>
          <ul class="manager-settings-list" data-highlight-list></ul>
        </div>
        <div class="manager-settings-view" data-settings-view="page-exclusions" hidden>
          <section class="manager-settings-group" data-page-exclusions-group hidden>
            <h3>Job-page detection keywords</h3>
            <p>A page is treated as a job page when two saved keywords appear in its visible text as whole words (plurals count). Pages without them can still pass on other job signals, such as an Apply button or job-posting sections.</p>
            <button type="button" class="manager-settings-suggest" data-exclusion-suggest>Add suggested keywords</button>
            <form data-exclusion-form>
              <label class="manager-settings-label" for="qts-manager-exclusion-url">Keyword or phrase</label>
              <input class="manager-settings-input" id="qts-manager-exclusion-url" name="url" type="text" maxlength="200" placeholder="preferred qualifications" autocomplete="off" required>
              <div class="manager-settings-actions">
                <button type="submit" class="manager-settings-save" data-exclusion-save>Add keyword</button>
                <button type="button" data-exclusion-cancel hidden>Cancel edit</button>
              </div>
            </form>
            <ul class="manager-settings-list" data-exclusion-list></ul>
          </section>
          <section class="manager-settings-group" data-job-detection-group hidden>
            <h3>Blocked URL rules</h3>
            <p>QTS controls and workflows do not run when the current URL contains any saved fragment.</p>
            <form data-job-detection-form>
              <label class="manager-settings-label" for="qts-manager-job-url">URL fragment</label>
              <input class="manager-settings-input" id="qts-manager-job-url" name="url" type="text" placeholder="example.com/private" required>
              <div class="manager-settings-actions">
                <button type="submit" class="manager-settings-save" data-job-detection-save>Add blocked URL</button>
                <button type="button" data-job-detection-cancel hidden>Cancel edit</button>
              </div>
            </form>
            <ul class="manager-settings-list" data-job-detection-list></ul>
          </section>
        </div>
      </div>`;
    const textColorPicker = createManagerColorPicker('Text color', '#111827', 'textColor');
    const backgroundColorPicker = createManagerColorPicker('Background color', '#fef08a', 'backgroundColor');
    section.querySelector('[data-highlight-text-color]').replaceWith(textColorPicker.wrapper);
    section.querySelector('[data-highlight-background-color]').replaceWith(backgroundColorPicker.wrapper);
    const refs = {
      root: section,
      card: section.querySelector('.manager-settings-card'),
      title: section.querySelector('[data-settings-title]'),
      hint: section.querySelector('[data-settings-hint]'),
      status: section.querySelector('[data-settings-status]'),
      highlightView: section.querySelector('[data-settings-view="text-highlights"]'),
      pageView: section.querySelector('[data-settings-view="page-exclusions"]'),
      highlightForm: section.querySelector('[data-highlight-form]'),
      highlightText: section.querySelector('#qts-manager-highlight-text'),
      textColorInput: textColorPicker.input,
      textColorPicker,
      backgroundColorInput: backgroundColorPicker.input,
      backgroundColorPicker,
      preview: section.querySelector('[data-highlight-preview]'),
      previewMark: section.querySelector('[data-highlight-preview-mark]'),
      highlightList: section.querySelector('[data-highlight-list]'),
      highlightCancel: section.querySelector('[data-highlight-cancel]'),
      highlightSave: section.querySelector('[data-highlight-save]'),
      highlightDelete: section.querySelector('[data-highlight-delete]'),
      exclusionGroup: section.querySelector('[data-page-exclusions-group]'),
      exclusionForm: section.querySelector('[data-exclusion-form]'),
      exclusionList: section.querySelector('[data-exclusion-list]'),
      exclusionCancel: section.querySelector('[data-exclusion-cancel]'),
      exclusionSave: section.querySelector('[data-exclusion-save]'),
      exclusionSuggest: section.querySelector('[data-exclusion-suggest]'),
      jobDetectionGroup: section.querySelector('[data-job-detection-group]'),
      jobDetectionForm: section.querySelector('[data-job-detection-form]'),
      jobDetectionList: section.querySelector('[data-job-detection-list]'),
      jobDetectionCancel: section.querySelector('[data-job-detection-cancel]'),
      jobDetectionSave: section.querySelector('[data-job-detection-save]'),
    };
    section.querySelector('[data-settings-back]').addEventListener('click', closeManagerSettings);
    refs.highlightForm.addEventListener('submit', saveHighlightRule);
    refs.highlightForm.addEventListener('input', updateManagerHighlightPreview);
    refs.highlightCancel.addEventListener('click', () => resetSettingsForm('text-highlights'));
    refs.highlightDelete.addEventListener('click', deleteSelectedHighlightRule);
    refs.exclusionForm.addEventListener('submit', savePageExclusion);
    refs.exclusionSuggest.addEventListener('click', addSuggestedPageExclusions);
    refs.exclusionCancel.addEventListener('click', () => resetSettingsForm('page-exclusions'));
    refs.jobDetectionForm.addEventListener('submit', saveJobDetectionRule);
    refs.jobDetectionCancel.addEventListener('click', () => resetSettingsForm('job-detection'));
    return refs;
  }

  function createManagerColorPicker(label, initialColor, inputName) {
    const wrapper = document.createElement('fieldset');
    wrapper.className = 'manager-settings-color-picker';
    const legend = document.createElement('legend');
    legend.textContent = label;
    const options = document.createElement('div');
    options.className = 'manager-settings-color-options';
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-label', label);
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = inputName;
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

    const colors = [...highlightColorPalette];
    if (!colors.some((color) => color.value.toLowerCase() === initialColor.toLowerCase())) {
      colors.unshift({ name: 'Current color', value: initialColor });
    }
    colors.forEach((color, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'manager-settings-color-option';
      button.dataset.color = color.value;
      button.style.setProperty('--highlight-color', color.value);
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', `${label}: ${color.name} (${color.value})`);
      button.setAttribute('aria-checked', String(index === 0));
      button.tabIndex = index === 0 ? 0 : -1;
      button.title = `${color.name} (${color.value})`;
      button.classList.toggle('is-selected', index === 0);
      button.addEventListener('click', () => selectColor(button));
      button.addEventListener('keydown', (event) => {
        const currentIndex = buttons.indexOf(button);
        let nextIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = buttons.length - 1;
        else return;
        event.preventDefault();
        selectColor(buttons[nextIndex], true);
      });
      buttons.push(button);
      options.appendChild(button);
    });
    input.value = initialColor;
    wrapper.append(legend, options, input);

    function setValue(value) {
      let button = buttons.find((candidate) => candidate.dataset.color.toLowerCase() === value.toLowerCase());
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'manager-settings-color-option';
        button.dataset.color = value;
        button.style.setProperty('--highlight-color', value);
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-label', `${label}: saved color (${value})`);
        button.title = `Saved color (${value})`;
        button.addEventListener('click', () => selectColor(button));
        button.addEventListener('keydown', (event) => {
          const currentIndex = buttons.indexOf(button);
          let nextIndex;
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = buttons.length - 1;
          else return;
          event.preventDefault();
          selectColor(buttons[nextIndex], true);
        });
        buttons.unshift(button);
        options.prepend(button);
      }
      selectColor(button);
    }
    setValue(initialColor);
    return { wrapper, input, setValue };
  }

  function closeManagerSettings() {
    managerSettingsOpen = false;
    const elements = host?.__qtsElements;
    if (elements) {
      elements.panel.classList.remove('is-manager-settings');
      elements.panelContent.hidden = false;
      elements.managerSettings.root.hidden = true;
    }
    renderCurrentResult();
  }

  // options.prefillBlockedUrl fills the blocked-URL field for the Manager to review and save.
  async function openManagerSettings(panel, tabId, permissions = {}, options = {}) {
    if (
      !['text-highlights', 'page-exclusions'].includes(panel)
      || !Number.isInteger(tabId)
    ) {
      throw new Error('Choose a valid Manager settings panel and page.');
    }
    const stored = await chrome.storage.local.get(['authExpiresAt']);
    if (!sessionIsValid(stored)) {
      throw new Error('Sign in as a Manager before opening settings.');
    }
    ensureRoot();
    signedIn = true;
    const elements = host.__qtsElements;
    const settings = elements.managerSettings;
    managerSettingsPermissions = {
      canManageTextHighlights: permissions.canManageTextHighlights === true,
      canManagePageExclusions: permissions.canManagePageExclusions === true,
      canManageJobDetectionUrlRules: permissions.canManageJobDetectionUrlRules === true,
    };
    if (
      (panel === 'text-highlights' && !managerSettingsPermissions.canManageTextHighlights)
      || (panel === 'page-exclusions'
        && !managerSettingsPermissions.canManagePageExclusions
        && !managerSettingsPermissions.canManageJobDetectionUrlRules)
    ) {
      throw new Error('Ask your Super Admin for access to these settings.');
    }
    managerSettingsOpen = true;
    elements.panelContent.hidden = true;
    settings.root.hidden = false;
    elements.panel.classList.add('is-manager-settings');
    settings.title.textContent = panel === 'text-highlights'
      ? 'Text highlights on all websites'
      : 'URL Settings';
    settings.hint.textContent = panel === 'text-highlights'
      ? 'Rules are shared from the database and automatically highlighted across supported HTTP and HTTPS websites. Select a saved phrase below to edit it in the shared editor. Only Managers assigned by Super can change them.'
      : 'Manage the URL rules assigned to this Manager account.';
    settings.status.textContent = 'Loading settings…';
    settings.status.classList.remove('is-error');
    settings.highlightView.hidden = panel !== 'text-highlights';
    settings.pageView.hidden = panel !== 'page-exclusions';
    if (panel === 'text-highlights') {
      settings.highlightView.insertBefore(settings.status, settings.highlightList);
    } else {
      settings.pageView.appendChild(settings.status);
    }
    settings.exclusionGroup.hidden = !managerSettingsPermissions.canManagePageExclusions;
    settings.jobDetectionGroup.hidden = !managerSettingsPermissions.canManageJobDetectionUrlRules;
    setPanelVisible(true);
    try {
      if (panel === 'text-highlights') await loadHighlightRules();
      else await loadUrlSettings();
      if (panel === 'page-exclusions') settings.status.textContent = '';
      const blockedUrlInput = settings.root.querySelector('#qts-manager-job-url');
      if (
        panel === 'page-exclusions'
        && typeof options.prefillBlockedUrl === 'string'
        && options.prefillBlockedUrl
        && managerSettingsPermissions.canManageJobDetectionUrlRules
        && blockedUrlInput
      ) {
        blockedUrlInput.value = options.prefillBlockedUrl;
        blockedUrlInput.focus();
        settings.status.textContent = 'Check the suggested URL fragment, then click Add blocked URL.';
      }
    } catch (error) {
      settings.status.textContent = error?.message || 'Could not load Manager settings.';
      settings.status.classList.add('is-error');
    }
  }

  async function sendSettingsMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.ok === false || response.success === false) {
      throw new Error(response?.error || response?.message || 'Could not save Manager settings.');
    }
    return response;
  }

  async function loadHighlightRules() {
    const response = await sendSettingsMessage({ type: 'GET_GLOBAL_TEXT_HIGHLIGHTS' });
    if (!Array.isArray(response.rules)) throw new Error('The saved highlight rules could not be read.');
    highlightRules = response.rules;
    renderHighlightRules();
    setSettingsStatus(`${highlightRules.length} shared rule(s) loaded from the database.`, false);
  }

  function renderHighlightRules() {
    const { highlightList } = host.__qtsElements.managerSettings;
    highlightList.replaceChildren();
    if (!highlightRules.length) {
      const empty = document.createElement('li');
      empty.className = 'manager-settings-empty';
      empty.textContent = 'No shared phrases have been added.';
      highlightList.appendChild(empty);
      return;
    }
    for (const rule of highlightRules) {
      const item = document.createElement('li');
      item.className = 'manager-settings-rule';
      const value = document.createElement('span');
      value.className = 'manager-settings-rule-value';
      value.textContent = rule.text;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'manager-settings-rule-edit';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => {
        selectedHighlightRuleId = rule.id;
        const settings = host.__qtsElements.managerSettings;
        settings.highlightText.value = rule.text;
        settings.textColorPicker.setValue(rule.textColor);
        settings.backgroundColorPicker.setValue(rule.backgroundColor);
        settings.highlightSave.textContent = 'Save changes';
        settings.highlightDelete.hidden = false;
        settings.highlightCancel.hidden = false;
        updateManagerHighlightPreview();
        settings.highlightText.focus();
      });
      value.style.color = rule.textColor;
      value.style.backgroundColor = rule.backgroundColor;
      item.append(value, edit);
      highlightList.appendChild(item);
    }
  }

  async function saveHighlightRule(event) {
    event.preventDefault();
    const settings = host.__qtsElements.managerSettings;
    const rule = {
      text: settings.highlightText.value.trim(),
      textColor: settings.textColorInput.value,
      backgroundColor: settings.backgroundColorInput.value,
    };
    if (!rule.text) {
      setSettingsStatus('Enter a phrase to highlight.', true);
      return;
    }
    const save = settings.highlightSave;
    const isUpdate = Boolean(selectedHighlightRuleId);
    save.disabled = true;
    try {
      const response = await sendSettingsMessage({
        type: 'MANAGE_GLOBAL_TEXT_HIGHLIGHT',
        action: isUpdate ? 'update' : 'create',
        ruleId: selectedHighlightRuleId,
        rule,
      });
      highlightRules = response.rules;
      renderHighlightRules();
      resetSettingsForm('text-highlights');
      setSettingsStatus(`${highlightRules.length} shared rule(s) loaded from the database.`, false);
    } catch (error) {
      setSettingsStatus(error.message, true);
    } finally {
      save.disabled = false;
    }
  }

  async function deleteSelectedHighlightRule() {
    if (!selectedHighlightRuleId) return;
    const settings = host.__qtsElements.managerSettings;
    settings.highlightDelete.disabled = true;
    try {
      const response = await sendSettingsMessage({
        type: 'MANAGE_GLOBAL_TEXT_HIGHLIGHT',
        action: 'delete',
        ruleId: selectedHighlightRuleId,
      });
      highlightRules = response.rules;
      renderHighlightRules();
      resetSettingsForm('text-highlights');
      setSettingsStatus(`${highlightRules.length} shared rule(s) loaded from the database.`, false);
    } catch (error) {
      setSettingsStatus(error.message, true);
    } finally {
      settings.highlightDelete.disabled = false;
    }
  }

  function updateManagerHighlightPreview() {
    const settings = host?.__qtsElements?.managerSettings;
    if (!settings) return;
    const phrase = settings.highlightText.value.trim() || 'Your text';
    settings.previewMark.textContent = phrase;
    settings.previewMark.classList.toggle('is-placeholder', !settings.highlightText.value.trim());
    settings.previewMark.style.color = settings.textColorInput.value;
    settings.previewMark.style.backgroundColor = settings.backgroundColorInput.value;
    settings.preview.setAttribute('aria-label', `Live preview: Example: ${phrase}`);
  }

  async function loadUrlSettings() {
    const requests = [];
    if (managerSettingsPermissions.canManagePageExclusions) {
      requests.push(
        sendSettingsMessage({ type: 'GET_MANAGER_PAGE_EXCLUSIONS' })
          .then((response) => { pageExclusionRules = response.exclusions || []; }),
      );
    }
    if (managerSettingsPermissions.canManageJobDetectionUrlRules) {
      requests.push(
        sendSettingsMessage({ type: 'GET_MANAGER_JOB_DETECTION_URL_RULES' })
          .then((response) => { jobDetectionRules = response.rules || []; }),
      );
    }
    await Promise.all(requests);
    renderUrlSettings();
  }

  function appendUrlRule(list, rule, edit, remove) {
    const item = document.createElement('li');
    item.className = 'manager-settings-rule';
    const value = document.createElement('span');
    value.className = 'manager-settings-rule-value';
    value.textContent = rule.url;
    const actions = document.createElement('span');
    actions.className = 'manager-settings-rule-actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => edit(rule));
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', async () => {
      deleteButton.disabled = true;
      try {
        await remove(rule);
        setSettingsStatus('URL setting deleted.', false);
      } catch (error) {
        setSettingsStatus(error.message, true);
        deleteButton.disabled = false;
      }
    });
    actions.append(editButton, deleteButton);
    item.append(value, actions);
    list.appendChild(item);
  }

  function renderUrlSettings() {
    const settings = host.__qtsElements.managerSettings;
    settings.exclusionList.replaceChildren();
    if (managerSettingsPermissions.canManagePageExclusions) {
      if (!pageExclusionRules.length) {
        const empty = document.createElement('li');
        empty.className = 'manager-settings-empty';
        empty.textContent = 'No job-page detection keywords.';
        settings.exclusionList.appendChild(empty);
      }
      pageExclusionRules.forEach((rule) => appendUrlRule(
        settings.exclusionList,
        rule,
        (entry) => {
          selectedPageExclusionId = entry.id;
          settings.exclusionForm.elements.namedItem('url').value = entry.url;
          settings.exclusionSave.textContent = 'Update keyword';
          settings.exclusionCancel.hidden = false;
          settings.exclusionForm.elements.namedItem('url').focus();
        },
        async (entry) => {
          const response = await sendSettingsMessage({
            type: 'DELETE_MANAGER_PAGE_EXCLUSION',
            exclusionId: entry.id,
          });
          pageExclusionRules = response.exclusions || [];
          if (selectedPageExclusionId === entry.id) resetSettingsForm('page-exclusions');
          renderUrlSettings();
        },
      ));
    }
    settings.jobDetectionList.replaceChildren();
    if (managerSettingsPermissions.canManageJobDetectionUrlRules) {
      if (!jobDetectionRules.length) {
        const empty = document.createElement('li');
        empty.className = 'manager-settings-empty';
        empty.textContent = 'No blocked URLs.';
        settings.jobDetectionList.appendChild(empty);
      }
      jobDetectionRules.forEach((rule) => appendUrlRule(
        settings.jobDetectionList,
        rule,
        (entry) => {
          selectedJobDetectionRuleId = entry.id;
          settings.jobDetectionForm.elements.namedItem('url').value = entry.url;
          settings.jobDetectionSave.textContent = 'Update blocked URL';
          settings.jobDetectionCancel.hidden = false;
          settings.jobDetectionForm.elements.namedItem('url').focus();
        },
        async (entry) => {
          const response = await sendSettingsMessage({
            type: 'DELETE_MANAGER_JOB_DETECTION_URL_RULE',
            ruleId: entry.id,
          });
          jobDetectionRules = response.rules || [];
          if (selectedJobDetectionRuleId === entry.id) resetSettingsForm('job-detection');
          renderUrlSettings();
        },
      ));
    }
  }

  async function savePageExclusion(event) {
    event.preventDefault();
    const settings = host.__qtsElements.managerSettings;
    const save = settings.exclusionSave;
    save.disabled = true;
    try {
      const response = await sendSettingsMessage({
        type: selectedPageExclusionId ? 'UPDATE_MANAGER_PAGE_EXCLUSION' : 'ADD_MANAGER_PAGE_EXCLUSION',
        exclusionId: selectedPageExclusionId,
        url: settings.exclusionForm.elements.namedItem('url').value.trim(),
      });
      pageExclusionRules = response.exclusions || [];
      resetSettingsForm('page-exclusions');
      renderUrlSettings();
      setSettingsStatus('Job-page detection keyword saved.', false);
    } catch (error) {
      setSettingsStatus(error.message, true);
    } finally {
      save.disabled = false;
    }
  }

  // Posting-specific phrases that rarely appear on non-job pages.
  const SUGGESTED_JOB_PAGE_KEYWORDS = [
    'responsibilities', 'requirements', 'qualifications', 'job description', 'about the role',
    "what you'll do", 'apply now', 'years of experience', 'full-time', 'remote', 'salary', 'benefits',
  ];

  async function addSuggestedPageExclusions() {
    const settings = host.__qtsElements.managerSettings;
    const button = settings.exclusionSuggest;
    const existing = new Set(pageExclusionRules.map((rule) => String(rule.url || '').trim().toLowerCase()));
    const missing = SUGGESTED_JOB_PAGE_KEYWORDS.filter((keyword) => !existing.has(keyword));
    if (!missing.length) {
      setSettingsStatus('All suggested keywords are already saved.', false);
      return;
    }
    button.disabled = true;
    let added = 0;
    try {
      for (const keyword of missing) {
        try {
          const response = await sendSettingsMessage({ type: 'ADD_MANAGER_PAGE_EXCLUSION', url: keyword });
          pageExclusionRules = response.exclusions || pageExclusionRules;
          added += 1;
        } catch (error) {
          // A keyword saved meanwhile (another tab) is fine to skip; anything else stops the run.
          if (!/already exists/i.test(error.message)) throw error;
        }
      }
      setSettingsStatus(`Added ${added} suggested keyword${added === 1 ? '' : 's'}.`, false);
    } catch (error) {
      setSettingsStatus(added ? `Added ${added}, then stopped: ${error.message}` : error.message, true);
    } finally {
      renderUrlSettings();
      button.disabled = false;
    }
  }

  async function saveJobDetectionRule(event) {
    event.preventDefault();
    const settings = host.__qtsElements.managerSettings;
    const save = settings.jobDetectionSave;
    save.disabled = true;
    try {
      const response = await sendSettingsMessage({
        type: selectedJobDetectionRuleId
          ? 'UPDATE_MANAGER_JOB_DETECTION_URL_RULE'
          : 'ADD_MANAGER_JOB_DETECTION_URL_RULE',
        ruleId: selectedJobDetectionRuleId,
        url: settings.jobDetectionForm.elements.namedItem('url').value.trim(),
      });
      jobDetectionRules = response.rules || [];
      resetSettingsForm('job-detection');
      renderUrlSettings();
      setSettingsStatus('Blocked URL rule saved.', false);
    } catch (error) {
      setSettingsStatus(error.message, true);
    } finally {
      save.disabled = false;
    }
  }

  function resetSettingsForm(type) {
    const settings = host?.__qtsElements?.managerSettings;
    if (!settings) return;
    if (type === 'text-highlights') {
      selectedHighlightRuleId = null;
      settings.highlightForm.reset();
      settings.textColorPicker.setValue('#111827');
      settings.backgroundColorPicker.setValue('#fef08a');
      settings.highlightSave.textContent = 'Save phrase';
      settings.highlightDelete.hidden = true;
      settings.highlightCancel.hidden = true;
      updateManagerHighlightPreview();
    } else if (type === 'page-exclusions') {
      selectedPageExclusionId = null;
      settings.exclusionForm.reset();
      settings.exclusionSave.textContent = 'Add keyword';
      settings.exclusionCancel.hidden = true;
    } else {
      selectedJobDetectionRuleId = null;
      settings.jobDetectionForm.reset();
      settings.jobDetectionSave.textContent = 'Add blocked URL';
      settings.jobDetectionCancel.hidden = true;
    }
  }

  function setSettingsStatus(message, isError) {
    const status = host?.__qtsElements?.managerSettings?.status;
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  // Matches the server's toastMessage wording for results that arrive without one.
  function jobPresenceMessage(result) {
    if (result.inBids) return 'Already applied — this job is in your Bids.';
    if (result.inJobs) return 'Already added — this job is in your Jobs list.';
    return 'New job — not in your Jobs or Bids yet.';
  }

  function saveResultToast(response) {
    const saved = Number(response.savedCount) || 0;
    const removed = Number(response.removedCount) || 0;
    const failed = Number(response.failedCount) || 0;
    const candidates = (count) => `${count} candidate${count === 1 ? '' : 's'}`;
    const changes = [
      saved ? `added ${candidates(saved)}` : '',
      removed ? `removed ${candidates(removed)}` : '',
    ].filter(Boolean).join(' and ');
    if (failed && changes) {
      return { type: 'warn', message: `Jobs updated: ${changes}; ${candidates(failed)} could not be changed. Review and retry.` };
    }
    if (failed) return { type: 'error', message: 'No candidates could be changed. Review the list and retry.' };
    if (changes) return { type: 'success', message: `Jobs updated: ${changes}.` };
    return { type: 'info', message: 'The selected candidates already have this job.' };
  }

  function showToast(message, type, key) {
    if (key && key === lastToastKey) return;
    if (key) lastToastKey = key;
    // All toasts on the page share one stack (content/page-toast.js).
    globalThis.__qtsPageToast?.show(message, { type, key });
  }

  function appendDetail(container, label, value, extraClass = '') {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || 'Not available';
    if (extraClass) description.className = extraClass;
    wrapper.append(term, description);
    container.appendChild(wrapper);
  }

  // A checkbox means "this account has this job". Mirrors the server's account states;
  // older stored results fall back to duplicateKind.
  function profileState(profile) {
    if (profile?.state) return profile.state;
    if (profile?.autoSaved) return 'has_job';
    if (profile?.duplicateKind === 'applied') return 'applied';
    if (profile?.duplicateKind === 'job_list') return 'has_job';
    return 'available';
  }

  // Applied accounts and running Generation stay checked and cannot be unchecked.
  function isLockedProfile(profile) {
    const state = profileState(profile);
    return state === 'applied' || state === 'generation_running';
  }

  // A candidate who works at this company now stays unchecked and cannot be ticked.
  function worksHere(profile) {
    return profileState(profile) === 'works_here';
  }

  // Neither kind can be changed by clicking.
  function isFixedProfile(profile) {
    return isLockedProfile(profile) || worksHere(profile);
  }

  const PROFILE_STATE_LABELS = {
    applied: 'Applied (in Bids)',
    generation_running: 'Generation running',
    has_job: 'Has this job · uncheck to remove',
    works_here: 'Works at this company now · not saved',
    available: '',
  };

  function readSelectedIds() {
    return Array.from(
      root.querySelectorAll('input[data-profile-id]:checked'),
      (input) => input.dataset.profileId,
    ).filter(Boolean);
  }

  async function sendSelection() {
    if (currentResult?.status !== 'complete' || selectionUpdateInProgress) return;
    const previousSelectedProfileIds = currentResult.selectedProfileIds || [];
    const elements = host.__qtsElements;
    currentResult = {
      ...currentResult,
      selectedProfileIds: readSelectedIds(),
      selectionModified: true,
    };
    selectionUpdateInProgress = true;
    elements.save.disabled = true;
    elements.cancel.disabled = true;
    root.querySelectorAll('input[data-profile-id]').forEach((input) => {
      input.disabled = true;
    });

    let errorMessage = '';
    let refreshReview = false;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_GET_JD_SELECTION',
        profileIds: currentResult.selectedProfileIds,
      });
      if (!response?.ok) {
        currentResult = response.result || {
          ...currentResult,
          selectedProfileIds: response?.selectedProfileIds || previousSelectedProfileIds,
        };
        errorMessage = response?.error || 'Could not save candidate selection.';
        refreshReview = true;
      } else {
        currentResult = response.result || {
          ...currentResult,
          selectedProfileIds: response.selectedProfileIds || currentResult.selectedProfileIds,
        };
        refreshReview = false;
      }
    } catch (error) {
      currentResult = {
        ...currentResult,
        selectedProfileIds: previousSelectedProfileIds,
      };
      errorMessage = error.message || 'Could not save candidate selection.';
      refreshReview = true;
    } finally {
      selectionUpdateInProgress = false;
    }

    if (refreshReview) {
      renderReview(currentResult);
      if (errorMessage) elements.message.textContent = errorMessage;
    } else {
      const profileById = new Map(
        (currentResult.profiles || []).map((profile) => [profile.id, profile]),
      );
      root.querySelectorAll('input[data-profile-id]').forEach((input) => {
        input.disabled = isFixedProfile(profileById.get(input.dataset.profileId));
      });
      elements.save.disabled = !(currentResult.profiles || []).some((profile) => !isFixedProfile(profile));
      elements.cancel.disabled = false;
    }
  }

  function renderProfiles(profiles, options = {}) {
    const elements = host.__qtsElements;
    const selectable = options.selectable === true;
    const selectionEnabled = options.enabled === true;
    const selectedIds = options.selectedIds || new Set();
    const saveResults = options.saveResults || new Map();
    elements.profiles.replaceChildren();
    elements.profiles.setAttribute('aria-busy', String(!profilesLoaded));
    elements.accountCount.textContent = `${profiles.length}`;
    if (!profiles.length) {
      if (!profilesLoaded) {
        const loading = document.createElement('div');
        loading.className = 'profiles-loading';
        loading.setAttribute('aria-label', 'Loading candidate accounts');
        for (let index = 0; index < 5; index += 1) {
          const skeleton = document.createElement('div');
          skeleton.className = 'profile-skeleton';
          skeleton.setAttribute('aria-hidden', 'true');
          loading.appendChild(skeleton);
        }
        elements.profiles.appendChild(loading);
        return;
      }
      const empty = document.createElement('p');
      empty.className = 'profiles-empty';
      empty.textContent = profileLoadError || (signedIn
        ? 'No active candidate accounts were found for this Manager.'
        : 'Sign in to load candidate accounts.');
      elements.profiles.appendChild(empty);
      return;
    }

    for (const profile of profiles) {
      const label = document.createElement('label');
      label.className = 'profile';
      const details = document.createElement('span');
      details.className = 'profile-name';
      details.textContent = profile.name || 'Candidate';
      const category = document.createElement('small');
      const saveResult = saveResults.get(profile.id) || profile.saveResult;
      const locked = isLockedProfile(profile);
      category.textContent = [
        profile.recommended === true ? 'Recommended' : '',
        profile.category || 'Uncategorized',
        profile.autoSaved === true ? 'Saved automatically' : '',
        profile.autoSaveFailed === true ? 'Auto-save failed · select Save to retry' : '',
        saveResult?.message
          || (worksHere(profile) && profile.worksAt ? `Works at ${profile.worksAt} now · not saved` : '')
          || PROFILE_STATE_LABELS[profileState(profile)] || '',
      ].filter(Boolean).join(' · ');
      if (saveResult?.status === 'saved') category.classList.add('saved');
      if (saveResult?.status === 'failed') category.classList.add('failed');
      details.appendChild(category);

      if (selectable) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.profileId = profile.id;
        checkbox.disabled = !selectionEnabled || locked || worksHere(profile);
        checkbox.checked = locked || (!worksHere(profile) && selectedIds.has(profile.id));
        if (locked || worksHere(profile)) label.classList.add('unavailable');
        else if (checkbox.disabled) label.classList.add('inactive');
        checkbox.addEventListener('change', () => {
          sendSelection().catch((error) => {
            elements.message.textContent = error.message || 'Could not save candidate selection.';
          });
        });
        label.append(details, checkbox);
      } else {
        label.classList.add('inactive');
        label.appendChild(details);
      }
      elements.profiles.appendChild(label);
    }
  }

  function renderIdlePanel(message) {
    const elements = host.__qtsElements;
    elements.heading.textContent = 'QTS Candidate Accounts';
    elements.status.textContent = message || profileLoadError || (
      !profilesLoaded
        ? 'Loading your candidate accounts...'
        : extensionStatus === 'get_jd'
          ? 'Get JD is checking this page. Candidate accounts will be ready to select when the check finishes.'
          : 'Start Get JD on a job page to match and save candidates.'
    );
    elements.status.classList.toggle(
      'is-loading',
      extensionStatus === 'get_jd' && (
        currentResult?.status === 'processing' ||
        !profilesLoaded ||
        /checking|loading/i.test(elements.status.textContent)
      ),
    );
    elements.details.hidden = true;
    elements.details.replaceChildren();
    elements.message.textContent = '';
    elements.save.hidden = true;
    elements.cancel.hidden = true;
    renderProfiles(managerProfiles, { selectable: true });
  }

  function renderReview(result) {
    const elements = host.__qtsElements;
    setPanelVisible(true);
    elements.heading.textContent = 'QTS Candidate Accounts';
    elements.status.textContent = result.summaryText || result.message || 'Select candidates to save this job.';
    elements.status.classList.remove('is-loading');
    elements.details.hidden = false;
    elements.details.replaceChildren();
    appendDetail(elements.details, 'Eligibility reason', result.classification.job.reason);
    appendDetail(elements.details, 'Title', result.classification.job.title);
    appendDetail(elements.details, 'Company', result.classification.job.company);
    appendDetail(elements.details, 'Location', result.classification.job.location);
    appendDetail(elements.details, 'Employment type', result.classification.job.employmentType);
    appendDetail(elements.details, 'Work arrangement', result.classification.job.workplaceType);
    appendDetail(elements.details, 'Salary', result.classification.job.salary);
    appendDetail(elements.details, 'URL', result.classification.job.jobUrl);
    appendDetail(elements.details, 'Job description', result.jobDescription, 'description');
    elements.message.textContent = result.saveError || '';

    // Accounts that have the job start checked; after a change, the stored selection wins
    // (so an unchecked saved account stays unchecked), with locked accounts always checked.
    const selectedIds = new Set([
      ...(Array.isArray(result.selectedProfileIds) ? result.selectedProfileIds : []),
      ...(Array.isArray(result.profiles)
        ? result.profiles
          .filter((profile) => (result.selectionModified === true
            ? isLockedProfile(profile)
            : profileState(profile) !== 'available'))
          .map((profile) => profile.id)
        : []),
      ...(result.selectionModified === true
        ? []
        : [
          ...(Array.isArray(result.classification.matchingProfileIds)
            ? result.classification.matchingProfileIds
            : []),
          ...(result.profiles || [])
            .filter((profile) => profile.recommended === true)
            .map((profile) => profile.id),
        ]),
    ]);
    const resultProfiles = new Map(
      (result.profiles || []).map((profile) => [profile.id, profile]),
    );
    const candidates = managerProfiles.length
      ? managerProfiles.map((profile) => ({
        ...profile,
        ...(resultProfiles.get(profile.id) || {}),
      }))
      : result.profiles || [];
    const saveResults = new Map(
      (result.saveResponse?.results || []).map((profileResult) => [profileResult.profileId, profileResult]),
    );
    renderProfiles(candidates, {
      selectable: true,
      enabled: !selectionUpdateInProgress,
      selectedIds,
      saveResults,
    });

    elements.save.hidden = false;
    elements.save.disabled = !candidates.some((profile) => !isFixedProfile(profile));
    elements.cancel.hidden = false;
    elements.save.textContent = 'Save';
    elements.cancel.disabled = false;
    elements.cancel.textContent = 'Close';
    elements.save.onclick = async () => {
      // The full checked set goes to the worker, which adds new ones and removes unchecked saved ones.
      const ids = readSelectedIds();
      elements.save.disabled = true;
      elements.cancel.disabled = true;
      // Freeze the checkboxes so a click during the save cannot start a second save.
      selectionUpdateInProgress = true;
      root.querySelectorAll('input[data-profile-id]').forEach((input) => { input.disabled = true; });
      elements.save.textContent = 'Saving...';
      elements.message.textContent = 'Saving selected candidates...';
      elements.status.textContent = 'Saving the selected candidates...';
      elements.status.classList.add('is-loading');
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'SAVE_GET_JD_SELECTION',
          profileIds: ids,
        });
        if (!response?.ok) throw new Error(response?.error || 'Could not save selected candidates.');
      } catch (error) {
        elements.message.textContent = error.message || 'Could not save selected candidates.';
        elements.save.disabled = false;
        elements.cancel.disabled = false;
        elements.save.textContent = 'Save';
        elements.status.textContent = result.summaryText || 'Select candidates to save this job.';
        elements.status.classList.remove('is-loading');
        const profileById = new Map(candidates.map((profile) => [profile.id, profile]));
        root.querySelectorAll('input[data-profile-id]').forEach((input) => {
          input.disabled = isFixedProfile(profileById.get(input.dataset.profileId));
        });
      } finally {
        selectionUpdateInProgress = false;
      }
    };
    elements.cancel.onclick = async () => {
      elements.cancel.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'CANCEL_GET_JD_REVIEW' });
        if (!response?.ok) throw new Error(response?.error || 'Could not cancel this review.');
      } catch (error) {
        elements.message.textContent = error.message || 'Could not cancel this review.';
        elements.cancel.disabled = false;
      }
    };
  }

  function renderSaveResult(result) {
    const elements = host.__qtsElements;
    const response = result.saveResponse || {};
    const savedCount = Number(response.savedCount || 0);
    const removedCount = Number(response.removedCount || 0);
    const duplicateCount = Number(response.duplicateCount || 0);
    const failedCount = Number(response.failedCount || 0);
    const candidates = (count) => `${count} candidate${count === 1 ? '' : 's'}`;
    setPanelVisible(true);
    elements.heading.textContent = 'Save result';
    elements.status.textContent = [
      savedCount ? `Added ${candidates(savedCount)}` : '',
      removedCount ? `Removed ${candidates(removedCount)}` : '',
    ].filter(Boolean).join(' · ') || 'Nothing changed.';
    elements.status.classList.remove('is-loading');
    elements.details.hidden = false;
    elements.details.replaceChildren();
    appendDetail(elements.details, 'Job', result.classification?.job?.title || 'Job');
    const responseByProfile = new Map(
      (response.results || []).map((profileResult) => [profileResult.profileId, profileResult]),
    );
    renderProfiles((result.profiles || managerProfiles).map((profile) => ({
      ...profile,
      saveResult: responseByProfile.get(profile.id) || null,
    })));
    elements.message.textContent = failedCount > 0
      ? `${failedCount} candidate${failedCount === 1 ? '' : 's'} could not be saved.`
      : duplicateCount > 0
        ? `${duplicateCount} candidate${duplicateCount === 1 ? '' : 's'} already had this job.`
        : '';
    elements.save.hidden = true;
    elements.cancel.hidden = false;
    elements.cancel.disabled = false;
    elements.cancel.textContent = 'Done';
    elements.cancel.setAttribute('aria-label', 'Return to candidate accounts');
    elements.cancel.onclick = () => {
      currentResult = null;
      renderCurrentResult();
    };
  }

  function sessionIsValid(stored) {
    // The service worker publishes only the session expiry; the token never reaches content scripts.
    return (Number(stored.authExpiresAt) || 0) > Date.now();
  }

  function renderCurrentResult() {
    if (!signedIn || extensionStatus !== 'get_jd') {
      setPanelVisible(false);
      return;
    }
    if (!currentResult) {
      setPanelVisible(false);
      return;
    }
    setPanelVisible(true);
    if (
      currentResult?.status === 'complete' &&
      currentResult.classification?.isJobPage === true &&
      currentResult.classification?.isRemote === true
    ) {
      renderReview(currentResult);
      return;
    }
    if (currentResult?.status === 'saved') {
      renderSaveResult(currentResult);
      return;
    }
    if (currentResult?.status === 'processing') {
      renderIdlePanel(currentResult.message);
      return;
    }
    if (currentResult?.status === 'error' || currentResult?.status === 'duplicate') {
      renderIdlePanel(currentResult.message || 'Get JD could not review this page.');
      return;
    }
    renderIdlePanel();
  }

  async function loadManagerSession() {
    const stored = await chrome.storage.local.get(['authExpiresAt']);
    if (!sessionIsValid(stored)) {
      signedIn = false;
      managerSettingsOpen = false;
      if (host?.__qtsElements?.managerSettings) {
        host.__qtsElements.managerSettings.root.hidden = true;
        host.__qtsElements.panelContent.hidden = false;
        host.__qtsElements.panel.classList.remove('is-manager-settings');
      }
      managerProfiles = [];
      profilesLoaded = false;
      profileLoadError = '';
      currentResult = null;
      setPanelVisible(false);
      return;
    }

    ensureRoot();
    signedIn = true;
    managerProfiles = [];
    profilesLoaded = true;
    profileLoadError = '';
    renderCurrentResult();
    renderCurrentResult();
  }

  // Get JD has its own switch (qtsGetJdOn), separate from the Generation/Apply work slot.
  async function syncExtensionStatus() {
    const stored = await chrome.storage.local.get(['qtsGetJdOn']);
    extensionStatus = stored.qtsGetJdOn === true ? 'get_jd' : null;
    renderCurrentResult();
  }

  function applyResult(result) {
    ensureRoot();
    if (!result || result.pageUrl !== location.href) {
      currentResult = null;
      renderCurrentResult();
      return;
    }
    currentResult = result;
    if (result.status === 'processing') profilesLoaded = false;
    else profilesLoaded = true;
    if (!signedIn) return;
    const elements = host.__qtsElements;
    setPanelVisible(true);
    const toastKey = `${result.runId || result.updatedAt || ''}:${result.status}`;
    if (result.status === 'duplicate') {
      const message = result.toastMessage || jobPresenceMessage(result);
      renderIdlePanel(result.message || message);
      showToast(message, result.inBids ? 'applied' : 'info', toastKey);
      return;
    }
    if (result.status === 'new') {
      renderIdlePanel(result.message || jobPresenceMessage(result));
      showToast(result.message || jobPresenceMessage(result), 'success', toastKey);
      return;
    }
    if (result.status === 'error') {
      renderIdlePanel(result.message || 'Could not check this job.');
      showToast(result.message || 'Could not check this job.', 'error', toastKey);
      return;
    }
    if (result.status === 'cancelled') {
      currentResult = null;
      renderCurrentResult();
      return;
    }
    if (result.status === 'saved') {
      renderSaveResult(result);
      const saveToast = saveResultToast(result.saveResponse || {});
      showToast(saveToast.message, saveToast.type, toastKey);
      return;
    }
    if (result.status !== 'complete' || !result.classification) {
      renderIdlePanel(result.message || 'Get JD is checking this page...');
      return;
    }
    if (!result.classification.isJobPage || !result.classification.isRemote) {
      currentResult = null;
      setPanelVisible(false);
      return;
    }
    showToast(
      result.toastMessage || jobPresenceMessage(result),
      result.toastKind === 'new' ? 'success' : result.toastKind === 'applied' ? 'applied' : 'info',
      `${result.runId || result.updatedAt}:candidate-review`,
    );
    renderReview(result);
  }

  // Page-wide listeners belong to this panel instance and are removed by disable().
  const onRuntimeMessage = (message) => {
    if (message?.type === RESULT_MESSAGE) applyResult(message.result);
  };

  const onStorageChanged = (changes, area) => {
    if (area !== 'local') return;
    if (changes.authExpiresAt) {
      loadManagerSession().catch((error) => {
        console.error('[QTS Get JD] Could not sync the manager session:', error);
      });
    }
    if (changes.qtsGetJdOn) {
      syncExtensionStatus().catch((error) => {
        console.error('[QTS Get JD] Could not sync Get JD status:', error);
      });
    }
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);

  chrome.runtime.sendMessage({ type: 'GET_JD_PAGE_RESULT' })
    .then((response) => {
      if (response?.ok && response.result) applyResult(response.result);
    })
    .catch((error) => console.error('[QTS Get JD] Could not load page review:', error));

  loadManagerSession().catch((error) => {
    console.error('[QTS Get JD] Could not load manager candidate accounts:', error);
  });
  syncExtensionStatus().catch((error) => {
    console.error('[QTS Get JD] Could not load Get JD status:', error);
  });

  globalThis.__qtsGetJdReview = {
    excluded: false,
    applyResult,
    openManagerSettings,
    disable() {
      setPanelVisible(false);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      host?.remove();
      document.documentElement?.removeAttribute('data-qts-get-jd-docked');
      globalThis.__qtsGetJdReview = { excluded: true };
    },
  };
}

function restoreGetJdReview() {
  if (!globalThis.__qtsGetJdReview?.excluded) return;
  globalThis.__qtsGetJdReview = null;
  initializeGetJdReview().catch((error) => {
    console.error('[QTS Get JD] Could not restore page review:', error);
  });
}

globalThis.__qtsInitializeGetJdReview = initializeGetJdReview;
// These listeners outlive any one panel so a disabled panel can come back.
if (!globalThis.__qtsGetJdNavigationListener) {
  globalThis.__qtsGetJdNavigationListener = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'QTS_PAGE_URL_CHANGED') return;
    if (message.excluded) {
      globalThis.__qtsGetJdReview?.disable?.();
      return;
    }
    restoreGetJdReview();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.qtsManagerJobDetectionUrlRules || changes.authExpiresAt)) return;
    chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_PAGE_ALLOWED' })
      .then((response) => {
        if (!response?.ok) return;
        if (response.excluded) globalThis.__qtsGetJdReview?.disable?.();
        else restoreGetJdReview();
      })
      .catch((error) => console.error('[QTS Get JD] Could not apply URL exclusions:', error));
  });
}

function initializeGetJdReviewAfterLoad() {
  initializeGetJdReview().catch((error) => {
    console.error('[QTS Get JD] Could not verify page access:', error);
  });
}

if (document.readyState === 'complete') initializeGetJdReviewAfterLoad();
else window.addEventListener('load', initializeGetJdReviewAfterLoad, { once: true });
