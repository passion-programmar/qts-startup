// Apply's form engine, injected into an application page. It reads the form's fields (shown and
// hidden, inside open and closed shadow roots), fills them the way a person would so React forms
// accept the values, attaches files, and reports CAPTCHAs, login walls, field errors, and the page's
// result after Submit. It never clicks Submit by itself: the service worker calls clickButton('submit')
// only after the server grants Submit permission.

(function initQtsApplyForm(global) {
  const FIELD_ATTRIBUTE = 'data-qts-apply-field';
  const SUBMIT_TEXT = /^(submit|submit application|submit your application|send application|apply|apply now|send)$/i;
  const NEXT_TEXT = /^(next|continue|save (and|&) continue|next step|proceed)$/i;
  const CONFIRMED_TEXT = /thank(s| you) for (applying|your application|your interest|submitting)|application (has been |was )?(received|submitted|sent)|we['’]?ve received your application|we have received your application|successfully (applied|submitted)|your application (is|was|has been) (complete|submitted|received)|application submitted/i;
  const PLACEHOLDER_OPTION = /^(select|choose|please select|--|—|select\.\.\.|select one|pick one)/i;

  function shadowRootOf(element) {
    if (element.shadowRoot) return element.shadowRoot;
    try {
      return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(element) || null;
    } catch {
      return null;
    }
  }

  /** Every element under root, including inside open and closed shadow roots. */
  function allElements(root = document) {
    const found = [];
    const visit = (node) => {
      for (const element of node.querySelectorAll('*')) {
        found.push(element);
        const shadow = shadowRootOf(element);
        if (shadow) visit(shadow);
      }
    };
    visit(root);
    return found;
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
  function labelFor(control) {
    const root = control.getRootNode();
    if (control.id) {
      const label = root.querySelector?.(`label[for="${CSS.escape(control.id)}"]`);
      if (label && textOf(label)) return textOf(label);
    }
    const wrapping = control.closest('label');
    if (wrapping && textOf(wrapping)) return textOf(wrapping);
    const labelledBy = control.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => textOf(root.getElementById?.(id))).filter(Boolean).join(' ');
      if (text) return text;
    }
    if (control.getAttribute('aria-label')) return cleanText(control.getAttribute('aria-label'));
    const legend = control.closest('fieldset')?.querySelector('legend');
    if (legend && textOf(legend)) return textOf(legend);
    // A question block: the nearest ancestor with its own text before the control.
    for (let node = control.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth += 1) {
      const heading = node.querySelector('label, legend, [class*="label" i], [class*="question" i], h3, h4, p');
      if (heading && !heading.contains(control) && textOf(heading)) return textOf(heading).slice(0, 300);
    }
    return cleanText(control.getAttribute('placeholder') || control.getAttribute('name') || '');
  }

  /**
   * The question of a block of controls (radio or checkbox options, a styled upload): the text of
   * the nearest enclosing block, without the options' own texts and button words.
   */
  function questionAround(control, optionTexts = []) {
    for (let node = control.parentElement, depth = 0; node && depth < 7; node = node.parentElement, depth += 1) {
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
      || /[*✱]\s*$|[*✱]\s|\(required\)|^[*✱]/.test(label);
  }

  function optionText(option) {
    return cleanText(option.label || option.textContent);
  }

  let nextFieldNumber = 1;
  function fieldId(element) {
    if (!element.getAttribute(FIELD_ATTRIBUTE)) element.setAttribute(FIELD_ATTRIBUTE, `f${nextFieldNumber++}`);
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
      if (tag === 'INPUT' && ['hidden', 'submit', 'button', 'image', 'reset', 'search', 'password'].includes(type)) continue;
      const isCombobox = control.getAttribute('role') === 'combobox' && tag === 'INPUT';
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !isCombobox) continue;
      const label = labelFor(control);
      const shown = type === 'file' ? isShown(control.closest('div, label, section') || control) : isShown(control);
      if ((type === 'radio' || type === 'checkbox') && control.name) {
        const key = `${type}:${control.name}`;
        const ownLabel = textOf(control.closest('label')) || textOf(control.id && control.getRootNode().querySelector?.(`label[for="${CSS.escape(control.id)}"]`));
        const option = ownLabel || control.value;
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
      // A styled upload's input has no useful label of its own ("Attach"); its block names it.
      const fieldLabel = type === 'file'
        ? cleanText(`${questionAround(control)} ${control.id || control.name || ''}`)
        : label;
      const field = {
        id: fieldId(control),
        label: fieldLabel,
        kind: tag === 'TEXTAREA' ? 'textarea'
          : tag === 'SELECT' ? 'select'
            : isCombobox ? 'combobox'
              : ['email', 'tel', 'url', 'number', 'date', 'file', 'checkbox'].includes(type) ? type : 'text',
        required: isRequired(control, fieldLabel),
        hidden: !shown,
        disabled: control.disabled || control.readOnly,
        ...(control.maxLength > 0 ? { maxLength: control.maxLength } : {}),
        // Date fields typed as text show their format here (DD/MM/YYYY).
        ...(control.placeholder ? { placeholder: String(control.placeholder).slice(0, 40) } : {}),
      };
      if (tag === 'SELECT') {
        field.options = [...control.options].map(optionText).filter((text) => text && !PLACEHOLDER_OPTION.test(text));
      }
      fields.push(field);
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

  /** Comboboxes (React Select and similar) show their options only when opened; opening reads them. */
  async function readComboboxOptions(id) {
    const input = findField(id);
    if (!input) return [];
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.click?.();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const listId = input.getAttribute('aria-controls') || input.getAttribute('aria-owns');
    const list = (listId && input.getRootNode().getElementById?.(listId)) || document.querySelector('[role="listbox"]');
    const options = list ? [...list.querySelectorAll('[role="option"]')].map(textOf).filter(Boolean) : [];
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    input.blur();
    return options.slice(0, 300);
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

  function controlsOfGroup(first) {
    const root = first.getRootNode();
    return [...root.querySelectorAll(`input[name="${CSS.escape(first.name)}"]`)];
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
    const type = (element.getAttribute('type') || '').toLowerCase();
    if (type === 'file') {
      if (!file) return { ok: false, error: 'No file to attach.' };
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
        const text = (textOf(control.closest('label')) || control.value).toLowerCase();
        const shouldBeChecked = wanted.includes(text);
        if (control.checked !== shouldBeChecked && (type === 'radio' ? shouldBeChecked : true)) control.click();
      }
      const checked = controlsOfGroup(element).filter((control) => control.checked)
        .map((control) => textOf(control.closest('label')) || control.value);
      return { ok: checked.length > 0, value: checked.join(', ') };
    }
    if (type === 'checkbox') {
      if (element.checked !== Boolean(value)) element.click();
      return { ok: element.checked === Boolean(value), value: element.checked };
    }
    if (element.tagName === 'SELECT') {
      const option = [...element.options].find((entry) => optionText(entry).toLowerCase() === cleanText(value).toLowerCase());
      if (!option) return { ok: false, error: `"${value}" is not an option.` };
      setNativeValue(element, option.value);
      return { ok: element.value === option.value, value: optionText(option) };
    }
    if (element.getAttribute('role') === 'combobox') {
      // Searchable lists match on what is typed, so "Warsaw, Poland" searches "Warsaw" and then
      // picks the option that matches the whole answer best.
      const answer = cleanText(value).toLowerCase();
      element.focus();
      setNativeValue(element, String(value).split(',')[0].trim());
      let options = [];
      for (let waited = 0; waited < 3000 && !options.length; waited += 300) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const listId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
        const list = (listId && element.getRootNode().getElementById?.(listId)) || document.querySelector('[role="listbox"]');
        options = list ? [...list.querySelectorAll('[role="option"]')] : [];
      }
      const match = options.find((option) => textOf(option).toLowerCase() === answer)
        || options.find((option) => answer.split(',').every((part) => textOf(option).toLowerCase().includes(part.trim())))
        || options.find((option) => textOf(option).toLowerCase().startsWith(answer.split(',')[0].trim()));
      if (!match) return { ok: false, error: `No option matching "${value}".` };
      match.click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { ok: true, value: textOf(match) };
    }
    element.focus();
    setNativeValue(element, String(value));
    // A search box (Lever's location, Google Places) keeps a value only when a suggestion is picked.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const suggestion = pickSuggestion(String(value));
    if (suggestion) {
      suggestion.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    element.blur();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { ok: Boolean(element.value) && (suggestion ? true : element.value === String(value)), value: element.value };
  }

  /** A suggestion list that appeared after typing: the entry that matches what was typed. */
  function pickSuggestion(typed) {
    const wanted = typed.toLowerCase().split(',')[0].trim();
    const entries = allElements().filter((element) => isShown(element) && (
      element.getAttribute('role') === 'option'
      || /(^|\s)(pac-item|dropdown-location|location-result|autocomplete-item|suggestion)/i.test(element.className || '')
    ));
    return entries.find((entry) => textOf(entry).toLowerCase().startsWith(wanted))
      || entries.find((entry) => textOf(entry).toLowerCase().includes(wanted))
      || null;
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
      || (/recaptcha\/(api2|enterprise)\/anchor|hcaptcha\.com\/.*frame=checkbox/i.test(element.src || '')
        && element.getBoundingClientRect().height > 40 && !/size=invisible/i.test(element.src || ''))
    ));
    if (challenge) blockers.push('captcha');
    const password = allElements().find((element) => element.tagName === 'INPUT' && element.type === 'password' && isShown(element));
    if (password) blockers.push('login');
    return blockers;
  }

  function buttonText(element) {
    return cleanText(element.innerText || element.value || element.getAttribute('aria-label') || '');
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
    return { submit: Boolean(findButton('submit')), next: Boolean(findButton('next')) };
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

  global.__qtsApplyForm = {
    scanForm,
    readComboboxOptions,
    fillField,
    fieldErrors,
    detectBlockers,
    buttons,
    clickButton,
    pageOutcome,
    pageText: () => cleanText(document.body?.innerText || '').slice(0, 20000),
  };
})(globalThis);
