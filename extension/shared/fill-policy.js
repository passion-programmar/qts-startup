// Template-driven rules for which discovered fields are filled on confirm.

const TEMPLATE_FILL_POLICIES = {
  justjoin_easy_apply: {
    profileKeys: ['name', 'email'],
    savedAnswerKeys: [],
    skipSavedAnswerKeys: ['terms_accepted', 'gdpr_consent', 'cover_message', 'marketing_opt_in'],
    skipCategories: ['ai_generation', 'unknown'],
    deferDocumentUploadToGpt: true,
    fillProfileBeforeGpt: true,
    gptDocumentSlots: ['resume'],
    gptApplyDocumentsOnly: true,
  },
};

function getFillPolicyForTemplate(templateId) {
  if (!templateId) return null;
  return TEMPLATE_FILL_POLICIES[templateId] || null;
}

function applyFillPolicy(fields, policy, context = {}) {
  if (!policy) return fields;

  const matcher = (typeof window !== 'undefined' ? window.__qtsCandidateMatcher : null)
    || (typeof self !== 'undefined' ? self.__qtsCandidateMatcher : null);
  const profileMap = context.candidate && matcher?.buildCandidateProfileMap
    ? matcher.buildCandidateProfileMap(context.candidate)
    : {};
  const savedMap = context.savedAnswers && matcher?.buildSavedAnswerMap
    ? matcher.buildSavedAnswerMap(context.savedAnswers)
    : {};

  const allowedProfile = new Set(policy.profileKeys || []);
  const allowedSaved = new Set(policy.savedAnswerKeys || []);
  const skipSaved = new Set(policy.skipSavedAnswerKeys || []);
  const skipCategories = new Set(policy.skipCategories || ['document_upload', 'ai_generation']);
  const overrides = policy.savedAnswerOverrides || {};

  return (fields || []).map((field) => {
    const next = { ...field };

    if ((next.fieldType === 'file' || next.category === 'document_upload')
      && policy.deferDocumentUploadToGpt) {
      next.category = 'document_upload';
      next.documentSlot = next.documentSlot || 'resume';
      next.fillStatus = 'awaiting_answer';
      next.fillValue = null;
      next.generatedAnswer = next.documentSlot;
      return next;
    }

    if (skipCategories.has(next.category) || next.fieldType === 'file') {
      next.fillStatus = 'skipped';
      next.fillValue = null;
      delete next.generatedAnswer;
      return next;
    }

    if (next.category === 'candidate_profile') {
      if (!allowedProfile.has(next.profileKey)) {
        next.fillStatus = 'skipped';
        next.fillValue = null;
        return next;
      }
      const value = profileMap[next.profileKey] || next.fillValue;
      if (value) {
        next.fillValue = value;
        next.fillStatus = 'filled';
      } else {
        next.fillStatus = 'skipped';
        next.fillValue = null;
      }
      return next;
    }

    if (next.category === 'saved_answer' || next.fieldType === 'switch') {
      const key = next.savedAnswerKey;
      if (!key || skipSaved.has(key) || !allowedSaved.has(key)) {
        next.fillStatus = 'skipped';
        next.fillValue = null;
        return next;
      }
      const override = overrides[key];
      const value = override != null
        ? String(override)
        : (matcher?.getSavedAnswerValue?.(key, savedMap) ?? next.fillValue);
      next.fillValue = value;
      next.fillStatus = value != null && value !== '' ? 'filled' : 'skipped';
      return next;
    }

    if (policy.skipUnknown !== false) {
      next.fillStatus = 'skipped';
      next.fillValue = null;
    }
    return next;
  });
}

function getEarlyProfileFillFields(fields, policy) {
  if (!policy?.fillProfileBeforeGpt) return [];
  const allowed = new Set(policy.profileKeys || []);
  return (fields || []).filter((field) => field.category === 'candidate_profile'
    && allowed.has(field.profileKey)
    && field.fillStatus === 'filled'
    && field.fillValue);
}

function applyEarlyFillResults(fields, fillResults) {
  const resultById = new Map((fillResults || []).map((item) => [item.stableFieldId, item]));
  return (fields || []).map((field) => {
    const outcome = resultById.get(field.stableFieldId);
    if (!outcome) return field;
    if (outcome.ok) return { ...field, fillStatus: 'filled' };
    return { ...field, fillStatus: 'error' };
  });
}

if (typeof window !== 'undefined') {
  window.__qtsFillPolicy = {
    TEMPLATE_FILL_POLICIES,
    getFillPolicyForTemplate,
    applyFillPolicy,
    getEarlyProfileFillFields,
    applyEarlyFillResults,
  };
}
if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  self.__qtsFillPolicy = {
    TEMPLATE_FILL_POLICIES,
    getFillPolicyForTemplate,
    applyFillPolicy,
    getEarlyProfileFillFields,
    applyEarlyFillResults,
  };
}
