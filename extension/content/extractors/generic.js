// Generic extractor — tries JSON-LD, meta tags, headings, common selectors

function extractJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const jobPosting = findJobPosting(JSON.parse(script.textContent));
      if (jobPosting) return parseJobPosting(jobPosting);
    } catch { /* invalid JSON-LD */ }
  }
  return null;
}

function findJobPosting(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findJobPosting(item);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some((type) => String(type || '').split('/').pop() === 'JobPosting')) {
    return value;
  }

  for (const child of Object.values(value)) {
    const match = findJobPosting(child);
    if (match) return match;
  }
  return null;
}

function parseJobPosting(jp) {
  return {
    title: jp.title || jp.name || '',
    company: (jp.hiringOrganization && jp.hiringOrganization.name) || '',
    description: stripHtml(jp.description || ''),
    location: getStructuredJobLocation(jp),
    country: getStructuredJobCountry(jp),
    employmentType: normalizeEmploymentType(jp.employmentType),
    workplaceType: normalizeWorkplaceType(jp.jobLocationType),
    salary: formatStructuredSalary(jp.baseSalary || jp.estimatedSalary),
    url: jp.url || document.location.href,
  };
}

function getStructuredJobLocation(jobPosting) {
  const structuredLocations = normalizeStructuredLocations(jobPosting.jobLocation);
  if (structuredLocations) return structuredLocations;
  return normalizeStructuredLocations(jobPosting.applicantLocationRequirements);
}

function getStructuredJobCountry(jobPosting) {
  const locations = Array.isArray(jobPosting.jobLocation)
    ? jobPosting.jobLocation
    : [jobPosting.jobLocation];
  const countries = [];
  for (const location of locations) {
    const country = normalizeStructuredCountry(
      location?.address?.addressCountry || location?.addressCountry,
    );
    if (country) countries.push(...country.split('; '));
  }
  const applicantLocations = Array.isArray(jobPosting.applicantLocationRequirements)
    ? jobPosting.applicantLocationRequirements
    : [jobPosting.applicantLocationRequirements];
  for (const location of applicantLocations) {
    const locationType = String(location?.['@type'] || '').toLowerCase();
    const country = normalizeStructuredCountry(
      location?.addressCountry
      || (locationType.includes('country') ? location?.name : ''),
    );
    if (country) countries.push(...country.split('; '));
  }
  const uniqueCountries = [...new Set(countries.filter(Boolean))];
  if (uniqueCountries.length) return uniqueCountries.join('; ');
  return findLabeledValue(
    'country|work country|country of employment',
    document,
  );
}

function normalizeStructuredCountry(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeStructuredCountry).filter(Boolean))].join('; ');
  }
  if (typeof value === 'string') {
    const country = value.trim();
    if (/^(?:remote|hybrid|on[- ]?site|onsite|worldwide|anywhere)$/i.test(country)) {
      return '';
    }
    if (!/^[A-Z]{2}$/.test(country) || typeof Intl.DisplayNames !== 'function') {
      return country;
    }
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(country) || country;
    } catch {
      return country;
    }
  }
  if (!value || typeof value !== 'object') return '';
  return normalizeStructuredCountry(value.name || value.addressCountry);
}

function normalizeEmploymentType(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeEmploymentType).filter(Boolean))].join(', ');
  }
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  if (/\bfull[\s-]?time\b/i.test(normalized)) return 'Full-time';
  if (/\bpart[\s-]?time\b/i.test(normalized)) return 'Part-time';
  if (/\bcontract(?:or)?\b/i.test(normalized)) return 'Contract';
  if (/\btemporary\b/i.test(normalized)) return 'Temporary';
  if (/\bintern(?:ship)?\b/i.test(normalized)) return 'Internship';
  if (/\bvolunteer\b/i.test(normalized)) return 'Volunteer';
  if (/\bper[\s-]?diem\b/i.test(normalized)) return 'Per diem';
  const labels = {
    FULL_TIME: 'Full-time',
    PART_TIME: 'Part-time',
    CONTRACTOR: 'Contract',
    TEMPORARY: 'Temporary',
    INTERN: 'Internship',
    VOLUNTEER: 'Volunteer',
    PER_DIEM: 'Per diem',
    OTHER: 'Other',
  };
  return normalized
    .split(/[,\s]+/)
    .map((part) => labels[part.toUpperCase()] || part)
    .join(' ');
}

