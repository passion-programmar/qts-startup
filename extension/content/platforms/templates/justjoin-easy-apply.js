// justjoin.it — Easy Apply modal template (guest apply, no justjoin login).
// Canonical example: https://justjoin.it/job-offer/7n-sp-z-o-o--fullstack-developer-java-react--warszawa-java

(function registerJustjoinEasyApplyTemplate() {
  if (window.__qtsJustjoinEasyApplyTemplate) return;
  const registry = window.__qtsTemplateRegistry;
  if (!registry?.registerTemplate) return;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getModalRoots() {
    return Array.from(document.querySelectorAll(
      '[role="dialog"], [aria-modal="true"], dialog, [class*="modal" i][class*="open" i], [data-testid*="modal" i]'
    )).filter((node) => {
      const style = window.getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function scoreModalHeuristic(root) {
    let score = 0;
    if (root.querySelector('input[type="file"]')) score += 60;
    if (root.querySelector('input[type="email"], input[autocomplete*="email" i]')) score += 35;
    if (root.querySelector('input[type="checkbox"], [role="checkbox"], [role="switch"]')) score += 15;
    const text = cleanText(root.textContent).toLowerCase();
    if (/wyrażam zgodę|danych osobowych|personal data|recruitment process/i.test(text)) score += 20;
    if (/cookie|pliki cookie/i.test(text) && !root.querySelector('input[type="file"]')) score -= 90;
    return score;
  }

  function scoreApplicationModal(root, baseScore) {
    let score = baseScore;
    const text = cleanText(root.textContent).toLowerCase();
    if (/apply|aplikuj|application/i.test(text)) score += 10;
    if (root.querySelector('[data-testid*="apply" i], [data-test*="application" i]')) score += 15;
    return score;
  }

  function getApplicationScanRoots() {
    const roots = getModalRoots();
    if (!roots.length) return null;
    const scored = roots
      .map((root) => ({
        root,
        score: scoreApplicationModal(root, scoreModalHeuristic(root)),
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score > 0) return [best.root];
    const withInputs = roots.filter((root) => root.querySelector('input, textarea, select'));
    if (withInputs.length) return [withInputs[withInputs.length - 1]];
    return roots;
  }

  function scoreApplyButton(el, baseScore) {
    let score = baseScore;
    const testId = cleanText(el.getAttribute('data-testid'));
    if (/apply/i.test(testId)) score += 25;
    if (el.closest('[class*="Application" i], [class*="application" i], [data-test*="application" i]')) {
      score += 20;
    }
    if (el.closest('aside, [class*="summary" i], [class*="Summary" i]')) score += 15;
    return score;
  }

  function detectDynamicTriggers() {
    const triggers = [];
    document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]').forEach((el) => {
      const label = cleanText(
        el.closest('label')?.textContent
        || document.querySelector(`label[for="${CSS.escape(el.id || '')}"]`)?.textContent
        || el.getAttribute('aria-label')
      );
      if (/attach.*message|cover letter|additional|dołącz.*wiadomość|wiadomość dla|list motywacyjny/i.test(label)) {
        triggers.push({ type: 'toggle', label, stableHint: el.name || el.id || label });
      }
    });
    return triggers;
  }

  function revealDynamicFields() {
    const actions = [];
    detectDynamicTriggers().forEach((trigger) => {
      const el = Array.from(document.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]'))
        .find((node) => {
          const label = cleanText(node.closest('label')?.textContent || node.getAttribute('aria-label'));
          return label === trigger.label;
        });
      if (el && !el.checked && el.getAttribute('aria-checked') !== 'true') {
        el.click();
        actions.push({ action: 'checked', label: trigger.label });
      }
    });
    return actions;
  }

  function detectApplyModalFingerprint() {
    const roots = getModalRoots();
    let best = { matched: false, score: 0, root: null };

    for (const root of roots) {
      const text = cleanText(root.textContent).toLowerCase();
      let score = 0;
      if (/you apply for|aplikujesz na/i.test(text)) score += 80;
      if (/first and last name|imię i nazwisko/i.test(text)) score += 40;
      if (/\bemail\b|e-mail/i.test(text)) score += 30;
      if (/add document|dodaj dokument|załącz/i.test(text)) score += 40;
      if (/attach a message|wiadomość dla pracodawcy|dołącz wiadomość/i.test(text)) score += 25;
      if (/terms of service|privacy policy|tworząc konto/i.test(text)) score += 20;
      if (/pdf,\s*docx|max size 5\s*mb/i.test(text)) score += 15;
      if (root.querySelector('input[type="file"]')) score += 30;
      if (root.querySelector('input[type="email"], input[autocomplete*="email" i]')) score += 20;
      if (root.querySelector('[role="switch"], input[type="checkbox"]')) score += 10;

      const matched = score >= 120;
      if (score > best.score) {
        best = { matched, score, root };
      }
    }

    return best;
  }

  function isJustjoinEasyApplyModalOpen() {
    return detectApplyModalFingerprint().matched;
  }

  function hasVisibleModalForm() {
    if (isJustjoinEasyApplyModalOpen()) return true;
    return getModalRoots().some((root) => root.querySelector('form, input, textarea, select, [role="textbox"]'));
  }

  function detectFlowType(scan, context) {
    if (context?.externalUrl) return 'external_redirect';
    if (/step\s+\d+\s+of\s+\d+/i.test(cleanText(scan?.pageStep || ''))) return 'multi_step';
    if (hasVisibleModalForm()) return 'modal';
    if (context?.dynamicActions?.length) return 'dynamic';
    if (scan?.fields?.length) return 'inline_single';
    return 'unknown';
  }

  function buildWarnings(scan, context, expectedFields) {
    const warnings = [];
    if (document.querySelector('.g-recaptcha, iframe[src*="recaptcha"], [class*="recaptcha" i]')) {
      warnings.push('reCAPTCHA detected — complete it manually before submit.');
    }
    if (detectDynamicTriggers().length && !context?.dynamicActions?.length) {
      warnings.push('Optional message field appears when you turn on "Attach a message".');
    }
    if (!scan?.fields?.length) {
      warnings.push('Click Apply on the job page to open the form (no justjoin.it login required).');
    }
    warnings.push(...registry.validateExpectedFields(scan?.fields, expectedFields));
    return warnings;
  }

  function hasNativeApplyButton() {
    const APPLY_LABEL = /\b(apply|aplikuj)\b/i;
    const nodes = document.querySelectorAll('button, a[href], [role="button"]');
    for (const el of nodes) {
      const label = cleanText([
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.textContent,
      ].filter(Boolean).join(' '));
      if (!APPLY_LABEL.test(label)) continue;
      if (el.closest('[role="dialog"], [aria-modal="true"], dialog')) continue;
      if (el.tagName === 'A' && el.href) {
        try {
          if (!/justjoin\.it/i.test(new URL(el.href).hostname)) continue;
        } catch {
          continue;
        }
      }
      return true;
    }
    return false;
  }

  function hasSummaryApplyPanel() {
    return Boolean(document.querySelector(
      'aside [class*="apply" i], aside button, [class*="summary" i] button, [class*="Summary" i] button'
    ));
  }

  function collectPageSignals(context = {}) {
    const modalFingerprint = detectApplyModalFingerprint();
    return {
      jobOfferUrl: /justjoin\.it\/job-offer\//i.test(context.url || window.location.href),
      nativeApplyButton: hasNativeApplyButton(),
      summaryApplyPanel: hasSummaryApplyPanel(),
      modalOpen: hasVisibleModalForm(),
      applyModalConfirmed: modalFingerprint.matched,
      youApplyForModal: modalFingerprint.matched,
      applyModalScore: modalFingerprint.score,
      applyModalInputs: Boolean(getModalRoots().some((root) => root.querySelector('input[type="file"], input[type="email"]'))),
      externalApplyLink: Boolean(context.external?.external),
    };
  }

  function detect(context) {
    const url = context?.url || window.location.href;
    if (!/justjoin\.it\/job-offer\//i.test(url)) return 0;
    if (context?.external?.external) return 0;

    const modalFingerprint = detectApplyModalFingerprint();
    if (modalFingerprint.matched) {
      return 500;
    }

    const signals = collectPageSignals(context);
    let score = 40;
    if (signals.jobOfferUrl) score += 30;
    if (signals.nativeApplyButton) score += 25;
    if (signals.summaryApplyPanel) score += 10;
    if (signals.modalOpen) score += 15;
    if (signals.applyModalInputs) score += 15;
    if (signals.nativeApplyButton && signals.summaryApplyPanel) score += 10;
    return score;
  }

  const EXPECTED_FIELDS = [
    {
      id: 'name',
      label: 'First and last name',
      labelPatterns: [/first and last name/i, /\bname\b/i, /imię i nazwisko/i],
      fieldTypes: ['text'],
      required: true,
    },
    {
      id: 'email',
      label: 'Email',
      labelPatterns: [/email/i, /e-mail/i],
      fieldTypes: ['text', 'email'],
      required: true,
    },
    {
      id: 'resume',
      label: 'Add document',
      labelPatterns: [/add document/i, /upload/i, /\bcv\b/i, /resume/i, /załącz/i],
      fieldTypes: ['file'],
      required: true,
    },
    {
      id: 'cover_toggle',
      label: 'Attach a message',
      labelPatterns: [/attach a message/i, /message for the employer/i, /dołącz.*wiadomość/i],
      fieldTypes: ['switch', 'checkbox'],
      required: false,
    },
    {
      id: 'terms',
      label: 'Terms of Service',
      labelPatterns: [/creating an account/i, /terms of service/i, /privacy policy/i],
      fieldTypes: ['checkbox'],
      required: true,
    },
    {
      id: 'gdpr',
      label: 'GDPR consent',
      labelPatterns: [/wyrażam zgodę/i, /danych osobowych/i],
      fieldTypes: ['checkbox'],
      required: true,
    },
    {
      id: 'marketing',
      label: 'Marketing opt-in',
      labelPatterns: [/marketing information/i, /newsletter/i],
      fieldTypes: ['checkbox'],
      required: false,
    },
  ];

  const JUSTJOIN_EASY_APPLY = {
    id: 'justjoin_easy_apply',
    platform: 'justjoin',
    name: 'justjoin Easy Apply',
    description: 'Guest apply modal on job-offer pages — name, email, CV, consents, optional message toggle.',
    applyMethod: 'easy_apply',
    anticipatedFlowType: 'modal',
    canonicalExampleUrl: 'https://justjoin.it/job-offer/7n-sp-z-o-o--fullstack-developer-java-react--warszawa-java',
    priority: 100,
    urlPatterns: [/^https:\/\/(www\.)?justjoin\.it\/job-offer\//i],
    guestApply: true,
    detect,
    discovery: {
      openApplyForm: true,
      expandDynamicOnPreview: false,
      expandDynamicOnFill: true,
      postApplyWaitMs: 1200,
      scanPollMs: 6000,
      scanIntervalMs: 400,
      revealPollMs: 2500,
    },
    deferDocumentUploadToGpt: true,
    fillPolicy: {
      profileKeys: ['name', 'email'],
      savedAnswerKeys: [],
      skipSavedAnswerKeys: ['terms_accepted', 'gdpr_consent', 'cover_message', 'marketing_opt_in'],
      skipCategories: ['ai_generation', 'unknown'],
      deferDocumentUploadToGpt: true,
      fillProfileBeforeGpt: true,
      gptDocumentSlots: ['resume'],
      gptApplyDocumentsOnly: true,
    },
    expectedFields: EXPECTED_FIELDS,
    hooks: {
      scoreApplyButton,
      getApplicationScanRoots,
      getModalRoots,
      detectDynamicTriggers,
      revealDynamicFields,
      detectFlowType,
      buildWarnings: (scan, context) => buildWarnings(scan, context, EXPECTED_FIELDS),
      collectPageSignals,
      detectApplyModalFingerprint,
      isJustjoinEasyApplyModalOpen,
    },
  };

  registry.registerTemplate(JUSTJOIN_EASY_APPLY);
  window.__qtsJustjoinEasyApplyTemplate = JUSTJOIN_EASY_APPLY;
})();
