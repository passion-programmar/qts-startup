(function initQtsLearningReviewPanel(global) {
  if (global.__qtsLearningReviewPanel) return;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function fetchLearningQueue(applicationId) {
    if (!applicationId) return { success: false, queue: [], message: 'No active application session.' };
    const api = global.window?.api;
    if (!api?.getApplicationLearningQueue) {
      return { success: false, queue: [], message: 'Learning review is unavailable.' };
    }
    return api.getApplicationLearningQueue(applicationId);
  }

  function getPanel() {
    return document.getElementById('learning-review-panel');
  }

  function getStatus() {
    return document.getElementById('learning-review-status');
  }

  function getList() {
    return document.getElementById('learning-review-list');
  }

  function setStatus(message, isError = false) {
    const status = getStatus();
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', isError);
  }

  async function refresh(applicationId) {
    const panel = getPanel();
    const list = getList();
    if (!panel || !list) return { success: false, queue: [] };

    const result = await fetchLearningQueue(applicationId);
    if (!result?.success) {
      panel.classList.remove('hidden');
      list.replaceChildren();
      setStatus(result?.message || 'Could not load learning review items.', true);
      return result;
    }

    const queue = Array.isArray(result?.queue) ? result.queue : [];
    if (!queue.length) {
      panel.classList.add('hidden');
      list.replaceChildren();
      setStatus('');
      return { success: true, queue: [] };
    }

    panel.classList.remove('hidden');
    setStatus('');
    list.innerHTML = queue.map((item) => {
      const fieldId = escapeHtml(String(item.stableFieldId || ''));
      const label = escapeHtml(String(item.label || 'Untitled field'));
      const fieldType = escapeHtml(String(item.fieldType || 'text'));
      const fillStatus = escapeHtml(String(item.fillStatus || 'pending'));
      const currentAnswer = escapeHtml(String(item.currentAnswer ?? ''));
      const sectionHeading = escapeHtml(String(item.sectionHeading || ''));
      return `
        <li class="learning-review-item" data-stable-field-id="${fieldId}">
          <div class="learning-review-question">${label}</div>
          <div class="learning-review-meta">${fieldType} · ${fillStatus}${sectionHeading ? ` · ${sectionHeading}` : ''}</div>
          <label class="learning-review-label">Current answer</label>
          <textarea class="learning-review-answer" data-field-id="${fieldId}" rows="2">${currentAnswer}</textarea>
          <div class="learning-review-actions">
            <button type="button" class="btn btn-ghost btn-xs learning-review-reusable" data-policy="reusable_profile" data-field-id="${fieldId}">Reusable</button>
            <button type="button" class="btn btn-ghost btn-xs learning-review-generated" data-policy="generated_ai" data-field-id="${fieldId}">Generated</button>
            <button type="button" class="btn btn-ghost btn-xs learning-review-manual" data-policy="manual_only" data-field-id="${fieldId}">Manual</button>
            <button type="button" class="btn btn-ghost btn-xs learning-review-ignore" data-policy="ignore" data-field-id="${fieldId}">Ignore</button>
          </div>
        </li>
      `;
    }).join('');

    return { success: true, queue };
  }

  async function applyDecision(applicationId, fieldId, policyType, editedAnswerOverride) {
    const api = global.window?.api;
    if (!api?.confirmApplicationLearning || !applicationId || !fieldId || !policyType) {
      return { success: false, message: 'Learning review is unavailable.' };
    }

    const queueResult = await fetchLearningQueue(applicationId);
    if (!queueResult?.success) {
      return { success: false, message: queueResult?.message || 'Could not verify the pending learning item.' };
    }
    const queue = Array.isArray(queueResult?.queue) ? queueResult.queue : [];
    const current = queue.find((item) => String(item.stableFieldId) === String(fieldId));
    if (!current) {
      return { success: false, message: 'Field is no longer in the learning queue.' };
    }

    const answerInput = document.querySelector(`.learning-review-answer[data-field-id="${CSS.escape(String(fieldId))}"]`);
    const editedAnswer = typeof editedAnswerOverride === 'string'
      ? editedAnswerOverride
      : (answerInput ? answerInput.value : (current.currentAnswer ?? ''));

    const payload = {
      fieldStableId: String(current.stableFieldId || fieldId),
      question: current.label || 'Application field',
      currentAnswer: current.currentAnswer ?? '',
      editedAnswer: editedAnswer ?? '',
      policyType,
      confidence: 0.9,
      userApproved: policyType !== 'ignore',
      fieldType: current.fieldType || 'text',
      sectionHeading: current.sectionHeading || '',
      evidenceSummary: {
        source: 'user_review_panel',
        fillStatus: current.fillStatus || 'pending',
        pageStep: current.pageStep || '',
      },
    };

    return api.confirmApplicationLearning(applicationId, payload);
  }

  function bindEvents() {
    document.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const reusableBtn = target.closest('.learning-review-reusable');
      const generatedBtn = target.closest('.learning-review-generated');
      const manualBtn = target.closest('.learning-review-manual');
      const ignoreBtn = target.closest('.learning-review-ignore');
      const applicationId = global.__qtsApplySessionStore?.getActive?.()?.applicationId ?? global.activeApplicationId;
      const button = reusableBtn || generatedBtn || manualBtn || ignoreBtn;
      if (!button || !applicationId) return;

      const policyType = button.dataset.policy;
      const fieldId = button.dataset.fieldId;
      if (!policyType || !fieldId) return;

      const item = button.closest('.learning-review-item');
      const answerField = item?.querySelector('.learning-review-answer');
      const editedAnswer = answerField ? answerField.value : undefined;

      button.disabled = true;
      setStatus('Saving learning decision...');
      try {
        const result = await applyDecision(applicationId, fieldId, policyType, editedAnswer);
        if (!result?.success) {
          setStatus(result?.message || 'Could not save the learning decision.', true);
          return;
        }
        await refresh(applicationId);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      } finally {
        button.disabled = false;
      }
    });
  }

  global.__qtsLearningReviewPanel = {
    refresh,
    applyDecision,
    fetchLearningQueue,
    bindEvents,
  };

  bindEvents();
})(typeof window !== 'undefined' ? window : self);