function normalizeWorkplaceType(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeWorkplaceType).filter(Boolean))].join(', ');
  }
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized) return '';
  if (/^(?:TELECOMMUTE|REMOTE)\b/i.test(normalized) || /\bremote\b/i.test(normalized)) return 'Remote';
  if (/^HYBRID\b/i.test(normalized) || /\bhybrid\b/i.test(normalized)) return 'Hybrid';
  if (/^(?:ON[-_ ]?SITE|ONSITE)\b/i.test(normalized) || /\bon[- ]?site\b|\bonsite\b/i.test(normalized)) {
    return 'On-site';
  }
  return normalized;
}

function formatStructuredSalary(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return formatSalaryNumber(value);
  if (!value || typeof value !== 'object') return '';
  const salaryValue = value.value && typeof value.value === 'object'
    ? value.value
    : value;
  const minimum = Number(salaryValue.minValue);
  const maximum = Number(salaryValue.maxValue);
  const singleValue = Number(salaryValue.value);
  const amount = Number.isFinite(minimum) && Number.isFinite(maximum)
    ? `${formatSalaryNumber(minimum)}-${formatSalaryNumber(maximum)}`
    : Number.isFinite(singleValue)
      ? formatSalaryNumber(singleValue)
      : Number.isFinite(minimum)
        ? `From ${formatSalaryNumber(minimum)}`
        : Number.isFinite(maximum)
          ? `Up to ${formatSalaryNumber(maximum)}`
          : '';
  if (!amount) return '';
  const currency = typeof value.currency === 'string' ? value.currency.trim() : '';
  const unit = typeof salaryValue.unitText === 'string'
    ? salaryValue.unitText.trim().toLowerCase()
    : '';
  return [currency, amount, unit && `per ${unit}`].filter(Boolean).join(' ');
}

function formatSalaryNumber(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function normalizeStructuredLocations(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeStructuredLocations).filter(Boolean))].join('; ');
  }
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';

  if (value.address) {
    const address = normalizeStructuredLocations(value.address);
    if (address) return address;
  }
  if (typeof value.name === 'string' && value.name.trim()) return value.name.trim();
  if (typeof value.address === 'string' && value.address.trim()) return value.address.trim();

  const address = value.address || value;
  if (typeof address !== 'object') return '';
  const fields = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    typeof address.addressCountry === 'object'
      ? address.addressCountry.name
      : address.addressCountry,
  ].filter((part) => typeof part === 'string' && part.trim());
  return [...new Set(fields.map((part) => part.trim()))].join(', ');
}

function trySelectors(selectors, root, accept = () => true) {
  const scope = root || document;
  for (const sel of selectors) {
    try {
      const el = scope.querySelector(sel);
      if (el) {
        const text = el.getAttribute?.('content')?.trim()
          || el.getAttribute?.('alt')?.trim()
          || el.innerText?.trim()
          || el.textContent?.trim();
        if (text && accept(text)) return text;
      }
    } catch { /* bad selector */ }
  }
  return '';
}

function isUsableJobTitle(value) {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title || title.length < 3) return false;
  return !/^(about (the )?job|job overview|job description|job details|career opportunities|careers|jobs|search jobs?|title:|company:|employer:|description:|location:)$/i
    .test(title);
}

