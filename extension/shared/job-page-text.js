// Reads a job page as plain text for Get JD: the page's content whether shown or not (collapsed
// sections, "Read more", tabs), without the site's header, footer, navigation menus, or cookie and
// consent banners, and without HTML. A JobPosting description from the page's structured data is
// added when the page text does not already contain it.
(function initQtsJobPageText(global) {
  const MAX_LENGTH = 100_000;
  const SKIPPED_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'PICTURE',
    'VIDEO', 'AUDIO', 'MAP', 'BUTTON', 'SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'DIALOG',
  ]);
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
    'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'OL', 'P',
    'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);
  const CHROME_ROLES = /^(?:banner|navigation|contentinfo|search|menu|menubar|alertdialog|listbox|option|combobox|tooltip)$/i;
  const CONSENT = /cookie|consent|gdpr|onetrust|didomi|usercentrics|truste|cookiebot|cc-(?:banner|window|revoke)|qc-cmp|osano|iubenda|cmplz|(?:^|\s)cky-/i;
  const COOKIE_NOTICE_START = /^(?:we|this (?:web)?site|our (?:web)?site|[\w.-]+ and our (?:selected )?partners) (?:uses?|may use) cookies\b/i;
  // Other postings listed beside this one, and list paging.
  const OTHER_JOBS = /(?:similar|related|recommended|other|more)[-_ ]?(?:jobs?|positions?|openings?|roles?|vacanc)|pagination/i;
  const OTHER_JOBS_HEADING = /^(?:similar|related|recommended|other|more|recent|latest|open)\b.{0,30}\b(?:jobs?|positions?|openings?|roles?|vacanc(?:y|ies)|opportunit(?:y|ies))\b|^(?:you may also like|people also viewed|jobs you might like)/i;
  // Screen-reader-only labels ("opens in a new tab", "page is loaded").
  const SCREEN_READER_ONLY = /(?:^|\s)(?:sr-only|visually-hidden|visuallyhidden|screen-reader-text|screenreader|a11y-hidden|assistive-text)(?:$|\s)/i;
  // A footer block, even inside the content, when it holds the copyright or the site's policies.
  const FOOTER_NAME = /footer/i;
  const SITE_FINE_PRINT = /©|copyright|all rights? reserved|privacy (?:policy|notice|statement)|terms (?:of|and) (?:use|service|conditions)/i;
  // Share buttons and social links, and application forms built without a <form>.
  const SHARE_NAMES = /(?:^|[\s_-])(?:share|sharing|social)(?:$|[\s_-])/i;
  const APPLICATION_FORM_NAMES = /application[-_]?form|apply[-_]?form/i;
  // Copyright lines, and lines of nothing but policy links, wherever they sit.
  const POLICY_LINK = '(?:privacy(?: policy| notice)?|cookie (?:policy|settings|preferences)|terms(?: of (?:use|service)| and conditions)?|imprint|impressum|legal(?: notice)?|accessibility|sitemap)';
  const FINE_PRINT_LINE = new RegExp(`^(?:copyright\\s*)?©|^copyright \\d{4}|all rights? reserved\\.?$|^${POLICY_LINK}(?:\\s*[•|·/,]?\\s*${POLICY_LINK})*$`, 'i');
  // A block of links with little else (footer columns, site maps, menus without markup). A job's own
  // skill tags can be links too, and rarely number 20.
  const LINK_FARM_MIN_LINKS = 20;
  const LINK_FARM_RATIO = 0.8;
  // Page data and styles left as text in hidden elements: JSON objects and CSS rules.
  const CODE_LINE = /^[{[]\s*["{[]|^@(?:keyframes|media|font-face|import|supports)\b|^[\w.#:\s>,*-]{1,80}\{[^}]*:[^}]*;/;
  // Site-wide bars named by class or id; "job-header" and similar stay, since they hold the job.
  const CHROME_NAMES = /(?:^|[\s_-])(?:site|global|page|top|main)[-_]?(?:header|footer|nav|navbar|navigation|menu)(?:$|[\s_-])|(?:^|\s)(?:header|footer|navbar|nav-bar|topbar|top-bar|masthead|mega-?menu|skip-?link|breadcrumbs?)(?:$|\s)/i;

  const inContent = (element) => Boolean(element.parentElement?.closest('main, article, [role="main"]'));
  const names = (element) => [
    element.id, typeof element.className === 'string' ? element.className : '', element.getAttribute('aria-label'),
    element.getAttribute('data-automation-id'), element.getAttribute('data-testid'),
  ].filter(Boolean).join(' ');
  const textLength = (element) => (element.textContent || '').length;
  const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  const headingLevel = (element) => (/^H[1-6]$/.test(element.tagName) ? Number(element.tagName[1])
    : element.getAttribute?.('role') === 'heading' ? Number(element.getAttribute('aria-level')) || 2 : 0);
  const isOtherJobsHeading = (element) => OTHER_JOBS_HEADING.test((element.textContent || '').trim().slice(0, 80));
  // A block titled "Similar jobs" (or the like) whose only h1, if any, is that title.
  function isOtherJobsBlock(element) {
    const headings = element.querySelectorAll(HEADINGS);
    if (!headings.length || !isOtherJobsHeading(headings[0])) return false;
    return ![...element.querySelectorAll('h1')].some((h1) => h1 !== headings[0]);
  }

  function isLinkFarm(element) {
    const links = element.getElementsByTagName('a');
    if (links.length < LINK_FARM_MIN_LINKS) return false;
    const total = (element.textContent || '').replace(/\s+/g, '').length;
    if (!total) return false;
    let linked = 0;
    for (const link of links) linked += (link.textContent || '').replace(/\s+/g, '').length;
    return linked / total >= LINK_FARM_RATIO;
  }

  // Header, footer, navigation, cookie or consent banners, other postings, and application forms:
  // never part of the job text. Lenient mode keeps all but the first four, for pages these rules
  // would leave nearly empty.
  function isPageChrome(element, lenient) {
    const tag = element.tagName;
    const role = element.getAttribute('role') || '';
    if (tag === 'NAV' || CHROME_ROLES.test(role)) return true;
    const label = names(element);
    if (CONSENT.test(label) && textLength(element) < 8000) return true;
    // A cookie notice in a dialog or notice bar that its class or id does not name.
    if ((role === 'dialog' || element.getAttribute('aria-modal') === 'true' || /modal|popup|banner|notice/i.test(label))
      && textLength(element) < 8000 && /\bcookies?\b/i.test(element.textContent || '')) return true;
    // A cookie notice with no names at all, known by how it starts.
    if (textLength(element) < 2000 && COOKIE_NOTICE_START.test((element.textContent || '').trim())) return true;
    // A header or footer inside the content belongs to it (an article's header holds the job title).
    if ((tag === 'HEADER' || tag === 'FOOTER') && !inContent(element) && !element.querySelector('h1')) return true;
    if (CHROME_NAMES.test(label) && !inContent(element) && !element.querySelector('h1')) return true;
    const idAndClass = `${element.id || ''} ${typeof element.className === 'string' ? element.className : ''}`;
    if ((tag === 'FOOTER' || FOOTER_NAME.test(idAndClass)) && textLength(element) < 5000 && !element.querySelector('h1')
      && SITE_FINE_PRINT.test(element.textContent || '')) return true;
    if (SHARE_NAMES.test(label) && textLength(element) < 600) return true;
    if (tag === 'A' && /^#/.test(element.getAttribute('href') || '') && /^skip to\b/i.test((element.textContent || '').trim())) return true;
    if (SCREEN_READER_ONLY.test(label) && textLength(element) < 200) return true;
    if ((role === 'alert' || role === 'status') && textLength(element) < 200) return true;
    if (lenient) return false;
    if (isOtherJobsBlock(element)) return true;
    if (element.querySelector('h1')) return false;
    if (OTHER_JOBS.test(label) || APPLICATION_FORM_NAMES.test(label)) return true;
    if (isLinkFarm(element)) return true;
    // The application form; a form around the whole page holds the job's h1 and stays.
    return tag === 'FORM' && element.querySelectorAll('input:not([type="hidden"]), select, textarea').length >= 2;
  }

  function collectText(root, lenient = false) {
    const parts = [];
    const newline = () => parts.push('\n');
    const visit = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue.replace(/\s+/g, ' ');
        if (text.trim()) parts.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (SKIPPED_TAGS.has(node.tagName) || isPageChrome(node, lenient)) return;
        if (node.tagName === 'BR') return newline();
      }
      const block = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
      if (block) newline();
      if (node.tagName === 'LI') parts.push('• ');
      if (node.shadowRoot) visit(node.shadowRoot);
      // A "Related jobs" heading drops itself and what follows it, up to the next heading at its
      // level or above.
      let skipBelow = 0;
      for (const child of node.childNodes) {
        const level = child.nodeType === Node.ELEMENT_NODE ? headingLevel(child) : 0;
        if (level && skipBelow && level <= skipBelow) skipBelow = 0;
        if (!lenient && level && !skipBelow && isOtherJobsHeading(child)) skipBelow = level;
        if (!skipBelow) visit(child);
      }
      if (block) newline();
    };
    visit(root);
    // One line per block; a line repeated in hidden copies of the same content (mobile and desktop
    // versions, for example) is kept once.
    const seen = new Set();
    const lines = [];
    for (const raw of parts.join('').split('\n')) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!line || line === '•' || FINE_PRINT_LINE.test(line) || CODE_LINE.test(line)) {
        if (lines.length && lines[lines.length - 1] !== '') lines.push('');
        continue;
      }
      const key = line.toLowerCase();
      if (line.length >= 30 && seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
    return lines.join('\n').trim();
  }

  function htmlToText(html) {
    // Inert parsing: page-supplied markup cannot load resources or run handlers.
    const parser = new DOMParser();
    const decoded = parser.parseFromString(`<textarea>${String(html)}</textarea>`, 'text/html').querySelector('textarea')?.value || String(html);
    return collectText(parser.parseFromString(decoded, 'text/html').body);
  }

  function jobPostings() {
    const found = [];
    const add = (value) => {
      if (Array.isArray(value)) return value.forEach(add);
      if (!value || typeof value !== 'object') return;
      if ([].concat(value['@type'] || []).some((type) => /JobPosting$/i.test(String(type)))) found.push(value);
      if (value['@graph']) add(value['@graph']);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        add(JSON.parse(script.textContent || ''));
      } catch {
        // Not valid JSON; skip it.
      }
    }
    return found;
  }

  function postingText(posting) {
    const place = (location) => {
      const address = location?.address || location;
      return typeof address === 'string'
        ? address
        : [address?.addressLocality, address?.addressRegion, address?.addressCountry?.name || address?.addressCountry]
          .filter((part) => typeof part === 'string' && part.trim()).join(', ');
    };
    const salary = posting.baseSalary?.value
      ? [posting.baseSalary.value.minValue, posting.baseSalary.value.maxValue].filter(Boolean).join(' – ')
        + ` ${posting.baseSalary.currency || ''} ${posting.baseSalary.value.unitText || ''}`.trimEnd()
      : '';
    return [
      posting.title && `Job title: ${posting.title}`,
      posting.hiringOrganization?.name && `Company: ${posting.hiringOrganization.name}`,
      [].concat(posting.jobLocation || []).map(place).filter(Boolean).join(' | ') && `Location: ${[].concat(posting.jobLocation || []).map(place).filter(Boolean).join(' | ')}`,
      posting.jobLocationType && `Workplace: ${posting.jobLocationType}`,
      posting.employmentType && `Employment type: ${[].concat(posting.employmentType).join(', ')}`,
      salary && `Salary: ${salary}`,
      posting.description && `Description:\n${htmlToText(posting.description)}`,
    ].filter(Boolean).join('\n');
  }

  function readJobPageText() {
    // The page's main region when it has the content; the site's bars sit outside it.
    const main = [...document.querySelectorAll('main, [role="main"], #mainContent, #main-content, #main')]
      .find((element) => (element.textContent || '').trim().length >= 500);
    const root = main || document.body;
    if (!root) return '';
    let text = collectText(root);
    if (text.length < 300) text = collectText(document.body, true);
    const compact = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const pageCompact = compact(text);
    for (const posting of jobPostings()) {
      const description = posting.description ? htmlToText(posting.description) : '';
      // Added only when the page text lacks it, so the description is not sent twice.
      if (description && pageCompact.includes(compact(description).slice(0, 300))) continue;
      text += `\n\nJob posting details from the page's structured data:\n${postingText(posting)}`;
    }
    return text.slice(0, MAX_LENGTH);
  }

  global.__qtsReadJobPageText = readJobPageText;
})(typeof globalThis !== 'undefined' ? globalThis : self);
