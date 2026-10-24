(function initQtsLearningRecorder(global) {
  if (global.__qtsLearningRecorder) return;

  const pendingByKey = new Map();
  let started = false;

  function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isTextLikeField(element) {
    if (!element || typeof element !== 'object') return false;
    if (element.closest && element.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="listbox"], [contenteditable="true"]')) {
      return true;
    }
    return false;
  }

  function getFieldType(element) {
    if (!element) return 'text';
    const tagName = String(element.tagName || '').toLowerCase();
    const type = String(element.type || '').toLowerCase();
    if (tagName === 'textarea' || element.getAttribute?.('role') === 'textbox') return 'textarea';
    if (tagName === 'select' || element.getAttribute?.('role') === 'combobox' || element.getAttribute?.('role') === 'listbox') return 'select';
    if (type === 'email') return 'email';
    if (type === 'tel') return 'tel';
    if (type === 'file') return 'file';
    if (type === 'checkbox' || element.getAttribute?.('role') === 'checkbox' || element.getAttribute?.('role') === 'switch') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (element.isContentEditable) return 'contenteditable';
    return 'text';
  }

  function getNearestLabel(element) {
    if (!element) return '';
    if (element.id) {
      const candidate = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (candidate) return cleanText(candidate.textContent);
    }
    const wrapped = element.closest('label');
    if (wrapped) return cleanText(wrapped.textContent);
    const ariaLabel = cleanText(element.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;
    const ariaLabelledBy = cleanText(element.getAttribute('aria-labelledby'));
    if (ariaLabelledBy) {
      const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
      const combined = ids
        .map((id) => cleanText(document.getElementById(id)?.textContent || ''))
        .filter(Boolean)
        .join(' ');
      if (combined) return combined;
    }
    const placeholder = cleanText(element.getAttribute('placeholder'));
    if (placeholder) return placeholder;
    return cleanText(element.getAttribute('name') || element.getAttribute('autocomplete') || '');
  }

  function getSectionHeading(element) {
    if (!element) return '';
    const fieldset = element.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) return cleanText(legend.textContent);
    }
    const dialog = element.closest('[role="dialog"], dialog, [aria-modal="true"]');
    const heading = dialog?.querySelector('h1, h2, h3, [role="heading"]');
    if (heading) return cleanText(heading.textContent);
    let node = element.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1) {
      const localHeading = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > legend, :scope > [role="heading"]');
      if (localHeading && !localHeading.contains(element)) {
        return cleanText(localHeading.textContent);
      }
      node = node.parentElement;
    }
    return '';
  }

  function getFieldValue(element) {
    if (!element) return '';
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked ? 'true' : 'false';
    }
    if (element.isContentEditable) {
      return cleanText(element.textContent);
    }
    if (element.tagName && element.tagName.toLowerCase() === 'select') {
      return cleanText(element.options[element.selectedIndex]?.text || element.value || '');
    }
    return cleanText(element.value);
  }

  function getStableFieldId(element) {
    if (!element) return 'unknown-field';
    const datasetValue = element.dataset?.stableFieldId || element.dataset?.fieldId || element.dataset?.semanticKey;
    if (datasetValue) return String(datasetValue);
    const fallback = [
      element.name,
      element.id,
      element.getAttribute?.('name'),
      element.getAttribute?.('id'),
      element.getAttribute?.('autocomplete'),
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('data-testid'),
      getNearestLabel(element),
    ].filter(Boolean).join('|');
    return fallback || `field-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getEffectiveQuestion(element) {
    const label = getNearestLabel(element);
    if (label) return label;
    const name = [element.name, element.getAttribute?.('name'), element.getAttribute?.('autocomplete'), element.getAttribute?.('aria-label')].filter(Boolean)[0];
    return name || 'Application field';
  }

  function pickPolicyType(question, fieldType) {
    const text = `${question} ${fieldType}`.toLowerCase();
    if (/(name|email|phone|city|state|country|address|postal|zip|resume|cover|linkedin|portfolio|website|authorized|work authorization|visa|citizenship|gender|pronouns|date of birth|birthdate)/i.test(text)) {
      return 'reusable_profile';
    }
    if (/(salary|start date|desired salary|why|motivation|cover|interests|eligibility|relocate|availability|hours|employment type|notice period)/i.test(text)) {
      return 'generated_ai';
    }
    if (/(consent|acknowledge|terms|agreement|marketing|opt in|gdpr|privacy)/i.test(text)) {
      return 'manual_only';
    }
    return 'requires_review';
  }

  function getActiveSessionId() {
    const store = global.__qtsApplySessionStore;
    const active = store?.getActive ? store.getActive() : store?.state?.active || null;
    return active && (active.applicationId ?? active.application_id ?? active.id)
      ? Number(active.applicationId ?? active.application_id ?? active.id)
      : null;
  }

  async function readAuthToken() {
    // Content scripts never receive the bearer token; only the service worker holds it.
    if (global.__qtsAccountAuth?.getWorkerAuthToken) {
      return global.__qtsAccountAuth.getWorkerAuthToken();
    }
    return '';
  }

  async function submitLearningConfirmation(payload) {
    const runtime = await chrome.runtime.sendMessage({ type: 'GET_QTS_RUNTIME_CONFIG' });
    if (!runtime?.ok || runtime.features?.applicationAutomation !== true) {
      return { success: false, disabled: true, message: 'Application learning is not enabled.' };
    }
    const sessionId = getActiveSessionId();
    if (!sessionId) {
      return { success: false, message: 'No active application session for learning capture.' };
    }

    const token = await readAuthToken();
    if (!token) {
      return { success: false, message: 'Not logged in.' };
    }

    try {
      const response = await fetch(`${runtime.serverUrl}/api/application-sessions/${sessionId}/learning-confirmation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      let data;
      try {
        data = await response.json();
      } catch {
        data = { success: false, message: 'Invalid learning server response.' };
      }
      if (!response.ok && data.success !== false) {
        data.success = false;
      }
      return data;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to reach learning server.',
      };
    }
  }

  function queueLearningConfirmation(element, { reason = 'input' } = {}) {
    if (!element || !isTextLikeField(element)) return;

    const value = getFieldValue(element);
    if (!value || value.length < 2) return;

    const stableFieldId = getStableFieldId(element);
    const question = getEffectiveQuestion(element);
    const fieldType = getFieldType(element);
    const sectionHeading = getSectionHeading(element);
    const evidence = {
      reason,
      pageUrl: location.href,
      selector: element.id || element.name || element.getAttribute?.('aria-label') || 'unknown-field',
      timestamp: new Date().toISOString(),
    };

    const payload = {
      fieldStableId: stableFieldId,
      question,
      currentAnswer: value,
      editedAnswer: null,
      policyType: pickPolicyType(question, fieldType),
      confidence: 0.8,
      userApproved: true,
      fieldType,
      sectionHeading,
      evidenceSummary: evidence,
    };

    const key = `${stableFieldId}|${value}`;
    pendingByKey.set(key, payload);

    window.clearTimeout(pendingByKey.get(`${key}__timer`));
    const timer = window.setTimeout(async () => {
      const next = pendingByKey.get(key);
      pendingByKey.delete(key);
      if (next) {
        await submitLearningConfirmation(next);
      }
    }, 1200);
    pendingByKey.set(`${key}__timer`, timer);
  }

  function handleInput(event) {
    if (!event?.target || !(event.target instanceof HTMLElement)) return;
    queueLearningConfirmation(event.target, { reason: 'input' });
  }

  function handleChange(event) {
    if (!event?.target || !(event.target instanceof HTMLElement)) return;
    queueLearningConfirmation(event.target, { reason: 'change' });
  }

  function handleBlur(event) {
    if (!event?.target || !(event.target instanceof HTMLElement)) return;
    queueLearningConfirmation(event.target, { reason: 'blur' });
  }

  function start() {
    if (started) return;
    started = true;
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);
    document.addEventListener('blur', handleBlur, true);
  }

  function stop() {
    if (!started) return;
    started = false;
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('change', handleChange, true);
    document.removeEventListener('blur', handleBlur, true);
  }

  global.__qtsLearningRecorder = {
    start,
    stop,
    submitLearningConfirmation,
    queueLearningConfirmation,
    getActiveSessionId,
  };

  start();
})(typeof window !== 'undefined' ? window : self);
