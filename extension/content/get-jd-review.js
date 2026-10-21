(function initializeGetJdReview() {
  if (globalThis.__qtsGetJdReview) return;
  if (globalThis.__qtsPageExclusions?.shouldSkipPage(location.href)) return;

  const RESULT_MESSAGE = 'QTS_GET_JD_RESULT_UPDATED';
  let host = null;
  let root = null;
  let toastTimer = null;
  let lastToastKey = '';

  function ensureRoot() {
    if (root) return root;
    host = document.createElement('div');
    host.setAttribute('data-qts-get-jd-ui', '');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    root = host.attachShadow({ mode: 'closed' });

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
        position: fixed; top: 14px; right: 14px; z-index: 1; width: min(390px, calc(100vw - 28px));
        max-height: calc(100vh - 28px); overflow: auto; box-sizing: border-box; padding: 16px;
        border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; color: #0f172a;
        box-shadow: 0 12px 40px #0f172a38; font: 13px/1.45 system-ui, sans-serif;
        pointer-events: auto;
      }
      .panel[hidden], .toast[hidden] { display: none; }
      h2 { margin: 0 0 10px; font-size: 16px; }
      .status { margin: 0 0 12px; color: #334155; }
      .details { margin: 0 0 12px; }
      .details div { margin-top: 7px; overflow-wrap: anywhere; }
      .details dt { color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      .details dd { margin: 1px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      .description { max-height: 130px; overflow: auto; padding: 8px; border-radius: 7px; background: #f8fafc; }
      .profiles { max-height: 220px; overflow: auto; margin: 9px 0 12px; border-top: 1px solid #e2e8f0; }
      .profile { display: flex; gap: 9px; align-items: flex-start; padding: 8px 2px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
      .profile.unavailable { cursor: default; opacity: .72; }
      .profile input { margin: 2px 0 0; accent-color: #4f46e5; }
      .profile small { display: block; margin-top: 2px; color: #64748b; }
      .profile .saved { color: #166534; }
      .profile .failed { color: #b91c1c; }
      .message { min-height: 18px; margin: 0 0 8px; color: #b91c1c; }
      .actions { display: flex; gap: 8px; }
      button { min-height: 36px; padding: 0 13px; border: 0; border-radius: 7px; font: 600 12px system-ui, sans-serif; cursor: pointer; }
      button:disabled { opacity: .6; cursor: wait; }
      button[hidden] { display: none; }
      .save { flex: 1; color: #fff; background: #4f46e5; }
      .cancel { color: #334155; background: #e2e8f0; }
      @media (max-width: 480px) { .panel { top: 8px; right: 8px; width: calc(100vw - 16px); max-height: calc(100vh - 16px); } }
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
    panel.setAttribute('aria-label', 'Review job and candidate matches');
    const heading = document.createElement('h2');
    heading.textContent = 'Review new job';
    const status = document.createElement('p');
    status.className = 'status';
    const details = document.createElement('dl');
    details.className = 'details';
    const profiles = document.createElement('div');
    profiles.className = 'profiles';
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
    panel.append(heading, status, details, profiles, message, actions);
    root.appendChild(panel);
    host.__qtsElements = { toast, panel, status, details, profiles, message, save, cancel };
    (document.documentElement || document.body).appendChild(host);
    return root;
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
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_GET_JD_SELECTION',
      profileIds: readSelectedIds(),
    });
    if (!response?.ok) throw new Error(response?.error || 'Could not save candidate selection.');
  }

  function renderReview(result) {
    const elements = host.__qtsElements;
    elements.panel.hidden = false;
    elements.panel.querySelector('h2').textContent = 'Review new job';
    elements.status.textContent = result.message || 'Select candidates to save this job.';
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
    elements.profiles.replaceChildren();
    elements.message.textContent = result.saveError || '';

    const candidates = result.profiles || [];
    if (!candidates.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No active candidate Accounts were found for this Manager.';
      elements.profiles.appendChild(empty);
    }
    const selectedIds = Array.isArray(result.selectedProfileIds)
      ? new Set(result.selectedProfileIds)
      : null;
    const saveResults = new Map(
      (result.saveResponse?.results || []).map((profileResult) => [profileResult.profileId, profileResult]),
    );
    for (const profile of candidates) {
      const label = document.createElement('label');
      label.className = 'profile';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.profileId = profile.id;
      checkbox.disabled = profile.available === false;
      checkbox.checked = !checkbox.disabled && (selectedIds
        ? selectedIds.has(profile.id)
        : profile.recommended === true);
      if (checkbox.disabled) label.classList.add('unavailable');
      checkbox.addEventListener('change', () => {
        sendSelection().catch((error) => {
          elements.message.textContent = error.message || 'Could not save candidate selection.';
        });
      });
      const details = document.createElement('span');
      details.textContent = profile.name || 'Candidate';
      const category = document.createElement('small');
      const saveResult = saveResults.get(profile.id) || profile.saveResult;
      const availability = profile.duplicateKind === 'applied'
        ? 'Already applied'
        : profile.duplicateKind === 'job_list'
          ? 'Already in Jobs'
          : '';
      category.textContent = [profile.category || 'Uncategorized', saveResult?.message || availability]
        .filter(Boolean)
        .join(' · ');
      if (saveResult?.status === 'saved') category.classList.add('saved');
      if (saveResult?.status === 'failed') category.classList.add('failed');
      details.appendChild(category);
      label.append(checkbox, details);
      elements.profiles.appendChild(label);
    }

    elements.save.hidden = false;
    elements.save.disabled = !candidates.some((profile) => profile.available !== false);
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
    elements.panel.hidden = false;
    elements.panel.querySelector('h2').textContent = 'Save result';
    elements.status.textContent = savedCount > 0
      ? `Successfully saved ${savedCount} job${savedCount === 1 ? '' : 's'}.`
      : 'No new jobs were saved.';
    elements.details.replaceChildren();
    appendDetail(elements.details, 'Job', result.classification?.job?.title || 'Job');
    elements.profiles.replaceChildren();
    for (const profileResult of response.results || []) {
      const row = document.createElement('div');
      row.className = 'profile unavailable';
      const details = document.createElement('span');
      details.textContent = profileResult.name || 'Candidate';
      const status = document.createElement('small');
      status.className = profileResult.status === 'failed' ? 'failed' : 'saved';
      status.textContent = [profileResult.category || 'Uncategorized', profileResult.message]
        .filter(Boolean)
        .join(' · ');
      details.appendChild(status);
      row.appendChild(details);
      elements.profiles.appendChild(row);
    }
    elements.message.textContent = failedCount > 0
      ? `${failedCount} candidate${failedCount === 1 ? '' : 's'} could not be saved.`
      : duplicateCount > 0
        ? `${duplicateCount} candidate${duplicateCount === 1 ? '' : 's'} already had this job.`
        : '';
    elements.save.hidden = true;
    elements.cancel.disabled = false;
    elements.cancel.textContent = 'Done';
    elements.cancel.onclick = () => { elements.panel.hidden = true; };
  }

  function applyResult(result) {
    ensureRoot();
    const elements = host.__qtsElements;
    if (!result || result.pageUrl !== location.href || result.status === 'processing') {
      elements.panel.hidden = true;
      return;
    }
    const toastKey = `${result.runId || result.updatedAt || ''}:${result.status}`;
    if (result.status === 'duplicate') {
      elements.panel.hidden = true;
      const message = result.toastMessage || (result.inBids
        ? 'Already applied.'
        : result.inJobs
          ? 'Already added.'
          : 'New job.');
      showToast(message, 'normal', toastKey);
      return;
    }
    if (result.status === 'new') {
      elements.panel.hidden = true;
      showToast(result.message || 'This is a new job!', 'success', toastKey);
      return;
    }
    if (result.status === 'error') {
      elements.panel.hidden = true;
      showToast(result.message || 'Could not check this job.', 'error', toastKey);
      return;
    }
    if (result.status === 'cancelled') {
      elements.panel.hidden = true;
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
      elements.panel.hidden = true;
      return;
    }
    if (!result.classification.isJobPage) {
      elements.panel.hidden = true;
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

  chrome.runtime.sendMessage({ type: 'GET_JD_PAGE_RESULT' })
    .then((response) => {
      if (response?.ok) applyResult(response.result);
    })
    .catch((error) => console.error('[QTS Get JD] Could not load page review:', error));

  globalThis.__qtsGetJdReview = { applyResult };
})();
