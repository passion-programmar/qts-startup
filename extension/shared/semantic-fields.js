// One source for worker recognition and server validation. No record writes or transformations.
(function init(global) {
  const normalize = (text) => String(text || '').normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/\(\s*(required|optional)\s*\)/g, ' ').replace(/[?*:]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  // Not identity: a Manager may set one default for all candidates (2026-11-06 decision).
  const MANAGER_DEFAULT_FACTS = new Set(['candidate.yearsExperience', 'candidate.salaryCurrency', 'candidate.salaryPeriod',
    'candidate.programmingLanguages', 'candidate.noticeDuration', 'candidate.startDate', 'candidate.interviewFormat']);
  const definitions = [
    ['candidate.givenName', 'First name', 'firstName', 'firstName', 'string', ['first name', 'given name', 'forename', 'prénom', 'prenom', 'vorname', 'imię', 'imie', 'nombre']],
    ['candidate.familyName', 'Last name', 'lastName', 'lastName', 'string', ['last name', 'family name', 'surname', 'nom de famille', 'nachname', 'nazwisko', 'apellido', 'apellidos', 'nom']],
    ['candidate.fullName', 'Full name', null, null, 'string', ['full name', 'first and last name', 'name and surname']],
    ['candidate.fullAddress', null, null, null, 'address', ['full address', 'complete address', 'home address', 'residential address']],
    ['candidate.birthday', null, 'birthday', null, 'date', ['date of birth', 'birth date', 'birthday']],
    ['candidate.yearsExperience', null, 'yearsOfExperience', null, 'number', ['years of experience', 'total years of experience']],
    ['candidate.salaryCurrency', null, 'salaryExpectationCurrency', null, 'currency', ['salary currency', 'compensation currency', 'currency']],
    ['candidate.salaryPeriod', null, 'salaryExpectationPeriod', null, 'period', ['salary period', 'salary frequency', 'pay frequency', 'payment frequency', 'frequency', 'payment period']],
    ['candidate.programmingLanguages', null, null, null, 'set', ['programming languages', 'languages you can program in']],
    ['candidate.legalName', null, null, null, 'string', ['legal name', 'full legal name']],
    ['candidate.preferredName', null, null, null, 'string', ['preferred name', 'preferred first name']],
    ['candidate.email', 'Email', 'email', 'candidateEmail', 'email', ['email', 'email address', 'e-mail', 'e-mail address', 'contact email', 'correo electrónico', 'correo electronico', 'courriel']],
    ['candidate.phone', 'Phone', 'phone', 'phone', 'phone', ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'telephone number', 'contact number', 'contact phone number', 'téléphone', 'numéro de téléphone', 'telefon', 'telefonnummer', 'teléfono', 'telefono', 'handynummer']],
    ['candidate.phoneCallingCode', null, null, null, 'string', ['phone country code', 'telephone country code', 'dialing code', 'dialling code']],
    ['candidate.phoneNationalNumber', null, null, null, 'phone', ['national phone number', 'local phone number', 'phone number without country code']],
    ['candidate.city', 'City', 'city', 'city', 'string', ['city', 'town', 'current city', 'city of residence', 'location(city)', 'location (city)', 'city/town']],
    ['candidate.residenceCountry', 'Country', 'country', null, 'country', ['country', 'country/region', 'country of residence', 'current country of residence', 'residence country']],
    ['candidate.nationality', 'Nationality', 'nationality', null, 'country', ['nationality']],
    ['candidate.citizenship', null, null, null, 'country', ['citizenship', 'country of citizenship']],
    ['candidate.addressLine1', 'Address line 1', 'addressLine1', null, 'string', ['address line 1', 'street address', 'street and house number']],
    ['candidate.postalCode', 'Postal code', 'postalCode', null, 'string', ['postal code', 'postcode', 'zip code', 'zip/postal code']],
    ['candidate.province', 'Province', 'province', null, 'string', ['state', 'province', 'state/province', 'region']],
    ['candidate.linkedin', 'LinkedIn', 'linkedinUrl', 'linkedinUrl', 'url', ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin profile url', 'linkedin profile link']],
    ['candidate.noticeDuration', null, null, null, 'duration', ['notice period', 'notice duration', 'current notice period']],
    ['candidate.startDate', null, null, null, 'date', ['earliest start date', 'available start date', 'availability date', 'date available to start', 'when can you start', 'when are you available to start', 'availability to start']],
    ['candidate.interviewFormat', null, null, null, 'choice', ['preferred interview format', 'preferred interview channel', 'preferred interview method']],
    ['application.source', null, null, null, 'choice', ['application source', 'how did you hear about us', 'where did you hear about this job', 'how did you find this position', 'where did you learn about this opportunity']],
  ].map(([id, canonicalLabel, profileKey, profileField, valueType, aliases]) => Object.freeze({ id, canonicalLabel, profileKey, profileField, valueType,
    // Candidate facts that are not identity may also have a Manager default ("all my candidates"),
    // which each candidate's or application's own answer overrides.
    aliases: Object.freeze(aliases), authority: id.startsWith('candidate.') ? 'candidate' : 'manager',
    defaultScope: id.startsWith('candidate.') ? 'candidate' : 'manager', contextDimensions: Object.freeze([]),
    allowedScopes: Object.freeze(id.startsWith('candidate.') && !MANAGER_DEFAULT_FACTS.has(id) ? ['candidate', 'application'] : ['application', 'candidate', 'manager']),
    representations: Object.freeze(['text', 'textarea', 'email', 'tel', 'url', 'number', 'range', 'date', 'select', 'radio', 'combobox', 'menu', 'checkbox-group', 'multiselect']) }));
  const sensitive = [
    { id: 'application.workAuthorization', pattern: /authori[sz].*work|right to work|(?:eligible|allowed|permitted|entitled) to work/, valueType: 'boolean' },
    { id: 'application.sponsorship', pattern: /sponsor/, valueType: 'boolean' },
    { id: 'candidate.salaryExpectation', pattern: /^(expected |desired |annual |yearly |monthly |hourly |daily |gross |net )*(salary|compensation)( expectation| expectations)?\b/, valueType: 'money' },
  ].map((entry) => Object.freeze({ ...entry, authority: 'candidate', defaultScope: 'application', contextDimensions: Object.freeze(['country', 'time', 'currency', 'period', 'basis', 'wording']), allowedScopes: Object.freeze(['application', 'candidate', 'manager']), representations: Object.freeze(['text', 'number', 'select', 'radio', 'combobox', 'menu', 'checkbox']) }));
  // Consent to be considered for future roles or kept in a talent pool, in any company's wording
  // (decision 2026-11-06): one reusable answer; Yes ticks it whether required or not. Pure marketing
  // (newsletters, promotions, news, updates) is never this answer.
  const futureRecruitmentConsent = Object.freeze({ id: 'application.futureRecruitmentConsent', canonicalLabel: null, profileKey: null, profileField: null,
    valueType: 'boolean', aliases: Object.freeze(['consent to future recruitment', 'future recruitment consent', 'talent pool consent']),
    authority: 'manager', defaultScope: 'manager', contextDimensions: Object.freeze([]), allowedScopes: Object.freeze(['application', 'candidate', 'manager']),
    representations: Object.freeze(['checkbox', 'checkbox-group', 'radio', 'select', 'combobox', 'menu']) });
  const FUTURE_RECRUITMENT = /\b(future|other|new|upcoming|subsequent) (recruitment|recruiting|hiring|jobs?|roles?|opportunit\w*|vacanc\w*|positions?|openings?)\b|\btalent (pool|community|network|database)\b/;
  const MARKETING_ONLY = /\b(marketing|newsletters?|promotion\w*|offers|news|updates|sms|text messages?)\b/;
  function recognize(question, hints = {}) {
    const original = normalize(question);
    if (futureRecruitmentConsent.aliases.includes(original)
      || (FUTURE_RECRUITMENT.test(original) && !MARKETING_ONLY.test(original))) {
      return { definition: futureRecruitmentConsent, context: {}, key: futureRecruitmentConsent.id };
    }
    if (/\b(employer|company|referee|recruiter|emergency contact|previous employment)\b/.test(normalize(`${hints.note || ''} ${hints.section || ''}`))) return { blocked: true, reason: 'contextual-subject' };
    if (/privacy|consent|\bterms\b|\bagree\b|acknowledg|attest|certif|marketing|newsletter|data processing/.test(original)) return { blocked: true, reason: 'policy-excluded' };
    if (/\b(referr\w*|referee|recruiter|emergency|next of kin|someone else|their|previous employer)\b/.test(original)) return { blocked: true, reason: 'other-person-or-employer' };
    // "Employer's name / company address" is about someone else; "employer sponsorship to work in your
    // country" (Ashby, Oyster) is the candidate's own work right and is not blocked.
    if (/\b(employer|company)\b/.test(original) && /\b(name|email|phone|address|country|city)\b/.test(original)
      && !/sponsor|authori[sz]|right to work|(?:eligible|allowed|permitted|entitled) to work/.test(original)) return { blocked: true, reason: 'other-person-or-employer' };
    const label = original.replace(/^(?:please (?:enter|provide|specify)|what is|what's)\s+(?:your\s+)?/, '').replace(/^your\s+/, '');
    const matches = definitions.filter((entry) => entry.aliases.includes(label));
    if (matches.length === 1) return { definition: matches[0], context: {}, key: matches[0].id };
    const durationUnit = label.match(/^notice (?:period|duration)(?: in |\s*\()(days?|weeks?|months?)(?:\))?$/);
    if (durationUnit) return { definition: definitions.find((entry) => entry.id === 'candidate.noticeDuration'), context: {}, key: 'candidate.noticeDuration', representation: { unit: durationUnit[1].replace(/s$/, '') } };
    if (/^full name\s*\((?:last|surname|family)(?: name)?,\s*(?:first|given)(?: name)?\)$/.test(label)) return { definition: definitions.find((entry) => entry.id === 'candidate.fullName'), context: {}, key: 'candidate.fullName', representation: { nameOrder: 'family-given' } };
    if (/\bname\b/.test(original) && /\b(passport|legal|preferred)\b/.test(original)) return { blocked: true, reason: 'specific-identity-context' };
    const special = sensitive.filter((entry) => entry.pattern.test(entry.valueType === 'money' ? label : original));
    if (special.length > 1) return { blocked: true, reason: 'combined-meanings' };
    if (special.length === 1) {
      // Unknown geographic/currency contexts retain exact wording rather than guessing equivalence.
      const context = { country: original.match(/\b(?:in|for)\s+(.+?)(?=\s+(?:now|currently|without|and|or)|$)/)?.[1] || null,
        time: /future|ever|will/.test(original) ? 'future' : /currently|now|present/.test(original) ? 'current' : 'unspecified',
        currency: original.match(/\b(?:eur|usd|gbp|ron|pln|cad|aud)\b/)?.[0] || null,
        period: original.match(/annual|yearly|monthly|hourly|daily|per year|per month|per hour|per day/)?.[0] || null,
        basis: original.match(/\b(?:gross|net)\b/)?.[0] || null,
        wording: original };
      // Only closed, equivalent templates may drop exact-wording protection.
      const authorization = original.match(/^(?:are you (?:legally )?(?:authorized|authorised|eligible) to work|do you (?:currently )?have (?:the )?right to work)(?: in ([a-z .-]+?))?(?: (?:now|currently))?$/);
      const sponsorship = original.match(/^(do you (?:currently )?(?:need|require)|will you (?:ever )?(?:need|require)) (?:visa )?sponsorship(?: (?:to work )?in ([a-z .-]+?))?(?: (?:now|currently))?$/);
      if (special[0].id === 'application.workAuthorization' && authorization) {
        context.country = authorization[1] || null; context.time = 'current'; context.wording = null;
      } else if (special[0].id === 'application.sponsorship' && sponsorship) {
        context.country = sponsorship[2] || null; context.time = sponsorship[1].startsWith('will') ? 'future' : 'current'; context.wording = null;
      } else if (special[0].valueType === 'money') {
        const residue = label.replace(/\b(?:expected|desired|salary|compensation|expectation|expectations|amount|annual|yearly|monthly|hourly|daily|gross|net|eur|usd|gbp|ron|pln|cad|aud)\b/g, '').trim();
        if (!residue) {
          context.period = ({ annual: 'year', yearly: 'year', monthly: 'month', hourly: 'hour', daily: 'day' })[context.period] || context.period;
          context.wording = null;
        }
      }
      return { definition: special[0], context, key: `${special[0].id}:${JSON.stringify(context)}` };
    }
    // Reject obvious combined facts rather than letting a broad legacy regex choose one.
    if (/\b(name|email|phone|address)\b.*\band\b.*\b(name|email|phone|address)\b/.test(label)) return { blocked: true, reason: 'combined-meanings' };
    return null;
  }
  function compatible(left, right) {
    const a = recognize(left), b = recognize(right);
    return Boolean(a?.definition && b?.definition && a.key === b.key);
  }
  const representationDefinitions = Object.freeze({ scalar: Object.freeze({ operation: 'existing-profile-rule-and-control-validation', transforms: false }),
    choice: Object.freeze({ operation: 'existing-controlled-answer-option-validation', transforms: false }) });
  const api = Object.freeze({ version: 1, definitions: Object.freeze([...definitions, ...sensitive, futureRecruitmentConsent]), representationDefinitions, recognize, compatible });
  global.__qtsSemanticFields = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
