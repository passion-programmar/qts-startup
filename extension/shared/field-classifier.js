// Deterministic field classification (no AI)

const PROFILE_PATTERNS = [
  { key: 'firstName', patterns: [/\bfirst[\s_-]?name\b/i, /\bgiven[\s_-]?name\b/i, /\bfname\b/i] },
  { key: 'lastName', patterns: [/\blast[\s_-]?name\b/i, /\bfamily[\s_-]?name\b/i, /\bsurname\b/i, /\blname\b/i] },
  { key: 'name', patterns: [/\bfull[\s_-]?name\b/i, /\blegal[\s_-]?name\b/i, /\bname\b/i, /\bapplicant[\s_-]?name\b/i] },
  { key: 'email', patterns: [/\be[\s-]?mail\b/i, /\bemail[\s_-]?address\b/i] },
  { key: 'phone', patterns: [/\bphone\b/i, /\bmobile\b/i, /\bcell\b/i, /\btelephone\b/i, /\bcontact[\s_-]?number\b/i] },
  { key: 'linkedinUrl', patterns: [/\blinkedin\b/i, /\bprofile[\s_-]?url\b/i, /\bportfolio[\s_-]?url\b/i] },
  { key: 'address', patterns: [/\baddress\b/i, /\bstreet[\s_-]?address\b/i] },
  { key: 'city', patterns: [/\bcity\b/i] },
  { key: 'country', patterns: [/\bcountry\b/i] },
];

const SAVED_ANSWER_PATTERNS = [
  { key: 'notice_period', patterns: [/\bnotice[\s_-]?period\b/i, /\bavailability\b/i, /\bstart[\s_-]?date\b/i, /\bwhen can you start\b/i] },
  { key: 'expected_salary', patterns: [/\bsalary\b/i, /\bcompensation\b/i, /\bpay[\s_-]?expectation\b/i, /\bdesired[\s_-]?salary\b/i, /\bexpected[\s_-]?salary\b/i] },
  { key: 'relocation', patterns: [/\brelocation\b/i, /\bwilling to relocate\b/i, /\bopen to relocate\b/i] },
  { key: 'remote_preference', patterns: [/\bremote\b/i, /\bwork[\s_-]?from[\s_-]?home\b/i, /\bhybrid\b/i] },
  { key: 'work_authorization', patterns: [/\bwork[\s_-]?authorization\b/i, /\blegally authorized\b/i, /\beligible to work\b/i, /\bright to work\b/i] },
  { key: 'sponsorship', patterns: [/\bsponsorship\b/i, /\bvisa[\s_-]?sponsor\b/i, /\brequire[\s_-]?sponsor\b/i, /\bneed[\s_-]?sponsor\b/i] },
  { key: 'terms_accepted', patterns: [/\bterms of service\b/i, /\bprivacy policy\b/i, /\baccept the terms\b/i, /\bcreating an account\b/i] },
  { key: 'gdpr_consent', patterns: [/\bwyrażam zgodę\b/i, /\bdanych osobowych\b/i, /\bgdpr\b/i, /\bpersonal data\b/i] },
  { key: 'marketing_opt_in', patterns: [/\bmarketing information\b/i, /\bnewsletter\b/i, /\bpartners\b/i, /\bmarketing_consent\b/i] },
  { key: 'cover_message', patterns: [/\battach a message\b/i, /\bmessage for the employer\b/i, /\bcover letter\b/i, /\bdołącz.*wiadomość\b/i] },
];

const NARRATIVE_HINTS = [
  /\bwhy\b/i,
  /\bdescribe\b/i,
  /\bexplain\b/i,
  /\btell us\b/i,
  /\bcover letter\b/i,
  /\bexperience with\b/i,
  /\bchallenging\b/i,
  /\bproject\b/i,
  /\bstatement\b/i,
  /\bessay\b/i,
  /\badditional information\b/i,
];

