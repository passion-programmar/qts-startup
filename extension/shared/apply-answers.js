// Apply's answers for one form page. Facts come only from the candidate's profile and saved answers;
// questions they cannot answer go to the AI in one request, whose answers are checked before use.
// A required fact the profile lacks stops the application instead of being guessed.

(function initApplyAnswers(global) {
  const DECLINE = /decline|prefer not|don['’]?t wish|do not wish|not to (say|answer|disclose)|i do not want|rather not/i;
  const EEO = /\b(gender|sex|race|racial|ethnic|ethnicity|veteran|disabilit\w*|hispanic|latin[oa]|sexual orientation|pronouns?|transgender)\b/i;
  const CONSENT = /\b(agree|consent|acknowledge|privacy|terms|certify|confirm that|i have read|accurate|true and complete|data processing|gdpr)\b/i;
  const YES = /^(yes|y|true)$/i;
  const NO = /^(no|n|false)$/i;

  function normalizeQuestionKey(question) {
    return String(question || '')
      .toLowerCase()
      .replace(/\(\s*(optional|required)\s*\)/g, ' ')
      .replace(/[*:?!.,;"'()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  function labelOf(field) {
    return String(field.label || '')
      .replace(/[*✱]/g, ' ')
      .replace(/\(\s*(optional|required)\s*\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function hasOptions(field) {
    return Array.isArray(field.options) && field.options.length > 0;
  }

  /** The option whose text matches, for selects, radios, and comboboxes. */
  function pickOption(field, pattern) {
    if (!hasOptions(field)) return null;
    return field.options.find((option) => pattern.test(String(option))) ?? null;
  }

  function yesNoAnswer(field, value) {
    if (value === null || value === undefined) return null;
    if (hasOptions(field)) {
      const option = field.options.find((entry) => (value ? YES : NO).test(String(entry).trim()))
        ?? field.options.find((entry) => new RegExp(`^${value ? 'yes' : 'no'}\\b`, 'i').test(String(entry).trim()));
      return option ?? null;
    }
    if (field.kind === 'checkbox') return value;
    return value ? 'Yes' : 'No';
  }

  function salaryText(candidate) {
    if (!candidate.salaryExpectationAmount) return null;
    const period = { year: 'per year', month: 'per month', hour: 'per hour' }[candidate.salaryExpectationPeriod] || '';
    return [candidate.salaryExpectationAmount, candidate.salaryExpectationCurrency, period].filter(Boolean).join(' ');
  }

  // Each rule: the question it recognizes, and the candidate fact that answers it (or the missing fact's name).
  const RULES = [
    { test: /first and last name|full name|legal name|^(your )?name$|^name and surname$/, fact: (c) => [c.firstName, c.lastName].filter(Boolean).join(' ') || null, name: 'name' },
    { test: /\b(first|given|preferred) name\b|preferred first/, fact: (c) => c.firstName, name: 'first name' },
    { test: /\b(last|family) name\b|\bsurname\b/, fact: (c) => c.lastName, name: 'last name' },
    { test: /e-?mail/, fact: (c) => c.email, name: 'email' },
    { test: /\b(phone|mobile|telephone|cell)\b/, fact: (c) => c.phone, name: 'phone' },
    { test: /linkedin/, fact: (c) => c.linkedinUrl, name: 'LinkedIn profile', optionalIfMissing: true },
    { test: /github/, fact: (c) => c.githubUrl, name: 'GitHub', optionalIfMissing: true },
    { test: /portfolio|personal (web)?site|^website|other website/, fact: (c) => c.portfolioUrl, name: 'portfolio', optionalIfMissing: true },
    { test: /^(current )?city$|city of residence|^town( or city)?$/, fact: (c) => c.city, name: 'city' },
    { test: /^(current )?location$|where are you (located|based)|current location|^location of residence/, fact: (c) => [c.city, c.country].filter(Boolean).join(', ') || null, name: 'location' },
    { test: /^country( of residence)?$/, fact: (c) => c.country, name: 'country' },
    { test: /postal|post ?code|zip/, fact: (c) => c.postalCode, name: 'postal code' },
    { test: /second line of (your )?address|address line 2|apartment|suite/, fact: () => null, name: 'address line 2', optionalIfMissing: true },
    { test: /^(street )?address( line 1)?$|first line of (your )?address/, fact: (c) => c.addressLine1, name: 'address' },
    { test: /^(state|province|region)(\s*\/\s*(state|province|region))?$/, fact: (c) => c.province, name: 'state or province' },
    { test: /sponsor/, yesNo: (c) => c.needsSponsorship, name: 'visa sponsorship' },
    { test: /relocat/, yesNo: (c) => c.willingToRelocate, name: 'relocation' },
    { test: /notice period|when can you start|earliest start|availability to start/, fact: (c) => c.noticePeriod, name: 'notice period', textOnly: true },
    { test: /salary|compensation|pay expectation|expected (pay|rate)|desired pay/, salary: true, name: 'salary expectation' },
    { test: /^(total )?(years of (professional |work |relevant )?experience|how many years of experience( do you have)?)$/, fact: (c) => (c.yearsOfExperience ?? null), name: 'years of experience' },
  ];

  /**
   * One field's answer: { value, source } from the profile or saved answers, { missing } when a fact
   * the profile lacks is needed, { skip } for fields left as they are, or null to ask the AI.
   */
  function resolveField(field, candidate, savedAnswers) {
    const label = labelOf(field);
    if (field.kind === 'file') {
      // "Autofill from resume" parses the file and overwrites the answers already filled.
      if (/autofill/.test(label)) return { skip: 'The site\'s autofill-from-résumé upload.' };
      if (/cover/.test(label)) return { file: 'coverLetter', source: 'documents' };
      if (/resume|résumé|\bcv\b|curriculum/.test(label) || field.required) return { file: 'resume', source: 'documents' };
      return { skip: 'An optional upload that is not a résumé or cover letter.' };
    }
    // Required consent and certification boxes are ticked; optional ones (marketing, future jobs) are left.
    if (field.kind === 'checkbox' && !hasOptions(field) && CONSENT.test(label)) {
      return field.required ? { value: true, source: 'consent' } : { skip: 'Optional consent box.' };
    }
    if (EEO.test(label)) {
      if (candidate.eeoPreference === 'prefer_not_to_say') {
        const option = pickOption(field, DECLINE);
        if (option) return { value: option, source: 'profile' };
        return field.required ? null : { skip: 'Optional diversity question left unanswered.' };
      }
      return null;
    }
    if (/how did you (hear|find|learn)|where did you (hear|find)|referral source|^source$/.test(label)) {
      const option = pickOption(field, /linkedin/i) ?? pickOption(field, /job (board|site)|online|internet|website/i);
      if (option) return { value: option, source: 'rule' };
      if (!hasOptions(field)) return { value: 'LinkedIn', source: 'rule' };
      return null;
    }
    // Questions about someone else (a referrer, an employee you spoke to) never take the candidate's facts.
    if (/\b(employee|referr\w*|recruiter|their|someone|who referred|hiring manager)\b/.test(label)) return null;
    const saved = savedAnswers?.get(normalizeQuestionKey(field.label));
    if (saved) {
      if (!hasOptions(field) || field.options.includes(saved)) return { value: saved, source: 'saved' };
    }
    for (const rule of RULES) {
      if (!rule.test.test(label)) continue;
      if (rule.yesNo) {
        const value = yesNoAnswer(field, rule.yesNo(candidate));
        if (value !== null) return { value, source: 'profile' };
        return { missing: rule.name };
      }
      if (rule.salary) {
        if (!candidate.salaryExpectationAmount) return { missing: rule.name };
        const value = field.kind === 'number' ? String(candidate.salaryExpectationAmount) : salaryText(candidate);
        return hasOptions(field) ? null : { value, source: 'profile' };
      }
      const fact = rule.fact(candidate);
      if (fact === null || fact === undefined || fact === '') {
        if (rule.optionalIfMissing && !field.required) return { skip: `No ${rule.name} in the profile.` };
        return { missing: rule.name };
      }
      if (hasOptions(field)) {
        if (rule.textOnly) return null;
        const option = field.options.find((entry) => String(entry).toLowerCase() === String(fact).toLowerCase());
        return option ? { value: option, source: 'profile' } : null;
      }
      return { value: String(fact), source: 'profile' };
    }
    return null;
  }

  /** Splits a page's fields into answered, needing the AI, needing the Manager, and left alone. */
  function resolveFields(fields, candidate, savedAnswerRows) {
    const savedAnswers = new Map((savedAnswerRows || []).map((row) => [row.questionKey, row.answer]));
    const answers = {};
    const open = [];
    const missing = [];
    for (const field of fields) {
      if (field.hidden || field.disabled) continue;
      const resolved = resolveField(field, candidate, savedAnswers);
      if (!resolved) {
        if (field.kind !== 'checkbox' || field.required) open.push(field);
        continue;
      }
      if (resolved.missing) {
        if (field.required) missing.push({ id: field.id, label: field.label, fact: resolved.missing });
        continue;
      }
      if (resolved.skip) continue;
      answers[field.id] = resolved;
    }
    return { answers, open, missing };
  }

  /** The AI request for a page's open questions: one message, answered as strict JSON. */
  function buildAnswerPrompt({ job, candidate, documentsJson, fields }) {
    const facts = {
      name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' '),
      headline: candidate.headline,
      location: [candidate.city, candidate.country].filter(Boolean).join(', '),
      workAuthorization: candidate.workAuthorization,
      needsSponsorship: candidate.needsSponsorship,
      noticePeriod: candidate.noticePeriod,
      yearsOfExperience: candidate.yearsOfExperience,
      willingToRelocate: candidate.willingToRelocate,
    };
    const questions = fields.map((field) => ({
      id: field.id,
      question: field.label,
      type: field.kind,
      required: Boolean(field.required),
      ...(hasOptions(field) ? { options: field.options } : {}),
      ...(field.maxLength ? { maxLength: field.maxLength } : {}),
    }));
    return [
      'You are filling in a job application form for the candidate below.',
      'Answer every question in the list. Use only the candidate facts and the résumé content; never invent employers, degrees, certifications, numbers, or skills that are not there.',
      'For a question with options, answer with exactly one of the options, copied character for character.',
      'Keep each answer within its maxLength. Write free-text answers in the first person, specific to this job, plain text without markdown.',
      'If the facts do not answer a factual question (for example a date, a licence, a clearance), answer with an empty string.',
      'Reply with JSON only, in this shape: {"answers":[{"id":"<question id>","value":"<answer>"}]}',
      '',
      `Job: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ''}`,
      `Job description:\n${String(job.description || '').slice(0, 12000)}`,
      '',
      `Candidate facts:\n${JSON.stringify(facts)}`,
      `Résumé and cover letter content:\n${String(documentsJson || '').slice(0, 15000)}`,
      '',
      `Questions:\n${JSON.stringify(questions)}`,
    ].join('\n');
  }

  /** { ok: true, value } with the cleaned answer, or { ok: false, reason }. */
  function checkAnswer(field, value) {
    if (value === null || value === undefined) return { ok: false, reason: 'no answer' };
    const text = String(value).trim();
    if (!text) return { ok: false, reason: 'empty answer' };
    if (hasOptions(field)) {
      const option = field.options.find((entry) => String(entry).trim() === text)
        ?? field.options.find((entry) => String(entry).trim().toLowerCase() === text.toLowerCase());
      return option === undefined
        ? { ok: false, reason: `"${text}" is not one of the options` }
        : { ok: true, value: option };
    }
    if (field.maxLength && text.length > field.maxLength) {
      return { ok: false, reason: `longer than ${field.maxLength} characters` };
    }
    if (field.kind === 'number' && !/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, reason: 'not a number' };
    if (field.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return { ok: false, reason: 'not an email address' };
    return { ok: true, value: text };
  }

  /**
   * The AI's answers matched to the open fields: { answers, invalid } where invalid lists each
   * unusable answer with its reason, for the one fix-up request.
   */
  function parseAnswerReply(text, fields) {
    const source = String(text || '');
    let parsed = null;
    const candidates = [...[...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]), source];
    for (const candidate of candidates) {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start < 0 || end <= start) continue;
      try {
        parsed = JSON.parse(candidate.slice(start, end + 1));
        break;
      } catch {
        // Try the next candidate.
      }
    }
    const replies = new Map(Array.isArray(parsed?.answers)
      ? parsed.answers.filter((entry) => entry && typeof entry.id === 'string').map((entry) => [entry.id, entry.value])
      : []);
    const answers = {};
    const invalid = [];
    for (const field of fields) {
      const checked = checkAnswer(field, replies.get(field.id));
      if (checked.ok) answers[field.id] = { value: checked.value, source: 'ai' };
      else invalid.push({ id: field.id, label: field.label, reason: checked.reason });
    }
    return { answers, invalid };
  }

  function buildFixPrompt(invalid) {
    return [
      'Some answers could not be used. Answer only these again, following the same rules:',
      JSON.stringify(invalid),
      'Reply with JSON only: {"answers":[{"id":"<question id>","value":"<answer>"}]}',
    ].join('\n');
  }

  const api = { normalizeQuestionKey, resolveField, resolveFields, buildAnswerPrompt, checkAnswer, parseAnswerReply, buildFixPrompt };
  global.__qtsApplyAnswers = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
