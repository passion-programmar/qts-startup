// Deterministic candidate profile value matching and normalization (no AI)

const PROFILE_AUTOCOMPLETE_MAP = {
  name: ['name', 'fullname'],
  firstName: ['given-name', 'fname'],
  lastName: ['family-name', 'lname'],
  email: ['email'],
  phone: ['tel', 'tel-national', 'tel-local'],
  linkedinUrl: ['url'],
};

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return String(value || '').trim();
}

function normalizeUrlValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes('linkedin.com')) return `https://${trimmed.replace(/^\/+/, '')}`;
  return trimmed;
}

function normalizeMonthYear(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return text;
}

function buildCandidateProfileMap(candidate) {
  const nameParts = splitName(candidate?.name);
  return {
    name: String(candidate?.name || '').trim(),
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    email: String(candidate?.email || '').trim(),
    phone: normalizePhone(candidate?.phone),
    linkedinUrl: normalizeUrlValue(candidate?.linkedin_url || candidate?.linkedinUrl),
    stack: String(candidate?.stack || '').trim(),
    notes: String(candidate?.notes || '').trim(),
  };
}

function buildSavedAnswerMap(savedAnswers) {
  const defaults = {
    terms_accepted: 'true',
    gdpr_consent: 'true',
    marketing_opt_in: 'false',
    cover_message: 'false',
  };
  const map = { ...defaults };
  for (const row of savedAnswers || []) {
    const key = row.answerKey || row.answer_key;
    const value = row.answerValue || row.answer_value;
    if (key && value != null && value !== '') map[key] = String(value).trim();
  }
  return map;
}

function getProfileValue(profileKey, profileMap) {
  if (!profileKey || !profileMap) return null;
  const value = profileMap[profileKey];
  if (!value) return null;
  return value;
}

function getSavedAnswerValue(savedAnswerKey, savedMap) {
  if (!savedAnswerKey || !savedMap) return null;
  const value = savedMap[savedAnswerKey];
  if (!value) return null;
  return value;
}

function resolveFillValue(field, profileMap, savedMap) {
  if (field.category === 'candidate_profile' && field.profileKey) {
    return getProfileValue(field.profileKey, profileMap);
  }
  if (field.category === 'saved_answer' && field.savedAnswerKey) {
    return getSavedAnswerValue(field.savedAnswerKey, savedMap);
  }
  return null;
}

function applyFieldClassificationFill(fields, candidate, savedAnswers, options = {}) {
  const profileMap = buildCandidateProfileMap(candidate);
  const savedMap = buildSavedAnswerMap(savedAnswers);
  const respectPageState = options.respectPageState !== false;

  return fields.map((field) => {
    const next = { ...field };

    if (next.requiresReview || next.status === 'ambiguous' || next.status === 'unresolved') {
      next.fillStatus = 'needs_review';
      next.fillValue = null;
      return next;
    }

    if (next.fieldType === 'checkbox' || next.fieldType === 'switch') {
      if (respectPageState && next.currentValue != null && next.currentValue !== '') {
        next.fillValue = String(next.currentValue);
        next.fillStatus = 'filled';
        return next;
      }
      const boolFill = resolveFillValue(next, profileMap, savedMap);
      next.fillValue = boolFill != null ? String(boolFill) : String(next.currentValue || 'false');
      next.fillStatus = 'filled';
      return next;
    }

    const fillValue = resolveFillValue(next, profileMap, savedMap);

    if (next.category === 'ai_generation') {
      next.fillStatus = next.required ? 'awaiting_answer' : 'pending';
      return next;
    }

    if (next.fieldType === 'file' || next.category === 'document_upload') {
      next.fillStatus = 'awaiting_answer';
      next.fillValue = null;
      next.generatedAnswer = next.documentSlot || 'resume';
      return next;
    }

    if (!fillValue) {
      next.fillStatus = 'skipped';
      next.fillValue = null;
      return next;
    }

    next.fillValue = fillValue;
    next.fillStatus = 'filled';
    return next;
  });
}

const candidateMatcherExport = {
  splitName,
  normalizePhone,
  normalizeUrlValue,
  normalizeMonthYear,
  buildCandidateProfileMap,
  buildSavedAnswerMap,
  resolveFillValue,
  applyFieldClassificationFill,
  PROFILE_AUTOCOMPLETE_MAP,
};

if (typeof window !== 'undefined') {
  window.__qtsCandidateMatcher = candidateMatcherExport;
}
if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  self.__qtsCandidateMatcher = candidateMatcherExport;
}