function normalizeText(...parts) {
  return parts
    .flatMap((part) => String(part || '').split(/\s+/))
    .join(' ')
    .trim()
    .toLowerCase();
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferFromAutocomplete(autocomplete) {
  const value = String(autocomplete || '').toLowerCase();
  if (!value) return null;
  if (value.includes('given-name')) return { category: 'candidate_profile', profileKey: 'firstName' };
  if (value.includes('family-name')) return { category: 'candidate_profile', profileKey: 'lastName' };
  if (value === 'name') return { category: 'candidate_profile', profileKey: 'name' };
  if (value.includes('email')) return { category: 'candidate_profile', profileKey: 'email' };
  if (value.includes('tel')) return { category: 'candidate_profile', profileKey: 'phone' };
  if (value.includes('street-address')) return { category: 'candidate_profile', profileKey: 'address' };
  if (value.includes('address-level2')) return { category: 'candidate_profile', profileKey: 'city' };
  if (value.includes('country-name')) return { category: 'candidate_profile', profileKey: 'country' };
  if (value === 'url') return { category: 'candidate_profile', profileKey: 'linkedinUrl' };
  return null;
}

function inferFromNameAttr(nameAttr, fieldType) {
  const value = String(nameAttr || '').toLowerCase();
  if (!value) return null;
  if (/\bmarketing\b/.test(value)) return { category: 'saved_answer', savedAnswerKey: 'marketing_opt_in' };
  if (/\bfuture_consent\b/.test(value) || /\bgdpr\b/.test(value)) {
    return { category: 'saved_answer', savedAnswerKey: 'gdpr_consent' };
  }
  if (/\bcreate_account\b/.test(value) || /\bterms\b/.test(value)) {
    return { category: 'saved_answer', savedAnswerKey: 'terms_accepted' };
  }
  if (['checkbox', 'radio', 'switch', 'file'].includes(fieldType)) return null;
  if (/\b(first|given|fname)\b/.test(value)) return { category: 'candidate_profile', profileKey: 'firstName' };
  if (/\b(last|family|lname|surname)\b/.test(value)) return { category: 'candidate_profile', profileKey: 'lastName' };
  if (/\b(full)?name\b/.test(value)) return { category: 'candidate_profile', profileKey: 'name' };
  if (/\bemail\b/.test(value)) return { category: 'candidate_profile', profileKey: 'email' };
  if (/\b(phone|mobile|tel)\b/.test(value)) return { category: 'candidate_profile', profileKey: 'phone' };
  if (/\blinkedin\b/.test(value)) return { category: 'candidate_profile', profileKey: 'linkedinUrl' };
  if (/\b(address|street)\b/.test(value)) return { category: 'candidate_profile', profileKey: 'address' };
  if (/\bcity\b/.test(value)) return { category: 'candidate_profile', profileKey: 'city' };
  if (/\bcountry\b/.test(value)) return { category: 'candidate_profile', profileKey: 'country' };
  return null;
}

function isChoiceOrUploadField(fieldType) {
  return ['checkbox', 'radio', 'switch', 'file'].includes(fieldType);
}

function classifyField(field) {
  const fieldType = field.fieldType || 'text';
  const text = normalizeText(field.label, field.placeholder, field.sectionHeading, field.nameAttr);
  const status = field.status || 'ambiguous';

  if (status === 'unresolved' && fieldType !== 'file') {
    return { category: 'needs_review', reason: 'field_unresolved' };
  }

  if (!isChoiceOrUploadField(fieldType)) {
    const autocompleteHint = inferFromAutocomplete(field.autocompleteAttr);
    if (autocompleteHint) return autocompleteHint;
  }

  const nameHint = inferFromNameAttr(field.nameAttr, fieldType);
  if (nameHint) return nameHint;

  for (const item of SAVED_ANSWER_PATTERNS) {
    if (matchesAny(text, item.patterns)) {
      return { category: 'saved_answer', savedAnswerKey: item.key };
    }
  }

  if (!isChoiceOrUploadField(fieldType)) {
    for (const item of PROFILE_PATTERNS) {
      if (matchesAny(text, item.patterns)) {
        return { category: 'candidate_profile', profileKey: item.key };
      }
    }
  }

  const isLongText = field.fieldType === 'textarea'
    || field.fieldType === 'contenteditable'
    || (field.fieldType === 'text' && String(field.label || '').length > 40);

  const isManualControl = field.fieldType === 'file'
    || field.fieldType === 'switch';

  if (field.fieldType === 'switch') {
    const switchText = normalizeText(field.label, field.placeholder, field.nameAttr);
    if (/attach.*message|message for the employer|cover letter/i.test(switchText)) {
      return { category: 'saved_answer', savedAnswerKey: 'cover_message' };
    }
    return { category: 'saved_answer', savedAnswerKey: 'cover_message' };
  }

  if (field.fieldType === 'checkbox' && field.required) {
    return { category: 'saved_answer', savedAnswerKey: 'terms_accepted' };
  }

  const riskyPatterns = [/passport/i, /social security/i, /ssn/i, /national id/i, /id number/i, /citizenship/i, /visa/i];
  if (matchesAny(text, riskyPatterns) && status !== 'matched') {
    return { category: 'needs_review', reason: 'sensitive_field_unresolved' };
  }

  const looksNarrative = matchesAny(text, NARRATIVE_HINTS) || isLongText;
  if (looksNarrative) {
    return { category: 'ai_generation' };
  }

  if (field.required && !isManualControl) {
    return { category: 'ai_generation' };
  }

  if (isManualControl) {
    if (field.fieldType === 'file') {
      const text = normalizeText(field.label, field.placeholder, field.nameAttr);
      if (/cover|message|letter/.test(text)) {
        return { category: 'document_upload', documentSlot: 'cover_letter' };
      }
      return { category: 'document_upload', documentSlot: 'resume' };
    }
    return { category: 'unknown' };
  }

  if (status === 'ambiguous' && field.required) {
    return { category: 'needs_review', reason: 'ambiguous_required_field' };
  }

  return { category: 'unknown' };
}

function classifyFields(fields) {
  return fields.map((field) => {
    const inferred = classifyField(field);
    const requiresReview = field.status === 'ambiguous'
      || field.status === 'unresolved'
      || inferred.category === 'needs_review'
      || inferred.category === 'unknown';

    return {
      ...field,
      category: inferred.category,
      profileKey: inferred.profileKey || null,
      savedAnswerKey: inferred.savedAnswerKey || null,
      documentSlot: inferred.documentSlot || null,
      requiresReview,
      statusReason: inferred.reason || null,
    };
  });
}

if (typeof window !== 'undefined') {
  window.__qtsFieldClassifier = { classifyField, classifyFields };
}
if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  self.__qtsFieldClassifier = { classifyField, classifyFields };
}
