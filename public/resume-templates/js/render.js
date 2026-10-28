/* =============================================================================
   QTS resume renderer · render.js
   Turns one JSON file into a resume (resume.html) or its matching cover
   letter (cover-letter.html) and applies a template. No dependencies. Data
   is inserted with textContent only, never innerHTML, and links are limited
   to http(s) and mailto.

   Where the data comes from (first match wins)
     1. window.RESUME_DATA, set by a PDF service before this script runs
     2. <script type="application/json" id="resume-data"> in the page
     3. ?data=local       JSON loaded earlier with "Load JSON" (browser storage)
        ?data=<path>      a JSON file on the same site, e.g. data/sample-rtl.json
     4. data/sample-full.json

   Settings, lowest to highest priority
     template defaults (js/templates.js) → data.theme → URL parameters
   URL parameters use the theme names: template, titleStyle, skillsLayout,
   accentColor (hex, # optional), keywordColor, density, paper, embed=1 ...

   When the page is ready to print, <html> gets data-render-state="ready",
   data-pages (estimated page count) and, if needed, data-warnings.
   Programmatic use: await window.renderResume(data, { template: "classic" })

   ?embed=1&view=pages is the Resume page preview: the document is shown as
   its printed pages, one sheet each (see "Page view" below).
   ========================================================================== */
