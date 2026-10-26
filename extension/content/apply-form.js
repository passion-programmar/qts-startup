// Apply's form engine, injected into an application page. It reads the form's fields (shown and
// hidden, inside open and closed shadow roots), fills them the way a person would so React forms
// accept the values, attaches files, and reports CAPTCHAs, login walls, field errors, and the page's
// result after Submit. It never clicks Submit by itself: the service worker calls clickButton('submit')
// only after the server grants Submit permission. On a job page without a form it finds the button
// that starts the application (clickStart), the way a person would.

(function initQtsApplyForm(global) {
  const FIELD_ATTRIBUTE = 'data-qts-apply-field';
  const DROP_ATTRIBUTE = 'data-qts-apply-drop';
  const MENU_ATTRIBUTE = 'data-qts-apply-menu';
  // English first, then the words Polish, German, French, Spanish, Portuguese, and Italian sites use.
  const SUBMIT_TEXT = /^(submit|submit application|submit your application|send application|apply|apply now|send|send (my |your )?(cv|resume|application)|submit (my |your )?(cv|resume)|aplikuj|wyślij( zgłoszenie| aplikację| cv)?|zaaplikuj|(bewerbung )?(absenden|senden)|jetzt bewerben|envoyer( ma candidature)?|postuler|enviar( candidatura| solicitud)?|candidatar(-se)?|invia( candidatura)?)$/i;
  const NEXT_TEXT = /^(next|continue|save (and|&) continue|next step|proceed|dalej|weiter|suivant|siguiente|continuar|avanti)$/i;
  const START_TEXT = /^(apply|apply now|apply (for|to) (this|the) (job|position|role|vacancy|opening)|apply (online|here|today)|apply for job|start (your |my )?application|begin (your )?application|i['’]?m interested|aplikuj( teraz)?|zaaplikuj|(jetzt )?bewerben|postuler|aplicar( ahora)?|candidatar(-se)?|candidati( ora)?)$/i;
  const MANUAL_TEXT = /^(apply manually|manual application|apply without .{1,30}|fill (out|in) (the )?(form|application)( manually)?|enter (your )?(details|information) manually|continue (manually|without .{1,30}))$/i;
  const NOT_START = /linkedin|indeed|seek|xing|glassdoor|easy apply|with (google|facebook|apple|github|resume|cv)|later|save|share|refer|alert|similar|sign ?in|log ?in|register|autofill/i;
  // Job-site systems whose form a company page embeds in a frame; opening the frame shows the form.
  const FORM_FRAME = /greenhouse\.io\/(embed\/)?job_app|boards(\.eu)?\.greenhouse\.io|jobs(\.eu)?\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com|smartrecruiters\.com|recruitee\.com|teamtailor\.com|personio\.(de|com)|bamboohr\.com|jobvite\.com|breezy\.hr|comeet\.(co|com)|pinpointhq\.com|join\.com|homerun\.co|applytojob\.com/i;
  const DROP_TEXT = /\b(drag|drop)\b[^.]{0,40}\b(files?|here|cv|resume|résumé|document)\b|\bclick to upload\b|\bbrowse (files|computer)\b|\bchoose (a )?file\b/i;
  const MENU_ITEMS = '[role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="menuitem"]';
  const POPUP_ITEM = /^(option|menuitem|menuitemcheckbox|menuitemradio)$/;
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
      || /[*✱]\s*$|[*✱]\s|\(required\)|^[*✱]|^required\b/i.test(label);
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

  /**
   * Upload areas without a file field of their own (Dropzone keeps its input outside the page's
   * form): the innermost element that says "drop your file", unless its block has a file input.
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

  function itemText(item) {
    return cleanText(item.getAttribute('data-search-text') || textOf(item));
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
      // Menus count only inside the form (a "Share page" menu is not a question).
      if ((tag === 'BUTTON' || control.getAttribute('role') === 'button') && control.closest('form, fieldset') && menuChoices(control)) {
        const label = labelFor(control);
        control.setAttribute(MENU_ATTRIBUTE, '1');
        fields.push({
          id: fieldId(control),
          label,
          kind: 'menu',
          required: isRequired(control, label),
          options: menuChoices(control).map(itemText).filter(Boolean),
          hidden: !isShown(control),
          disabled: control.disabled,
        });
        continue;
      }
      // A menu whose choices exist only while it is open (Radix DropdownMenu): read by opening it.
      // A menu button beside an input (a phone number's country flag) belongs to that input.
      if ((tag === 'BUTTON' || control.getAttribute('role') === 'button') && control.closest('form, fieldset')
        && /^(menu|listbox|true)$/i.test(control.getAttribute('aria-haspopup') || '') && !listboxChoices(control)
        && !blockQuestion(control).block?.querySelector('input:not([type="hidden"]):not([aria-hidden="true"]), textarea')) {
        const label = labelFor(control);
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
        const label = labelFor(control);
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
      if (tag === 'INPUT' && ['hidden', 'submit', 'button', 'image', 'reset', 'search', 'password'].includes(type)) continue;
      const isCombobox = control.getAttribute('role') === 'combobox' && tag === 'INPUT';
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !isCombobox) continue;
      const label = labelFor(control);
      const shown = type === 'file' ? isShown(control.closest('div, label, section') || control) : isShown(control);
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
      // A styled upload's input has no useful label of its own ("Attach"); its block names it.
      const blockLabel = type === 'file' ? blockQuestion(control).text : '';
      const fieldLabel = type === 'file'
        ? (/resume|résumé|\bcv\b|cover|letter|file|attach|upload|document|portfolio/i.test(blockLabel)
          ? blockLabel
          : cleanText(`${questionAround(control)} ${control.id || control.name || ''}`))
        : label;
      const field = {
        id: fieldId(control),
        label: fieldLabel,
        kind: tag === 'TEXTAREA' ? 'textarea'
          : tag === 'SELECT' ? 'select'
            : isCombobox ? 'combobox'
              : ['email', 'tel', 'url', 'number', 'date', 'file', 'checkbox', 'range'].includes(type) ? type : 'text',
        required: isRequired(control, fieldLabel),
        hidden: !shown,
        disabled: control.disabled || control.readOnly,
        ...(control.maxLength > 0 ? { maxLength: control.maxLength } : {}),
        // Date fields typed as text show their format here (DD/MM/YYYY).
        ...(control.placeholder ? { placeholder: String(control.placeholder).slice(0, 40) } : {}),
      };
      if (type === 'number' || type === 'range') {
        const unit = unitOf(control, fieldLabel);
        if (unit) field.unit = unit;
        if (control.min !== '' && Number.isFinite(Number(control.min))) field.min = Number(control.min);
        if (control.max !== '' && Number.isFinite(Number(control.max))) field.max = Number(control.max);
      }
      if (tag === 'SELECT') {
        field.options = [...control.options].map(optionText).filter((text) => text && !PLACEHOLDER_OPTION.test(text));
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

  /** A menu's choices, read by opening it and closing it again (they exist only while it is open). */
  async function readMenuOptions(id) {
    const button = findField(id);
    if (!button) return [];
    press(button);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const options = allElements().filter((element) => POPUP_ITEM.test(element.getAttribute('role') || '') && isShown(element))
      .map(itemText).filter(Boolean);
    for (const target of [document.activeElement, button]) {
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
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
      || control.value;
  }

  // Same type only: Rails pairs a checkbox with a hidden input of the same name.
  function controlsOfGroup(first) {
    const root = first.getRootNode();
    return [...root.querySelectorAll(`input[type="${first.type}"][name="${CSS.escape(first.name)}"]`)];
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
    if (element.tagName !== 'INPUT' && element.getAttribute('role') === 'checkbox') {
      if ((element.getAttribute('aria-checked') === 'true') !== Boolean(value)) element.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { ok: (element.getAttribute('aria-checked') === 'true') === Boolean(value), value: element.getAttribute('aria-checked') === 'true' };
    }
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
        const shouldBeChecked = wanted.includes(choiceText(control).toLowerCase());
        if (control.checked !== shouldBeChecked && (type === 'radio' ? shouldBeChecked : true)) control.click();
      }
      const checked = controlsOfGroup(element).filter((control) => control.checked).map(choiceText);
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
    // Sites reformat numbers: "5000" shows as "5,000", and a country picker keeps "600 100 200" of "+48 600 100 200".
    const digits = (text) => String(text).replace(/\D/g, '');
    const reformatted = digits(element.value).length >= 4 && digits(String(value)).endsWith(digits(element.value));
    return { ok: Boolean(element.value) && (suggestion || element.value === String(value) || reformatted), value: element.value };
  }

  /**
   * Drops the file on an upload area as a person dragging it there would, then waits for the site
   * to show it. A Dropzone that ignores the drop gets it through its own hidden file input instead.
   */
  async function dropFile(zone, file) {
    if (!file) return { ok: false, error: 'No file to attach.' };
    const { block } = blockQuestion(zone);
    const inputValues = () => [...(block?.querySelectorAll('input:not([type="file"])') || [])].map((input) => input.value).join('|');
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
    const hiddenInput = [...document.querySelectorAll('input.dz-hidden-input, body > input[type="file"]')][0];
    if (hiddenInput) {
      hiddenInput.files = transfer.files;
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      if (await waitShown()) return { ok: true, value: file.filename };
    }
    return { ok: false, error: 'The site did not take the dropped file.' };
  }

  async function pickMenuChoice(button, value) {
    const wanted = cleanText(value).toLowerCase();
    if (['listbox', 'lazy'].includes(button.getAttribute(MENU_ATTRIBUTE))) {
      // The choices appear in a popup (often outside the form) only once the button is pressed.
      if (button.getAttribute('aria-expanded') !== 'true') press(button);
      // The popup may word an option differently from the hidden list ("EUR Euro" for "EUREuro").
      const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const target = squash(wanted);
      let option = null;
      for (let waited = 0; waited < 3000 && !option; waited += 250) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const shown = allElements().filter((element) => POPUP_ITEM.test(element.getAttribute('role') || '') && isShown(element));
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
      const shownNow = squash(textOf(button));
      return { ok: Boolean(shownNow) && (squash(picked).includes(shownNow) || shownNow.includes(squash(picked))), value: textOf(button) };
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
      || (/recaptcha\/(api2|enterprise)\/anchor|hcaptcha\.com\/.*frame=checkbox|challenges\.cloudflare\.com/i.test(element.src || '')
        && element.getBoundingClientRect().height > 40 && !/size=invisible/i.test(element.src || ''))
    ));
    // Cloudflare's "Just a moment..." page checks the browser before showing the site.
    if (challenge || /^just a moment/i.test(document.title)) blockers.push('captcha');
    const password = allElements().find((element) => element.tagName === 'INPUT' && element.type === 'password' && isShown(element));
    // A sign-in page without a password field yet (an email-first or magic-link login).
    const signInPage = /\/(auth\/)?(sign-?in|log-?in|register|sign-?up|create-account)(\/|$)/i.test(location.pathname);
    if (password || signInPage) blockers.push('login');
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
      return { ok: true, text: startText(button) };
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

  global.__qtsApplyForm = {
    scanForm,
    readComboboxOptions,
    readMenuOptions,
    fillField,
    fieldErrors,
    detectBlockers,
    buttons,
    clickButton,
    clickStart,
    declineCookies,
    jobClosed,
    pageOutcome,
    pageText: () => cleanText(document.body?.innerText || '').slice(0, 20000),
  };
})(globalThis);
