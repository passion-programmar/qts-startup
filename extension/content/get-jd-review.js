(function initializeGetJdReview() {
  if (globalThis.__qtsGetJdReview) return;
  if (globalThis.__qtsPageExclusions?.shouldSkipPage(location.href)) return;

  const RESULT_MESSAGE = 'QTS_GET_JD_RESULT_UPDATED';
  let host = null;
  let root = null;
  let toastTimer = null;
  let lastToastKey = '';
  let managerProfiles = [];
  let currentResult = null;
  let extensionStatus = null;
  let signedIn = false;
  let profilesLoaded = false;
  let profileLoadError = '';
  let profileLoadRequestId = 0;
  let panelHideTimer = null;

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
    (document.head || document.documentElement).appendChild(dockStyle);

    const style = document.createElement('style');
    style.textContent = `
      .toast {
        position: fixed; top: 14px; left: 14px; z-index: 2; max-width: min(360px, calc(100vw - 28px));
        padding: 11px 14px; border-radius: 9px; color: #fff; background: #172554;
        box-shadow: 0 8px 28px #0f172a40; font: 600 13px/1.4 system-ui, sans-serif;
        pointer-events: none; opacity: 0; transform: translateY(-6px); transition: opacity .16s ease, transform .16s ease;
      }
      .toast.visible { opacity: 1; transform: translateY(0); }
      .toast.error { background: #991b1b; }
      .toast.success { background: #166534; }
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
      .panel[hidden], .toast[hidden] { display: none; }
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

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    root.appendChild(toast);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.hidden = true;
    panel.inert = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('aria-label', 'Review job and candidate matches');
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
    panel.append(panelHeader, details, accountHeading, profiles, message, actions);
    root.appendChild(panel);
    host.__qtsElements = {
      toast, panel, heading, status, details, accountCount, profiles, message, save, cancel,
    };
    (document.documentElement || document.body).appendChild(host);
    return root;
  }

  function setPanelVisible(visible) {
    const shouldShow =
      visible && signedIn && profilesLoaded && extensionStatus === 'get_jd';
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

  function showToast(message, type, key) {
    if (key && key === lastToastKey) return;
    if (key) lastToastKey = key;
    const elements = host?.__qtsElements;
    if (!elements) return;
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', type === 'error');
    elements.toast.classList.toggle('success', type === 'success');
    elements.toast.hidden = false;
    requestAnimationFrame(() => elements.toast.classList.add('visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.classList.remove('visible');
      setTimeout(() => {
        if (elements.toast) elements.toast.hidden = true;
      }, 180);
    }, 4200);
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

  function readSelectedIds() {
    return Array.from(
      root.querySelectorAll('input[data-profile-id]:checked'),
      (input) => input.dataset.profileId,
    ).filter(Boolean);
  }

  async function sendSelection() {
    if (currentResult?.status !== 'complete') return;
    currentResult = {
      ...currentResult,
      selectedProfileIds: readSelectedIds(),
      selectionModified: true,
    };
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_GET_JD_SELECTION',
      profileIds: currentResult.selectedProfileIds,
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not save candidate selection.');
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
      const availability = profile.duplicateKind === 'applied'
        ? 'Already applied'
        : profile.duplicateKind === 'job_list'
          ? 'Already in Jobs'
          : '';
      category.textContent = [
        profile.category || 'Uncategorized',
        saveResult?.message || availability,
      ].filter(Boolean).join(' · ');
      if (saveResult?.status === 'saved') category.classList.add('saved');
      if (saveResult?.status === 'failed') category.classList.add('failed');
      details.appendChild(category);

      if (selectable) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.profileId = profile.id;
        checkbox.disabled = !selectionEnabled || profile.available === false;
        checkbox.checked = !checkbox.disabled && selectedIds.has(profile.id);
        if (profile.available === false) label.classList.add('unavailable');
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
    elements.status.textContent = result.message || 'Select candidates to save this job.';
    elements.status.classList.remove('is-loading');
    elements.details.hidden = false;
    elements.details.replaceChildren();
    appendDetail(elements.details, 'Title', result.classification.job.title);
    appendDetail(elements.details, 'Company', result.classification.job.company);
    appendDetail(elements.details, 'Location', result.classification.job.location);
    appendDetail(elements.details, 'Country', result.classification.job.country);
    appendDetail(elements.details, 'Employment type', result.classification.job.employmentType);
    appendDetail(elements.details, 'Work arrangement', result.classification.job.workplaceType);
    appendDetail(elements.details, 'Salary', result.classification.job.salary);
    appendDetail(elements.details, 'URL', result.classification.job.jobUrl);
    appendDetail(elements.details, 'Job description', result.jobDescription, 'description');
    elements.message.textContent = result.saveError || '';

    const selectedIds = result.selectionModified === true
      ? new Set(Array.isArray(result.selectedProfileIds) ? result.selectedProfileIds : [])
      : new Set([
        ...(Array.isArray(result.selectedProfileIds) ? result.selectedProfileIds : []),
        ...(Array.isArray(result.classification.matchingProfileIds)
          ? result.classification.matchingProfileIds
          : []),
        (result.profiles || [])
          .filter((profile) => profile.recommended === true)
          .map((profile) => profile.id),
      ].flat());
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
    renderProfiles(candidates, { selectable: true, enabled: true, selectedIds, saveResults });

    elements.save.hidden = false;
    elements.save.disabled = !candidates.some((profile) => profile.available !== false);
    elements.cancel.hidden = false;
    elements.save.textContent = 'Save';
    elements.cancel.disabled = false;
    elements.cancel.textContent = 'Cancel';
    elements.save.onclick = async () => {
      const ids = readSelectedIds();
      if (!ids.length) {
        elements.message.textContent = 'Select at least one candidate before saving.';
        return;
      }
      elements.save.disabled = true;
      elements.cancel.disabled = true;
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
        elements.status.textContent = 'Select candidates to save this job.';
        elements.status.classList.remove('is-loading');
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
    const duplicateCount = Number(response.duplicateCount || 0);
    const failedCount = Number(response.failedCount || 0);
    setPanelVisible(true);
    elements.heading.textContent = 'Save result';
    elements.status.textContent = savedCount > 0
      ? `Successfully saved ${savedCount} job${savedCount === 1 ? '' : 's'}.`
      : 'No new jobs were saved.';
    elements.status.classList.remove('is-loading');
    elements.details.hidden = false;
    elements.details.replaceChildren();
    appendDetail(elements.details, 'Job', result.classification?.job?.title || 'Job');
    const responseByProfile = new Map(
      (response.results || []).map((profileResult) => [profileResult.profileId, profileResult]),
    );
    renderProfiles(managerProfiles.map((profile) => ({
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
      renderIdlePanel();
    };
  }

  function sessionIsValid(stored) {
    if (!stored.authToken) return false;
    let expiresAt = Number(stored.authExpiresAt) || 0;
    try {
      const payloadSegment = String(stored.authToken).split('.')[1];
      const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(normalized));
      if (Number.isFinite(payload.exp)) expiresAt = payload.exp * 1000;
    } catch {
      // The stored expiry remains authoritative for non-JWT tokens.
    }
    return expiresAt > Date.now();
  }

  function renderCurrentResult() {
    setPanelVisible(true);
    if (!signedIn || extensionStatus !== 'get_jd') return;
    if (currentResult?.status === 'complete' && currentResult.classification?.isJobPage === true) {
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

  async function loadManagerProfiles() {
    const requestId = ++profileLoadRequestId;
    const stored = await chrome.storage.local.get(['authToken', 'authExpiresAt']);
    if (!sessionIsValid(stored)) {
      profileLoadRequestId += 1;
      signedIn = false;
      managerProfiles = [];
      profilesLoaded = false;
      profileLoadError = '';
      currentResult = null;
      setPanelVisible(false);
      return;
    }

    ensureRoot();
    signedIn = true;
    profilesLoaded = false;
    profileLoadError = '';
    renderCurrentResult();
    if (extensionStatus === 'get_jd') {
      renderIdlePanel('Loading your candidate accounts...');
    }
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'GET_MANAGER_CANDIDATE_PROFILES',
      });
    } catch (error) {
      if (requestId !== profileLoadRequestId || !signedIn) return;
      const message = error instanceof Error ? error.message : 'Could not load candidate accounts.';
      profilesLoaded = true;
      profileLoadError = message;
      renderCurrentResult();
      console.error('[QTS Get JD] Could not load manager candidate accounts:', error);
      return;
    }
    if (requestId !== profileLoadRequestId || !signedIn) return;
    if (!response?.ok || !Array.isArray(response.profiles)) {
      profileLoadError = response?.error || 'Could not load candidate accounts.';
      profilesLoaded = true;
      renderCurrentResult();
      console.error('[QTS Get JD] Could not load manager candidate accounts:', profileLoadError);
      return;
    }
    managerProfiles = response.profiles
      .filter((profile) => profile && typeof profile.id === 'string')
      .map((profile) => ({
        id: profile.id,
        name: typeof profile.name === 'string' ? profile.name : 'Candidate',
        category: typeof profile.category === 'string' ? profile.category : null,
      }));
    profilesLoaded = true;
    profileLoadError = '';
    renderCurrentResult();
  }

  async function syncExtensionStatus() {
    const stored = await chrome.storage.local.get(['qtsExtensionStatus']);
    extensionStatus = stored.qtsExtensionStatus || null;
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
    if (!signedIn) return;
    const elements = host.__qtsElements;
    setPanelVisible(true);
    const toastKey = `${result.runId || result.updatedAt || ''}:${result.status}`;
    if (result.status === 'duplicate') {
      const message = result.toastMessage || (result.inBids
        ? 'Already applied.'
        : result.inJobs
          ? 'Already added.'
          : 'New job.');
      renderIdlePanel(result.message || message);
      showToast(message, 'normal', toastKey);
      return;
    }
    if (result.status === 'new') {
      renderIdlePanel(result.message || 'This is a new job.');
      showToast(result.message || 'This is a new job!', 'success', toastKey);
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
      const failures = result.saveResponse?.failedCount || 0;
      renderSaveResult(result);
      showToast(
        failures ? 'Some candidates could not be saved. Please review and retry.' : 'Successfully saved!',
        failures ? 'error' : 'success',
        toastKey,
      );
      return;
    }
    if (result.status !== 'complete' || !result.classification) {
      renderIdlePanel(result.message || 'Get JD is checking this page...');
      return;
    }
    if (!result.classification.isJobPage) {
      renderIdlePanel('This is not a job posting page.');
      showToast('This is not Job Page', 'normal', toastKey);
      return;
    }
    showToast(
      result.toastMessage || 'New job.',
      result.toastKind === 'new' ? 'success' : 'normal',
      `${result.runId || result.updatedAt}:candidate-review`,
    );
    renderReview(result);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === RESULT_MESSAGE) applyResult(message.result);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.authToken || changes.authExpiresAt) {
      loadManagerProfiles().catch((error) => {
        console.error('[QTS Get JD] Could not sync the manager session:', error);
      });
    }
    if (changes.qtsExtensionStatus) {
      syncExtensionStatus().catch((error) => {
        console.error('[QTS Get JD] Could not sync Get JD status:', error);
      });
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_JD_PAGE_RESULT' })
    .then((response) => {
      if (response?.ok && response.result) applyResult(response.result);
    })
    .catch((error) => console.error('[QTS Get JD] Could not load page review:', error));

  loadManagerProfiles().catch((error) => {
    console.error('[QTS Get JD] Could not load manager candidate accounts:', error);
  });
  syncExtensionStatus().catch((error) => {
    console.error('[QTS Get JD] Could not load Get JD status:', error);
  });

  globalThis.__qtsGetJdReview = { applyResult };
})();
