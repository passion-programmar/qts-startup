// Apply's answers for one form page. Facts come only from the candidate's profile and saved answers;
// questions they cannot answer go to the AI in one request, whose answers are checked before use.
// A required fact the profile lacks stops the application instead of being guessed.

(function initApplyAnswers(global) {
  const DECLINE = /decline|prefer not|don['’]?t wish|do not wish|not to (say|answer|disclose)|i do not want|rather not/i;
  const EEO = /\b(gender|sex|race|racial|ethnic|ethnicity|veteran|disabilit\w*|hispanic|latin[oa]|sexual orientation|pronouns?|transgender)\b/i;
  const CONSENT = /\b(agree|consent|acknowledge|privacy|terms|certify|confirm that|i have read|accurate|true and complete|data processing|gdpr)\b/i;
  // Opt-ins a person may refuse without losing the application.
  const OPT_IN = /\b(marketing|newsletters?|future (jobs|roles|opportunities|vacancies|positions)|other (jobs|roles|opportunities|positions)|talent (pool|community|network)|sms|text messages?|updates|offers|promotional|job alerts?)\b/i;
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

  // Salary arithmetic uses standard full-time working time: 8 hours a day, 260 working days a year.
  const HOURS_IN = { hour: 1, day: 8, month: 2080 / 12, year: 2080 };
  const PERIOD_WORDS = { year: 'per year', month: 'per month', day: 'per day', hour: 'per hour' };
  const PERIOD_PATTERNS = [
    ['hour', /\bhourly\b|\bper hour\b|\ban hour\b|\/\s*(h|hr|hour)\b/i],
    ['day', /\bdaily\b|\bper day\b|\bday rate\b|\ba day\b|\/\s*(d|day)\b/i],
    ['month', /\bmonthly\b|\bper month\b|\ba month\b|\/\s*(mo|mth|month)\b/i],
    ['year', /\bannual(ly)?\b|\byearly\b|\bper (year|annum)\b|\ba year\b|\bp\.\s?a\b|\/\s*(y|yr|year)\b/i],
  ];
  const CURRENCY_SYMBOLS = [['US$', 'USD'], ['CA$', 'CAD'], ['AU$', 'AUD'], ['C$', 'CAD'], ['A$', 'AUD'], ['€', 'EUR'], ['£', 'GBP'], ['zł', 'PLN'], ['₹', 'INR'], ['$', 'USD']];
  const CURRENCY_WORDS = [[/\beuros?\b/i, 'EUR'], [/\b(us )?dollars?\b/i, 'USD'], [/\bpounds?( sterling)?\b/i, 'GBP'], [/\bz[łl]oty\b/i, 'PLN']];
  const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'PLN', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'CZK', 'HUF', 'RON', 'BGN', 'UAH', 'INR', 'JPY', 'CNY', 'SGD', 'HKD', 'ZAR', 'BRL', 'MXN', 'TRY', 'ILS', 'AED'];

  function periodIn(text) {
    const source = String(text || '');
    return PERIOD_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? null;
  }

  /** The currency a question or option names by code, symbol, or word; null when it names none. */
  function currencyIn(text, exchangeRates) {
    const source = String(text || '');
    const codes = new Set([...CURRENCY_CODES, ...Object.keys(exchangeRates?.rates || {})]);
    for (const [code] of source.matchAll(/\b[A-Z]{3}\b/g)) {
      if (codes.has(code)) return code;
    }
    // An option that runs the code into the name ("EUREuro", "USDUS Dollar").
    const lead = source.match(/^([A-Z]{3})(?=[A-Z][a-z]|[^A-Za-z]|$)/)?.[1];
    if (lead && codes.has(lead)) return lead;
    for (const [symbol, code] of CURRENCY_SYMBOLS) {
      if (source.includes(symbol)) return code;
    }
    return CURRENCY_WORDS.find(([pattern]) => pattern.test(source))?.[1] ?? null;
  }

  /** The candidate's salary for a period and currency, rounded; null when the currency cannot be converted. */
  function convertSalary(candidate, period, currency, exchangeRates) {
    const ownPeriod = candidate.salaryExpectationPeriod;
    if (!candidate.salaryExpectationAmount || !HOURS_IN[ownPeriod] || !HOURS_IN[period]) return null;
    let value = (candidate.salaryExpectationAmount * HOURS_IN[period]) / HOURS_IN[ownPeriod];
    const from = candidate.salaryExpectationCurrency;
    if (currency && from && currency !== from) {
      const fromRate = exchangeRates?.rates?.[from];
      const toRate = exchangeRates?.rates?.[currency];
      if (!fromRate || !toRate) return null;
      value = (value / fromRate) * toRate;
    }
    return period === 'year' || period === 'month' ? Math.round(value) : Math.round(value * 100) / 100;
  }

  function salaryText(candidate) {
    if (!candidate.salaryExpectationAmount) return null;
    const period = PERIOD_WORDS[candidate.salaryExpectationPeriod] || '';
    return [candidate.salaryExpectationAmount, candidate.salaryExpectationCurrency, period].filter(Boolean).join(' ');
  }

  /** The salary in every period, in the candidate's currency and each other one asked, for the AI. */
  function salaryEquivalents(candidate, currencies, exchangeRates) {
    const result = {};
    for (const currency of new Set([candidate.salaryExpectationCurrency, ...currencies].filter(Boolean))) {
      const figures = {};
      for (const period of Object.keys(PERIOD_WORDS)) {
        const amount = convertSalary(candidate, period, currency, exchangeRates);
        if (amount !== null) figures[period] = amount;
      }
      if (Object.keys(figures).length) result[currency] = figures;
    }
    return result;
  }

  /** An option's salary range as [low, high]: "€50,000 - €70,000", "50k–70k", "Under 40k", "100k+". */
  function parseRange(option) {
    const text = String(option).toLowerCase().replace(/(\d)[,\s](?=\d{3}\b)/g, '$1');
    const numbers = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(k|m)?\b/g)]
      .map(([, number, unit]) => Number(number) * (unit === 'k' ? 1000 : unit === 'm' ? 1000000 : 1));
    if (!numbers.length) return null;
    if (/less than|under|below|up to|<|\bmax/.test(text)) return [0, numbers[0]];
    if (/\+|more than|over|above|>|at least|or more|\bmin/.test(text)) return [numbers[0], Infinity];
    return numbers.length >= 2 ? [numbers[0], numbers[1]] : [numbers[0], numbers[0]];
  }

  /**
   * A salary question: the figure for the period and currency it asks, worked out here rather than by
   * the AI. A question naming no period gets the candidate's own wording, or the AI when only a number fits.
   */
  function resolveSalary(field, label, candidate, exchangeRates) {
    if (!candidate.salaryExpectationAmount) return { missing: 'salary expectation' };
    const ownPeriod = candidate.salaryExpectationPeriod;
    const ownCurrency = candidate.salaryExpectationCurrency;
    const askedPeriod = periodIn(field.label);
    const askedCurrency = currencyIn(field.label, exchangeRates);
    if (hasOptions(field)) {
      const numbered = field.options.filter((option) => /\d/.test(String(option)));
      // A separate period or currency choice takes the candidate's own, so the amount field keeps their figure.
      if (!numbered.length && field.options.filter((option) => periodIn(option)).length >= 2) {
        const option = field.options.find((entry) => periodIn(entry) === ownPeriod);
        return option ? { value: option, source: 'profile' } : null;
      }
      if (!numbered.length && field.options.some((option) => currencyIn(option, exchangeRates))) {
        const option = field.options.find((entry) => currencyIn(entry, exchangeRates) === ownCurrency);
        return option ? { value: option, source: 'profile' } : null;
      }
      let best = null;
      for (const option of numbered) {
        const range = parseRange(option);
        const period = periodIn(option) || askedPeriod;
        if (!range || !period) return null;
        const amount = convertSalary(candidate, period, currencyIn(option, exchangeRates) || askedCurrency || ownCurrency, exchangeRates);
        if (amount === null) return null;
        const distance = amount < range[0] ? range[0] - amount : amount > range[1] ? amount - range[1] : 0;
        if (!best || distance < best.distance) best = { option, distance };
      }
      return best ? { value: best.option, source: 'profile' } : null;
    }
    // "Currency" or "Salary currency" alone asks for the code, not an amount.
    if (/\bcurrency\b/.test(label) && !/\b(amount|how much|figure|and currency)\b/.test(label)) {
      return { value: ownCurrency, source: 'profile' };
    }
    const currency = askedCurrency || ownCurrency;
    if (!askedPeriod && field.kind === 'number') return null;
    const period = askedPeriod || ownPeriod;
    const amount = convertSalary(candidate, period, currency, exchangeRates);
    if (amount === null) return null;
    return { value: field.kind === 'number' ? String(amount) : `${amount} ${currency} ${PERIOD_WORDS[period]}`, source: 'profile' };
  }

  function noticeDays(candidate) {
    return candidate.noticePeriod === '1_week' ? 7 : 0;
  }

  function startDate(candidate, today) {
    const date = new Date(today || Date.now());
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + noticeDays(candidate));
  }

  /** A date as the field's placeholder shows it (DD/MM/YYYY, MM.DD.YYYY...), else YYYY-MM-DD. */
  function formatDate(date, placeholder) {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const pattern = String(placeholder || '').trim();
    if (/^(dd|mm|yyyy)([./\- ])(dd|mm|yyyy)\2(dd|mm|yyyy)$/i.test(pattern)) {
      return pattern.replace(/yyyy/i, year).replace(/mm/i, month).replace(/dd/i, day);
    }
    return `${year}-${month}-${day}`;
  }

  /** How many days an option means: "Immediately" 0, "2 weeks" 14, "1 month" 30; null when it says none. */
  function optionDays(option) {
    const text = String(option).toLowerCase();
    if (/immediate|asap|as soon as possible|right away|straight away|\bnow\b/.test(text)) return 0;
    const match = text.match(/(\d+|one|two|three|four|six)\s*(day|week|month)/);
    if (!match) return null;
    const count = { one: 1, two: 2, three: 3, four: 4, six: 6 }[match[1]] ?? Number(match[1]);
    return count * { day: 1, week: 7, month: 30 }[match[2]];
  }

  /** Notice and start questions: immediately or in 1 week, as a choice, a date, or words. */
  function resolveNotice(field, label, candidate, today) {
    const days = noticeDays(candidate);
    if (hasOptions(field)) {
      const choices = field.options.map((option) => ({ option, days: optionDays(option) })).filter((entry) => entry.days !== null);
      if (!choices.length) return null;
      const fitting = choices.filter((entry) => entry.days <= days).sort((a, b) => b.days - a.days)[0];
      const shortest = [...choices].sort((a, b) => a.days - b.days)[0];
      return { value: (fitting ?? shortest).option, source: 'profile' };
    }
    // A number or slider counts in its unit (Teamtailor: weeks); 1 week in months rounds up to 1.
    if (field.kind === 'range' || field.kind === 'number') {
      const unit = `${field.unit || ''} ${label}`;
      const unitDays = /\bdays?\b/.test(unit) ? 1 : /\bweeks?\b/.test(unit) ? 7 : /\bmonths?\b/.test(unit) ? 30 : null;
      if (!unitDays) return days ? null : { value: '0', source: 'profile' };
      let count = days ? Math.max(1, Math.ceil(days / unitDays)) : 0;
      if (Number.isFinite(field.min)) count = Math.max(count, field.min);
      if (Number.isFinite(field.max)) count = Math.min(count, field.max);
      return { value: String(count), source: 'profile' };
    }
    if (field.kind === 'date' || /\bdate\b/.test(label)) {
      const date = startDate(candidate, today);
      return { value: field.kind === 'date' ? formatDate(date) : formatDate(date, field.placeholder), source: 'profile' };
    }
    if (!days) return { value: 'Immediately', source: 'profile' };
    return { value: /notice/.test(label) ? '1 week' : 'In 1 week', source: 'profile' };
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
    { test: /notice period|when can you start|earliest start|availability to start|available to start|start date|date (you are |you're )?available/, notice: true, name: 'notice period' },
    { test: /salary|compensation|pay expectation|expected (pay|rate)|desired (pay|rate)|\b(hourly|daily|day) rate\b|rate expectation|\bpay (period|frequency)\b|^(payment |salary )?frequency$|\bcurrency\b/, salary: true, name: 'salary expectation' },
    { test: /^(total )?(years of (professional |work |relevant )?experience|how many years of (professional |work )?experience( do you have)?)\??$/, fact: (c) => (c.yearsOfExperience ?? null), years: true, name: 'years of experience' },
  ];

  /**
   * One field's answer: { value, source } from the profile or saved answers, { missing } when a fact
   * the profile lacks is needed, { skip } for fields left as they are, or null to ask the AI.
   */
  function resolveField(field, candidate, savedAnswers, context = {}) {
    const label = labelOf(field);
    if (field.kind === 'file') {
      // "Autofill from resume" parses the file and overwrites the answers already filled.
      if (/autofill/.test(label)) return { skip: 'The site\'s autofill-from-résumé upload.' };
      if (/cover/.test(label)) return { file: 'coverLetter', source: 'documents' };
      if (/resume|résumé|\bcv\b|curriculum/.test(label) || field.required) return { file: 'resume', source: 'documents' };
      return { skip: 'An optional upload that is not a résumé or cover letter.' };
    }
    // Required consent and certification boxes are ticked; optional ones (marketing, future jobs) are left.
    // Agreeing to the terms or privacy policy is needed to apply even when the box is not marked required.
    if (field.kind === 'checkbox' && !hasOptions(field) && CONSENT.test(label)) {
      const neededToApply = field.required || (/\b(terms|privacy|data processing|gdpr)\b/.test(label) && !OPT_IN.test(label));
      return neededToApply ? { value: true, source: 'consent' } : { skip: 'Optional consent box.' };
    }
    // A single choice that acknowledges a statement ("I acknowledge this statement") is the answer.
    if (hasOptions(field) && field.options.length === 1 && CONSENT.test(String(field.options[0]))) {
      return { value: field.options[0], source: 'consent' };
    }
    // A cover letter typed into the form is the one Generation wrote; a shorter one comes from the AI.
    if (!hasOptions(field) && ['textarea', 'text'].includes(field.kind) && /cover letter|motivation(al)? letter|letter of motivation/.test(label)) {
      const letter = context.coverLetterText;
      if (letter && (!field.maxLength || letter.length <= field.maxLength)) return { value: letter, source: 'documents' };
      return null;
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
      // A tick box takes only a yes/no fact ("SMS to my phone number" is not the phone number).
      if (field.kind === 'checkbox' && !rule.yesNo) continue;
      if (rule.yesNo) {
        const fact = rule.yesNo(candidate);
        if (fact === null || fact === undefined) return { missing: rule.name };
        const value = yesNoAnswer(field, fact);
        // Choices that are not yes/no (a list of visa types) are left to the AI with the facts.
        return value !== null ? { value, source: 'profile' } : null;
      }
      if (rule.salary) return resolveSalary(field, label, candidate, context.exchangeRates);
      if (rule.notice) return resolveNotice(field, label, candidate, context.today);
      const fact = rule.fact(candidate);
      if (fact === null || fact === undefined || fact === '') {
        if (rule.optionalIfMissing && !field.required) return { skip: `No ${rule.name} in the profile.` };
        return { missing: rule.name };
      }
      if (hasOptions(field)) {
        const option = field.options.find((entry) => String(entry).toLowerCase() === String(fact).toLowerCase());
        if (option) return { value: option, source: 'profile' };
        // Years as choices ("No experience", "1+ year", "5-7 years"): the highest one the candidate reaches.
        if (rule.years) {
          const reached = field.options
            .map((entry) => ({ entry, from: /^\s*(no|none|less than|under|<)/i.test(String(entry)) ? 0 : Number(String(entry).match(/\d+/)?.[0]) }))
            .filter(({ from }) => Number.isFinite(from) && from <= Number(fact))
            .sort((a, b) => b.from - a.from)[0];
          return reached ? { value: reached.entry, source: 'profile' } : null;
        }
        return null;
      }
      return { value: String(fact), source: 'profile' };
    }
    return null;
  }

  /** Splits a page's fields into answered, needing the AI, needing the Manager, and left alone. */
  function resolveFields(fields, candidate, savedAnswerRows, context = {}) {
    const savedAnswers = new Map((savedAnswerRows || []).map((row) => [row.questionKey, row.answer]));
    const answers = {};
    const open = [];
    const missing = [];
    for (const field of fields) {
      if (field.hidden || field.disabled) continue;
      const resolved = resolveField(field, candidate, savedAnswers, context);
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
  function buildAnswerPrompt({ job, candidate, documentsJson, fields, exchangeRates, today }) {
    const facts = {
      name: [candidate.firstName, candidate.lastName].filter(Boolean).join(' '),
      headline: candidate.headline,
      location: [candidate.city, candidate.country].filter(Boolean).join(', '),
      workAuthorization: candidate.workAuthorization,
      needsSponsorship: candidate.needsSponsorship,
      noticePeriod: noticeDays(candidate) ? '1 week' : 'Immediately',
      earliestStartDate: formatDate(startDate(candidate, today)),
      yearsOfExperience: candidate.yearsOfExperience,
      willingToRelocate: candidate.willingToRelocate,
    };
    if (candidate.salaryExpectationAmount) {
      const asked = [job.description, ...fields.map((field) => `${field.label} ${(field.options || []).join(' ')}`)]
        .map((text) => currencyIn(text, exchangeRates));
      facts.salaryExpectation = salaryText(candidate);
      facts.salaryEquivalents = salaryEquivalents(candidate, asked, exchangeRates);
    }
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
      'For salary questions, copy a figure from salaryEquivalents for the period and currency asked; when the question names no period, use the one the job description uses, else the period of salaryExpectation. Only for a currency missing there, convert at the current exchange rate. A number field takes digits only.',
      'For notice or start-date questions, use noticePeriod and earliestStartDate (YYYY-MM-DD).',
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
    if ((field.kind === 'number' || field.kind === 'range') && !/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, reason: 'not a number' };
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