(() => {
  "use strict";

  const TEMPLATES = window.RESUME_TEMPLATES || [];
  const OPTIONS = window.RESUME_OPTIONS || {};
  const DEFAULT_TEMPLATE = "qts-standard";
  const DEFAULT_DATA_URL = "data/sample-full.json";
  const STORAGE_KEY = "qts-resume:data";
  const SKILL_MAX_LENGTH = 40;
  const FONT_SCALE_MIN = 0.95;
  const FONT_SCALE_MAX = 1.15;
  // The sizes a resume's bullets step down to when it runs past its pages.
  const BULLET_SIZES = ["11.5pt", "11pt"];

  let DOCUMENT = document.body.dataset.document === "cover-letter" ? "cover-letter" : "resume";
  let MAX_PAGES = DOCUMENT === "resume" ? 2 : 1;

  const FALLBACK_SETTINGS = {
    headerAlign: "start",
    contactStyle: "inline",
    titleStyle: "rule",
    titleCase: "upper",
    datePosition: "inline",
    bulletStyle: "disc",
    itemStyle: "plain",
    summaryStyle: "plain",
    skillsLayout: "rows",
    skillDetail: "bracket",
    letterLayout: "block",
    density: "auto",
  };

  const DEFAULT_LABELS = {
    summary: "Summary",
    email: "Email",
    phone: "Phone",
    location: "Location",
    linkedin: "LinkedIn",
    website: "Website",
    listSeparator: ", ",
    page: "Page",
    of: "of",
    subject: "Application for",
    dear: "Dear",
    greeting: "Dear Hiring Manager,",
    closing: "Kind regards,",
  };

  let root = document.documentElement;
  const params = new URLSearchParams(location.search);
  let mount = document.getElementById("resume-root");
  let styleRoot = document.head;
  let directRenderMode = window.QTS_RESUME_DIRECT_RENDER === true;
  let scopeDirectStyle = null;
  let currentData = null;
  let renderCount = 0;
  const PAGES_VIEW = params.get("embed") === "1" && params.get("view") === "pages";
  const PAGE_NUMBER_FONT = '8pt "QTS Arial"';


  /* ---------- Value helpers ---------- */

  const text = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
  const list = (value) => (Array.isArray(value) ? value : []);
  const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

  function safeUrl(value) {
    const raw = text(value);
    if (!raw) return "";
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  }

  const displayUrl = (url) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

  const cssString = (value) => `"${String(value).replace(/["\\]/g, "\\$&").replace(/[\r\n]+/g, " ")}"`;

  const slug = (value) =>
    value.toLowerCase().normalize("NFKD").replace(/[^a-z\d]+/g, "-").replace(/^-+|-+$/g, "");

  const hexColor = (value) => {
    const raw = text(value).replace(/^#?/, "#");
    return /^#([\da-f]{3}|[\da-f]{6})$/i.test(raw) ? raw : "";
  };

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function anchor(href, label) {
    const link = el("a", "", label);
    link.href = href;
    return link;
  }

  // Appends text, keeping each hyphenated word ("on-call") on one line: split
  // at a line end, an ATS that joins lines with a space would read "on- call".
  function unbroken(node, value) {
    value.split(/(\S*\w-\w\S*)/g).forEach((part, index) => {
      if (part) node.append(index % 2 ? el("span", "nowrap", part) : part);
    });
    return node;
  }

  // Appends text, turning **keyword** into <strong class="keyword">.
  function rich(node, value) {
    value.split(/(\*\*[^*]+?\*\*)/g).forEach((part) => {
      if (!part) return;
      const keyword = /^\*\*([^*]+?)\*\*$/.exec(part);
      node.append(keyword ? unbroken(el("strong", "keyword"), keyword[1]) : unbroken(document.createDocumentFragment(), part));
    });
    return node;
  }


  /* ---------- Normalise: same structure, clean values ---------- */

  function normaliseSkill(entry) {
    const source = typeof entry === "string" ? { name: entry } : object(entry);
    return { name: text(source.name), detail: text(source.detail) };
  }

  // The same date format as src/app/pdf/document-data.ts: "2025-04" -> "Apr 2025",
  // "present" -> "Present", joined as "Apr 2025 – Present".
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthText(value) {
    const raw = text(value);
    if (/^(present|current|now)$/i.test(raw)) return "Present";
    const match = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(raw);
    if (match) return MONTHS[Number(match[2]) - 1] ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
    return /^\d{4}$/.test(raw) ? raw : "";
  }
  function dateRange(startDate, endDate) {
    const start = monthText(startDate);
    const end = monthText(endDate);
    return start && end && start !== end ? `${start} – ${end}` : start || end;
  }

  function normaliseItem(item) {
    const source = object(item);
    const entries = list(source.bullets);
    return {
      heading: text(source.heading),
      focus: list(source.focus).map(text).filter(Boolean).slice(0, 6),
      subheading: text(source.subheading),
      location: text(source.location),
      workMode: text(source.workMode),
      dateRange: text(source.dateRange) || dateRange(source.startDate, source.endDate),
      description: text(source.description),
      link: safeUrl(source.link),
      // Standard items show bullets as sentences; skills keep name + detail.
      bullets: entries
        .map(normaliseSkill)
        .filter((skill) => skill.name)
        .map((skill) => (skill.detail ? `${skill.name} (${skill.detail})` : skill.name)),
      skills: entries.map(normaliseSkill).filter((skill) => skill.name),
    };
  }

  const hasContent = (item) =>
    Boolean(item.heading || item.subheading || item.dateRange || item.description || item.link || item.bullets.length);

  // A section is treated as skills when it is marked type "skills", or when
  // every item is only a heading plus short entries (grouped or flat lists).
  function looksLikeSkills(items) {
    return items.every(
      (item) =>
        item.skills.length &&
        !item.subheading &&
        !item.dateRange &&
        !item.description &&
        !item.link &&
        item.skills.every((skill) => skill.detail || skill.name.length <= SKILL_MAX_LENGTH)
    );
  }

  function normaliseSection(section, index) {
    const source = object(section);
    const title = text(source.title);
    const items = list(source.items).map(normaliseItem).filter(hasContent);
    const requested = ["standard", "skills"].includes(source.type) ? source.type : "auto";
    return {
      key: (text(source.id) || slug(title) || `section-${index + 1}`).toLowerCase(),
      title,
      items,
      type: requested === "auto" ? (looksLikeSkills(items) ? "skills" : "standard") : requested,
    };
  }

  function normaliseLetter(raw) {
    const source = object(raw);
    const recipient = object(source.recipient);
    const address = Array.isArray(recipient.address) ? recipient.address : text(recipient.address).split(/\r?\n/);
    return {
      date: text(source.date),
      recipient: {
        name: text(recipient.name),
        title: text(recipient.title),
        company: text(recipient.company),
        address: address.map(text).filter(Boolean),
      },
      subject: text(source.subject),
      greeting: text(source.greeting),
      paragraphs: list(source.paragraphs).map(text).filter(Boolean),
      closing: text(source.closing),
      signature: text(source.signature),
    };
  }

  function normalise(raw) {
    const data = object(raw);
    const letterCandidate = object(object(data.coverLetter).candidate);
    const source =
      DOCUMENT === "cover-letter" && Object.keys(letterCandidate).length
        ? letterCandidate
        : object(data.candidate);
    const resumeSource = object(data.resume);
    const warnings = [];

    const candidate = {
      fullName: text(source.fullName),
      email: text(source.email),
      phone: text(source.phone),
      location: text(source.location),
      headline: text(source.headline),
      linkedinUrl: safeUrl(source.linkedinUrl),
      links: list(source.links)
        .map((link) => (typeof link === "string" ? { url: link } : object(link)))
        .map((link) => ({ label: text(link.label), url: safeUrl(link.url) }))
        .filter((link) => link.url),
    };

    const resume = {
      targetRole: text(resumeSource.targetRole),
      targetCompany: text(resumeSource.targetCompany),
      summary: text(resumeSource.summary),
      sections: list(resumeSource.sections)
        .map(normaliseSection)
        .filter((section) => section.title && section.items.length),
    };

    if (!candidate.fullName) warnings.push("candidate.fullName is required.");
    if (!candidate.email) warnings.push("candidate.email is required.");
    if (!resume.targetRole) warnings.push("resume.targetRole is required.");
    if (DOCUMENT === "resume" && !resume.sections.length) {
      warnings.push("resume.sections needs at least one section with a title and items.");
    }

    const coverLetter = normaliseLetter(data.coverLetter);
    if (DOCUMENT === "cover-letter" && !coverLetter.paragraphs.length) {
      warnings.push("coverLetter.paragraphs is empty.");
    }

    return { candidate, resume, coverLetter, theme: object(data.theme), warnings };
  }


  /* ---------- Settings ---------- */

  function resolveTemplate(requested, warnings) {
    const id = text(requested);
    const match = TEMPLATES.find((template) => template.id === id);
    if (match) return match;
    if (id) warnings.push(`Unknown template "${id}"; using "${DEFAULT_TEMPLATE}".`);
    return TEMPLATES.find((template) => template.id === DEFAULT_TEMPLATE) || { id: DEFAULT_TEMPLATE, defaults: {} };
  }

  function resolveSettings(template, theme, overrides, warnings) {
    const settings = { ...FALLBACK_SETTINGS, ...template.defaults };
    for (const source of [theme, overrides]) {
      for (const [key, option] of Object.entries(OPTIONS)) {
        const value = text(source[key]);
        if (!value) continue;
        if (option.values.includes(value)) settings[key] = value;
        else warnings.push(`Ignored ${key} "${value}"; expected ${option.values.join(", ")}.`);
      }
    }
    return settings;
  }

  const urlOverrides = () => Object.fromEntries([...params.entries()].filter(([key]) => key !== "data" && key !== "embed"));

  function applyDocumentSettings(theme, labels) {
    root.lang = text(theme.language) || "en";
    root.dir = ["ltr", "rtl", "auto"].includes(theme.direction) ? theme.direction : "ltr";

    const tokens = {
      "--color-accent": hexColor(theme.accentColor),
      "--color-keyword": hexColor(theme.keywordColor),
      "--date-separator": theme.contentConsistency === "uniform" ? cssString(theme.dateSeparator || "–") : "",
      "--font-body": OPTIONS.fontFamily && OPTIONS.fontFamily.values.includes(theme.fontFamily) ? `var(--font-${theme.fontFamily})` : "",
      "--font-heading":
        OPTIONS.headingFont && OPTIONS.headingFont.values.includes(theme.headingFont) ? `var(--font-${theme.headingFont})` : "",
    };
    const scale = Number(theme.fontScale);
    if (Number.isFinite(scale) && scale > 0) {
      tokens["--font-scale"] = String(Math.min(Math.max(scale, FONT_SCALE_MIN), FONT_SCALE_MAX));
    }
    const letter = text(theme.paper).toLowerCase() === "letter";
    tokens["--page-width"] = letter ? "215.9mm" : "";
    tokens["--page-height"] = letter ? "279.4mm" : "";
    for (const [name, value] of Object.entries(tokens)) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
    if (!(Number.isFinite(scale) && scale > 0)) root.style.removeProperty("--font-scale");

    // @page cannot read custom properties, so paper size and page-number
    // wording are written as a small runtime stylesheet.
    const rules = [];
    if (theme.contentConsistency === "uniform") {
      rules.push(
        '.doc--uniform-content :is(.candidate-name, .candidate-headline, .section-title, .item-heading, .skill-group-title, .letter-subject) { text-transform: none !important; }'
      );
    }
    if (letter) rules.push("@page { size: letter; }");
    if (theme.showPageNumbers === false) {
      rules.push("@page { @bottom-right { content: none; } }");
    } else if (labels.page !== DEFAULT_LABELS.page || labels.of !== DEFAULT_LABELS.of) {
      rules.push(
        `@page { @bottom-right { content: ${cssString(labels.page)} " " counter(page) " " ${cssString(labels.of)} " " counter(pages); } }`
      );
    }
    runtimeStyle().textContent = rules.join("\n");
    if (directRenderMode && scopeDirectStyle) scopeDirectStyle(runtimeStyle());
  }

  function runtimeStyle() {
    let style = styleRoot.querySelector("#resume-runtime-style");
    if (!style) {
      style = el("style");
      style.id = "resume-runtime-style";
      styleRoot.append(style);
    }
    return style;
  }

  async function loadTemplate(id) {
    if (directRenderMode) {
      const current = styleRoot.querySelector("#template-css");
      if (current?.dataset.templateId === id) return;
      const response = await fetch(`/resume-templates/templates/${id}.css`);
      if (!response.ok) throw new Error(`The ${id} resume template stylesheet could not be loaded.`);
      const style = el("style");
      style.id = "template-css";
      style.textContent = await response.text();
      styleRoot.insertBefore(style, current || runtimeStyle());
      try {
        if (scopeDirectStyle) scopeDirectStyle(style);
      } catch (reason) {
        style.remove();
        throw reason;
      }
      style.dataset.templateId = id;
      current?.remove();
      return;
    }
    const href = `templates/${id}.css`;
    const current = styleRoot.querySelector("#template-css");
    if (current && current.getAttribute("href") === href) return Promise.resolve();
    return new Promise((resolve) => {
      const link = el("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = link.onerror = () => {
        if (current) current.remove();
        link.id = "template-css";
        resolve();
      };
      // Before the runtime style, so runtime @page rules keep the last word.
      styleRoot.insertBefore(link, runtimeStyle());
    });
  }

  function setMetadata(candidate, resume) {
    if (directRenderMode) return;
    const kind = DOCUMENT === "resume" ? "Resume" : "Cover Letter";
    document.title = [candidate.fullName, resume.targetRole, kind].filter(Boolean).join(" – ");
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      const target = resume.targetCompany ? ` at ${resume.targetCompany}` : "";
      description.content = `${kind} of ${candidate.fullName} for ${resume.targetRole}${target}`;
    }
    const author = document.querySelector('meta[name="author"]');
    if (author) author.content = candidate.fullName;
  }


  /* ---------- Shared markup ---------- */

  function renderHeader(candidate, resume, settings, labels) {
    const header = el("header", "resume-header");
    header.append(el("h1", "candidate-name", candidate.fullName));

    // headline is optional; the required target role fills the line instead.
    const headline = candidate.headline || resume.targetRole;
    if (headline) header.append(el("p", "candidate-headline", headline));

    const fields = [
      candidate.email && { label: labels.email, value: anchor(`mailto:${candidate.email}`, candidate.email) },
      candidate.phone && { label: labels.phone, value: candidate.phone },
      candidate.location && { label: labels.location, value: candidate.location },
      candidate.linkedinUrl && { label: labels.linkedin, value: anchor(candidate.linkedinUrl, displayUrl(candidate.linkedinUrl)) },
      ...candidate.links.map((link) => ({ label: link.label || labels.website, value: anchor(link.url, displayUrl(link.url)) })),
    ].filter(Boolean);

    if (fields.length) {
      const contactList = el("ul", "contact-list");
      fields.forEach(({ label, value }) => {
        const item = el("li");
        if (settings.contactStyle === "labeled") item.append(el("span", "contact-label", `${label}:`), " ");
        // <bdi> keeps a phone number or email left-to-right inside an RTL document.
        const isolated = el("bdi");
        isolated.append(value);
        item.append(isolated);
        contactList.append(item);
      });
      const address = el("address", "contact");
      address.append(contactList);
      header.append(address);
    }
    return header;
  }

  function createDocument(kind, settings) {
    const article = el("article", `doc ${kind} sheet`);
    for (const [key, value] of Object.entries(settings)) {
      if (key in OPTIONS && key !== "fontFamily" && key !== "headingFont" && key !== "density") {
        article.setAttribute(`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
      }
    }
    return article;
  }

  function nodeKey(node) {
    if (node.nodeType !== 1) return "";
    return node.getAttribute("data-section") || node.id || "";
  }

  function canReuseNode(current, next) {
    if (!current || current.nodeType !== next.nodeType) return false;
    if (current.nodeType !== 1 || current.localName !== next.localName) return current.nodeType !== 1;
    return nodeKey(current) === nodeKey(next);
  }

  function reconcileNode(current, next) {
    if (current.nodeType === 3 || current.nodeType === 8) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    if (current.nodeType !== 1) return;

    for (const attribute of Array.from(current.attributes)) {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(next.attributes)) {
      if (current.getAttribute(attribute.name) !== attribute.value) {
        current.setAttribute(attribute.name, attribute.value);
      }
    }

    let cursor = current.firstChild;
    for (const nextChild of Array.from(next.childNodes)) {
      let match = canReuseNode(cursor, nextChild) ? cursor : null;
      const key = nodeKey(nextChild);
      if (!match && key) {
        for (let candidate = cursor?.nextSibling; candidate; candidate = candidate.nextSibling) {
          if (canReuseNode(candidate, nextChild)) {
            match = candidate;
            break;
          }
        }
      }
      if (!match) {
        match = nextChild.cloneNode(true);
        current.insertBefore(match, cursor);
      } else {
        if (match !== cursor) current.insertBefore(match, cursor);
        reconcileNode(match, nextChild);
      }
      cursor = match.nextSibling;
    }
    while (cursor) {
      const following = cursor.nextSibling;
      cursor.remove();
      cursor = following;
    }
  }


  /* ---------- Resume ---------- */

  function renderSection(title, id, modifier) {
    const section = el("section", modifier ? `section ${modifier}` : "section");
    section.setAttribute("aria-labelledby", id);
    const heading = el("h2", "section-title", title);
    heading.id = id;
    section.append(heading);
    return section;
  }

  // entryLayout A-G (js/templates.js): the entry's parts arranged in lines. Every
  // separator is real text, so the extracted text reads "Role | Focus | Company".
  function entryLines(item, settings) {
    const role = () => (item.heading ? [el("h3", "item-heading", item.heading)] : []);
    const company = () => (item.subheading ? [el("span", "item-company", item.subheading)] : []);
    const detail = (value) => el("span", "entry-detail", value);
    const dates = (prefix = "", suffix = "") => (item.dateRange ? [el("span", "item-date", `${prefix}${item.dateRange}${suffix}`)] : []);
    const joined = (parts, separator) => parts.filter(Boolean).join(separator);
    const place = joined([item.location, item.workMode], " | ");

    switch (settings.entryLayout) {
      case "A": {
        const where = joined([item.subheading, item.location], ", ");
        const tail = where ? ` | ${where}${item.workMode ? ` (${item.workMode})` : ""}` : item.workMode ? ` | ${item.workMode}` : "";
        return [[[...role(), ...(tail ? [detail(tail)] : [])], dates()]];
      }
      case "B": {
        const second = [...company()];
        const rest = joined([item.location, item.workMode, item.dateRange], " | ");
        if (rest) second.push(detail(`${item.subheading ? " - " : ""}${rest}`));
        return [[role(), []], [second, []]];
      }
      case "C": {
        const where = item.location ? `${item.location}${item.workMode ? ` (${item.workMode})` : ""}` : item.workMode;
        return [[role(), dates()], [company(), where ? [detail(where)] : []]];
      }
      case "D":
        return [[company(), place ? [detail(place)] : []], [role(), dates()]];
      case "E": {
        const first = [...company()];
        if (place) first.push(detail(`${item.subheading ? " – " : ""}${place}`));
        return [[first, []], [role(), []], [dates(), []]];
      }
      case "F": {
        const where = joined([item.subheading, item.location, item.workMode], " · ");
        return [[[...role(), ...dates(" (", ")")], []], [where ? [detail(where)] : [], []]];
      }
      default: {
        const where = joined([item.subheading, item.location, item.workMode], " · ");
        return [[role(), []], [where ? [detail(where)] : [], []], [dates(), []]];
      }
    }
  }

  function renderEntryHeader(item, settings) {
    const header = el("div", "item-header");
    if (!item.heading && !item.subheading && !item.location && !item.dateRange) return null;
    // The entry's key skills get a line of their own under the role, so an ATS
    // reads the role line as the job title alone.
    const focus = settings.showFocus === "yes" && item.heading && item.focus.length
      ? el("p", "item-focus", item.focus.slice(0, 3).join(" · "))
      : null;
    entryLines(item, settings).forEach(([main, aside]) => {
      if (!main.length && !aside.length) return;
      const line = el("div", "entry-line");
      const start = el("span", "entry-main");
      start.append(...main);
      line.append(start);
      if (aside.length) {
        // A real space keeps the two parts apart in the extracted text.
        const end = el("span", "entry-aside");
        end.append(" ", ...aside);
        line.append(end);
      }
      header.append(line);
      if (focus && main.some((part) => part.localName === "h3")) header.append(focus);
    });
    return header;
  }

  // Every template prints a project the same way: its name, a "Technologies:" line and
  // bullets, with no dates or company line.
  function renderProject(item) {
    const node = el("div", "item");
    if (item.heading) {
      const header = el("div", "item-header");
      header.append(el("h3", "item-heading", item.heading));
      if (item.focus.length) {
        const technologies = el("p", "item-technologies");
        technologies.append(el("span", "item-technologies-label", "Technologies:"), ` ${item.focus.join(", ")}`);
        header.append(technologies);
      }
      node.append(header);
    }
    if (item.description) node.append(rich(el("p", "item-description"), item.description));
    if (item.bullets.length) {
      const bullets = el("ul", "item-bullets");
      item.bullets.forEach((bullet) => bullets.append(rich(el("li"), bullet)));
      node.append(bullets);
    }
    return node;
  }

  function renderItem(item, settings, sectionKey = "") {
    if (sectionKey === "projects") return renderProject(item);
    // Education entries print without bullets in every template.
    if (sectionKey === "education") item = { ...item, bullets: [] };
    const node = el("div", "item");
    if (settings.entryLayout) {
      const header = renderEntryHeader(item, settings);
      if (header) node.append(header);
    } else if (item.heading || item.dateRange) {
      const header = el("div", "item-header");
      if (item.heading) header.append(el("h3", "item-heading", item.heading));
      if (item.heading && item.dateRange) header.append(" ");
      if (item.dateRange) {
        const date = settings.datePosition === "parentheses" && item.heading ? `(${item.dateRange})` : item.dateRange;
        header.append(el("p", "item-date", date));
      }
      node.append(header);
    }
    if (item.subheading && !settings.entryLayout) node.append(el("p", "item-subheading", item.subheading));
    if (item.link) {
      const value = el("bdi");
      value.append(anchor(item.link, displayUrl(item.link)));
      const link = el("p", "item-link");
      link.append(value);
      node.append(link);
    }
    if (item.description) node.append(rich(el("p", "item-description"), item.description));
    if (item.bullets.length) {
      const bullets = el("ul", "item-bullets");
      item.bullets.forEach((bullet) => bullets.append(rich(el("li"), bullet)));
      node.append(bullets);
    }
    return node;
  }

  const DETAIL_TEXT = {
    colon: (detail) => `: ${detail}`,
    dash: (detail) => ` – ${detail}`,
    bracket: (detail) => ` (${detail})`,
  };

  // Punctuation is real text chosen per layout: rows and compact read as
  // sentences ("Tools: A, B"), grid and bubbles show each skill on its own.
  function renderSkills(section, settings, labels) {
    const layout = settings.skillsLayout;
    const inline = layout === "rows" || layout === "compact";
    const skills = el("div", "skills");
    skills.dataset.groups = String(section.items.length);

    section.items.forEach((item, groupIndex) => {
      const group = el("div", "skill-group");
      if (item.heading) {
        group.append(el("h3", "skill-group-title", layout === "grid" ? item.heading : `${item.heading}:`), " ");
      }
      const skillList = el("ul", "skill-list");
      item.skills.forEach((skill, index) => {
        const entry = el("li", "skill");
        entry.append(rich(el("span", "skill-name"), skill.name));
        // Skills print as names only; years and levels are left out in every template.
        if (inline && index < item.skills.length - 1) entry.append(labels.listSeparator);
        skillList.append(entry);
        // A real space between tags and inline items keeps extracted words apart.
        if (layout !== "grid" && index < item.skills.length - 1) skillList.append(" ");
      });
      group.append(skillList);
      if (layout === "compact" && groupIndex < section.items.length - 1) group.append(el("span", "skill-group-sep", " · "));
      skills.append(group);
      if (layout === "compact") skills.append(" ");
    });
    return skills;
  }

  function orderBlocks(resume, theme) {
    const blocks = [];
    if (resume.summary) blocks.push({ key: "summary" });
    resume.sections.forEach((section) => blocks.push({ key: section.key, section }));

    const order = list(theme.sectionOrder).map((key) => text(key).toLowerCase()).filter(Boolean);
    const hidden = new Set(list(theme.hiddenSections).map((key) => text(key).toLowerCase()));
    const rank = (block) => (order.includes(block.key) ? order.indexOf(block.key) : order.length);
    return blocks
      .filter((block) => !hidden.has(block.key))
      .map((block, index) => ({ block, index }))
      .sort((a, b) => rank(a.block) - rank(b.block) || a.index - b.index)
      .map(({ block }) => block);
  }

  function renderResumeDocument(data, settings, labels) {
    const { candidate, resume, theme } = data;
    const article = createDocument("resume", settings);
    article.append(renderHeader(candidate, resume, settings, labels));

    const body = el("div", "doc-body resume-body");
    orderBlocks(resume, theme).forEach(({ key, section }, index) => {
      if (!section) {
        const summary = renderSection(labels.summary, "section-summary", "section--summary");
        summary.append(rich(el("p", "summary"), resume.summary));
        body.append(summary);
        return;
      }
      const isSkills = section.type === "skills";
      const node = renderSection(section.title, `section-${index}`, isSkills ? "section--skills" : "");
      node.dataset.section = key;
      if (isSkills) node.append(renderSkills(section, settings, labels));
      else section.items.forEach((item) => node.append(renderItem(item, settings, key)));
      body.append(node);
    });
    article.append(body);
    return article;
  }


  /* ---------- Cover letter ---------- */

  function today(language) {
    try {
      return new Intl.DateTimeFormat(language || "en", { dateStyle: "long" }).format(new Date());
    } catch {
      return new Date().toDateString();
    }
  }

  function renderLetterDocument(data, settings, labels) {
    const { candidate, resume, coverLetter: letter, theme } = data;
    const article = createDocument("letter", settings);
    article.append(renderHeader(candidate, resume, settings, labels));

    const body = el("div", "doc-body letter-body");
    body.append(el("p", "letter-date", letter.date || today(text(theme.language))));

    const recipient = letter.recipient;
    const lines = [recipient.name, recipient.title, recipient.company || resume.targetCompany, ...recipient.address].filter(Boolean);
    if (lines.length) {
      const block = el("div", "letter-recipient");
      lines.forEach((line) => block.append(el("p", "", line)));
      body.append(block);
    }

    const subject = letter.subject || [labels.subject, resume.targetRole].filter(Boolean).join(" ");
    if (subject) body.append(el("h2", "letter-subject", subject));

    const greeting = letter.greeting || (recipient.name ? `${labels.dear} ${recipient.name},` : labels.greeting);
    body.append(el("p", "letter-greeting", greeting));
    letter.paragraphs.forEach((paragraph) => body.append(rich(el("p", "letter-paragraph"), paragraph)));

    const signOff = el("div", "letter-signoff");
    signOff.append(
      el("p", "letter-closing", letter.closing || labels.closing),
      el("p", "letter-signature", letter.signature || candidate.fullName)
    );
    body.append(signOff);
    article.append(body);
    return article;
  }


  /* ---------- Page fitting ---------- */

  function estimatePages(article) {
    const probe = el("div");
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--page-area-height)";
    (directRenderMode ? mount : document.body).append(probe);
    const pageHeight = probe.getBoundingClientRect().height;
    probe.remove();

    const style = getComputedStyle(article);
    const top = article.getBoundingClientRect().top + parseFloat(style.paddingTop);
    const body = article.querySelector(".doc-body") || article;
    const contentHeight = body.getBoundingClientRect().bottom - top;
    return pageHeight > 0 ? Math.max(1, Math.ceil((contentHeight - 1) / pageHeight)) : 1;
  }

  // The pages the document prints on, from the page view's columns (see "Filling
  // pages"), which also count the space a block leaves when it moves on whole.
  // estimatePages adds up the content alone and can be a page short.
  function printedPages(article) {
    return inPageFlow(article, () => Math.max(1, article.getClientRects().length));
  }

  // density "auto" (default) tightens spacing only when content runs past the
  // page budget, then steps a resume's bullets down through BULLET_SIZES
  // (base.css section 12) until it fits. One that does not fit even at the
  // smallest size keeps its bullets at full size and runs over. No other text
  // shrinks.
  function fitToPages(article, density, warnings) {
    // The app's own preview (direct render) has no page view to measure with.
    const countPages = directRenderMode ? estimatePages : printedPages;
    article.classList.toggle("doc--compact", density === "compact");
    let pages = countPages(article);
    if (density === "auto" && pages > MAX_PAGES) {
      article.classList.add("doc--compact");
      pages = countPages(article);
    }
    if (density === "auto" && pages > MAX_PAGES && DOCUMENT === "resume") {
      article.classList.add("doc--small-bullets");
      const fits = BULLET_SIZES.some((size) => {
        article.style.setProperty("--text-bullet", size);
        return countPages(article) <= MAX_PAGES;
      });
      if (!fits) {
        article.classList.remove("doc--small-bullets");
        article.style.removeProperty("--text-bullet");
      }
      pages = countPages(article);
    }
    if (pages > MAX_PAGES) {
      const what = DOCUMENT === "resume" ? "resume" : "cover letter";
      warnings.push(`The ${what} needs about ${pages} pages; shorten it to fit ${MAX_PAGES}.`);
    }
    return pages;
  }


  /* ---------- Filling pages ----------
     A page ends early when the next block (a heading with its first entry, a
     bullet) does not fit, which would leave white space above the bottom
     margin. That space is shared out over the gaps between the sections,
     entries, bullets and paragraphs on the page, each growing by the same
     share of its size and at most tripling, so every page but the last ends at
     the bottom margin. Pages are found with the columns of the page view,
     which break exactly like print; a fill that would move anything to
     another page is retried smaller, then undone. */

  const FILL_GAPS = [
    ".section + .section",
    ".item + .item",
    ".item-bullets li + li",
    ".skill-group + .skill-group",
    ".letter-paragraph + .letter-paragraph",
  ].join(", ");
  const FILL_MAX_GROWTH = 2;
  const FILL_SHARES = [1, 0.9, 0.75, 0.5, 0.25];
  const FILL_SPARE_PX = 1;

  // Runs measure() with the document flowed through the page columns, out of
  // sight, then puts it back.
  function inPageFlow(article, measure) {
    const home = article.parentNode;
    const next = article.nextSibling;
    const flow = el("div", "page-flow");
    flow.style.visibility = "hidden";
    flow.append(article);
    document.body.append(flow);
    try {
      return measure();
    } finally {
      home.insertBefore(article, next);
      flow.remove();
    }
  }

  function fillPages(article) {
    inPageFlow(article, () => {
      let layout = pageLayout(article);
      for (let page = 0; page < layout.columns.length - 1; page += 1) {
        const room = layout.columns[page].bottom - layout.bottoms[page] - FILL_SPARE_PX;
        const gaps = pageGaps(article, layout, page);
        const total = gaps.reduce((sum, gap) => sum + gap.size, 0);
        if (room <= 0 || total <= 0) continue;
        const extra = Math.min(room / total, FILL_MAX_GROWTH);
        for (const share of FILL_SHARES) {
          gaps.forEach((gap) => gap.node.style.setProperty(gap.property, `${gap.size * (1 + extra * share)}px`));
          const filled = pageLayout(article);
          if (filled.pages === layout.pages) {
            layout = filled;
            break;
          }
          gaps.forEach((gap) => gap.node.style.removeProperty(gap.property));
        }
      }
    });
  }

  // The document's pages (one column each), how far down each page's content
  // reaches, and which page every line of text is on, to compare by. (A box
  // without text, such as the empty start of a section whose title moved on,
  // may change page.)
  function pageLayout(article) {
    const columns = [...article.getClientRects()];
    const centre = (rect) => (rect.left + rect.right) / 2;
    const columnOf = (rect) =>
      columns.reduce((best, column, index) => (Math.abs(centre(column) - centre(rect)) < Math.abs(centre(columns[best]) - centre(rect)) ? index : best), 0);
    const bottoms = columns.map((column) => column.top);
    for (const node of article.querySelectorAll("*")) {
      const rects = node.getClientRects();
      if (!rects.length) continue;
      // Only a box's last piece shows where it ends; earlier pieces run to the end of their page.
      const last = rects[rects.length - 1];
      bottoms[columnOf(last)] = Math.max(bottoms[columnOf(last)], last.bottom);
    }
    const lines = [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        const index = columnOf(rect);
        lines.push(index);
        bottoms[index] = Math.max(bottoms[index], rect.bottom);
      }
    }
    return { columns, columnOf, bottoms, pages: lines.join() };
  }

  // The gaps that may grow on a page: the space above each matching element
  // that starts on the page below its top (at a page top that space is dropped).
  // Under a rule (divided entries, topline titles) the padding grows with it,
  // and between timeline entries the padding that carries the line.
  function pageGaps(article, layout, page) {
    const top = layout.columns[page].top;
    const space = (node, property) => ({ node, property, size: parseFloat(getComputedStyle(node).getPropertyValue(property)) || 0 });
    return [...article.querySelectorAll(FILL_GAPS)].flatMap((node) => {
      const first = node.getClientRects()[0];
      if (!first || layout.columnOf(first) !== page || first.top <= top + 1) return [];
      const gaps = [space(node, "margin-top")];
      if (parseFloat(getComputedStyle(node).borderTopWidth) > 0) gaps.push(space(node, "padding-top"));
      if (node.classList.contains("item")) gaps.push(space(node.previousElementSibling, "padding-bottom"));
      return gaps.filter((gap) => gap.size > 0);
    });
  }


  /* ---------- Render ---------- */

  async function renderResume(rawData, overrides = {}, context = null) {
    if (context?.mount && context?.root && context?.styleRoot) {
      directRenderMode = true;
      DOCUMENT = context.documentType === "cover-letter" ? "cover-letter" : "resume";
      MAX_PAGES = DOCUMENT === "resume" ? 2 : 1;
      root = context.root;
      mount = context.mount;
      styleRoot = context.styleRoot;
      scopeDirectStyle = context.scopeStyle;
    }
    const run = ++renderCount;
    root.dataset.renderState = "rendering";
    currentData = rawData;

    const data = normalise(rawData);
    const { warnings } = data;
    const theme = { ...data.theme, ...overrides };
    const template = resolveTemplate(theme.template, warnings);
    const settings = resolveSettings(template, data.theme, overrides, warnings);
    if (theme.contentConsistency === "uniform") {
      settings.bulletStyle = "disc";
      if (settings.titleStyle === "topline") settings.titleStyle = "plain";
    }
    const labels = { ...DEFAULT_LABELS };
    for (const [key, value] of Object.entries(object(theme.labels))) {
      if (typeof value === "string") labels[key] = key === "listSeparator" ? value : value.trim();
    }

    applyDocumentSettings(theme, labels);
    setMetadata(data.candidate, data.resume);
    await loadTemplate(template.id);
    if (run !== renderCount) return null;

    let article =
      DOCUMENT === "resume" ? renderResumeDocument(data, settings, labels) : renderLetterDocument(data, settings, labels);
    if (theme.contentConsistency === "uniform") article.classList.add("doc--uniform-content");
    if (directRenderMode) {
      const currentArticle = mount.querySelector(".doc");
      if (currentArticle) {
        reconcileNode(currentArticle, article);
        article = currentArticle;
      } else {
        mount.replaceChildren(article);
      }
    } else {
      mount.replaceChildren(article);
    }

    // Web fonts only start loading once the text is laid out, so lay it out first; otherwise
    // fonts.ready resolves at once and the pages are measured with a fallback font.
    article.getBoundingClientRect();
    if (document.fonts) {
      // The page numbers (base.css section 2) are in a font the document may not use anywhere
      // else; unloaded, it would print nothing.
      document.fonts.load(PAGE_NUMBER_FONT).catch(() => {});
      await document.fonts.ready;
    }
    if (run !== renderCount) return null;

    const pages = fitToPages(article, settings.density, warnings);
    if (!directRenderMode) fillPages(article);
    root.dataset.document = DOCUMENT;
    root.dataset.template = template.id;
    root.dataset.pages = String(pages);
    if (warnings.length) root.dataset.warnings = warnings.join(" ");
    else delete root.dataset.warnings;
    warnings.forEach((warning) => console.warn(`[resume] ${warning}`));
    const layout = PAGES_VIEW && !directRenderMode ? showPages(article, (page, total) => pageNumberText(theme, labels, page, total)) : null;
    root.dataset.renderState = "ready";

    if (!directRenderMode) updateToolbar(template.id, pages, article.classList.contains("doc--compact"), warnings);
    return { document: DOCUMENT, template: template.id, settings, pages, warnings, layout };
  }


  /* ---------- Page view (?embed=1&view=pages) ----------
     The Resume page preview shows the document as its printed pages. The
     document flows through CSS columns exactly one page area tall; Chromium
     splits columns with the same fragmentation it splits printed pages with
     (break-inside, break-after, orphans and widows), so each column holds
     what the PDF prints on that page. Each sheet shows one column of its own
     copy, plus the page number @page prints in the margin. */

  function showPages(article, pageNumber) {
    const stack = el("div", "pages");
    // A picture of the pages: nothing in it takes focus, opens a link or is read out twice.
    stack.inert = true;
    const flows = [];
    const addSheet = (content) => {
      const sheet = el("div", "page");
      const flow = el("div", "page-flow");
      flow.append(content);
      sheet.append(flow);
      stack.append(sheet);
      flows.push(flow);
    };
    addSheet(article);
    const current = document.querySelector("body > .pages");
    if (current) current.replaceWith(stack);
    else document.body.append(stack);

    // A box split across columns has one client rect per column, in page order.
    const columns = [...article.getClientRects()];
    for (let index = 1; index < columns.length; index += 1) {
      addSheet(article.cloneNode(true));
      flows[index].style.transform = `translateX(${columns[0].left - columns[index].left}px)`;
    }
    flows.forEach((flow, index) => {
      const text = pageNumber(index + 1, flows.length);
      if (text) flow.parentElement.append(el("div", "page-number", text));
    });

    const first = flows[0].parentElement.getBoundingClientRect();
    const second = flows[1]?.parentElement.getBoundingClientRect();
    return {
      pageCount: flows.length,
      pageWidth: first.width,
      pageHeight: first.height,
      gap: second ? second.top - first.bottom : 0,
      height: stack.getBoundingClientRect().height,
    };
  }

  // What @page prints in the bottom-right margin (base.css section 2 and
  // applyDocumentSettings): nothing on page 1 or when page numbers are off.
  function pageNumberText(theme, labels, page, total) {
    if (page === 1 || theme.showPageNumbers === false) return "";
    return `${labels.page} ${page} ${labels.of} ${total}`;
  }


  /* ---------- Data loading ---------- */

  function readStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  function writeStorage(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage can be unavailable (private mode); the render still works.
    }
  }

  async function loadInitialData() {
    if (window.RESUME_DATA && typeof window.RESUME_DATA === "object") return window.RESUME_DATA;

    const embedded = document.getElementById("resume-data");
    if (embedded && embedded.textContent.trim()) return JSON.parse(embedded.textContent);

    const source = params.get("data") || DEFAULT_DATA_URL;
    if (source === "local") {
      const saved = readStorage();
      if (saved) return saved;
      throw new Error("No JSON file has been loaded in this browser yet.");
    }

    const url = new URL(source, location.href);
    if (url.origin !== location.origin) throw new Error("The data file must be on the same site as this page.");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${source} (HTTP ${response.status}).`);
    return response.json();
  }

  function showLoadError(error) {
    root.dataset.renderState = "error";
    const box = el("div", "load-error no-print");
    box.append(el("p", "load-error-title", "No resume data loaded"), el("p", "", error.message));
    if (location.protocol === "file:") {
      box.append(
        el(
          "p",
          "",
          "Browsers block reading JSON files from a page opened from disk. Run “python -m http.server 8000” " +
            "in this folder and open http://localhost:8000/, or use “Load JSON” above."
        )
      );
    }
    mount.replaceChildren(box);
    setStatus(error.message, true);
  }


  /* ---------- Preview toolbar (absent in production pages) ---------- */

  function setStatus(message, isError) {
    const status = document.getElementById("render-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }

  function updateToolbar(templateId, pages, compact, warnings) {
    const select = document.getElementById("template-select");
    if (select) select.value = templateId;
    document.querySelectorAll("[data-doc-link]").forEach((link) => {
      link.href = `${link.dataset.docLink}?${params}`;
      if (link.dataset.docLink.startsWith(DOCUMENT)) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const spacing = compact ? " · compact spacing" : "";
    const notes = warnings.length ? ` · ${warnings.join(" ")}` : "";
    setStatus(`About ${pages} page${pages === 1 ? "" : "s"}${spacing}${notes}`, warnings.length > 0);
  }

  function replaceUrl() {
    try {
      history.replaceState(null, "", `?${params}`);
    } catch {
      // Some file:// contexts refuse URL changes; the preview still updates.
    }
  }

  function setupToolbar() {
    const select = document.getElementById("template-select");
    if (select) {
      TEMPLATES.forEach((template) => select.append(new Option(template.name, template.id)));
      select.addEventListener("change", () => {
        params.set("template", select.value);
        replaceUrl();
        if (currentData) renderResume(currentData, urlOverrides()).catch(showLoadError);
      });
    }

    const fileInput = document.getElementById("data-file");
    if (fileInput) {
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          writeStorage(data);
          params.set("data", "local");
          replaceUrl();
          await renderResume(data, urlOverrides());
        } catch (error) {
          setStatus(`Could not read ${file.name}: ${error.message}`, true);
        }
        fileInput.value = "";
      });
    }

    const printButton = document.getElementById("print-button");
    if (printButton) printButton.addEventListener("click", () => window.print());
  }


  /* ---------- Start ---------- */

  window.renderResume = renderResume;
  if (params.get("embed") === "1" && !directRenderMode) root.classList.add("is-embed");
  if (PAGES_VIEW && !directRenderMode) root.classList.add("is-pages");
  if (!directRenderMode) setupToolbar();
  if (params.get("embed") === "1" && !directRenderMode) {
    window.addEventListener("message", async (event) => {
      const message = event.data;
      if (
        event.source !== window.parent
        || event.origin !== location.origin
        || message?.type !== "QTS_RESUME_TEMPLATE_RENDER"
        || typeof message.requestId !== "string"
        || !message.document
        || typeof message.document !== "object"
        || typeof message.template !== "string"
      ) return;

      try {
        const rendered = await renderResume(message.document, { template: message.template });
        // A newer request replaced this one; its answer follows.
        if (!rendered) return;
        window.parent.postMessage({
          type: "QTS_RESUME_TEMPLATE_RENDERED",
          requestId: message.requestId,
          ok: true,
          warnings: root.dataset.warnings || "",
          layout: rendered.layout,
        }, location.origin);
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error("The document could not be rendered.");
        showLoadError(error);
        window.parent.postMessage({
          type: "QTS_RESUME_TEMPLATE_RENDERED",
          requestId: message.requestId,
          ok: false,
          error: error.message,
        }, location.origin);
      }
    });
  } else if (!directRenderMode) {
    loadInitialData()
      .then((data) => renderResume(data, urlOverrides()))
      .catch(showLoadError);
  }
})();
