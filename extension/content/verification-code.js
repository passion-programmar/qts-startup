// The code box of a job site's verification page: one box, or 4-8 boxes of one character each.
// Filled with the code from the verification mailbox (extension/background/verification-mail.js),
// then the page's own Verify / Confirm / Continue button is clicked. Never a password box.

(function initializeQtsVerificationCode() {
  if (globalThis.__qtsVerificationCode) return;

  const CODE_HINT = /\b(code|otp|one[- ]?time|verif\w*|pin|passcode|token|security)\b/i;
  const BUTTON_WORDS = /^(verify|confirm|continue|submit|next|done|sign ?in|log ?in|activate|validate)\b/i;
  const QTS_UI = '[data-qts-apply-review], [data-qts-apply-assist], [data-qts-page-toast]';

  function shown(element) {
    if (!element?.isConnected || element.closest(QTS_UI)) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function labelOf(input) {
    const byId = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : '';
    return [input.name, input.id, input.placeholder, input.getAttribute('aria-label'), byId, input.closest('label')?.textContent]
      .filter(Boolean).join(' ');
  }

  function textBoxes() {
    return [...document.querySelectorAll('input')].filter((input) => shown(input) && !input.disabled && !input.readOnly
      && (['text', 'tel', 'number', ''].includes((input.getAttribute('type') || '').toLowerCase()) || input.autocomplete === 'one-time-code'));
  }

  /** { single } or { split: [...] } or null. */
  function codeBoxes() {
    const boxes = textBoxes();
    const singles = boxes.filter((input) => input.maxLength === 1);
    if (singles.length >= 4 && singles.length <= 8) return { split: singles };
    const hinted = boxes.find((input) => input.autocomplete === 'one-time-code' || CODE_HINT.test(labelOf(input)));
    if (hinted) return { single: hinted };
    if (boxes.length === 1 && CODE_HINT.test((document.body?.innerText || '').slice(0, 4000))) return { single: boxes[0] };
    return null;
  }

  function setValue(input, value) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value); else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function verifyButton(near) {
    const scope = near?.closest('form') || document;
    const buttons = [...scope.querySelectorAll('button, [role="button"], input[type="submit"]')]
      .filter((button) => shown(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    return buttons.find((button) => BUTTON_WORDS.test((button.textContent || button.value || button.getAttribute('aria-label') || '').trim())) || null;
  }

  function state() {
    return { codeBox: Boolean(codeBoxes()), url: location.href };
  }

  // Words of a page that waits for a code or a link sent by email (not an application form that
  // only mentions a code somewhere).
  const WAITS_FOR_MAIL = /verify your (e-?mail|account|identity|address)|verification (code|link|e-?mail)|confirm your (e-?mail|account|address)|check your (e-?mail|inbox)|we('ve| have)? (just )?sent (you )?(a |an |the )?(\d+[- ]digit )?(code|link|e-?mail|verification)|enter (the )?(\d+[- ]digit )?(code|verification)|one[- ]time (code|password|passcode)|activation (link|code|e-?mail)|activate your account/i;

  /** Whether this page waits for an emailed code (a code box) or link (no form to speak of). */
  function waitsForMail() {
    const text = (document.body?.innerText || '').slice(0, 6000);
    if (!WAITS_FOR_MAIL.test(text)) return false;
    const boxes = textBoxes();
    if (codeBoxes() && boxes.length <= 8) return true;
    return boxes.length <= 1 && /link|check your (e-?mail|inbox)|activate/i.test(text);
  }

  /** Types the code and clicks Verify. { ok, clicked, reason }. */
  function fill(code) {
    const boxes = codeBoxes();
    if (!boxes) return { ok: false, clicked: false, reason: 'No code box on this page.' };
    const characters = [...String(code)];
    if (boxes.split) {
      if (characters.length !== boxes.split.length) return { ok: false, clicked: false, reason: `The code has ${characters.length} characters, the page has ${boxes.split.length} boxes.` };
      boxes.split.forEach((input, index) => setValue(input, characters[index]));
    } else {
      setValue(boxes.single, String(code));
    }
    const first = boxes.single || boxes.split[0];
    const button = verifyButton(first);
    // Many code pages go on by themselves once the last character is in: a short wait, then the button.
    if (button) setTimeout(() => { if (button.isConnected && !button.disabled) button.click(); }, 400);
    return { ok: true, clicked: Boolean(button), reason: '' };
  }

  globalThis.__qtsVerificationCode = { state, fill, waitsForMail };
})();