function stripHtml(html) {
  if (!html) return '';
  // Parse page-supplied markup in an inert document so it cannot load resources or run handlers.
  const parsingDocument = typeof DOMParser === 'function'
    ? new DOMParser().parseFromString('', 'text/html')
    : document;
  const entityDecoder = parsingDocument.createElement('textarea');
  entityDecoder.innerHTML = String(html);
  const decodedHtml = entityDecoder.value || String(html);
  const d = parsingDocument.createElement('div');
  d.innerHTML = decodedHtml;
  d.querySelectorAll('script,style,nav,footer').forEach(e => e.remove());
  return (d.innerText || d.textContent || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getMetaContent(name) {
  const el = document.querySelector(`meta[name="${name}"],meta[property="${name}"]`);
  return el?.getAttribute('content') || '';
}

function getCompanyFromIcon(root) {
  const scope = root || document;
  const icon = scope.querySelector('img[alt="company" i]');
  return icon?.parentElement?.innerText?.trim()
    || icon?.parentElement?.textContent?.trim()
    || '';
}

function getReadableElementText(element, excludeActions = false) {
  if (!element) return '';
  let source = element;
  if (excludeActions && element.cloneNode) {
    source = element.cloneNode(true);
    source.querySelectorAll?.(
      'a, button, input, select, textarea, form, nav, header, footer, aside, [class*="application-form"], [data-testid*="application"], [role="button"], [role="link"], [role="navigation"]',
    ).forEach((action) => action.remove());
  }
  return (source.innerText || source.textContent || '').replace(/\s+/g, ' ').trim();
}

function isPlausibleCompanyName(value) {
  const company = String(value || '').replace(/\s+/g, ' ').trim();
  if (!company || company.length > 120 || company.split(/\s+/).length > 12) return false;
  if (/^(?:who we are|our team|about us|company|employer|hiring organization|contact us|ventures|careers|jobs)$/i.test(company)) {
    return false;
  }
  return !/\b(?:who we are|our team|contact us|open positions|job openings)\b/i.test(company);
}

function tryCompanySelectors(selectors, root) {
  const scope = root || document;
  for (const selector of selectors) {
    try {
      const element = scope.querySelector(selector);
      if (!element || element.closest?.('nav, [role="navigation"]')) continue;
      const value = getReadableElementText(element, true)
        || element.getAttribute?.('content')?.trim()
        || element.getAttribute?.('alt')?.trim()
        || '';
      if (isPlausibleCompanyName(value)) return value;
    } catch { /* skip unusable candidates */ }
  }
  return '';
}

function findValueAfterHeading(labels, root) {
  const scope = root || document;
  const expression = new RegExp(`^(?:${labels})\\s*:?\\s*$`, 'i');
  for (const heading of scope.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
    const label = (heading.innerText || heading.textContent || '').replace(/\s+/g, ' ').trim();
    if (!expression.test(label)) continue;
    const sibling = heading.nextElementSibling;
    const value = stripHtml(sibling?.innerHTML || '');
    if (value) return { element: sibling, value };
  }
  return null;
}

function findLabeledValue(labels, root) {
  const scope = root || document;
  const expression = new RegExp(`^(?:${labels})\\s*:?\\s*(.*)$`, 'i');
  for (const term of scope.querySelectorAll(
    'dt, [role="term"], [aria-label], label, strong, b, span',
  )) {
    const label = (
      term.getAttribute?.('aria-label')
      || term.innerText
      || term.textContent
      || ''
    ).replace(/\s+/g, ' ').trim();
    const match = expression.exec(label);
    if (!match) continue;
    const sibling = term.nextElementSibling;
    const siblingValue = getReadableElementText(sibling);
    const parentText = getReadableElementText(term.parentElement, true);
    const parentMatch = expression.exec(parentText);
    const value = match[1]
      || siblingValue
      || parentMatch?.[1];
    if (value && !expression.test(value)) return value.trim();
  }
  for (const element of scope.querySelectorAll('p, li')) {
    const text = getReadableElementText(element, true);
    const match = expression.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function findWorkplaceType(root) {
  const labeled = findLabeledValue(
    'workplace type|work arrangement|work model|work modality|location type|remote policy',
    root,
  );
  if (labeled) return normalizeWorkplaceType(labeled);
  const scope = root || document;
  for (const heading of scope.querySelectorAll('h1, h2')) {
    const metadata = getReadableElementText(heading.nextElementSibling, true);
    if (metadata.length > 0 && metadata.length <= 160) {
      const match = metadata.match(/\b(remote|hybrid|on[- ]site|onsite)\b/i);
      if (match) return normalizeWorkplaceType(match[1]);
    }
  }
  for (const element of scope.querySelectorAll('p, li, span')) {
    const text = getReadableElementText(element, true);
    if (text.length <= 80 && /^(remote|hybrid|on[- ]site|onsite)$/i.test(text)) {
      return normalizeWorkplaceType(text);
    }
  }
  return '';
}

function findEmploymentType(root) {
  const labeled = findLabeledValue(
    'employment type|job type|role type|contract type|schedule|employment',
    root,
  );
  if (labeled) return normalizeEmploymentType(labeled);
  const scope = root || document;
  for (const heading of scope.querySelectorAll('h1, h2')) {
    const metadata = getReadableElementText(heading.nextElementSibling, true);
    if (metadata.length === 0 || metadata.length > 160) continue;
    const match = metadata.match(
      /\b(full[\s-]?time|part[\s-]?time|contract(?:or)?|temporary|intern(?:ship)?|volunteer|per[\s-]?diem)\b/i,
    );
    if (match) return normalizeEmploymentType(match[1]);
  }
  return '';
}

function findSalary(root) {
  const labeled = findLabeledValue(
    'salary range|base salary|compensation|pay range|hourly rate|salary',
    root,
  );
  if (labeled) return labeled;
  const scope = root || document;
  for (const selector of [
    '[itemprop="baseSalary"]',
    '[data-testid*="salary" i]',
    '[class*="salary" i]',
    '[class*="compensation" i]',
  ]) {
    const text = getReadableElementText(scope.querySelector(selector), true);
    if (text && text.length <= 300) return text;
  }
  const currencyAmount = /(?:[$€£¥]\s*\d[\d,.]*(?:\s?(?:k|m))?(?:\s*[-–]\s*(?:[$€£¥]\s*)?\d[\d,.]*(?:\s?(?:k|m))?)?)/i;
  for (const heading of scope.querySelectorAll('h1')) {
    for (const sibling of heading.parentElement?.children || []) {
      if (sibling === heading) continue;
      const text = getReadableElementText(sibling, true);
      if (text.length <= 160 && currencyAmount.test(text)) return text;
    }
  }
  return '';
}

function findJobLocation(root) {
  const scope = root || document;
  const schemaLocation = trySelectors(['[itemprop="jobLocation"]'], scope);
  if (schemaLocation) return schemaLocation;

  const locationLabel = /^(?:job\s+|work\s+)?locations?\s*:?\s*$/i;
  for (const element of scope.querySelectorAll('p, li, [role="term"], [aria-label]')) {
    const text = getReadableElementText(element, true);
    const labeledLocation = text.match(/^(?:job\s+|work\s+)?locations?\s*:\s*(.{2,300})$/i);
    if (labeledLocation) return labeledLocation[1].trim();
  }

    const semanticLocation = findLabeledValue(
      'job\\s+locations?|work\\s+locations?|locations?',
      scope,
    );
    if (semanticLocation) return semanticLocation;

  for (const term of scope.querySelectorAll('dt')) {
    const label = (term.innerText || term.textContent || '').replace(/\s+/g, ' ').trim();
    if (!locationLabel.test(label)) continue;
    const definition = term.nextElementSibling;
    if (definition?.tagName?.toLowerCase() === 'dd') {
      const value = stripHtml(definition.innerHTML || definition.textContent || '');
      if (value) return value;
    }
  }

  const labeledLocation = findValueAfterHeading(
    'job\\s+locations?|work\\s+locations?|locations?',
    scope,
  );
  if (labeledLocation?.value) return labeledLocation.value;

  for (const element of scope.querySelectorAll('[aria-label]')) {
    const label = element.getAttribute('aria-label') || '';
    if (!locationLabel.test(label.trim())) continue;
    const value = stripHtml(element.innerHTML || element.textContent || '');
    if (value && !locationLabel.test(value)) return value;
  }

  for (const element of scope.querySelectorAll('p, li')) {
    const text = getReadableElementText(element, true);
    const roleLocation = text.match(
      /\b(?:the\s+|this\s+)?(?:job|position|role|opportunity)\s+(?:is|will be)\s+((?:based\s+in\s+)?[^.;\n]{2,120})/i,
    );
    if (roleLocation && /\b(?:based\s+in|remote|hybrid|on[\s-]?site)\b/i.test(roleLocation[1])) {
      return roleLocation[1].replace(/^based\s+in\s+/i, '').trim();
    }
  }

  for (const heading of scope.querySelectorAll('h1')) {
    const title = (heading.innerText || heading.textContent || '').replace(/\s+/g, ' ').trim();
    if (!isUsableJobTitle(title)) continue;
    const metadata = getReadableElementText(heading.nextElementSibling, true);
    if (
      metadata.length > 0
      && metadata.length <= 120
      && /\b(?:remote|hybrid|on[\s-]?site)\b/i.test(metadata)
    ) {
      return metadata;
    }
  }
  return '';
}

function findJobDetailRoot() {
  const roots = [
    '[class*="job-details"]',
    '[class*="JobDetails"]',
    '[class*="job-detail"]',
    '[class*="jobDetail"]',
    '[class*="position-details"]',
    '[class*="posting-details"]',
    '[class*="vacancy-details"]',
    '[data-testid*="job-details"]',
    '[role="main"] [class*="detail"]',
    'aside [class*="job"]',
  ];

  for (const sel of roots) {
    try {
      const el = document.querySelector(sel);
      const text = el?.innerText?.trim() || '';
      if (text.length >= 80) return el;
    } catch { /* skip */ }
  }
  return null;
}

function findDescriptionElement(root) {
  const scope = root || document;
  const roleDescription = findRoleDescriptionFromHeadings(scope);
  if (roleDescription.length >= 80) return { textContent: roleDescription };

  const labeledDescription = findValueAfterHeading(
    'job description|role description|description|about the role|responsibilities',
    scope,
  );
  if (labeledDescription && labeledDescription.value.length >= 80) {
    return labeledDescription.element;
  }

  const semanticSelectors = [
    '[itemprop="description"]',
    '[class*="job-content"]',
    '[class*="rich-text"]',
    '[class*="richtext"]',
    '[data-testid*="description"]',
    '[data-automation*="description"]',
    '[id*="job-description" i]',
    '#jobDescriptionText',
    '.jobs-description-content__text',
  ];
  for (const sel of semanticSelectors) {
    try {
      const el = scope.querySelector(sel);
      if (stripHtml(el?.innerHTML || '').length >= 80) return el;
    } catch { /* skip */ }
  }

  const proseContainers = [];
  for (const selector of ['article', 'main', '[role="main"]', 'section', 'div']) {
    try {
      scope.querySelectorAll(selector).forEach((element) => {
        if (element.closest?.('nav, header, footer, aside')) return;
        const text = getReadableElementText(element, true);
        if (text.length < 80 || text.length > 30000) return;

        const blockCount = element.querySelectorAll?.('p, li, h2, h3, h4').length || 0;
        const tagName = element.tagName?.toLowerCase();
        const semanticBoost = element.hasAttribute?.('itemprop')
          || element.getAttribute?.('role') === 'article'
          ? 500
          : tagName === 'article' || tagName === 'main'
            ? 250
            : 0;
        proseContainers.push({
          element,
          text,
          score: Math.min(text.length, 20000) + Math.min(blockCount, 20) * 25 + semanticBoost,
        });
      });
    } catch { /* skip unavailable container queries */ }
  }
  proseContainers.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  if (proseContainers.length) {
    const best = proseContainers[0];
    const comparable = proseContainers.find(
      (candidate) => candidate.text.length >= best.text.length * 0.8,
    );
    if (comparable) return { textContent: comparable.text };
  }

  const descriptionSelectors = [
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="description-content"]',
    '[class*="posting-description"]',
  ];
  const candidates = new Set();
  for (const sel of descriptionSelectors) {
    try {
      scope.querySelectorAll(sel).forEach((el) => {
        if (stripHtml(el.innerHTML || '').length >= 80) candidates.add(el);
      });
    } catch { /* skip */ }
  }
  const rankedCandidates = [...candidates]
    .map((el) => ({ el, length: stripHtml(el.innerHTML || '').length }))
    .sort((a, b) => a.length - b.length);
  if (rankedCandidates.length) {
    const longest = rankedCandidates[rankedCandidates.length - 1].length;
    const bestScopedMatch = rankedCandidates.find((candidate) => candidate.length >= longest * 0.8);
    if (bestScopedMatch) return bestScopedMatch.el;
  }

  const headings = scope.querySelectorAll('h1, h2, h3, h4');
  for (const heading of headings) {
    const label = (heading.innerText || heading.textContent || '').trim();
    if (!/^(job description|role description|about the role|responsibilities)$/i.test(label)) continue;

    const section = heading.closest?.('section, article, [class*="section"]')
      || heading.parentElement;
    if (!section) continue;

    const content = section.querySelector(
      '[itemprop="description"], [class*="description"], [class*="content"]',
    );
    const text = stripHtml(content?.innerHTML || section.innerHTML || '');
    if (text.length >= 80) return content || section;

    let sibling = heading.nextElementSibling;
    while (sibling) {
      if (stripHtml(sibling.innerHTML || '').length >= 80) return sibling;
      sibling = sibling.nextElementSibling;
    }
  }

  return null;
}

function findRoleDescriptionFromHeadings(root) {
  const scope = root || document;
  const roleHeading = /^(?:job description|role description|about (?:the|this) role|role overview|position overview|job overview|who\s+(?:we['’]re|we are|we)\s+looking\s+for|responsibilities|key responsibilities)\s*:?\s*$/i;
  const primaryRoleHeading = /^(?:job description|role description|about (?:the|this) role|role overview|position overview|job overview|who\s+(?:we['’]re|we are|we)\s+looking\s+for)\s*:?\s*$/i;
  const stopHeading = /^(?:about\s+(?!the\s+(?:role|job|position)\b)\S+|company overview|benefits|what we offer|equal opportunity|diversity|privacy|data protection|application(?: process)?|how to apply|apply(?: now)?)\b/i;

  for (const heading of scope.querySelectorAll('h1, h2, h3, h4, [role="heading"]')) {
    const label = (heading.innerText || heading.textContent || '').replace(/\s+/g, ' ').trim();
    if (!roleHeading.test(label)) continue;

    const headingLevel = Number(heading.tagName?.match(/^H([1-6])$/i)?.[1] || heading.getAttribute?.('aria-level') || 6);
    const sections = [];
    let sibling = heading.nextElementSibling;
    let length = 0;
    while (sibling && length < 30000) {
      const siblingLabel = (sibling.innerText || sibling.textContent || '').replace(/\s+/g, ' ').trim();
      const siblingLevel = Number(sibling.tagName?.match(/^H([1-6])$/i)?.[1] || sibling.getAttribute?.('aria-level') || 0);
      if (
        siblingLevel
        && (
          siblingLevel < headingLevel
          || (siblingLevel === headingLevel && primaryRoleHeading.test(siblingLabel))
          || stopHeading.test(siblingLabel)
        )
      ) break;
      const text = (sibling.innerText || sibling.textContent || '').trim();
      if (text) {
        sections.push(text);
        length += text.length;
      }
      sibling = sibling.nextElementSibling;
    }
    const description = sections.join('\n\n').trim();
    if (description.length >= 80) return description;
  }
  return '';
}

function getCompanyFromPageTitle(title) {
  const pageTitle = String(document.title || '').trim();
  const jobTitle = String(title || '').trim();
  if (!pageTitle || !jobTitle) return '';

  for (const separator of [' | ', ' - ', ' – ', ' — ']) {
    if (pageTitle.toLowerCase().startsWith(`${jobTitle}${separator}`.toLowerCase())) {
      return pageTitle.slice(jobTitle.length + separator.length).trim();
    }
    const suffix = `${separator}${jobTitle}`;
    if (pageTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
      return pageTitle.slice(0, -suffix.length).trim();
    }
  }
  return '';
}

function normalizeJobUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.pathname = parsed.pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\s+/g, '-').replace(/-+/g, '-'))
      .join('/');
    return parsed.href;
  } catch {
    return trimmed.replace(/\s+/g, '-');
  }
}

function genericExtract() {
  const ld = extractJsonLd();
  const detailRoot = findJobDetailRoot();
  const scope = detailRoot || document;

  const titleSelectors = [
    '[itemprop="title"]',
    'h1[data-testid*="job-title"]',
    '[data-testid*="job-title"]',
    'h1',
    'h2',
    '[class*="jobTitle"] h1',
    '[class*="job-title"] h1',
    '[class*="job-title"]',
    '[class*="jobTitle"]',
    '[id*="job-title"]',
  ];
  const companySelectors = [
    '[itemprop="hiringOrganization"] [itemprop="name"]',
    '[itemprop="hiringOrganization"]',
    '[data-testid*="company"]',
    '[class*="company-name"]',
    '[class*="companyName"]',
    '[id*="company"]',
    '[class*="employer"]',
    '[data-company]',
  ];

  const title = (isUsableJobTitle(ld?.title) && ld.title)
    || findValueAfterHeading('job title|title', scope)?.value
    || trySelectors(titleSelectors, scope, isUsableJobTitle)
    || (isUsableJobTitle(getMetaContent('og:title')) && getMetaContent('og:title'))
    || (isUsableJobTitle(document.title) ? document.title : '');
  const company = ld?.company
    || findValueAfterHeading('company|employer|hiring organization', scope)?.value
    || trySelectors(companySelectors.slice(0, 2), scope)
    || getCompanyFromPageTitle(title)
    || tryCompanySelectors(companySelectors.slice(2), scope)
    || getCompanyFromIcon(scope)
    || trySelectors(['header img[alt*="logo" i]', '[role="banner"] img[alt*="logo" i]'])
      .replace(/\s+logo$/i, '').trim()
    || getMetaContent('og:site_name')
    || '';

  const descEl = findDescriptionElement(scope);
  const pageDescription = descEl
    ? descEl.textContent || stripHtml(descEl.innerHTML || '')
    : '';
  const structuredDescription = ld?.description || '';
  const description = (
    pageDescription.length >= 80
    && pageDescription.length > structuredDescription.length + 80
  )
    ? pageDescription
    : structuredDescription
    || pageDescription
    || getMetaContent('description')
    || getMetaContent('og:description')
    || '';
  const location = ld?.location || findJobLocation(scope);
  const country = ld?.country
    || normalizeStructuredCountry(trySelectors(['[itemprop="addressCountry"]'], scope))
    || findLabeledValue('country|work country|country of employment', scope);
  const employmentType = ld?.employmentType
    || normalizeEmploymentType(trySelectors(['[itemprop="employmentType"]'], scope))
    || findEmploymentType(scope);
  const workplaceType = ld?.workplaceType
    || normalizeWorkplaceType(trySelectors(['[itemprop="jobLocationType"]'], scope))
    || findWorkplaceType(scope);
  const salary = ld?.salary || findSalary(scope);

  const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const url = normalizeJobUrl(ld?.url || getMetaContent('og:url') || canonicalUrl || document.location.href);

  return {
    title: title.split('|')[0].trim(),
    company,
    description,
    location,
    country,
    employmentType,
    workplaceType,
    salary,
    url,
  };
}

window.__genericExtract = genericExtract;
window.__extractJsonLd = extractJsonLd;
window.__stripHtml = stripHtml;
window.__normalizeJobUrl = normalizeJobUrl;
