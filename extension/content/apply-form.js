// Apply's form engine, injected into an application page. It reads the form's fields (shown and
// hidden, inside open and closed shadow roots), fills them the way a person would so React forms
// accept the values, attaches files, and reports CAPTCHAs, login walls, field errors, and the page's
// result after Submit. It never clicks Submit by itself: the Manager does, after reviewing (the
// service worker calls clickButton('submit') only with Super Admin's automatic Submit option). On a
// job page without a form it finds the button that starts the application (clickStart), the way a
// person would. It also reads back what the form shows, for the record of what was submitted.

(function initQtsApplyForm(global) {
  const FIELD_ATTRIBUTE = 'data-qts-apply-field';
  const DROP_ATTRIBUTE = 'data-qts-apply-drop';
  const MENU_ATTRIBUTE = 'data-qts-apply-menu';
  const SEEN_ATTRIBUTE = 'data-qts-apply-seen';
  const RADIO_GROUP_ATTRIBUTE = 'data-qts-apply-radiogroup';
  // English first, then the words Polish, German, French, Spanish, Portuguese, and Italian sites use.
  const SUBMIT_TEXT = /^(submit|submit application|submit your application|send application|apply|apply now|send|send (my |your )?(cv|resume|application)|submit (my |your )?(cv|resume)|aplikuj|wyślij( zgłoszenie| aplikację| cv)?|zaaplikuj|(bewerbung )?(absenden|senden)|jetzt bewerben|envoyer( ma candidature)?|postuler|enviar( candidatura| solicitud)?|candidatar(-se)?|invia( candidatura)?)$/i;
  const NEXT_TEXT = /^(next|continue|save (and|&) continue|next step|proceed|dalej|weiter|suivant|siguiente|continuar|avanti)$/i;
  const START_TEXT = /^(apply|apply now|apply (for|to) (this|the) (job|position|role|vacancy|opening)|apply (online|here|today)|apply for job|start (your |my )?application|begin (your )?application|i['’]?m interested|aplikuj( teraz)?|zaaplikuj|(jetzt )?bewerben|postuler|aplicar( ahora)?|candidatar(-se)?|candidati( ora)?|apply (directly )?(on|at|via|through) (the )?(employer|company|hiring company|recruiter)['’]?s? (site|website|page|career(s)? (site|page))|apply (on|at) (company|employer) (site|website)|apply externally|apply on website|(continue|go|proceed) to (the )?(application|apply|employer['’]?s? site))$/i;
  const MANUAL_TEXT = /^(apply manually|manual application|apply without .{1,30}|fill (out|in) (the )?(form|application)( manually)?|enter (your )?(details|information) manually|continue (manually|without .{1,30}))$/i;
  const NOT_START = /linkedin|indeed|seek|xing|glassdoor|easy apply|with (google|facebook|apple|github|resume|cv)|later|save|share|refer|alert|similar|sign ?in|log ?in|register|autofill/i;
  // Job-site systems whose form a company page embeds in a frame; opening the frame shows the form.
  const FORM_FRAME = /greenhouse\.io\/(embed\/)?job_app|boards(\.eu)?\.greenhouse\.io|jobs(\.eu)?\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com|smartrecruiters\.com|recruitee\.com|teamtailor\.com|personio\.(de|com)|bamboohr\.com|jobvite\.com|breezy\.hr|comeet\.(co|com)|pinpointhq\.com|join\.com|homerun\.co|applytojob\.com/i;
  const DROP_TEXT = /\b(drag|drop)\b[^.]{0,40}\b(files?|here|cv|resume|résumé|document)\b|\bclick to upload\b|\bbrowse (files|computer)\b|\bchoose (a )?file\b/i;
  const MENU_ITEMS = '[role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="menuitem"]';
  const POPUP_ITEM = /^(option|menuitem|menuitemcheckbox|menuitemradio)$/;
  const CONFIRMED_TEXT = /thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(received|submitted|sent)|we['’]?ve received your application|we have received your application|successfully (applied|submitted)|your application (is|was|has been) (complete|submitted|received)|application submitted/i;
  // "Please select" in the languages job sites use: a dropdown's placeholder, never an answer.
  const PLACEHOLDER_WORDS = String.raw`(please )?(select|choose|pick)\b|bitte (aus)?w(ä|ae)hlen|(aus)?w(ä|ae)hlen sie|ausw(ä|ae)hlen|veuillez (s(é|e)lectionner|choisir)|s(é|e)lectionne(r|z)?\b|choisi(r|ssez)\b|seleccion(e|a|ar)\b|elija\b|selecione\b|escolha\b|selezion(a|are)\b|scegli\b|wybierz|kliknij|kies\b|selecteer\b|maak een keuze`;
  const PLACEHOLDER_OPTION = new RegExp(String.raw`^(-+$|—|–|-+\s*none\s*-+|${PLACEHOLDER_WORDS})`, 'i');
  const answerable = (text) => Boolean(text) && !PLACEHOLDER_OPTION.test(text);
  const IMAGE_CAPTCHA = /\bcaptcha\b|type (the )?(below |above )?(image )?(text|characters|letters|code|word)s? (shown |in |from |below |above )*(the )?(image|picture)?|type (the )?below image|enter (the )?(code|characters|text|letters) (shown |in |from )+(the )?(image|picture)/i;

  function shadowRootOf(element) {
    if (element.shadowRoot) return element.shadowRoot;
    try {
      return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(element) || null;
    } catch {
      return null;
    }
  }

  /** A frame's document when the browser lets this page read it (the same site); null otherwise. */
  function frameDocument(frame) {
    try {
      return frame.contentDocument || null;
    } catch {
      return null;
    }
  }

  /**
   * Every element under root, including inside open and closed shadow roots and inside frames from
   * the same site (another site's frame cannot be read; unreadableFrames reports those).
   */
  function allElements(root = document) {
    const found = [];
    const visit = (node) => {
      for (const element of node.querySelectorAll('*')) {
        found.push(element);
        const shadow = shadowRootOf(element);
        if (shadow) visit(shadow);
        if (element.tagName === 'IFRAME') {
          const inner = frameDocument(element);
          if (inner?.documentElement) visit(inner);
        }
      }
    };
    visit(root);
    return found;
  }

  // Frames that never hold application questions: security checks, video, maps, ads, payments.
  const NOT_FORM_FRAME = /captcha|recaptcha|hcaptcha|turnstile|challenges\.cloudflare|youtube|vimeo|wistia|maps\.google|google\.com\/maps|doubleclick|googletagmanager|facebook|twitter|linkedin\.com\/embed|stripe|paypal|intercom|zendesk|hotjar/i;

  /**
   * Shown frames from another site that may hold part of the form and cannot be read: their
   * addresses, so the Manager is told rather than Apply claiming the page is complete.
   */
  function unreadableFrames() {
    return allElements()
      .filter((element) => element.tagName === 'IFRAME' && isShown(element) && !frameDocument(element)?.documentElement)
      .filter((frame) => {
        const box = frame.getBoundingClientRect();
        return box.width >= 300 && box.height >= 200 && /^https?:/i.test(frame.src || '') && !NOT_FORM_FRAME.test(frame.src);
      })
      .map((frame) => {
        try {
          return new URL(frame.src).host;
        } catch {
          return frame.src.slice(0, 80);
        }
      });
  }

  /** The elements under root matching a selector, inside page components (shadow roots) too. */
  function deepQuery(root, selector) {
    if (!root) return [];
    // The root's own shadow root too: a list component keeps its options there.
    const own = root.nodeType === 1 ? shadowRootOf(root) : null;
    return [...allElements(root), ...(own ? allElements(own) : [])].filter((element) => element.matches(selector));
  }

  function isShown(element) {
    if (!element?.isConnected) return false;
    // Helper inputs that libraries hide from people (React Select's validation input) are not fields.
    if (element.closest('[aria-hidden="true"]')) return false;
    if (typeof element.checkVisibility === 'function') {
      return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function textOf(element) {
    return cleanText(element?.innerText || element?.textContent || '');
  }

  /** The question a control answers: its label, aria label, fieldset legend, or nearby question text. */
  /**
   * A page component's own label attribute around the control (Zoho's cx-prop-label="Last Name",
   * label="Email", data-label="City"): the question when no <label> names it.
   */
  function componentLabel(control) {
    let node = control.parentElement || control.getRootNode()?.host;
    for (let depth = 0; node && depth < 6; depth += 1) {
      // Only a component around this one control: a section holding other fields names them all.
      if (node.querySelectorAll?.('input:not([type="hidden"]), textarea, select').length > 2) break;
      for (const attribute of node.attributes || []) {
        if (!/(^|-)label$/i.test(attribute.name) || attribute.name === 'aria-label' || /class|style|position|direction/i.test(attribute.name)) continue;
        const text = cleanText(attribute.value);
        if (text && /\p{L}{2}/u.test(text) && text.length <= 200) return text;
      }
      node = node.parentElement || node.getRootNode?.()?.host;
    }
    return '';
  }

  // A label has words: a lone required mark ("*") is not a question (SmartRecruiters' screening
  // questions label each box with just "*" and show the question beside it).
  const hasWords = (text) => /\p{L}{2}/u.test(String(text || ''));
  const worded = (text) => (hasWords(text) ? text : '');

  function labelFor(control) {
    const root = control.getRootNode();
    // aria-labelledby first, as browsers name a field: a wrapping <label> may hold only an icon's
    // fallback text ("SVGs not supported by this browser.", Workable).
    const labelledBy = control.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = worded(labelledBy.split(/\s+/).map((id) => (root.getElementById?.(id) === control ? '' : textOf(root.getElementById?.(id)))).filter(Boolean).join(' '));
      if (text) return text;
    }
    if (control.id) {
      const label = worded(textOf(root.querySelector?.(`label[for="${CSS.escape(control.id)}"]`)));
      if (label) return label;
    }
    const wrapping = worded(textOf(control.closest('label')));
    if (wrapping) return wrapping;
    const ariaLabel = worded(cleanText(control.getAttribute('aria-label')));
    if (ariaLabel) return ariaLabel;
    const component = worded(componentLabel(control));
    if (component) return component;
    const legend = worded(textOf(control.closest('fieldset')?.querySelector('legend')));
    if (legend) return legend;
    // A question block: the nearest worded text before the control that is its own: never another
    // field's <label for>, never text holding a field, and with no other field between the text and
    // this control (that text is the other field's question).
    const before = (element, later) => Boolean(element.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    // A <label for> naming another field on the page is that field's; one naming nothing that
    // exists (Ashby's "Location" for a missing id) may still be this question's.
    const labelsOther = (element) => {
      if (element.tagName !== 'LABEL' || !element.htmlFor || element.htmlFor === control.id) return false;
      const target = element.getRootNode().getElementById?.(element.htmlFor);
      return Boolean(target && target !== control && !target.contains(control) && target.matches(FIELD_CONTROLS));
    };
    for (let node = control.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const fieldsHere = [...node.querySelectorAll(FIELD_CONTROLS)].filter((other) => other !== control && other.type !== 'hidden' && isShown(other));
      // Texts before the control with no other field between them and it, nearest last.
      const headings = [...node.querySelectorAll('label, legend, [class*="label" i], [class*="question" i], h3, h4, p')]
        .filter((element) => !element.contains(control) && before(element, control) && hasWords(textOf(element))
          && !labelsOther(element) && !element.querySelector(FIELD_CONTROLS)
          && !fieldsHere.some((other) => before(element, other) && before(other, control)));
      if (!headings.length) {
        // A text exists, but another field sits between it and this control: it is that field's.
        if (fieldsHere.some((other) => before(other, control))) break;
        continue;
      }
      // A real <label> or <legend> names the question; a paragraph after it only describes it.
      const heading = [...headings].reverse().find((element) => ['LABEL', 'LEGEND'].includes(element.tagName)) || headings[headings.length - 1];
      return textOf(heading).slice(0, 300);
    }
    // Inside a page component: the question around the component on the page.
    const outside = root.host ? labelFor(root.host) : '';
    if (outside) return outside;
    // Nothing names it for sure: its own placeholder or title, or text around it that holds no other
    // field. '' when none: the question is unresolved (scanForm marks it), never guessed.
    return worded(cleanText(control.getAttribute('placeholder') || control.getAttribute('aria-placeholder') || control.getAttribute('title')))
      || worded(ownTextAround(control));
  }

  // Elements that are a field (or one option of one).
  const FIELD_CONTROLS = 'input:not([type="hidden"]), textarea, select, [role="combobox"], [role="radio"], [role="checkbox"], [role="listbox"], [role="radiogroup"], button[aria-pressed], [contenteditable="true"]';

  /** The text of the boxes around a control, up to the first one that holds another field; '' when none. */
  function ownTextAround(control) {
    const up = (node) => node.parentElement || node.parentNode?.host || null;
    for (let node = up(control), depth = 0; node && depth < 4; node = up(node), depth += 1) {
      if (deepQuery(node, FIELD_CONTROLS).some((other) => other !== control && !other.contains(control) && isShown(other))) return '';
      const text = textOf(node);
      if (hasWords(text)) return text.slice(0, 300);
    }
    return '';
  }

  /**
   * The question of a block of controls (radio or checkbox options, a styled upload): the text of
   * the nearest enclosing block, without the options' own texts and button words.
   */
  function questionAround(control, optionTexts = []) {
    // Out of a page component too: its option sits in a shadow root, the question outside it.
    const up = (node) => node.parentElement || node.parentNode?.host || null;
    for (let node = up(control), depth = 0; node && depth < 7; node = up(node), depth += 1) {
      let text = textOf(node);
      for (const option of optionTexts) if (option) text = text.split(option).join(' ');
      text = cleanText(text.replace(/\b(attach|dropbox|google drive|enter manually|remove|upload|browse)\b/gi, ' '));
      if (text.replace(/[*✱:]/g, '').trim().length > 2) return text.slice(0, 300);
    }
    return '';
  }

  function isRequired(control, label) {
    return control.required
      || control.getAttribute('aria-required') === 'true'
      || /[*✱]\s*$|[*✱]\s|\(required\)|^[*✱]|^required\b/i.test(label)
      || labelMarkedRequired(control);
  }

  /** A <label for> styled "required" (Rails forms draw its asterisk with CSS). */
  function labelMarkedRequired(control) {
    const own = control.id ? control.getRootNode().querySelector?.(`label[for="${CSS.escape(control.id)}"]`) : null;
    return Boolean(own && /(^|\s)required(\s|$)/i.test(String(own.className || '')));
  }

  /** The unit a number or slider counts in (Teamtailor's notice slider says data-unit="Weeks"). */
  function unitOf(control, label) {
    for (let node = control, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
      const unit = node.getAttribute?.('data-unit') || node.querySelector?.('[data-unit]')?.getAttribute('data-unit');
      if (unit) return cleanText(unit).toLowerCase();
    }
    return String(label).toLowerCase().match(/\b(days?|weeks?|months?)\b/)?.[1] ?? null;
  }

  /** The question a block's control belongs to: its block's label or legend, else the block's text. */
  function blockQuestion(element) {
    for (let node = element.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
      const heading = node.querySelector('label, legend, h3, h4, [class*="label" i]');
      if (heading && !heading.contains(element) && textOf(heading)) return { text: textOf(heading).slice(0, 300), block: node };
    }
    return { text: questionAround(element), block: element.parentElement };
  }

  // Words saying an upload reads the résumé to fill the form (apply-answers.js decides on the label too).
  const AUTOFILL_NEAR = /auto-?fill|auto-?complete|auto-?populate|pre-?fill|easy apply|\b(parse|import)\b[^.]{0,30}\b(resume|résumé|cv)s?\b/i;

  /**
   * Whether an upload's own section says it reads the résumé to fill the form (Zoho's "Autofill
   * Application" above "Upload your resume"). Stops at a section holding another upload.
   */
  function autofillSection(element) {
    for (let node = element.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
      if (node.querySelectorAll('input[type="file"]').length > 1) return false;
      const text = textOf(node);
      if (text.length > 500) return false;
      if (AUTOFILL_NEAR.test(text)) return true;
    }
    return false;
  }

  // A button's words on an upload ("Choose file", "Browse", "or drag and drop here"), not its question.
  const UPLOAD_ACTION = /^(or )?(choose|select|browse|upload|attach|add|drop|drag)\b[^.]{0,40}$|drag (and|&) drop|no file (chosen|selected)|^\*$/i;

  /**
   * An upload's question ("Resume", "Cover letter"): the texts its input is labelled by, then its
   * own <label>, leaving out button words. Empty when only button words name it.
   */
  function uploadQuestion(control) {
    const root = control.getRootNode();
    const named = (control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map((id) => textOf(root.getElementById?.(id)))
      .concat(control.id ? [...(root.querySelectorAll?.(`label[for="${CSS.escape(control.id)}"]`) || [])].map(textOf) : [])
      .map((text) => cleanText(text.replace(/[*✱]/g, ' ')))
      .filter((text) => text && !UPLOAD_ACTION.test(text));
    return named.length ? named[0].slice(0, 200) : '';
  }

  /**
   * The heading of the section an upload sits in: the last heading before it on the page ("Add a
   * cover letter" above a box named only "Upload file"), so it gets the right document.
   */
  function headingAbove(control) {
    let anchor = control;
    while (anchor.getRootNode() !== document && anchor.getRootNode().host) anchor = anchor.getRootNode().host;
    let found = '';
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, legend, [role="heading"]')) {
      if (heading.contains(anchor) || !(heading.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (isShown(heading) && textOf(heading)) found = textOf(heading);
    }
    return cleanText(found).slice(0, 120);
  }

  // A text written as a date format ("DD/MM/YYYY", "mm-dd-yy").
  const DATE_FORMAT = /^[dmy]{1,4}[./\- ][dmy]{1,4}[./\- ][dmy]{1,4}$/i;

  /** A read-only box that opens a picker: a list (typed list, popup) or a date picker. */
  function readOnlyPicker(control) {
    if (control.tagName !== 'INPUT') return false;
    if (isTypedList(control) || control.hasAttribute('aria-haspopup') || (control.getAttribute('type') || '').toLowerCase() === 'date') return true;
    if (DATE_FORMAT.test(cleanText(control.placeholder))) return true;
    return /date|picker|calendar/i.test(`${control.className} ${control.id} ${control.name}`);
  }

  /**
   * A phone box holding only a dialling code ("+49", "0049"), put there by its country picker: no
   * number yet, so it is empty and gets the candidate's number.
   */
  function onlyDialCode(control, label = '') {
    const phone = (control.getAttribute?.('type') || '').toLowerCase() === 'tel'
      || /phone|mobile|telefon|\btel\b|handy|cellular|kom[oó]rk/i.test(`${label} ${control.name || ''} ${control.id || ''} ${control.autocomplete || ''}`);
    return phone && /^\s*(\+|00)\s?\d{1,4}\s*$/.test(String(control.value || ''));
  }

  /** Choices that are mostly dialing codes ("+40", "Romania (+40)"). */
  function dialCodeList(options) {
    return options.length >= 2 && options.filter((text) => /\+\s?\d{1,4}\b/.test(text)).length >= options.length / 2;
  }

  /** An editable box that is a field: the outermost editable element (an editor's writing area). */
  function isEditorHost(element) {
    const editable = element.getAttribute?.('contenteditable');
    return editable !== null && editable !== undefined && editable !== 'false' && element.isContentEditable
      && !element.parentElement?.isContentEditable && !insideQtsUi(element);
  }

  /** The hidden textarea an editor writes into for the page (Froala, Quill keep the original). */
  function editorPartner(editor) {
    for (let node = editor.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const textarea = [...node.querySelectorAll('textarea')].find((element) => !isShown(element));
      if (textarea) return textarea;
    }
    return null;
  }

  /** The editor shown in place of a hidden textarea, if any. */
  function editorOf(textarea) {
    for (let node = textarea.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const editor = deepQuery(node, '[contenteditable]').find((element) => isEditorHost(element) && isShown(element));
      if (editor) return editor;
    }
    return null;
  }

  /** Whether a control sits in a <form>, out of page components too. */
  function insideForm(control) {
    for (let node = control; node; node = node.parentElement || node.getRootNode?.()?.host || null) {
      if (node.tagName === 'FORM') return true;
    }
    return false;
  }

  // Languages as each names itself: a dropdown of these is the page's language switcher.
  const LANGUAGE_NAMES = /^(english|deutsch|français|francais|español|espanol|polski|português|portugues|italiano|nederlands|українська|русский|čeština|cestina|slovenčina|slovencina|magyar|română|romana|svenska|dansk|norsk|suomi|türkçe|turkce|ελληνικά|български|hrvatski|srpski|lietuvių|latviešu|eesti|日本語|中文|한국어|简体中文|繁體中文)$/i;

  /** The page's own language switcher: a dropdown of languages named in their own words, with no question of its own. */
  function languageSwitcher(select) {
    const options = [...select.options].map(optionText).filter(Boolean);
    if (options.length < 3 || options.filter((text) => LANGUAGE_NAMES.test(text)).length < options.length * 0.6) return false;
    const label = labelFor(select);
    return !label || options.every((text) => label.includes(text)) || !/\?|language|speak|interview/i.test(label);
  }

  /** An upload's label texts as the page writes them ("Resume/CV *"), for its required mark. */
  function uploadLabelsAsWritten(control, blockLabel = '') {
    const root = control.getRootNode();
    return [
      ...(control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => textOf(root.getElementById?.(id))),
      ...(control.id ? [...(root.querySelectorAll?.(`label[for="${CSS.escape(control.id)}"]`) || [])].map(textOf) : []),
      textOf(control.closest('label')),
      blockLabel,
    ].filter(Boolean).find((text) => isRequired(control, text)) || '';
  }

  /**
   * Upload areas without a file field of their own (Dropzone keeps its input outside the page's
   * form): the innermost element that says "drop your file", unless a file input sits next to it.
   */
  function dropZones() {
    const zones = [];
    for (const element of allElements()) {
      if (!['DIV', 'LABEL', 'BUTTON', 'SPAN', 'SECTION', 'P'].includes(element.tagName) || !isShown(element)) continue;
      const text = textOf(element);
      if (!text || text.length > 160 || !DROP_TEXT.test(text)) continue;
      if ([...element.children].some((child) => DROP_TEXT.test(textOf(child)))) continue;
      const { text: question, block } = blockQuestion(element);
      if (block?.querySelector('input[type="file"]')) continue;
      // "or drag and drop here" beside a real file input (Workable) is that upload, not another one.
      let near = element.parentElement;
      for (let depth = 0; near && depth < 4 && !near.querySelector('input[type="file"]'); depth += 1) near = near.parentElement;
      if (near?.querySelector('input[type="file"]')) continue;
      zones.push({ element, question });
    }
    return zones;
  }

  /** A button that opens a menu of choices (Teamtailor's "Select an option"), with its choices. */
  function menuChoices(button) {
    const listId = button.getAttribute('aria-controls');
    if (!listId || !/^(menu|listbox|true)$/i.test(button.getAttribute('aria-haspopup') || '')) return null;
    const list = button.getRootNode().getElementById?.(listId);
    const items = list ? [...list.querySelectorAll(MENU_ITEMS)] : [];
    return items.length >= 2 ? items : null;
  }

  /**
   * A dropdown button's question: its block's label ("Country"), never its accessible name, which
   * often adds the current choice ("Country United States").
   */
  function menuLabel(control) {
    // A component's own label first: the text next to the button may be its current value ("-None-").
    const component = componentLabel(control);
    if (component) return component;
    const own = textOf(control);
    let label = blockQuestion(control).text || labelFor(control);
    if (own && label.endsWith(own)) label = label.slice(0, -own.length).trim();
    return label;
  }

  // A chosen chip's remove mark ("None of the above ✕", "Yes✕") is not part of the choice; only the
  // marks at the very end are removed, so "C++", "R&D", or "2×2 grid" keep every character.
  const CHIP_REMOVE_MARK = /\s*[✕✖×✗]+$/u;
  function itemText(item) {
    return cleanText(item.getAttribute('data-search-text') || textOf(item)).replace(CHIP_REMOVE_MARK, '');
  }

  // What opens a menu of choices: a button, or a non-text element marked as a dropdown (Zoho's
  // <div role="combobox" aria-haspopup="listbox">). A typed combobox is an <input> and handled apart.
  /**
   * A typed list: an input with role="combobox" (also a type="search" one), or one that says it
   * suggests from a list (aria-autocomplete="list|both", aria-haspopup="listbox") without that role.
   */
  function isTypedList(control) {
    if (control.tagName !== 'INPUT') return false;
    const type = (control.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'password', 'checkbox', 'radio', 'file'].includes(type)) return false;
    return control.getAttribute('role') === 'combobox'
      || /^(list|both)$/i.test(control.getAttribute('aria-autocomplete') || '')
      || /^listbox$/i.test(control.getAttribute('aria-haspopup') || '');
  }

  function isMenuButton(control) {
    const role = control.getAttribute('role');
    return control.tagName === 'BUTTON' || role === 'button'
      || (role === 'combobox' && control.tagName !== 'INPUT' && control.hasAttribute('aria-haspopup'));
  }

  // Choice buttons a page draws itself: pressable ones side by side (Ashby's Yes / No).
  function pressButtons(element) {
    return [...element.children].filter((child) => child.tagName === 'BUTTON' && child.hasAttribute('aria-pressed'));
  }

  /** Two or more short pressable buttons in a question's block are one choice question. */
  function isPressGroup(element) {
    if (element.tagName === 'BUTTON' || element.hasAttribute('role')) return false;
    // A text editor's toolbar (Bold, Italic, Underline) is not a question.
    if (element.closest('[role="toolbar"], [class*="toolbar" i]')) return false;
    const buttons = pressButtons(element);
    return buttons.length >= 2 && buttons.every((button) => { const text = itemText(button); return text && text.length <= 40; })
      && Boolean(blockQuestion(element).text);
  }

  // A styled radio group's choices: role="radio" items, or pressable buttons.
  function groupItems(group) {
    const radios = [...group.querySelectorAll('[role="radio"]')];
    return radios.length ? radios : pressButtons(group);
  }

  const isChosen = (item) => item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-pressed') === 'true';

  // Ashby draws a required question's asterisk with CSS: its heading's class says "required".
  function headingRequired(element) {
    const heading = blockQuestion(element).block?.querySelector('label, legend');
    return Boolean(heading && !heading.contains(element) && /required/i.test(String(heading.className)));
  }

  /**
   * A styled dropdown button (Radix and shadcn: role="combobox") whose real choices sit in the
   * hidden native select next to it, which the page keeps for its form.
   */
  function listboxChoices(button) {
    const isListbox = button.getAttribute('role') === 'combobox' || /^listbox$/i.test(button.getAttribute('aria-haspopup') || '');
    if (!isListbox || button.tagName === 'INPUT') return null;
    const select = button.parentElement?.querySelector('select');
    const options = select ? [...select.options].map(optionText).filter((text) => text && !PLACEHOLDER_OPTION.test(text)) : [];
    return options.length >= 2 ? options : null;
  }

  /**
   * A press as a mouse makes it, at the element's centre: Radix opens and picks on pointer events,
   * and ignores a pick where the pointer has not moved since the list opened.
   */
  function press(element) {
    element.scrollIntoView?.({ block: 'nearest' });
    const box = element.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, composed: true, button: 0, pointerType: 'mouse', isPrimary: true,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2,
    };
    element.dispatchEvent(new PointerEvent('pointermove', init));
    element.dispatchEvent(new PointerEvent('pointerdown', init));
    element.dispatchEvent(new MouseEvent('mousedown', init));
    element.dispatchEvent(new PointerEvent('pointerup', init));
    element.dispatchEvent(new MouseEvent('mouseup', init));
    element.click();
  }

  function optionText(option) {
    return cleanText(option.label || option.textContent);
  }

  /**
   * A select's answerable choices: not its placeholder, whether it says "Select…" or asks the
   * question itself ("Do you need a visa…?"), which has no value or cannot be chosen.
   */
  function realOptions(select) {
    return [...select.options]
      .filter((option) => option.value !== '' && !option.disabled)
      .map(optionText)
      .filter((text) => text && !PLACEHOLDER_OPTION.test(text));
  }

  // This file is injected again for every call; the prefix keeps new ids from repeating earlier ones.
  const idPrefix = Math.random().toString(36).slice(2, 6);
  let nextFieldNumber = 1;
  function fieldId(element) {
    if (!element.getAttribute(FIELD_ATTRIBUTE)) element.setAttribute(FIELD_ATTRIBUTE, `f${idPrefix}${nextFieldNumber++}`);
    return element.getAttribute(FIELD_ATTRIBUTE);
  }

  function findField(id) {
    return allElements().find((element) => element.getAttribute(FIELD_ATTRIBUTE) === id) || null;
  }

  /** The form's fields, one entry per question; radios and checkbox groups are one field each. */
  function scanForm() {
    const fields = [];
    const groups = new Map();
    const firstControls = new Map();
    for (const control of allElements()) {
      const tag = control.tagName;
      const type = (control.getAttribute('type') || '').toLowerCase();
      // A rich-text editor (Froala, Quill, ProseMirror, Trix): an editable box, often over a hidden
      // textarea the page sends; answered as a text box (a cover letter, a message).
      if (isEditorHost(control)) {
        const partner = editorPartner(control);
        const label = (partner && labelFor(partner)) || labelFor(control) || blockQuestion(control).text;
        fields.push({
          id: fieldId(control),
          label,
          kind: 'textarea',
          richEditor: true,
          required: isRequired(control, label) || Boolean(partner && isRequired(partner, label)),
          hidden: !isShown(control),
          disabled: control.getAttribute('aria-disabled') === 'true',
          ...(partner?.maxLength > 0 ? { maxLength: partner.maxLength } : {}),
          ...(textOf(control) ? { filled: true } : {}),
        });
        continue;
      }
      // The hidden textarea behind such an editor is the editor's, not a question of its own.
      if (tag === 'TEXTAREA' && !isShown(control) && editorOf(control)) continue;
      // The page's own controls are not questions: its language switcher, or a dropdown in its
      // header, navigation, or footer outside any form.
      if (tag === 'SELECT' && (languageSwitcher(control)
        || (!insideForm(control) && control.closest('header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]')))) continue;
      // Pressable choice buttons (Ashby's Yes / No) are one question, answered like a radio group;
      // the tick box the page keeps hidden beside them is not a question of its own.
      if (isPressGroup(control)) {
        const label = blockQuestion(control).text;
        control.setAttribute(RADIO_GROUP_ATTRIBUTE, 'press');
        fields.push({
          id: fieldId(control),
          label,
          kind: 'radio',
          required: isRequired(control, label) || headingRequired(control),
          options: pressButtons(control).map(itemText),
          hidden: !isShown(control),
          disabled: pressButtons(control).every((button) => button.disabled),
        });
        continue;
      }
      if (tag === 'INPUT' && control.closest(`[${RADIO_GROUP_ATTRIBUTE}="press"]`)) continue;
      // Menus count only inside the form (a "Share page" menu is not a question).
      if (isMenuButton(control) && control.closest('form, fieldset') && menuChoices(control)) {
        const label = labelFor(control);
        control.setAttribute(MENU_ATTRIBUTE, '1');
        fields.push({
          id: fieldId(control),
          label,
          kind: 'menu',
          required: isRequired(control, label),
          options: menuChoices(control).map(itemText).filter(answerable),
          hidden: !isShown(control),
          disabled: control.disabled,
        });
        continue;
      }
      // A menu whose choices exist only while it is open (Radix DropdownMenu): read by opening it.
      // A menu button beside an input (a phone number's country flag) belongs to that input.
      if (isMenuButton(control) && control.closest('form, fieldset')
        && /^(menu|listbox|true)$/i.test(control.getAttribute('aria-haspopup') || '') && !listboxChoices(control)
        && !deepQuery(blockQuestion(control).block, 'input:not([type="hidden"]):not([aria-hidden="true"]), textarea').length
        // "Import resume from…" and autofill pickers are not questions.
        && !/import|autofill|upload|attach|apply with|\bresume\b|\bcv\b|svg/i.test(`${textOf(control)} ${labelFor(control)}`)) {
        const label = menuLabel(control);
        control.setAttribute(MENU_ATTRIBUTE, 'lazy');
        fields.push({
          id: fieldId(control),
          label,
          kind: 'menu',
          lazy: true,
          required: isRequired(control, label),
          options: [],
          hidden: !isShown(control),
          disabled: control.disabled,
        });
        continue;
      }
      if (tag !== 'INPUT' && listboxChoices(control)) {
        const label = menuLabel(control);
        control.setAttribute(MENU_ATTRIBUTE, 'listbox');
        fields.push({
          id: fieldId(control),
          label,
          kind: 'menu',
          required: isRequired(control, label),
          options: listboxChoices(control),
          hidden: !isShown(control),
          disabled: control.disabled,
        });
        continue;
      }
      // A styled tick box (role="checkbox" on a button) is one yes/no box.
      if (tag !== 'INPUT' && control.getAttribute('role') === 'checkbox') {
        // Its own words sit next to it ("I agree to the terms"); a far-off heading would be another question.
        const label = cleanText(control.getAttribute('aria-label')) || questionAround(control) || labelFor(control);
        fields.push({
          id: fieldId(control),
          label,
          kind: 'checkbox',
          required: isRequired(control, label),
          hidden: !isShown(control),
          disabled: control.disabled || control.getAttribute('aria-disabled') === 'true',
        });
        continue;
      }
      // A styled radio group (role="radiogroup" around role="radio" buttons) is one question.
      if (control.getAttribute('role') === 'radiogroup' && !control.querySelector('input[type="radio"]')) {
        const items = [...control.querySelectorAll('[role="radio"]')];
        if (items.length >= 2) {
          const label = cleanText(control.getAttribute('aria-label')) || labelForGroup(items[0]) || labelFor(control);
          control.setAttribute(RADIO_GROUP_ATTRIBUTE, '1');
          fields.push({
            id: fieldId(control),
            label,
            kind: 'radio',
            required: control.getAttribute('aria-required') === 'true' || isRequired(control, label),
            options: items.map(itemText).filter(Boolean),
            hidden: !isShown(control),
            disabled: control.getAttribute('aria-disabled') === 'true',
          });
        }
        continue;
      }
      // Selectize keeps the real choices in the hidden select it replaced (Traffit's lists).
      const selectize = tag === 'INPUT' && control.closest('.selectize-control');
      if (selectize) {
        // The replaced select keeps the input's id without "-selectized", usually just before the control.
        const byId = control.id && control.getRootNode().getElementById?.(control.id.replace(/-selectized$/, ''));
        const original = byId?.tagName === 'SELECT' ? byId
          : selectize.previousElementSibling?.tagName === 'SELECT' ? selectize.previousElementSibling : null;
        const options = original ? realOptions(original) : [];
        // Selectize may move the choices out of that select; then they are read by opening the list.
        // The visible input's own label; the hidden select's would be its fieldset's section heading.
        const label = labelFor(control) || blockQuestion(selectize).text;
        control.setAttribute(MENU_ATTRIBUTE, options.length ? 'listbox' : 'lazy');
        fields.push({
          id: fieldId(control),
          label,
          kind: 'menu',
          // Typing opens and filters a Selectize list; a click does not reopen a focused one.
          searchable: true,
          ...(options.length ? {} : { lazy: true }),
          required: Boolean(original?.required) || isRequired(control, label),
          options,
          hidden: !isShown(control),
          disabled: control.disabled,
        });
        continue;
      }
      // A typed list: role="combobox" (also on type="search" boxes), or a box that says it suggests
      // from a list (aria-autocomplete, aria-haspopup="listbox") without that role.
      const isCombobox = isTypedList(control);
      if (tag === 'INPUT' && ['hidden', 'submit', 'button', 'image', 'reset', 'search', 'password'].includes(type) && !isCombobox) continue;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !isCombobox) continue;
      // No text names this box for sure: its name attribute is only a hint ("first_name"), and the
      // question is marked unresolved, so it is never answered as if it were another question.
      // A dropdown with no label of its own whose choices are dialing codes is a phone's country code.
      const named = labelFor(control) || (tag === 'SELECT' && dialCodeList(realOptions(control)) ? 'Phone country code' : '');
      const labelUnresolved = !named && type !== 'radio' && type !== 'checkbox' && type !== 'file';
      const label = named || (labelUnresolved ? cleanText(String(control.name || control.id || '').replace(/[_\-[\].]+/g, ' ')) : '');
      // A styled radio or tick box hides its input and shows its label instead.
      const ownLabel = (type === 'radio' || type === 'checkbox')
        ? control.closest('label') || (control.id && control.getRootNode().querySelector?.(`label[for="${CSS.escape(control.id)}"]`))
        : null;
      const shown = type === 'file' ? isShown(control.closest('div, label, section') || control)
        : isShown(control) || Boolean(ownLabel && isShown(ownLabel));
      if ((type === 'radio' || type === 'checkbox') && control.name) {
        const key = `${type}:${control.name}`;
        const option = choiceText(control);
        if (!groups.has(key)) {
          const field = {
            id: fieldId(control),
            label: '',
            kind: type === 'radio' ? 'radio' : 'checkbox-group',
            required: control.required || control.getAttribute('aria-required') === 'true',
            options: [],
            hidden: !shown,
            disabled: control.disabled,
          };
          groups.set(key, field);
          firstControls.set(field.id, control);
          fields.push(field);
        }
        const field = groups.get(key);
        field.options.push(option);
        field.hidden = field.hidden && !shown;
        continue;
      }
      // A styled upload's input has no useful label of its own ("Attach"); its question names it.
      const blockLabel = type === 'file' ? blockQuestion(control).text : '';
      const fieldLabel = type === 'file'
        ? (uploadQuestion(control)
          || (/resume|résumé|\bcv\b|cover|letter|file|attach|upload|document|portfolio/i.test(blockLabel)
            ? blockLabel
            : cleanText(`${questionAround(control)} ${control.id || control.name || ''}`)))
        : label;
      const field = {
        id: fieldId(control),
        label: fieldLabel,
        kind: tag === 'TEXTAREA' ? 'textarea'
          : tag === 'SELECT' ? 'select'
            : isCombobox ? 'combobox'
              : ['email', 'tel', 'url', 'number', 'date', 'file', 'checkbox', 'range'].includes(type) ? type : 'text',
        // An upload's name drops its "*", so its required mark is read from its label texts as written.
        required: isRequired(control, fieldLabel) || (type === 'file' && isRequired(control, uploadLabelsAsWritten(control, blockLabel))),
        hidden: !shown,
        // Read-only only stops Apply when it is not a picker: a date picker or a list box takes its
        // value through a popup, so it is still a question; a locked prefilled box is left alone.
        disabled: control.disabled || (control.readOnly && !readOnlyPicker(control)),
        ...(control.readOnly && readOnlyPicker(control) ? { readOnlyPicker: true } : {}),
        ...(labelUnresolved ? { labelUnresolved: true } : {}),
        // Named only by its placeholder ("Your city"): usable, but the question text is less sure.
        ...(named && type !== 'file' && cleanText(control.placeholder) === named ? { labelConfidence: 'low' } : {}),
        ...(tag === 'SELECT' && control.multiple ? { multiple: true } : {}),
        ...(control.maxLength > 0 ? { maxLength: control.maxLength } : {}),
        // What an upload takes ("image/*" for a photo), so Apply never puts a document there.
        ...(type === 'file' && control.accept ? { accept: String(control.accept).slice(0, 200) } : {}),
        ...(type === 'file' && autofillSection(control) ? { autofill: true } : {}),
        // The section's heading tells an upload named only "Upload file" which document it takes.
        ...(type === 'file' && headingAbove(control) ? { section: headingAbove(control) } : {}),
        // Date fields typed as text show their format here (DD/MM/YYYY).
        ...(control.placeholder ? { placeholder: String(control.placeholder).slice(0, 40) } : {}),
        // The question's help text ("Gross annual, in EUR"), so the AI answers in the form it asks for.
        ...(helpText(control) ? { note: helpText(control) } : {}),
        // "Select all that apply": a list that takes several choices.
        ...(isCombobox && isMultiple(control, fieldLabel) ? { multiple: true } : {}),
        // Text already in the box (a site may remember the previous applicant).
        // A phone box holding only the dialling code its country picker put there ("+49") is empty.
        ...(['TEXTAREA', 'INPUT'].includes(tag) && !['file', 'checkbox', 'radio', 'range'].includes(type) && control.value && !onlyDialCode(control, fieldLabel) ? { filled: true } : {}),
      };
      if (type === 'number' || type === 'range') {
        const unit = unitOf(control, fieldLabel);
        if (unit) field.unit = unit;
        if (control.min !== '' && Number.isFinite(Number(control.min))) field.min = Number(control.min);
        if (control.max !== '' && Number.isFinite(Number(control.max))) field.max = Number(control.max);
      }
      if (tag === 'SELECT') {
        field.options = realOptions(control);
      }
      // Choices already in the page are read without opening anything: a typed list's own list (even
      // closed), or the suggestions a <datalist> offers a text box (only some of what it takes).
      if (isCombobox || control.list) {
        const read = domChoices(control);
        if (read.options.length) {
          field.options = read.options;
          if (!isCombobox || read.partial) field.optionsPartial = true;
        }
      }
      fields.push(field);
    }
    for (const zone of dropZones()) {
      zone.element.setAttribute(DROP_ATTRIBUTE, '1');
      fields.push({
        id: fieldId(zone.element),
        label: zone.question,
        kind: 'file',
        drop: true,
        required: isRequired(zone.element, zone.question),
        hidden: false,
        disabled: false,
        ...(autofillSection(zone.element) ? { autofill: true } : {}),
        ...(headingAbove(zone.element) ? { section: headingAbove(zone.element) } : {}),
      });
    }
    for (const field of fields) {
      const control = firstControls.get(field.id);
      if (!control) continue;
      const question = questionAround(control, field.options);
      // A single checkbox is one yes/no box, named by its own text when it has words, else by its block.
      if (field.kind === 'checkbox-group' && field.options.length === 1) {
        const own = field.options[0];
        field.kind = 'checkbox';
        field.label = own && /[a-z]{3}/i.test(own) ? own : question;
        delete field.options;
      } else {
        field.label = question || labelForGroup(control);
      }
      field.required = field.required || isRequired(control, field.label);
    }
    return fields;
  }

  // A site's own required or error message is not help text.
  const NOT_HELP = /required|mandatory|invalid|error|must be|please (enter|fill|select)|cannot be (empty|blank)/i;

  /** The help text a field points to (aria-describedby), without the site's error messages. */
  function helpText(control) {
    const root = control.getRootNode();
    const text = String(control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map((id) => textOf(root.getElementById?.(id) || document.getElementById(id)))
      .filter((entry) => entry && !NOT_HELP.test(entry))
      .join(' ');
    return text.slice(0, 200);
  }

  const MULTIPLE_TEXT = /select all that apply|all that apply|select (one or more|several|multiple|any)|choose (all|one or more|several|multiple)|multiple (choices|answers|selections?)|(select|choose|pick) up to \d/i;

  /** Whether a typed list takes several choices: marked so, or its question says so. */
  function isMultiple(control, label) {
    if (control.getAttribute('aria-multiselectable') === 'true') return true;
    const listId = control.getAttribute('aria-controls') || control.getAttribute('aria-owns');
    const list = listId && control.getRootNode().getElementById?.(listId);
    return list?.getAttribute('aria-multiselectable') === 'true' || MULTIPLE_TEXT.test(label);
  }

  function labelForGroup(control) {
    const fieldset = control.closest('fieldset');
    const legend = fieldset?.querySelector('legend');
    if (legend && textOf(legend)) return textOf(legend);
    const group = control.closest('[role="radiogroup"], [role="group"]');
    if (group?.getAttribute('aria-labelledby')) {
      const text = textOf(group.getRootNode().getElementById?.(group.getAttribute('aria-labelledby')));
      if (text) return text;
    }
    if (group?.getAttribute('aria-label')) return cleanText(group.getAttribute('aria-label'));
    for (let node = control.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
      const heading = [...node.children].find((child) => !child.contains(control) && textOf(child) && !child.querySelector('input'));
      if (heading) return textOf(heading).slice(0, 300);
    }
    return '';
  }

  function shownListboxes() {
    return allElements().filter((element) => element.getAttribute('role') === 'listbox' && isShown(element));
  }

  /**
   * The list a search box opened: the one it names (aria-controls), else one that appeared when it
   * opened. Never another field's list that happens to be open (a phone number's country list).
   */
  function listFor(input, before) {
    const listId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    const root = input.getRootNode();
    // React Select names its list after the input ("react-select-<input id>-listbox").
    const named = (listId && root.getElementById?.(listId)) || (input.id && root.getElementById?.(`react-select-${input.id}-listbox`));
    if (named) return named;
    return shownListboxes().find((list) => !before.includes(list)) || null;
  }

  // At most this many choices go to the AI; a list with more is marked partial, never complete.
  const MAX_CHOICES = 300;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * A typed list's choices already in the page, read without opening it: a <datalist>, or the
   * options of the list it names (aria-controls), even while that list is closed. { options, partial }.
   */
  function domChoices(control) {
    let texts = [];
    if (control.list?.options?.length) {
      texts = [...new Set([...control.list.options].map((option) => cleanText(option.value || option.label || option.textContent)).filter(answerable))];
    } else {
      const listId = control.getAttribute('aria-controls') || control.getAttribute('aria-owns');
      const list = listId ? (control.getRootNode().getElementById?.(listId) || document.getElementById(listId)) : null;
      texts = list ? [...new Set(deepQuery(list, '[role="option"]').map(itemText).filter(answerable))] : [];
    }
    return { options: texts.slice(0, MAX_CHOICES), partial: texts.length > MAX_CHOICES };
  }

  /**
   * What a typed list holds before Apply looks at its choices: its value, and the words around it
   * (chips), so looking can be checked to have changed nothing.
   */
  function fieldState(input) {
    return { value: input.value, around: textAround(input) };
  }

  /** The words around a box (its chips, its question), without any list open beside it. */
  function textAround(input) {
    const { block } = blockQuestion(input.getRootNode()?.host || input);
    let text = textOf(block);
    for (const list of deepQuery(block, '[role="listbox"], [role="menu"]')) {
      const listText = textOf(list);
      if (listText) text = text.split(listText).join(' ');
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * After looking at a list's choices: a value it changed is put back; words that appeared around it
   * (a chip a tag box created) cannot be, and are reported. true when anything had changed.
   */
  function restoreAfterLooking(input, state) {
    let changed = false;
    if (input.value !== state.value) {
      setNativeValue(input, state.value);
      changed = true;
    }
    // A list left open beside the box is not a change; anything else around it (a new chip) is.
    if (textAround(input) !== state.around) changed = true;
    return changed;
  }

  /** The element that scrolls a list's choices: the list itself or a box around it. */
  function scrollerOf(list) {
    for (let node = list, depth = 0; node && depth < 4 && node !== document.body; node = node.parentElement, depth += 1) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 5 && /(auto|scroll)/.test(`${style.overflowY} ${style.overflow}`)) return node;
    }
    return null;
  }

  /**
   * A search list that shows nothing when opened: sample searches ("a", "e", ...) bring up its
   * choices, collected and never picked. Only typing events are sent (no "change", which a tag box
   * takes as a new tag); the box is emptied after and checked to be as it was.
   * { options, partial: true, changed }.
   */
  async function searchComboboxChoices(id) {
    const input = findField(id);
    if (!input || input.tagName !== 'INPUT') return { options: [], partial: true, changed: false };
    const state = fieldState(input);
    const found = new Set();
    const typeQuietly = (text) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, text);
      else input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    markShownChoices();
    input.focus();
    for (const query of ['a', 'e', 'i', 'o', 'u', '1']) {
      typeQuietly(query);
      input.dispatchEvent(new KeyboardEvent('keyup', { key: query, bubbles: true, composed: true }));
      for (let waited = 0; waited < 1500; waited += 300) {
        await sleep(300);
        const texts = shownChoiceTexts(id);
        if (texts.length) {
          for (const text of texts) found.add(text);
          break;
        }
      }
      if (found.size > MAX_CHOICES) break;
    }
    typeQuietly(state.value);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    input.blur();
    await sleep(100);
    const options = [...found].filter(answerable);
    return { options: options.slice(0, MAX_CHOICES), partial: true, changed: restoreAfterLooking(input, state) };
  }

  /** The choices sample searches bring up (only some of the list's). */
  async function searchComboboxOptions(id) {
    return (await searchComboboxChoices(id)).options;
  }

  /**
   * A typed list's choices, read by opening it, and closed again with nothing picked: opened with a
   * click (the arrow key, which can mark a choice a site then commits, only when a click opens
   * nothing); a list that loads more rows as it scrolls is scrolled to its end and back. The box is
   * checked to be as it was. { options, partial, changed }: partial when more rows may exist.
   */
  async function discoverComboboxChoices(id) {
    const input = findField(id);
    if (!input) return { options: [], partial: false, changed: false };
    const state = fieldState(input);
    const before = shownListboxes();
    const found = new Set();
    const collect = (list) => {
      for (const text of deepQuery(list, '[role="option"]').map(itemText).filter(answerable)) found.add(text);
    };
    input.focus();
    input.click?.();
    await sleep(400);
    let list = listFor(input, before);
    if (!list || !deepQuery(list, '[role="option"]').length) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await sleep(300);
      list = listFor(input, before);
    }
    // A list that opened empty, or says it is loading (aria-busy, "Loading…"), is waited for while it
    // loads: up to 1.5 seconds when it gives no sign, 3 seconds while it says it is loading.
    const loading = (element) => element?.getAttribute('aria-busy') === 'true' || /^(loading|searching|please wait)\b/i.test(textOf(element));
    for (let waited = 0; list && (!deepQuery(list, '[role="option"]').length || loading(list)) && waited < (loading(list) ? 3000 : 1500); waited += 300) {
      await sleep(300);
      list = listFor(input, before) || list;
    }
    collect(list);
    let partial = false;
    const scroller = list && scrollerOf(list);
    if (scroller) {
      for (let step = 0; step < 15; step += 1) {
        const size = found.size;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
        await sleep(300);
        collect(listFor(input, before) || list);
        if (found.size === size) break;
        // Still growing after the last step: more rows may exist.
        if (step === 14 || found.size > MAX_CHOICES) partial = true;
        if (found.size > MAX_CHOICES) break;
      }
      scroller.scrollTop = 0;
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    input.blur();
    await sleep(100);
    const options = [...found];
    return { options: options.slice(0, MAX_CHOICES), partial: partial || options.length > MAX_CHOICES, changed: restoreAfterLooking(input, state) };
  }

  /** Comboboxes (React Select and similar) show their options only when opened; opening reads them. */
  async function readComboboxOptions(id) {
    return (await discoverComboboxChoices(id)).options;
  }

  /**
   * A dropdown's choices as the page holds them now, read without opening anything (a select, a
   * typed list's named list or datalist, a menu's list, a hidden select): null when they are not in
   * the page and only opening it would show them.
   */
  function currentChoices(id) {
    const element = findField(id);
    if (!element) return null;
    if (element.tagName === 'SELECT') return realOptions(element);
    if (isTypedList(element) || element.list) {
      const read = domChoices(element);
      return read.options.length ? read.options : null;
    }
    const menu = menuChoices(element);
    if (menu) return menu.map(itemText).filter(answerable);
    return listboxChoices(element);
  }

  /** A typed list's state by its id, before the service worker opens it with real clicks to look. */
  function fieldStateOf(id) {
    const input = findField(id);
    return input?.tagName === 'INPUT' ? fieldState(input) : null;
  }

  /** After a real-click look: the value put back if it changed; true when anything had changed. */
  function restoreFieldState(id, state) {
    const input = findField(id);
    return input && state ? restoreAfterLooking(input, state) : false;
  }

  /** A menu's choices, read by opening it and closing it again (they exist only while it is open). */
  /**
   * The choices of the list a dropdown points to (aria-controls), shown now; null when it names
   * none, so another dropdown's list left open is never read as this one's.
   */
  function controlledChoices(button) {
    const id = button.getAttribute('aria-controls');
    const list = id ? (button.getRootNode().getElementById?.(id) || document.getElementById(id)) : null;
    const items = list ? [...list.querySelectorAll(MENU_ITEMS)].filter((item) => isShown(item) && answerable(itemText(item))) : [];
    return items.length ? items : null;
  }

  async function readMenuOptions(id) {
    const button = findField(id);
    if (!button) return [];
    press(button);
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (button.hasAttribute('aria-expanded') && button.getAttribute('aria-expanded') !== 'true') {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const options = (controlledChoices(button) || shownChoices()).map(itemText).filter(answerable);
    for (const target of [document.activeElement, button]) {
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    // A dropdown that ignores Escape is closed with another click, so its list does not stay open.
    if (button.getAttribute('aria-expanded') === 'true') {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return [...new Set(options)].slice(0, 300);
  }

  function setNativeValue(element, value) {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** A radio's or checkbox's own text: its wrapping label or label[for], else its value. */
  function choiceText(control) {
    return textOf(control.closest('label'))
      || textOf(control.id && control.getRootNode().querySelector?.(`label[for="${CSS.escape(control.id)}"]`))
      // A radio inside a page component (<x-radio>Yes</x-radio>): the component's own words.
      || worded(textOf(control.getRootNode().host))
      || control.value;
  }

  // Same type only: Rails pairs a checkbox with a hidden input of the same name.
  function controlsOfGroup(first) {
    const root = first.getRootNode();
    const local = [...root.querySelectorAll(`input[type="${first.type}"][name="${CSS.escape(first.name)}"]`)];
    // Page components keep each option in its own shadow root: the group spans them.
    if (local.length > 1 || root === document) return local;
    return allElements().filter((control) => control.tagName === 'INPUT' && control.type === first.type && control.name === first.name);
  }

  /** Whether a file input takes this file: no accept list, or one naming its type or extension. */
  function acceptsFile(input, file) {
    const types = String(input.accept || '').toLowerCase().split(',').map((entry) => entry.trim()).filter(Boolean);
    if (!types.length) return true;
    const mime = String(file.mimeType || '').toLowerCase();
    const extension = `.${String(file.filename || '').split('.').pop()?.toLowerCase()}`;
    return types.some((entry) => entry === '*/*' || entry === mime || entry === extension
      || (entry.endsWith('/*') && mime.startsWith(entry.slice(0, -1))));
  }

  function base64ToFile(base64, filename, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], filename, { type: mimeType || 'application/pdf' });
  }

  /** Fills one field; returns { ok, value } with what the field holds afterwards. */
  async function fillField(id, value, file = null) {
    const element = findField(id);
    if (!element) return { ok: false, error: 'The field is no longer on the page.' };
    if (element.hasAttribute(DROP_ATTRIBUTE)) return dropFile(element, file);
    if (element.hasAttribute(MENU_ATTRIBUTE)) return pickMenuChoice(element, value);
    if (isEditorHost(element)) return fillEditor(element, value);
    if (element.hasAttribute(RADIO_GROUP_ATTRIBUTE)) {
      const wanted = cleanText(value).toLowerCase();
      const item = groupItems(element).find((entry) => itemText(entry).toLowerCase() === wanted);
      if (!item) return { ok: false, error: `"${value}" is not an option.` };
      if (!isChosen(item)) press(item);
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { ok: isChosen(item), value: itemText(item) };
    }
    if (element.tagName !== 'INPUT' && element.getAttribute('role') === 'checkbox') {
      if ((element.getAttribute('aria-checked') === 'true') !== Boolean(value)) element.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { ok: (element.getAttribute('aria-checked') === 'true') === Boolean(value), value: element.getAttribute('aria-checked') === 'true' };
    }
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (type === 'file') {
      if (!file) return { ok: false, error: 'No file to attach.' };
      if (!acceptsFile(element, file)) return { ok: false, error: `This upload does not take ${file.filename.split('.').pop()?.toUpperCase() || 'this'} files (it takes ${element.accept}).` };
      const transfer = new DataTransfer();
      transfer.items.add(base64ToFile(file.base64, file.filename, file.mimeType));
      element.files = transfer.files;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: element.files?.length === 1, value: element.files?.[0]?.name || '' };
    }
    if (type === 'radio' || (type === 'checkbox' && element.name && controlsOfGroup(element).length > 1)) {
      const wanted = [].concat(value).map((entry) => cleanText(entry).toLowerCase());
      for (const control of controlsOfGroup(element)) {
        const shouldBeChecked = wanted.includes(choiceText(control).toLowerCase());
        if (control.checked !== shouldBeChecked && (type === 'radio' ? shouldBeChecked : true)) {
          control.click();
          // A page that draws its own box around a hidden input (role="radio", Workable) takes the
          // click on that box when the input ignores it (React may undo the input's own click a moment later).
          const box = control.closest('[role="radio"], [role="checkbox"]');
          if (box) {
            await sleep(100);
            if (control.checked !== shouldBeChecked) {
              box.click();
              await sleep(100);
            }
          }
        }
      }
      const checked = controlsOfGroup(element).filter((control) => control.checked).map(choiceText);
      return { ok: checked.length > 0, value: checked.join(', ') };
    }
    if (type === 'checkbox') {
      if (element.checked !== Boolean(value)) element.click();
      return { ok: element.checked === Boolean(value), value: element.checked };
    }
    if (element.tagName === 'SELECT' && element.multiple) {
      // Several choices: each one selected, every other one left unselected.
      const wanted = [].concat(value).map((entry) => cleanText(entry).toLowerCase());
      const options = [...element.options];
      const missing = wanted.filter((text) => !options.some((entry) => optionText(entry).toLowerCase() === text));
      if (missing.length) return { ok: false, error: `"${missing.join('", "')}" is not an option.` };
      for (const entry of options) entry.selected = wanted.includes(optionText(entry).toLowerCase());
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      const picked = [...element.selectedOptions].map(optionText);
      return { ok: picked.length === wanted.length, value: picked.join(', ') };
    }
    if (element.tagName === 'SELECT') {
      const option = [...element.options].find((entry) => optionText(entry).toLowerCase() === cleanText(value).toLowerCase());
      if (!option) return { ok: false, error: `"${value}" is not an option.` };
      setNativeValue(element, option.value);
      return { ok: element.value === option.value, value: optionText(option) };
    }
    if (isTypedList(element)) {
      // A list that takes several choices gets each one in turn.
      const picked = [];
      for (const one of [].concat(value)) {
        // Already holding this choice: left as it is, never opened again.
        if (sameWords(element.value, one) || choiceShown(id, one)) {
          picked.push(cleanText(one));
          continue;
        }
        const result = await pickInCombobox(element, one);
        if (!result.ok) return { ...result, value: picked.join(', ') };
        picked.push(result.value);
      }
      return { ok: picked.length > 0, value: picked.join(', ') };
    }
    // A phone box beside a country-code picker: the picker on the number's country, the rest typed.
    const typed = await fitPhoneToPicker(element, String(value));
    // Suggestions already showing (another field's list) are marked, so only this box's are used.
    markShownChoices();
    element.focus();
    setNativeValue(element, typed);
    // A search box (Lever's location, Google Places) keeps a value only when a suggestion is picked.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const suggestion = pickSuggestion(element, typed);
    if (suggestion) {
      suggestion.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    element.blur();
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Sites reformat numbers: "5000" shows as "5,000", and a country picker keeps "600 100 200" of "+48 600 100 200".
    const digits = (text) => String(text).replace(/\D/g, '');
    const reformatted = digits(element.value).length >= 4 && digits(String(value)).endsWith(digits(element.value));
    // A picked suggestion counts only when the box now holds it (the typed text's words).
    const tookSuggestion = Boolean(suggestion) && closeChoice(element.value, typed.split(',')[0]);
    return { ok: Boolean(element.value) && (element.value === typed || element.value === String(value) || reformatted || tookSuggestion), value: element.value };
  }

  /**
   * One choice in a search list: "Warsaw, Poland" searches "Warsaw" and then picks the option that
   * matches the whole answer best. Nothing typed stays when no option matches; the options the list
   * showed come back, so the AI can choose one of them.
   */
  async function pickInCombobox(element, value) {
    const answer = cleanText(value).toLowerCase();
    const search = String(value).split(',')[0].trim();
    const before = shownListboxes();
    let seen = [];
    const squash = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    // exact: only the same choice (case and punctuation aside), for a whole list nothing filtered.
    const findMatch = async (waitMs, exact = false) => {
      let options = [];
      for (let waited = 0; waited < waitMs && !options.length; waited += 300) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const list = listFor(element, before);
        options = deepQuery(list, '[role="option"]').filter((option) => answerable(itemText(option)));
      }
      if (options.length) seen = options.map(itemText);
      const same = options.find((option) => squash(itemText(option)) === squash(answer));
      if (exact || same) return same || null;
      return options.find((option) => closeChoice(itemText(option), value))
        // "Warsaw" (what was typed) in "Warsaw, Masovian Voivodeship, Poland".
        || options.find((option) => closeChoice(itemText(option), search));
    };
    // A choice counts only when the box shows it after the click: a click alone is not an answer.
    const take = async (choice) => {
      const picked = itemText(choice);
      choice.click();
      await sleep(200);
      const id = element.getAttribute(FIELD_ATTRIBUTE);
      return sameWords(element.value, picked) || closeChoice(element.value, picked) || (id && choiceShown(id, picked))
        ? { ok: true, value: picked }
        : { ok: false, error: `The list did not take "${picked}".`, choices: [...new Set(seen)].slice(0, 300) };
    };
    // Click first: a list that shows its choices when opened is picked from, with nothing typed.
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    element.click?.();
    let match = await findMatch(1200, true);
    if (match) return take(match);
    // No choices shown, or not this one among them: typed to search.
    setNativeValue(element, search);
    match = await findMatch(3000);
    // Some suggestion boxes search only on key presses, or slowly: typed again letter by letter.
    if (!match) {
      await typeLetters(element, search);
      match = await findMatch(6000);
    }
    if (!match) {
      setNativeValue(element, '');
      return { ok: false, error: `No option matching "${value}".`, choices: [...new Set(seen)].slice(0, 300) };
    }
    return take(match);
  }

  /**
   * "+40 264 420 463" as "264 420 463" when a country-code picker beside the box (a flag button,
   * a select) already shows "+40": typed whole, the site would read "+40 +40 264…". Any other value,
   * or a picker showing another code, is typed as it is.
   */
  // A country code as a picker shows it: "+40", "🇷🇴 +40", "RO +40".
  const DIAL_CODE = /^[^\p{L}\p{N}+]*(?:\p{Lu}{2}\s*)?\+\s?(\d{1,4})\s*$/u;

  /**
   * The country-code picker beside a phone box, however a site draws it (a button, a select, a
   * component, plain text): { node, code }, found in the boxes around the phone box up to the one
   * holding another question. null when there is none.
   */
  function dialPicker(element) {
    const up = (node) => node.parentElement || node.parentNode?.host || null;
    for (let box = up(element), depth = 0; box && depth < 5; box = up(box), depth += 1) {
      // A box holding another question's field is past this phone box: no picker of its own there.
      const others = deepQuery(box, 'input:not([type="hidden"]), textarea')
        .filter((input) => input !== element && !String(input.value || '').match(DIAL_CODE) && isShown(input));
      if (others.length) return null;
      for (const node of deepQuery(box, '*')) {
        if (node === element || node.contains(element) || !isShown(node)) continue;
        const shown = node.tagName === 'SELECT' ? optionText(node.selectedOptions?.[0] || { textContent: '' })
          : node.tagName === 'INPUT' ? node.value : textOf(node);
        const code = String(shown).match(DIAL_CODE)?.[1];
        if (!code) continue;
        // The part a person clicks: the select, the button or dropdown it is, holds, or sits in.
        const CLICKABLE = 'button, select, [role="combobox"], [role="button"], [aria-haspopup]';
        const clickable = node.matches(CLICKABLE) ? node
          : deepQuery(node, CLICKABLE).find((inner) => isShown(inner)) || node.closest(CLICKABLE) || node;
        return { node: clickable, code };
      }
    }
    return null;
  }

  /** The digits after a number's country code, with the spacing the number had ("+40 264 484 948" → "264 484 948"). */
  const afterCode = (number, code) => number.replace(/^\+\s*/, '').slice(code.length).replace(/^[\s.()-]+/, '');

  /**
   * A phone number for a box beside a country-code picker, with the picker on the number's own
   * country: "+40 264 484 948" types "264 484 948" with the picker on +40. A picker on another code
   * is first switched to the number's (a choice showing "+40"); when it cannot be, or there is no
   * picker, the whole number is typed as it is.
   */
  async function fitPhoneToPicker(element, value) {
    const number = value.trim();
    if (!/^\+\d[\d\s().-]{5,}$/.test(number)) return value;
    const digits = number.replace(/\D/g, '');
    const picker = dialPicker(element);
    if (!picker) return value;
    if (digits.startsWith(picker.code)) return afterCode(number, picker.code) || value;
    // Another country's code: the picker's choice with the number's code, the longest that fits (+420 before +4).
    const codeOf = (text) => String(text).match(/\+\s?(\d{1,4})\b/)?.[1] || '';
    const best = (texts) => texts.filter((text) => codeOf(text) && digits.startsWith(codeOf(text)))
      .sort((a, b) => codeOf(b).length - codeOf(a).length)[0];
    if (picker.node.tagName === 'SELECT') {
      const option = [...picker.node.options].find((entry) => optionText(entry) === best([...picker.node.options].map(optionText)));
      if (!option) return value;
      setNativeValue(picker.node, option.value);
    } else {
      press(picker.node);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const choices = shownChoices().filter((choice) => !choice.contains(element));
      const wanted = best(choices.map(itemText));
      const choice = wanted && choices.find((entry) => itemText(entry) === wanted);
      if (!choice) {
        for (const target of [document.activeElement, picker.node]) target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        return value;
      }
      choice.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const now = dialPicker(element);
    return now && digits.startsWith(now.code) ? afterCode(number, now.code) || value : value;
  }

  /**
   * A rich-text editor takes text as typing gives it: everything in it selected, then the text
   * inserted through the browser's editing, so the editor's own model updates. Its hidden textarea
   * gets the editor's content too. ok when the editor shows the text.
   */
  async function fillEditor(editor, value) {
    const text = String(value ?? '');
    const owner = editor.ownerDocument;
    editor.focus();
    owner.getSelection()?.selectAllChildren(editor);
    if (!owner.execCommand('insertText', false, text)) {
      editor.textContent = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(200);
    const partner = editorPartner(editor);
    if (partner) setNativeValue(partner, editor.innerHTML);
    editor.blur();
    const shown = textOf(editor);
    const start = cleanText(text).slice(0, 40);
    return { ok: Boolean(start) && cleanText(shown).includes(start), value: shown.slice(0, 2000) };
  }

  // A file's name as a site shows it once attached ("Radu_Star_CV.pdf"), not an allowed-types note (".pdf").
  const SHOWN_FILE_NAME = /[\p{L}\p{N}_()-][\p{L}\p{N}_ ()-]*\.(pdf|docx?|rtf|odt|txt)\b/iu;

  /** Whether an upload holds a file: its input has one, or its block shows a file's name. */
  function uploadHolds(id) {
    const element = findField(id);
    if (!element) return false;
    if (element.files?.length) return true;
    const { block } = blockQuestion(element);
    return SHOWN_FILE_NAME.test(textOf(block));
  }

  /**
   * Required uploads left empty (a page that reloaded loses its files): for the Manager, never
   * assumed done. Photo uploads count too; Apply never fills those.
   */
  function emptyRequiredUploads() {
    return scanForm()
      .filter((field) => field.kind === 'file' && !field.drop && field.required && !field.hidden && !field.disabled && !uploadHolds(field.id))
      .map((field) => ({ id: field.id, label: field.label }));
  }

  /** Types a text letter by letter with key events, as a person does, after emptying the box. */
  async function typeLetters(element, text) {
    element.focus();
    setNativeValue(element, '');
    for (let index = 1; index <= text.length; index += 1) {
      const key = text[index - 1];
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
      setNativeValue(element, text.slice(0, index));
      element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }

  /**
   * Drops the file on an upload area as a person dragging it there would, then waits for the site
   * to show it. A Dropzone that ignores the drop gets it through its own hidden file input instead.
   */
  async function dropFile(zone, file) {
    if (!file) return { ok: false, error: 'No file to attach.' };
    const { block } = blockQuestion(zone);
    const inputValues = () => deepQuery(block, 'input:not([type="file"])').map((input) => input.value).join('|');
    const before = textOf(block);
    const valuesBefore = inputValues();
    const shown = () => {
      const text = textOf(block);
      const name = file.filename.replace(/\.[a-z0-9]+$/i, '').slice(0, 12).toLowerCase();
      return text.toLowerCase().includes(name)
        || inputValues() !== valuesBefore
        || (text !== before && /\b(kb|mb|uploaded|100 ?%)\b/i.test(text));
    };
    const waitShown = async () => {
      for (let waited = 0; waited < 10000; waited += 500) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (shown()) return true;
      }
      return false;
    };
    const transfer = new DataTransfer();
    transfer.items.add(base64ToFile(file.base64, file.filename, file.mimeType));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
    if (await waitShown()) return { ok: true, value: file.filename };
    // The zone's own input first (in its box), then a Dropzone's hidden one; never one that does not
    // take this kind of file (a photo upload elsewhere on the page).
    const hiddenInput = [
      ...[zone, block].flatMap((element) => [...(element?.querySelectorAll('input[type="file"]') || [])]),
      ...document.querySelectorAll('input.dz-hidden-input, body > input[type="file"]'),
    ].find((input) => acceptsFile(input, file));
    if (hiddenInput) {
      hiddenInput.files = transfer.files;
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (await waitShown()) return { ok: true, value: file.filename };
    }
    return { ok: false, error: 'The site did not take the dropped file.' };
  }

  async function pickMenuChoice(button, value) {
    const wanted = cleanText(value).toLowerCase();
    // Already showing this choice: left as it is, never opened again.
    if (sameWords(textOf(button), value)) return { ok: true, value: textOf(button) };
    if (['listbox', 'lazy'].includes(button.getAttribute(MENU_ATTRIBUTE))) {
      // The choices appear in a popup (often outside the form) only once the button is pressed.
      if (button.getAttribute('aria-expanded') !== 'true') press(button);
      // Some dropdowns open only on a plain click (Zoho).
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (button.hasAttribute('aria-expanded') && button.getAttribute('aria-expanded') !== 'true') button.click();
      const ownList = () => controlledChoices(button);
      // The popup may word an option differently from the hidden list ("EUR Euro" for "EUREuro").
      const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const target = squash(wanted);
      let option = null;
      for (let waited = 0; waited < 3000 && !option; waited += 250) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const shown = ownList() || shownChoices();
        option = shown.find((element) => squash(itemText(element)) === target)
          || shown.find((element) => squash(itemText(element)) && (target.includes(squash(itemText(element))) || squash(itemText(element)).includes(target)))
          || null;
      }
      if (!option) {
        if (button.getAttribute('aria-expanded') === 'true') button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { ok: false, error: `"${value}" is not an option.` };
      }
      const picked = itemText(option);
      press(option);
      await new Promise((resolve) => setTimeout(resolve, 300));
      // A Selectize input is empty; its box shows the choice.
      const display = button.tagName === 'INPUT' ? textOf(button.closest('[class*="control" i]') || button.parentElement) : textOf(button);
      const shownNow = squash(display);
      return { ok: Boolean(shownNow) && (squash(picked).includes(shownNow) || shownNow.includes(squash(picked))), value: display };
    }
    const items = menuChoices(button) || [];
    const item = items.find((entry) => itemText(entry).toLowerCase() === wanted);
    if (!item) return { ok: false, error: `"${value}" is not an option.` };
    if (button.getAttribute('aria-expanded') !== 'true') button.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    item.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const picked = item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-selected') === 'true'
      || textOf(button).toLowerCase().includes(wanted.slice(0, 20));
    if (button.getAttribute('aria-expanded') === 'true') button.click();
    return { ok: picked, value: itemText(item) };
  }

  /** Empties a text box Apply does not answer, so nothing someone else typed there is sent. */
  function clearField(id) {
    const element = findField(id);
    if (!element || element.readOnly || element.disabled || !element.value) return false;
    setNativeValue(element, '');
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    return !element.value;
  }

  /**
   * This box's suggestion matching what was typed: only from the list the box names, or from
   * suggestions that appeared since typing began (markShownChoices before it). Another field's
   * list left open is never used. Matched by whole words: "Warsaw" finds "Warsaw, Masovian…".
   */
  function pickSuggestion(element, typed) {
    const listId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
    const ownList = listId ? (element.getRootNode().getElementById?.(listId) || null) : null;
    const entries = allElements().filter((entry) => isShown(entry) && !entry.contains(element) && (
      entry.getAttribute('role') === 'option'
      || /(^|\s)(pac-item|dropdown-location|location-result|autocomplete-item|suggestion)/i.test(entry.className || '')
    )).filter((entry) => (ownList ? ownList.contains(entry) : !entry.hasAttribute(SEEN_ATTRIBUTE)));
    const first = typed.split(',')[0].trim();
    return entries.find((entry) => wordsOf(first).trim() && wordsOf(itemText(entry)).startsWith(wordsOf(first)))
      || entries.find((entry) => closeChoice(itemText(entry), typed))
      || null;
  }

  /**
   * The site's complaint about one field right after it was filled: the field marked invalid, or an
   * error message in its question block. '' when the site accepted it.
   */
  function fieldIssue(id) {
    const element = findField(id);
    if (!element) return '';
    const { block } = blockQuestion(element);
    // Inside page components too: a component shows its own field's error in its shadow root.
    const message = deepQuery(block, '[role="alert"], [class*="error" i], [class*="invalid" i]')
      .filter((node) => isShown(node) && !node.contains(element) && textOf(node) && textOf(node).length < 300)
      .map(textOf)[0];
    if (message) return message;
    return element.getAttribute('aria-invalid') === 'true' ? 'The site marks this answer as invalid.' : '';
  }

  // For real clicks (the service worker's debugger input), which some dropdowns require: Greenhouse's
  // React Select and BambooHR's menus ignore simulated events.

  function centreOf(element) {
    // Instant: a page with smooth scrolling would still be moving when the position is measured.
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    // Inside a frame its box is measured from the frame: the frames' own places are added.
    let [left, top] = [box.left, box.top];
    for (let frame = element.ownerDocument?.defaultView?.frameElement; frame; frame = frame.ownerDocument?.defaultView?.frameElement) {
      const outer = frame.getBoundingClientRect();
      left += outer.left + frame.clientLeft;
      top += outer.top + frame.clientTop;
    }
    const x = Math.round(left + box.width / 2);
    const y = Math.round(top + box.height / 2);
    // A real click lands where the screen shows it; off the screen it would hit something else.
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
    return { x, y };
  }

  /**
   * The box drawn around a field's input (React Select's "control"), only when it holds this field
   * alone: a page's "form-control" wrapper around several questions is not it, and clicking its
   * centre would land on another question.
   */
  function ownBox(element) {
    const box = element.closest('[class*="control" i]');
    return box && box !== element && holdsOnly(box, element) ? box : null;
  }

  /** Whether a box holds no field but this one (helper inputs a page hides do not count). */
  function holdsOnly(box, element) {
    return ![...box.querySelectorAll('input, textarea, select, [role="combobox"]')]
      .some((other) => other !== element && other.type !== 'hidden' && !other.closest('[aria-hidden="true"]'));
  }

  /** Where to click to open a field: its centre on screen after scrolling it into view. */
  function boxOf(id) {
    const element = findField(id);
    if (!element) return null;
    // React Select's input is a sliver inside its box; the box is what a person clicks.
    const target = isTypedList(element)
      ? ownBox(element) || element
      : element;
    return centreOf(target);
  }

  /** The element that has the cursor, inside shadow roots too. */
  function focusedElement() {
    let active = document.activeElement;
    // Into page components and frames from the same site.
    for (;;) {
      if (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      else if (active?.tagName === 'IFRAME' && frameDocument(active)?.activeElement) active = frameDocument(active).activeElement;
      else return active;
    }
  }

  /**
   * Whether the cursor is in this field (or what it typed into belongs to it), putting it there when a
   * click did not. Real key presses go wherever the cursor is, so nothing is typed until this is true.
   */
  function cursorInField(id) {
    const element = findField(id);
    if (!element) return false;
    const inField = () => {
      const active = focusedElement();
      return Boolean(active) && (active === element || element.contains(active) || Boolean(ownBox(element)?.contains(active)));
    };
    if (!inField()) element.focus?.();
    return inField();
  }

  /** The choices an open list shows, by role or by the class names list libraries use. */
  function shownChoices() {
    return allElements().filter((element) => isShown(element) && textOf(element) && (
      POPUP_ITEM.test(element.getAttribute('role') || '')
      || (element.tagName === 'LI' && element.closest('[role="listbox"], [role="menu"]'))
      || /(^|[\s_-])(option|menu-?item|dropdown-?item|select-?item)([\s_-]|$)|(^|\s)(pac-item|dropdown-location|location-result|autocomplete-item|suggestion)/i.test(String(element.className || ''))
    )).filter((element, index, all) => !all.some((other, otherIndex) => otherIndex !== index && element.contains(other) && textOf(other) === textOf(element)));
  }

  /** Marks the choices showing before a list is opened, so only the list's own are used after. */
  function markShownChoices() {
    // Marks from an earlier look are cleared: a list hidden then shown again counts as new.
    for (const element of allElements()) if (element.hasAttribute(SEEN_ATTRIBUTE)) element.removeAttribute(SEEN_ATTRIBUTE);
    for (const element of shownChoices()) element.setAttribute(SEEN_ATTRIBUTE, '1');
    return true;
  }

  /**
   * The opened list's choices: inside the list the field names (React Select's own listbox) when it
   * has one, else those that appeared since markShownChoices, else any popup items.
   */
  function openedChoices(id) {
    const input = id ? findField(id) : null;
    const ownList = input?.tagName === 'INPUT' ? listFor(input, shownListboxes()) : null;
    const choices = shownChoices();
    if (ownList) {
      const inside = choices.filter((element) => ownList.contains(element));
      if (inside.length) return inside;
    }
    const fresh = choices.filter((element) => !element.hasAttribute(SEEN_ATTRIBUTE));
    return fresh.length ? fresh : choices.filter((element) => POPUP_ITEM.test(element.getAttribute('role') || ''));
  }

  function shownChoiceTexts(id) {
    // A search list's prompts ("Type to search", "No options") are not choices.
    return [...new Set(openedChoices(id).map(itemText).filter(Boolean))]
      .filter((text) => !/^(no options|no results|no matches|nothing found|no items|type to search|start typing|loading\.*|search\.*)$/i.test(text) && !/^type .* to search/i.test(text))
      .slice(0, 300);
  }

  /** A text's words, spaced, so "UK" is found in "UK (United Kingdom)" but never in "Ukraine". */
  const wordsOf = (text) => ` ${String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  /** The same words, case and punctuation aside ("Romania" and "romania "); never two empty texts. */
  const sameWords = (one, other) => wordsOf(one).trim() !== '' && wordsOf(one) === wordsOf(other);

  /**
   * Whether a choice holds the answer's whole words: "Poland" in "Poland +48", "Associate" in
   * "Associate's degree", and "Warsaw, Poland" in "Warsaw, Masovian Voivodeship, Poland" (each part).
   */
  function closeChoice(choice, answer) {
    const words = wordsOf(choice);
    const has = (part) => wordsOf(part).trim() && words.includes(wordsOf(part));
    const parts = String(answer).split(',').filter((part) => part.trim());
    return has(answer) || (parts.length > 1 && parts.every(has));
  }

  /**
   * The opened list's choice matching an answer, with where to click it. exact: only the same
   * choice (case and punctuation aside), for a whole list that nothing typed has narrowed.
   */
  function choiceBox(value, id, exact = false) {
    const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, '');
    const target = squash(value);
    const choices = openedChoices(id);
    if (exact) {
      const same = choices.find((element) => squash(itemText(element)) === target);
      const centre = same && centreOf(same);
      return centre ? { ...centre, text: itemText(same) } : null;
    }
    const choice = choices.find((element) => squash(itemText(element)) === target)
      || choices.find((element) => closeChoice(itemText(element), value))
      // "Warsaw" (the part typed) in Lever's "Warsaw, Warszawa, Mazowieckie, POL".
      || choices.find((element) => closeChoice(itemText(element), String(value).split(',')[0]));
    if (!choice) return null;
    const centre = centreOf(choice);
    return centre ? { ...centre, text: itemText(choice) } : null;
  }

  /**
   * Where to click one option of a radio or tick-box group (its label, or a styled role="radio"),
   * and whether it is now checked. For a real click when the site ignores simulated ones.
   */
  function optionOf(id, value) {
    const element = findField(id);
    if (!element) return null;
    const wanted = cleanText(value).toLowerCase();
    if (element.hasAttribute(RADIO_GROUP_ATTRIBUTE)) {
      return groupItems(element).find((entry) => itemText(entry).toLowerCase() === wanted) || null;
    }
    const control = element.name ? controlsOfGroup(element).find((entry) => choiceText(entry).toLowerCase() === wanted) : null;
    if (!control) return null;
    // The label is what a person clicks; a styled radio hides the input itself.
    return control.closest('label') || (control.id && control.getRootNode().querySelector?.(`label[for="${CSS.escape(control.id)}"]`)) || control;
  }

  function optionBox(id, value) {
    const option = optionOf(id, value);
    return option ? centreOf(option) : null;
  }

  function optionChecked(id, value) {
    const element = findField(id);
    if (!element) return false;
    if (element.hasAttribute(RADIO_GROUP_ATTRIBUTE)) {
      const option = optionOf(id, value);
      return Boolean(option && isChosen(option));
    }
    const wanted = cleanText(value).toLowerCase();
    return controlsOfGroup(element).some((entry) => entry.checked && choiceText(entry).toLowerCase() === wanted);
  }

  const PLACEHOLDER = new RegExp(String.raw`^(|-+|–|—|-+\s*none\s*-+|–?\s*select\s*–?|(${PLACEHOLDER_WORDS}).*)$`, 'i');

  /** Whether a scanned field still has no answer, whatever kind it is. */
  function isUnanswered(field) {
    const element = findField(field.id);
    if (!element) return false;
    if (element.hasAttribute(RADIO_GROUP_ATTRIBUTE)) return !groupItems(element).some(isChosen);
    if (field.kind === 'radio' || field.kind === 'checkbox-group') return !controlsOfGroup(element).some((control) => control.checked);
    if (field.kind === 'checkbox') return element.tagName === 'INPUT' ? !element.checked : element.getAttribute('aria-checked') !== 'true';
    if (isEditorHost(element)) return !textOf(element);
    if (field.kind === 'select') return !element.value || PLACEHOLDER.test(optionText(element.selectedOptions?.[0] || {}));
    if (field.kind === 'menu' || field.kind === 'combobox') {
      const shown = shownValue(field.id).replace(/[×✕]/g, '').trim();
      return PLACEHOLDER.test(shown);
    }
    return !String(element.value || '').trim() || onlyDialCode(element, field.label);
  }

  /**
   * Required questions on the page that still have no answer, whatever kind they are: the check
   * that an application is complete before Submit. Uploads are left to the site's own check.
   */
  function emptyRequired() {
    return scanForm()
      .filter((field) => field.required && !field.hidden && !field.disabled && field.kind !== 'file' && isUnanswered(field))
      .map((field) => ({ id: field.id, label: field.label }));
  }

  // ---- The safety net: required questions read the way a person reads them ----

  // A question shown as required: "Name *", "Email (required)", or a heading styled required (Ashby).
  const REQUIRED_MARK = /[*✱]\s*$|\(required\)\s*$/i;
  // "* indicates a required field" is a note, not a question.
  const REQUIRED_NOTE = /indicates? (a )?required|required fields?|fields? (marked|with)|are (required|mandatory)|mandatory fields?/i;
  const INTERACTIVE = 'input:not([type="hidden"]), textarea, select, button, [role="radio"], [role="checkbox"], '
    + '[role="combobox"], [role="listbox"], [role="switch"], [contenteditable="true"]';
  const QTS_UI = ['data-qts-apply-review', 'data-qts-page-launcher', 'data-qts-page-toast', 'data-qts-get-jd-ui'];
  const UPLOAD_QUESTION = /resume|résumé|\bcv\b|cover letter|upload|attach|\bfiles?\b|\bdocuments?\b/i;

  /** QTS's own panels on the page (in their own shadow roots) are not the form. */
  function insideQtsUi(element) {
    for (let node = element; node; node = node.parentNode || node.host) {
      if (node.nodeType === 1 && (node.id === 'qts-generation-steps' || QTS_UI.some((name) => node.hasAttribute(name)))) return true;
    }
    return false;
  }

  function requiredHeadingText(element) {
    if (!['LABEL', 'LEGEND', 'SPAN', 'DIV', 'P', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) return '';
    const text = textOf(element);
    if (!text || text.length > 300 || REQUIRED_NOTE.test(text)) return '';
    const styledRequired = ['LABEL', 'LEGEND'].includes(element.tagName) && /required/i.test(String(element.className));
    if (!REQUIRED_MARK.test(text) && !styledRequired) return '';
    // A question has words besides its mark.
    const question = cleanText(text.replace(/[*✱]/g, ' ').replace(/\(required\)/ig, ' '));
    return /\p{L}{2}/u.test(question) ? question : '';
  }

  // Page components that are controls (<spl-button>, <x-input>…): their real control is in a shadow root.
  const CONTROL_COMPONENT = /-(button|input|select|checkbox|radio|textarea|dropdown|combobox|autocomplete|upload)$/i;
  const isControl = (element) => element.matches(INTERACTIVE) || CONTROL_COMPONENT.test(element.tagName);

  /** The question's own block: the heading itself around its control, else the nearest parent holding one. */
  function questionBlock(heading) {
    if ([...heading.querySelectorAll('*')].some(isControl)) return heading;
    for (let node = heading.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
      if ([...node.querySelectorAll('*')].some((control) => isControl(control) && !heading.contains(control))) return node;
    }
    return null;
  }

  /**
   * Whether a block shows more than its question and buttons: entries a section already lists
   * ("Experience" with jobs added), which count as answered.
   */
  function blockHasContent(block, question) {
    let rest = textOf(block);
    for (const element of block.querySelectorAll('*')) {
      if (isControl(element)) rest = rest.replace(textOf(element), ' ');
    }
    rest = cleanText(rest.replace(question, ' ').replace(/[*✱+]/g, ' '));
    return rest.length > 30;
  }

  /**
   * The safety net behind the scanner: every question the page shows as required whose block holds
   * no field Apply recognised ("unread"), or only recognised fields that are still empty and were
   * not known to be required ("empty"). Nothing is filled from here; the Manager is asked to check.
   */
  function unreadRequired() {
    const fields = new Map(scanForm().filter((field) => !field.disabled).map((field) => [field.id, field]));
    const found = [];
    const blocks = new Set();
    for (const heading of allElements()) {
      if (!isShown(heading) || insideQtsUi(heading)) continue;
      const question = requiredHeadingText(heading);
      // The innermost element saying it: a wrapper around the same question is skipped.
      if (!question || [...heading.children].some((child) => isShown(child) && requiredHeadingText(child))) continue;
      const block = questionBlock(heading);
      if (!block || blocks.has(block)) continue;
      blocks.add(block);
      // Uploads have their own check (a failed upload is marked for the Manager): a block with a
      // file input or a drop box, or a question asking for a document, is left to it. Sites swap
      // the input for the file's name once uploaded (Greenhouse).
      if (deepQuery(block, `input[type="file"], [${DROP_ATTRIBUTE}]`).length || UPLOAD_QUESTION.test(question)) continue;
      // Inside page components too: SmartRecruiters keeps its phone input in a shadow root.
      const marked = [block, ...deepQuery(block, `[${FIELD_ATTRIBUTE}]`)];
      // A field the page hid once answered (a picked dropdown, an uploaded file) still counts; a
      // hidden one with no answer (a box behind buttons Apply did not read) does not.
      const known = marked.map((element) => fields.get(element.getAttribute(FIELD_ATTRIBUTE)))
        .filter((field) => field && (!field.hidden || !isUnanswered(field)));
      if (!known.length) {
        // Entries a section lists may sit next to its heading's box: the section counts when it
        // holds no other question.
        const section = block.parentElement;
        const ownSection = section && !deepQuery(section, `[${FIELD_ATTRIBUTE}]`).length
          && ![...section.querySelectorAll('label, legend, h2, h3, h4, h5, h6')].some((element) => !block.contains(element) && requiredHeadingText(element));
        if (blockHasContent(block, question) || (ownSection && blockHasContent(section, question))) continue;
        found.push({ id: fieldId(heading), label: question.slice(0, 200), kind: 'unread' });
      } else if (!known.some((field) => field.required || field.kind === 'file') && known.every(isUnanswered)) {
        // A field required only on screen (emptyRequired covers the ones known to be required).
        found.push({ id: known[0].id, label: question.slice(0, 200), kind: 'empty' });
      }
    }
    return found.slice(0, 10);
  }

  /**
   * Whether a picked choice shows in its question: in the field's own box, or as a chip ("Model
   * explainability ✕") that a list taking several choices adds beside it. Never an open list's option.
   */
  function choiceShown(id, text) {
    const element = findField(id);
    const squash = (value) => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const wanted = squash(text);
    if (!element || !wanted) return false;
    if (squash(shownValue(id)).includes(wanted)) return true;
    const { block } = blockQuestion(element.getRootNode()?.host || element);
    return deepQuery(block, '*').some((node) => isShown(node) && squash(itemText(node)) === wanted
      && !node.closest('[role="listbox"], [role="option"], [role="menu"], [role="menuitem"]'));
  }

  /** What a field shows now: a button's text, or an input's value with the text of its box. */
  function shownValue(id) {
    const element = findField(id);
    if (!element) return '';
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return textOf(element);
    // React Select shows the choice in its control box, not in the input's own small container.
    // Only a box around this field alone: a wrapper of several questions holds their answers too.
    const container = element.closest('[class*="container" i]');
    const box = ownBox(element) || (container && holdsOnly(container, element) ? container : null) || element.parentElement;
    // The box's own words only: never the question's label, nor a list of choices open in it
    // (which would make every choice look chosen).
    let text = textOf(box);
    const notValue = deepQuery(box, 'label, legend, [role="listbox"], [role="menu"], [role="option"]').filter((node) => !node.contains(element));
    if (element.id) notValue.push(element.getRootNode().querySelector?.(`label[for="${CSS.escape(element.id)}"]`));
    for (const node of notValue) {
      const words = textOf(node);
      if (words) text = text.split(words).join(' ');
    }
    return cleanText(`${element.value || ''} ${text}`);
  }

  /** Field error messages shown on the page (after filling, before Submit). */
  function fieldErrors() {
    const errors = [];
    for (const element of allElements()) {
      if (!isShown(element)) continue;
      if (element.getAttribute('aria-invalid') === 'true') {
        errors.push(`${labelFor(element) || 'A field'} is marked invalid`);
      } else if (element.getAttribute('role') === 'alert' || /(^|\s|-)error(-message)?($|\s|-)/i.test(element.className || '')) {
        const text = textOf(element);
        if (text && text.length < 300) errors.push(text);
      }
    }
    return [...new Set(errors)].slice(0, 10);
  }

  /** What stops an automatic application: a CAPTCHA to solve, or a login or account wall. */
  function detectBlockers() {
    const blockers = [];
    // Only a challenge the person must answer counts: invisible reCAPTCHA or hCaptcha that runs on
    // its own (a badge, an empty container) does not stop the application.
    const challenge = allElements().find((element) => element.tagName === 'IFRAME' && isShown(element) && (
      (/recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com\/.*(challenge|frame=challenge)|challenges\.cloudflare\.com/i.test(element.src || '')
        && element.getBoundingClientRect().height > 100)
      || (/recaptcha\/(api2|enterprise)\/anchor|hcaptcha\.com\/.*frame=checkbox|challenges\.cloudflare\.com/i.test(element.src || '')
        && element.getBoundingClientRect().height > 40 && !/size=invisible/i.test(element.src || ''))
      // DataDome's "verify you are human" (SmartRecruiters and others).
      || (/captcha-delivery\.com/i.test(element.src || '') && element.getBoundingClientRect().height > 40)
    ));
    // An image of letters to type ("Type below image text", Zoho), the old kind of CAPTCHA.
    const imageCode = allElements().some((element) => element.tagName === 'INPUT' && isShown(element)
      && IMAGE_CAPTCHA.test(labelFor(element)));
    // Cloudflare's "Just a moment..." page checks the browser before showing the site.
    if (challenge || imageCode || /^just a moment/i.test(document.title)) blockers.push('captcha');
    const password = allElements().find((element) => element.tagName === 'INPUT' && element.type === 'password' && isShown(element));
    // A sign-in page without a password field yet (an email-first or magic-link login).
    const signInPage = /\/(auth\/)?(sign-?in|log-?in|register|sign-?up|create-account)(\/|$)/i.test(location.pathname);
    if (password || signInPage) blockers.push('login');
    return blockers;
  }

  function buttonText(element) {
    const own = cleanText(element.innerText || element.value || element.getAttribute('aria-label') || '');
    if (own) return own;
    // A button inside a page component (<spl-button>Next</spl-button>) shows the component's own
    // words through a slot: read them there, or from the component when it is just that button.
    const slotted = cleanText([...(element.querySelectorAll?.('slot') || [])]
      .flatMap((slot) => slot.assignedNodes({ flatten: true })).map((node) => node.textContent || '').join(' '));
    if (slotted) return slotted;
    const host = element.getRootNode?.()?.host;
    const hostText = host ? cleanText(host.innerText || host.getAttribute?.('aria-label') || '') : '';
    return hostText.length <= 40 ? hostText : '';
  }

  function findButton(kind) {
    const pattern = kind === 'submit' ? SUBMIT_TEXT : NEXT_TEXT;
    const candidates = allElements().filter((element) => (
      (element.tagName === 'BUTTON' || (element.tagName === 'INPUT' && ['submit', 'button'].includes(element.type))
        || element.getAttribute('role') === 'button')
      && isShown(element) && !element.disabled && pattern.test(buttonText(element))
    ));
    if (candidates.length === 1) return candidates[0];
    // A page can show "Apply Now" at the top and "Submit application" under the form: the one that
    // says submit, then the one inside the form with the fields, wins. Otherwise refuse, not guess.
    if (kind === 'submit') {
      const submits = candidates.filter((element) => /submit/i.test(buttonText(element)));
      if (submits.length === 1) return submits[0];
      const inForm = (submits.length ? submits : candidates)
        .filter((element) => element.closest('form')?.querySelector(`[${FIELD_ATTRIBUTE}]`));
      if (inForm.length === 1) return inForm[0];
    }
    return null;
  }

  function buttons() {
    // A Submit that stays disabled usually means a requirement question was not met.
    const submitDisabled = allElements().some((element) => (
      (element.tagName === 'BUTTON' || (element.tagName === 'INPUT' && element.type === 'submit'))
      && isShown(element) && (element.disabled || element.getAttribute('aria-disabled') === 'true')
      && SUBMIT_TEXT.test(buttonText(element))
    ));
    return { submit: Boolean(findButton('submit')), next: Boolean(findButton('next')), submitDisabled };
  }

  /** The words saying the job takes no more applications ("This job has expired"), or ''. */
  function jobClosed() {
    const text = cleanText(document.body?.innerText || '');
    return text.match(/this (job|position|vacancy|role) (has )?(expired|closed|been filled)|(job|position|vacancy|posting) (is )?no longer (available|open|active|accepting applications)|no longer (available for application|accepting applications)|(applications|vacancy) (are |is )?(now )?closed|not accepting applications/i)?.[0] || '';
  }

  /** Closes a cookie banner the way a person would, declining what is optional; true when clicked. */
  function declineCookies() {
    const button = allElements().find((element) => clickable(element)
      && /^(decline|reject|refuse)( all)?( non-?necessary| optional| additional)?( cookies)?$|^(use |allow )?(only )?(necessary|essential|required)( cookies)?( only)?$/i.test(startText(element)));
    if (!button) return false;
    button.click();
    return true;
  }

  function clickable(element) {
    return (element.tagName === 'A' || element.tagName === 'BUTTON' || element.getAttribute('role') === 'button'
      || (element.tagName === 'INPUT' && ['submit', 'button'].includes(element.type)))
      && isShown(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
  }

  function startText(element) {
    return buttonText(element).replace(/[→›»↗➔>]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * On a job page without a form: clicks what starts the application ("Apply for this job"; on a
   * second screen "Apply manually"), skipping buttons already tried. Without one, a form embedded
   * in a frame is reported so the tab can open it. { ok, text } | { ok, frameUrl } | { email } | { ok: false }.
   */
  function clickStart(alreadyClicked = []) {
    const tried = new Set(alreadyClicked);
    const candidates = allElements().filter((element) => clickable(element) && !tried.has(startText(element)));
    const manual = candidates.find((element) => MANUAL_TEXT.test(startText(element)) && !/linkedin|indeed/i.test(startText(element)));
    const starts = candidates
      .filter((element) => START_TEXT.test(startText(element)) && !NOT_START.test(startText(element)))
      .sort((a, b) => {
        const area = (element) => element.getBoundingClientRect().width * element.getBoundingClientRect().height;
        return area(b) - area(a);
      });
    const button = manual || starts.find((element) => !/^mailto:/i.test(element.getAttribute('href') || '')) || null;
    if (button) {
      button.scrollIntoView({ block: 'center' });
      button.click();
      // A link's own address, for when the page catches the click instead (an aggregator's sign-up box).
      const away = (element) => element?.tagName === 'A' && /^https?:/i.test(element.href || '')
        && element.href.split('#')[0] !== location.href.split('#')[0];
      const href = [button, button.closest('a[href]'), ...starts].find(away)?.href || null;
      return { ok: true, text: startText(button), ...(href ? { href } : {}) };
    }
    if (starts.length) return { ok: false, email: true };
    const frame = allElements().find((element) => element.tagName === 'IFRAME' && isShown(element)
      && /^https?:/i.test(element.src || '') && FORM_FRAME.test(element.src));
    return frame ? { ok: true, frameUrl: frame.src } : { ok: false };
  }

  function clickButton(kind) {
    const button = findButton(kind);
    if (!button) return { ok: false, error: `No single ${kind} button was found.` };
    button.scrollIntoView({ block: 'center' });
    button.click();
    return { ok: true, text: buttonText(button) };
  }

  /** After Submit: did the page confirm the application, show an error, or neither (yet)? */
  function pageOutcome() {
    const text = cleanText(document.body?.innerText || '');
    if (CONFIRMED_TEXT.test(text) || /\/(confirmation|thank-?you|thanks|applied|success)(\/|$|\?)/i.test(location.pathname)) {
      return { result: 'confirmed', evidence: (text.match(CONFIRMED_TEXT)?.[0] || location.pathname).slice(0, 200) };
    }
    const errors = fieldErrors();
    if (errors.length) return { result: 'error', evidence: errors.join(' · ').slice(0, 500) };
    return { result: 'unclear', evidence: text.slice(0, 300) };
  }

  // ---- Apply as the Manager's assistant: which boxes belong to the application ----

  // Forms that are not the application: a site search, a newsletter, job alerts.
  const UNRELATED_FORM = /\b(news ?letters?|subscri(be|ption)|job ?alerts?|get (job )?notified|notify me|mailing list|talent (community|network|pool)|stay (in touch|updated)|search)\b/i;
  const PAGE_FRAME = 'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"]';

  /** The <form> a control sits in, out of page components too; null outside any form. */
  function formOf(control) {
    for (let node = control; node; node = node.parentElement || node.getRootNode?.()?.host || null) {
      if (node.tagName === 'FORM') return node;
    }
    return null;
  }

  /**
   * A box that is not the application's: in a search (role="search"), in a newsletter, job-alert or
   * search form (its name, or the words of a small form), or in a small form in the page's header
   * or footer. The candidate's facts are never typed there.
   */
  function unrelatedBox(control) {
    for (let node = control; node; node = node.parentElement || node.getRootNode?.()?.host || null) {
      if (node.tagName === 'SEARCH' || node.getAttribute?.('role') === 'search') return true;
    }
    const form = formOf(control);
    if (!form) return Boolean(control.closest(PAGE_FRAME));
    const named = `${form.id} ${typeof form.className === 'string' ? form.className : ''} ${form.getAttribute('name') || ''} ${form.getAttribute('action') || ''} ${form.getAttribute('aria-label') || ''}`;
    if (UNRELATED_FORM.test(named.replace(/[-_/.?=&]+/g, ' '))) return true;
    const boxes = [...form.querySelectorAll('input, select, textarea')]
      .filter((element) => !['hidden', 'submit', 'button', 'image', 'reset'].includes((element.type || '').toLowerCase()) && isShown(element)).length;
    if (boxes > 2) return false;
    return UNRELATED_FORM.test(cleanText(form.innerText || '').slice(0, 300)) || Boolean(form.closest(PAGE_FRAME));
  }

  /**
   * A box of a sign-in or create-account form (one with a password box; on a page without forms, a
   * page showing one): the Manager types those, with the password copied from the panel.
   */
  function accountBox(control) {
    const form = formOf(control);
    const scope = form || document;
    return [...scope.querySelectorAll('input[type="password"]')].some((box) => isShown(box) && box.autocomplete !== 'one-time-code');
  }

  /**
   * scanForm for the assistant: each question that is not the application's is marked unrelated
   * (search, newsletter, job alerts), and each of a sign-in or create-account form marked account.
   */
  function scanForAssist() {
    const fields = scanForm();
    const elements = new Map(allElements().filter((element) => element.hasAttribute(FIELD_ATTRIBUTE))
      .map((element) => [element.getAttribute(FIELD_ATTRIBUTE), element]));
    return fields.map((field) => {
      const element = elements.get(field.id);
      if (!element) return field;
      if (unrelatedBox(element)) return { ...field, unrelated: true };
      return accountBox(element) ? { ...field, account: true } : field;
    });
  }

  global.__qtsApplyForm = {
    scanForm,
    scanForAssist,
    readComboboxOptions,
    discoverComboboxChoices,
    currentChoices,
    formSchema,
    checkFormSchema,
    classifyPage,
    formActions,
    uploadHolds,
    emptyRequiredUploads,
    unreadableFrames,
    searchComboboxChoices,
    fieldStateOf,
    restoreFieldState,
    searchComboboxOptions,
    readMenuOptions,
    fillField,
    clearField,
    fieldIssue,
    boxOf,
    cursorInField,
    markShownChoices,
    shownChoiceTexts,
    choiceBox,
    shownValue,
    choiceShown,
    optionBox,
    optionChecked,
    emptyRequired,
    isUnanswered,
    unreadRequired,
    fieldErrors,
    detectBlockers,
    buttons,
    clickButton,
    clickStart,
    declineCookies,
    jobClosed,
    pageOutcome,
    pageText: () => cleanText(document.body?.innerText || '').slice(0, 20000),
    currentAnswers,
    focusField,
    markProblemFields,
    isSubmitControl,
    enterManually,
  };

  /**
   * What every visible question shows now, for the record of what was submitted (the Manager's
   * edits included): [{ id, label, value }]. Uploads are left out; tick boxes read Ticked/Not ticked.
   */
  /** What a field holds now, as a person reads it: the choice, the text, Ticked, a file's name. */
  function valueOf(field, element = findField(field.id)) {
    if (!element) return '';
    let value = '';
    if (element.hasAttribute(RADIO_GROUP_ATTRIBUTE)) {
      value = textOf(groupItems(element).find(isChosen) || {});
    } else if (field.kind === 'radio' || field.kind === 'checkbox-group') {
      value = controlsOfGroup(element).filter((control) => control.checked)
        .map((control) => labelFor(control) || control.value).filter(Boolean).join(' | ');
    } else if (field.kind === 'checkbox') {
      const ticked = element.tagName === 'INPUT' ? element.checked : element.getAttribute('aria-checked') === 'true';
      value = ticked ? 'Ticked' : 'Not ticked';
    } else if (field.kind === 'select') {
      value = element.multiple ? [...element.selectedOptions].map(optionText).join(' | ')
        : element.value ? optionText(element.selectedOptions?.[0] || {}) : '';
    } else if (field.kind === 'menu' || field.kind === 'combobox') {
      value = shownValue(field.id).replace(/[×✕]/g, '').trim();
    } else if (field.kind === 'file') {
      value = element.files?.[0]?.name || '';
    } else {
      value = isEditorHost(element) ? textOf(element) : String(element.value || '');
    }
    return cleanText(value).slice(0, 2000);
  }

  function currentAnswers() {
    return scanForm()
      .filter((field) => !field.hidden && field.kind !== 'file')
      .map((field) => {
        const element = findField(field.id);
        return element ? { id: field.id, label: field.label, value: valueOf(field, element) } : null;
      })
      .filter(Boolean);
  }

  // ---- The structured form: one record per question, what the page offers, what it is ----
  // A projection of scanForm's field records (the single source the runner fills from), as data
  // that can be checked, logged, and compared between steps. Locators stay in the page: each
  // field's id is its data-qts-apply-field mark.

  const FORM_SCHEMA_VERSION = '1.0';
  const CHOICE_FIELD_KINDS = ['select', 'menu', 'combobox', 'radio', 'checkbox-group'];

  /** What the page element is: input, select, textarea, button group, editable box... */
  function elementTypeOf(field, element) {
    if (!element) return field.kind;
    if (field.drop) return 'drop_area';
    if (isEditorHost(element)) return 'contenteditable';
    if (element.hasAttribute(RADIO_GROUP_ATTRIBUTE)) return 'button_group';
    if (element.hasAttribute(MENU_ATTRIBUTE)) return element.tagName === 'INPUT' ? 'input' : 'button';
    return element.tagName.toLowerCase();
  }

  /** How the control expects to be answered: typed, picked from a list, ticked, uploaded... */
  function inputTypeOf(field) {
    if (field.richEditor) return 'rich_text';
    if (field.drop) return 'drop_area';
    if (field.kind === 'file') return 'file_upload';
    if (field.kind === 'combobox') return field.multiple ? 'multi_select' : 'searchable_select';
    if (field.kind === 'select' || field.kind === 'menu') return field.multiple ? 'multi_select' : 'single_select';
    if (field.kind === 'radio') return 'radio_group';
    if (field.kind === 'checkbox-group') return 'checkbox_group';
    if (field.kind === 'checkbox') return 'checkbox';
    if (field.kind === 'textarea') return 'long_text';
    if (field.kind === 'date' || (field.readOnlyPicker && DATE_FORMAT.test(cleanText(field.placeholder)))) return 'date_picker';
    if (field.kind === 'tel') return 'phone';
    return field.kind === 'text' ? 'text' : field.kind;
  }

  /** The shape the answer must have: a string, a number, yes/no, a date, one choice, several, a file. */
  function valueTypeOf(field, element) {
    if (field.kind === 'file') return 'file';
    if (field.kind === 'checkbox') return 'boolean';
    if (field.multiple || field.kind === 'checkbox-group') return 'array';
    if (CHOICE_FIELD_KINDS.includes(field.kind)) return 'enum';
    if (field.kind === 'number' || field.kind === 'range') {
      const step = element?.getAttribute?.('step');
      return !step || /^\d+$/.test(step) ? 'integer' : 'decimal';
    }
    if (field.kind === 'date' || inputTypeOf(field) === 'date_picker') return 'date';
    if (['time', 'datetime-local'].includes((element?.getAttribute?.('type') || '').toLowerCase())) return 'time';
    return 'string';
  }

  /**
   * How much of a field's list is known: complete, partial, unknown, waiting for another answer
   * (pending_dependency: "Select a country first", or disabled until then), or not applicable.
   */
  function optionsStatus(field) {
    // A text box with suggestions (a datalist) takes other answers too: its list is partial.
    if (!CHOICE_FIELD_KINDS.includes(field.kind)) return field.options?.length ? 'partial' : 'not_applicable';
    const element = findField(field.id);
    const waits = /\b(select|choose|pick)\b.{0,30}\bfirst\b/i;
    if ((field.disabled && !field.options?.length) || (element?.tagName === 'SELECT' && [...element.options].some((option) => waits.test(optionText(option))))) {
      return 'pending_dependency';
    }
    if (!field.options?.length) return 'unknown';
    return field.optionsPartial ? 'partial' : 'complete';
  }

  /** Where a field's choices came from: the page as it was, a click, sample searches, or none yet. */
  function discoveryMethodOf(field) {
    if (!CHOICE_FIELD_KINDS.includes(field.kind) && !field.options?.length) return null;
    if (field.optionsSource) return field.optionsSource;
    return field.options?.length ? 'dom' : null;
  }

  /** How sure the question text is: from the page's label (high), only a placeholder (low), or none (unresolved). */
  function labelConfidence(field) {
    if (field.labelUnresolved || !hasWords(field.label)) return 'unresolved';
    return field.labelConfidence || 'high';
  }

  /**
   * A list's choices as the page holds them, with what can be seen of each: the shown words, the
   * value it sends, disabled, selected, its group. Nothing is opened to read them.
   */
  function optionDetails(field, element) {
    if (!element) return [];
    if (element.tagName === 'SELECT') {
      return [...element.options].filter((option) => answerable(optionText(option)) && option.value !== '').slice(0, 300).map((option) => ({
        label: optionText(option),
        value: option.value,
        disabled: option.disabled,
        selected: option.selected,
        ...(option.parentElement?.tagName === 'OPTGROUP' ? { group: cleanText(option.parentElement.label) } : {}),
      }));
    }
    const listId = element.getAttribute?.('aria-controls') || element.getAttribute?.('aria-owns');
    const list = listId ? (element.getRootNode().getElementById?.(listId) || null) : null;
    const items = list ? deepQuery(list, '[role="option"]') : [];
    if (items.length) {
      return items.filter((item) => answerable(itemText(item))).slice(0, 300).map((item) => ({
        label: itemText(item),
        ...(item.getAttribute('data-value') || item.getAttribute('value') ? { value: item.getAttribute('data-value') || item.getAttribute('value') } : {}),
        disabled: item.getAttribute('aria-disabled') === 'true',
        selected: item.getAttribute('aria-selected') === 'true',
        ...(item.id ? { optionId: item.id } : {}),
      }));
    }
    return (field.options || []).map((label) => ({ label }));
  }

  // Headings that name a part of a form ("Personal information", "Experience").
  const SECTION_HEADINGS = 'h1, h2, h3, h4, legend, [role="heading"]';

  /** The form's sections: its headings in page order, each with an id. */
  function formSections() {
    return allElements()
      .filter((element) => element.matches(SECTION_HEADINGS) && isShown(element) && hasWords(textOf(element)) && textOf(element).length <= 120 && !insideQtsUi(element))
      .map((element, index) => ({ id: `section_${index + 1}`, title: textOf(element), element }));
  }

  /** The section a field sits in: the last heading before it on the page. */
  function sectionOf(element, sections) {
    let found = null;
    for (const section of sections) {
      if (section.element.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) found = section;
      else break;
    }
    return found?.id || null;
  }

  // The job sites a page is on, by its address (for diagnostics and the schema; no behaviour depends on it).
  const PLATFORMS = [
    ['greenhouse', /greenhouse\.io/], ['lever', /lever\.co/], ['ashby', /ashbyhq\.com/], ['workable', /workable\.com/],
    ['smartrecruiters', /smartrecruiters\.com/], ['bamboohr', /bamboohr\.com/], ['zoho_recruit', /zohorecruit/], ['peopleforce', /peopleforce\.io/],
    ['softgarden', /softgarden\.io/], ['teamtailor', /teamtailor\.com/], ['recruitee', /recruitee\.com/], ['personio', /personio\.(de|com)/],
    ['workday', /myworkday(jobs|site)\.com/], ['talentlyft', /talentlyft\.com/], ['jobvite', /jobvite\.com/], ['breezy', /breezy\.hr/],
  ];

  /**
   * The page's own actions a person could take, each with what it is and whether Apply may take it:
   * Next/Continue (a navigation candidate, its effect unverified), Submit (final, the Manager's), a
   * start button, sign-in or account creation (never Apply's), back.
   */
  function formActions() {
    const kinds = [
      ['submit', SUBMIT_TEXT, 'final_submit'],
      ['next', NEXT_TEXT, 'unverified'],
      ['start', START_TEXT, 'start_application'],
      ['sign_in', /^(sign ?in|log ?in|create (an )?account|register|sign ?up|continue with (google|linkedin|apple|microsoft|facebook))\b/i, 'never_automatic'],
      ['back', /^(back|previous|zurück|wstecz|retour|atrás|anterior)$/i, 'navigation'],
    ];
    const seen = new Set();
    let count = 0;
    return allElements()
      .filter((element) => (element.tagName === 'BUTTON' || element.tagName === 'A' || (element.tagName === 'INPUT' && ['submit', 'button'].includes(element.type))
        || element.getAttribute('role') === 'button') && isShown(element) && !insideQtsUi(element))
      .map((element) => {
        const text = buttonText(element).slice(0, 60);
        const kind = kinds.find(([, pattern]) => pattern.test(text));
        if (!kind || seen.has(`${kind[0]}:${text}`)) return null;
        seen.add(`${kind[0]}:${text}`);
        count += 1;
        return {
          id: `${kind[0]}_${count}`,
          text,
          type: kind[0],
          safetyStatus: kind[2],
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        };
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  // A one-time code or verification step ("Enter the 6-digit code we sent you").
  const VERIFICATION_TEXT = /\b(verification code|one[- ]time (code|password)|enter the (\d-digit )?code|we (have )?sent (you )?(a|an|the) (code|link|email)|check your (email|inbox)|magic link)\b/i;
  const REGISTRATION_TEXT = /\b(create (an |your )?account|register|sign ?up|confirm (your )?password)\b/i;

  /**
   * What kind of page this is, for deciding what Apply may do. { type, reason }. One of:
   * application_form, partial_application_form, email_first_application, application_navigation,
   * authentication_required, registration_required, verification_required, captcha_required,
   * application_closed, application_submitted, unsupported_page, unknown.
   */
  function classifyPage(fields = scanForm()) {
    const shown = fields.filter((field) => !field.hidden && !field.disabled);
    const blockers = detectBlockers();
    const text = cleanText(document.body?.innerText || '').slice(0, 20000);
    const isEmail = (field) => field.kind === 'email' || /e-?mail/i.test(field.label);
    const actions = formActions();
    const passwords = allElements().filter((element) => element.tagName === 'INPUT' && element.type === 'password' && isShown(element));
    const codeBox = allElements().some((element) => element.tagName === 'INPUT' && isShown(element)
      && (element.autocomplete === 'one-time-code' || /\b(code|otp|pin)\b/i.test(labelFor(element))));
    if (blockers.includes('captcha') && shown.length < 3) return { type: 'captcha_required', reason: 'A security check (CAPTCHA) is on the page.' };
    if (codeBox && VERIFICATION_TEXT.test(text)) return { type: 'verification_required', reason: 'The page asks for a code sent by email or text.' };
    if (passwords.length >= 2 || (passwords.length && REGISTRATION_TEXT.test(text) && !/\bsign ?in\b|\blog ?in\b/i.test(actions.map((action) => action.text).join(' ')))) {
      return { type: 'registration_required', reason: 'The page asks to create an account.' };
    }
    if (blockers.includes('login')) return { type: 'authentication_required', reason: 'The page asks to sign in.' };
    if (shown.length <= 1 && CONFIRMED_TEXT.test(text)) return { type: 'application_submitted', reason: 'The page confirms an application was sent.' };
    const closed = jobClosed();
    if (closed && shown.length < 2) return { type: 'application_closed', reason: `The page says "${closed}".` };
    if (shown.some(isEmail) && shown.length >= 3) return { type: 'application_form', reason: `${shown.length} questions, including an email.` };
    // Only an email (and maybe a name) with a Continue: the next page may be a sign-in or a code sent by email.
    if (shown.some(isEmail) && shown.length <= 2 && actions.some((action) => action.type === 'next' || action.type === 'start' || action.type === 'submit')) {
      return { type: 'email_first_application', reason: 'The page asks only for an email before going on.' };
    }
    if (shown.length >= 2) return { type: 'partial_application_form', reason: `${shown.length} questions, no email.` };
    // No questions: an "Apply" button (also a Submit word) can only start the application.
    if (!shown.length && actions.some((action) => action.type === 'start' || START_TEXT.test(action.text))) {
      return { type: 'application_navigation', reason: 'A button starts the application.' };
    }
    if (!shown.length) return { type: 'unsupported_page', reason: 'No application questions were found.' };
    return { type: 'unknown', reason: 'One question and nothing that says what the page is.' };
  }

  /**
   * The form as structured data, version FORM_SCHEMA_VERSION: the page (address, type, title,
   * language, platform, step, revision), its sections, one record per question (what it asks, the
   * element, how it is answered and with what kind of value, its state, constraints, current value,
   * choices and how they were found, label confidence, lifecycle), the page's actions, and the
   * questions it could not name. revision grows whenever the questions or their choices change.
   */
  function formSchema(step = 1) {
    const fields = scanForm();
    const shown = fields.filter((field) => !field.hidden);
    const sections = formSections();
    const records = shown.map((field) => {
      const element = findField(field.id);
      const status = optionsStatus(field);
      const issue = element ? fieldIssue(field.id) : '';
      const value = valueOf(field, element);
      const confidence = labelConfidence(field);
      return {
        id: field.id,
        sectionId: element ? sectionOf(element, sections) : null,
        question: field.label,
        label: field.label,
        helpText: field.note || null,
        placeholder: field.placeholder || null,
        elementType: elementTypeOf(field, element),
        inputType: inputTypeOf(field),
        valueType: valueTypeOf(field, element),
        required: Boolean(field.required),
        locatorId: field.id,
        labelConfidence: confidence,
        constraints: {
          ...(field.maxLength ? { maxLength: field.maxLength } : {}),
          ...(Number.isFinite(field.min) ? { min: field.min } : {}),
          ...(Number.isFinite(field.max) ? { max: field.max } : {}),
          ...(field.unit ? { unit: field.unit } : {}),
          ...(field.accept ? { accept: field.accept } : {}),
          ...(element?.getAttribute?.('pattern') ? { pattern: element.getAttribute('pattern').slice(0, 120) } : {}),
          ...(DATE_FORMAT.test(cleanText(field.placeholder)) ? { format: field.placeholder } : {}),
        },
        multiple: Boolean(field.multiple || field.kind === 'checkbox-group'),
        options: optionDetails(field, element),
        optionsDiscovery: { method: discoveryMethodOf(field), status },
        currentValue: value || null,
        state: { visible: true, enabled: !field.disabled, readOnly: Boolean(field.readOnlyPicker || element?.readOnly) },
        ...(issue ? { validationError: issue } : {}),
        dependsOn: [],
        lifecycle: confidence === 'unresolved' ? 'unresolved'
          : status === 'pending_dependency' ? 'waiting_dependency'
            : CHOICE_FIELD_KINDS.includes(field.kind) && status !== 'unknown' ? 'options_ready' : 'discovered',
      };
    });
    // The revision grows when the questions or their choices change (kept on the page between calls).
    const signature = records.map((record) => `${record.id}|${record.question}|${record.options.map((option) => option.label).join(',')}`).join(';');
    const root = document.documentElement;
    if (root.dataset.qtsFormSignature !== signature) {
      root.dataset.qtsFormSignature = signature;
      root.dataset.qtsFormRevision = String(Number(root.dataset.qtsFormRevision || 0) + 1);
    }
    const page = classifyPage(fields);
    const required = records.filter((record) => record.required);
    return {
      schemaVersion: FORM_SCHEMA_VERSION,
      page: {
        url: location.href.split('#')[0].slice(0, 300),
        origin: location.origin,
        type: page.type,
        reason: page.reason,
        step,
        title: cleanText(document.title).slice(0, 160),
        language: (document.documentElement.lang || '').slice(0, 12) || null,
        platform: PLATFORMS.find(([, pattern]) => pattern.test(location.hostname))?.[0] || null,
        forms: document.querySelectorAll('form').length,
        revision: Number(root.dataset.qtsFormRevision),
      },
      sections: sections.map(({ id, title }) => ({ id, title })),
      fields: records,
      actions: formActions(),
      unresolvedFields: records.filter((record) => record.labelConfidence === 'unresolved').map((record) => record.id),
      discoveryStatus: required.some((record) => ['unknown', 'pending_dependency'].includes(record.optionsDiscovery.status)) ? 'partial' : 'complete_for_current_state',
    };
  }

  /**
   * Whether a form record is well formed, before anything downstream uses it: [] when it is, else
   * what is wrong.
   */
  function checkFormSchema(schema) {
    const problems = [];
    if (schema?.schemaVersion !== FORM_SCHEMA_VERSION) problems.push('schemaVersion');
    if (!schema?.page || typeof schema.page.type !== 'string') problems.push('page.type');
    if (!Array.isArray(schema?.fields)) return [...problems, 'fields'];
    const ids = new Set();
    schema.fields.forEach((record, index) => {
      if (!record.id || ids.has(record.id)) problems.push(`fields[${index}].id`);
      ids.add(record.id);
      for (const key of ['question', 'elementType', 'inputType', 'valueType', 'labelConfidence']) {
        if (typeof record[key] !== 'string') problems.push(`fields[${index}].${key}`);
      }
      if (typeof record.required !== 'boolean') problems.push(`fields[${index}].required`);
      if (!Array.isArray(record.options)) problems.push(`fields[${index}].options`);
      if (!['complete', 'partial', 'unknown', 'pending_dependency', 'not_applicable'].includes(record.optionsDiscovery?.status)) problems.push(`fields[${index}].optionsDiscovery.status`);
    });
    if (!Array.isArray(schema.actions)) problems.push('actions');
    return problems;
  }

  /** Scrolls a question into view and outlines it briefly, for "click an answer" in the review panel. */
  function focusField(id) {
    const element = findField(id);
    if (!element) return false;
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const box = element.closest('label, fieldset, [class*="field" i], [class*="question" i]') || element;
    const before = box.style.outline;
    box.style.outline = '3px solid #6366f1';
    setTimeout(() => { box.style.outline = before; }, 2500);
    return true;
  }

  /** Outlines the questions the Manager must fill by hand (a rejected value, an empty answer, an upload). */
  function markProblemFields(ids) {
    for (const element of allElements()) {
      if (element.hasAttribute('data-qts-apply-problem')) {
        element.removeAttribute('data-qts-apply-problem');
        element.style.outline = '';
      }
    }
    for (const id of ids || []) {
      const element = findField(id);
      if (!element) continue;
      const box = element.closest('label, fieldset, [class*="field" i], [class*="question" i]') || element;
      box.setAttribute('data-qts-apply-problem', '');
      box.style.outline = '3px solid #e11d48';
      box.style.outlineOffset = '2px';
    }
  }

  /** Whether a click target is the form's Submit button (the Manager's own click, in review). */
  function isSubmitControl(target) {
    const control = target?.closest?.('button, input[type="submit"], input[type="button"], [role="button"], a');
    if (!control || control.closest('[data-qts-apply-review]')) return false;
    if (control.tagName === 'INPUT' && control.type === 'submit') return true;
    return SUBMIT_TEXT.test(buttonText(control));
  }

  /**
   * Clicks "Enter manually" next to a document field (Greenhouse's cover letter: Attach / Dropbox /
   * Google Drive / Enter manually), so a text box takes the letter instead. True when clicked.
   */
  function enterManually(id) {
    let container = findField(id);
    for (let depth = 0; container && depth < 5; depth += 1) {
      const button = [...container.querySelectorAll('button, a, [role="button"]')]
        .find((element) => isShown(element) && /^(enter|type|paste) (it )?manually$|^paste( text)?$/i.test(buttonText(element)));
      if (button) {
        button.click();
        return true;
      }
      container = container.parentElement;
    }
    return false;
  }
})(globalThis);
