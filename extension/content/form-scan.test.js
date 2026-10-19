const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFormScanner(control, optionElements = []) {
  const controls = [control, ...optionElements];
  class FakeElement {
    constructor(tagName, attributes = {}) {
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map(Object.entries(attributes));
      this.isConnected = true;
      this.events = [];
      this.textContent = '';
      this.value = '';
      this.disabled = false;
    }

    getAttribute(name) {
      return this.attributes.get(name) || null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    dispatchEvent(event) {
      this.events.push(event.type);
      return true;
    }

    getBoundingClientRect() {
      return { width: 100, height: 24 };
    }

    closest() {
      return null;
    }
  }

  class HTMLInputElement extends FakeElement {}
  class HTMLTextAreaElement extends FakeElement {}
  class HTMLSelectElement extends FakeElement {
    constructor(attributes, options) {
      super('select', attributes);
      this.options = options;
      this._value = '';
    }

    get value() {
      return this._value;
    }

    set value(value) {
      this._value = String(value);
    }
  }
  class Event {
    constructor(type) {
      this.type = type;
    }
  }

  const listbox = {
    querySelectorAll: () => optionElements,
  };
  const document = {
    body: {},
    documentElement: { lang: 'en' },
    getElementById: (id) => {
      const matched = controls.find((element) => element.getAttribute?.('id') === id);
      if (matched) return matched;
      if (control.getAttribute('aria-controls') === id) return listbox;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === '[role="option"]') return optionElements.filter((element) => element.getAttribute('role') === 'option');
      if (selector.includes('input:not([type="hidden"])')) return controls;
      if (selector === '[role="radio"]') return controls.filter((element) => element.getAttribute?.('role') === 'radio');
      if (selector.includes('[role="radio"]')) return controls.filter((element) => element.getAttribute?.('role') === 'radio');
      if (selector.startsWith('input[type="radio"][name="')) {
        const name = selector.match(/\[name="([^"]*)"\]/)?.[1];
        return controls.filter((element) => element.type === 'radio' && element.name === name);
      }
      if (selector.startsWith('[') || selector.startsWith('dialog')) return [];
      return [];
    },
    querySelector: () => null,
  };
  const window = {
    location: { href: 'https://example.test/apply', pathname: '/apply' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { language: 'en' },
    HTMLInputElement,
    HTMLTextAreaElement,
    HTMLSelectElement,
    Event,
    CSS: { escape: (value) => value },
    setTimeout,
  });
  const source = fs.readFileSync(path.join(__dirname, 'form-scan.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'form-scan.js' });
  return {
    fill: window.__fillApplicationFields,
    scan: window.__scanApplicationForm,
    FakeElement,
    HTMLInputElement,
    HTMLSelectElement,
  };
}

function scannerField(fillValue, fieldType, id) {
  return {
    stableFieldId: `field-${id}`,
    selectorHints: { id },
    fieldType,
    fillValue,
  };
}

test('scanner captures required select choices without disabled or placeholder options', () => {
  const control = {
    tagName: 'SELECT',
    id: 'education',
    name: 'education',
    type: 'select-one',
    required: true,
    disabled: false,
    isConnected: true,
    value: '',
    options: [
      { textContent: 'Choose an option', value: '', disabled: false, getAttribute: () => null },
      { textContent: 'High school diploma', value: 'high-school', disabled: false, getAttribute: () => null },
      { textContent: 'Doctorate', value: 'doctorate', disabled: true, getAttribute: () => null },
    ],
    getAttribute(name) {
      if (name === 'aria-label') return 'Highest level of education';
      return name === 'id' ? this.id : name === 'name' ? this.name : null;
    },
    closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 24 }),
  };
  const setup = loadFormScanner(control);
  const scan = setup.scan();

  assert.equal(scan.fields.length, 1);
  assert.equal(scan.fields[0].required, true);
  assert.deepEqual(Array.from(scan.fields[0].options), ['High school diploma']);
});

test('native select matches the option label and confirms the selected value', async () => {
  const options = [
    { textContent: 'Select an option', value: '' },
    { textContent: "Bachelor's degree", value: 'bachelors' },
    { textContent: 'Master’s degree', value: 'masters' },
  ];
  const setup = loadFormScanner({
    tagName: 'SELECT',
    options,
    value: '',
    isConnected: true,
    getAttribute: (name) => (name === 'id' ? 'education' : null),
    set value(next) { this._value = String(next); },
    get value() { return this._value || ''; },
    dispatchEvent(event) { this.events.push(event.type); return true; },
    closest: () => null,
    events: [],
  });

  const result = await setup.fill([scannerField("Bachelor's degree", 'select', 'education')]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].stableFieldId, 'field-education');
});

test('stale locators recover only when one field matches the captured label and options', async () => {
  const control = {
    tagName: 'INPUT',
    type: 'tel',
    value: '',
    isConnected: true,
    getAttribute(name) {
      if (name === 'id') return 'phone-current';
      if (name === 'name') return 'phone-current';
      if (name === 'aria-label') return 'Phone';
      return null;
    },
    dispatchEvent() { return true; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    closest() { return null; },
  };
  const setup = loadFormScanner(control);
  const result = await setup.fill([{
    ...scannerField('+40 262 275 024', 'tel', 'phone-old'),
    label: 'Phone',
    nameAttr: 'phone-old',
  }]);

  assert.equal(result.results[0].ok, true);
  assert.equal(control.value, '+40 262 275 024');
});

test('stale locators are not recovered when matching fields are ambiguous', async () => {
  const makeControl = (id) => ({
    tagName: 'INPUT',
    type: 'tel',
    value: '',
    isConnected: true,
    getAttribute(name) {
      if (name === 'id') return id;
      if (name === 'aria-label') return 'Phone';
      return null;
    },
    dispatchEvent() { return true; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    closest() { return null; },
  });
  const first = makeControl('phone-one');
  const second = makeControl('phone-two');
  const setup = loadFormScanner(first, [second]);
  const result = await setup.fill([{
    ...scannerField('+40 262 275 024', 'tel', 'phone-old'),
    label: 'Phone',
    nameAttr: 'phone-old',
  }]);

  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].reason, 'element_not_found');
  assert.equal(first.value, '');
  assert.equal(second.value, '');
});

test('phone input formatting is accepted when the underlying digits are retained', async () => {
  const control = {
    tagName: 'INPUT',
    type: 'tel',
    value: '',
    isConnected: true,
    getAttribute(name) {
      if (name === 'id') return 'phone';
      return null;
    },
    dispatchEvent(event) {
      if (event.type === 'input') this.value = '+40 (262) 275-024';
      return true;
    },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    closest() { return null; },
  };
  const setup = loadFormScanner(control);
  const result = await setup.fill([scannerField('+40 262 275 024', 'tel', 'phone')]);

  assert.equal(result.results[0].ok, true);
});

test('native browser constraints reject a value before input events are dispatched', async () => {
  const control = {
    tagName: 'INPUT',
    type: 'number',
    value: '',
    isConnected: true,
    validity: { valid: false },
    events: [],
    getAttribute(name) {
      if (name === 'id') return 'salary';
      if (name === 'aria-label') return 'Salary';
      return null;
    },
    dispatchEvent(event) { this.events.push(event.type); return true; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    closest() { return null; },
  };
  const setup = loadFormScanner(control);
  const result = await setup.fill([scannerField('5000 EUR per month', 'number', 'salary')]);

  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].reason, 'constraint_validation_failed');
  assert.equal(control.value, '');
  assert.deepEqual(control.events, []);
});

test('custom accessible dropdown opens and selects a matching option', async () => {
  const control = {
    tagName: 'BUTTON',
    value: '',
    isConnected: true,
    attributes: new Map([
      ['id', 'education'],
      ['aria-haspopup', 'listbox'],
      ['aria-controls', 'education-options'],
      ['aria-expanded', 'false'],
    ]),
    getAttribute(name) { return this.attributes.get(name) || null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    dispatchEvent() { return true; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    closest() { return null; },
    click() { this.setAttribute('aria-expanded', 'true'); },
  };
  const option = {
    tagName: 'DIV',
    textContent: "Bachelor's degree",
    isConnected: true,
    attributes: new Map([['role', 'option'], ['aria-selected', 'false']]),
    getAttribute(name) { return this.attributes.get(name) || null; },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'aria-selected' && value === 'true') control.value = this.textContent;
    },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    closest() { return null; },
    click() {
      this.setAttribute('aria-selected', 'true');
      control.setAttribute('aria-expanded', 'false');
    },
  };
  const setup = loadFormScanner(control, [option]);
  const result = await setup.fill([scannerField("Bachelor's degree", 'combobox', 'education')]);

  assert.equal(result.results[0].ok, true);
  assert.equal(control.value, "Bachelor's degree");
  assert.equal(control.getAttribute('aria-expanded'), 'false');
});

test('custom combobox does not report success when no option matches', async () => {
  const control = {
    tagName: 'INPUT',
    value: '',
    isConnected: true,
    attributes: new Map([
      ['id', 'education'],
      ['role', 'combobox'],
      ['aria-controls', 'education-options'],
      ['aria-expanded', 'false'],
    ]),
    getAttribute(name) { return this.attributes.get(name) || null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    dispatchEvent() { return true; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
    closest() { return null; },
    click() { this.setAttribute('aria-expanded', 'true'); },
  };
  const option = {
    tagName: 'DIV',
    textContent: 'High school diploma',
    isConnected: true,
    getAttribute: (name) => (name === 'role' ? 'option' : null),
    getBoundingClientRect: () => ({ width: 100, height: 24 }),
    closest: () => null,
  };
  const setup = loadFormScanner(control, [option]);
  const result = await setup.fill([scannerField('Doctorate', 'combobox', 'education')]);

  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].reason, 'option_not_found');
  assert.equal(control.value, '');
});

test('unselected accessible radio groups are scanned once and the chosen option is clicked', async () => {
  const group = {
    tagName: 'DIV',
    parentElement: null,
    attributes: new Map([['aria-required', 'true']]),
    classList: [],
    querySelectorAll: (selector) => selector === '[role="radio"]' ? [yes, no, unavailable] : [],
    querySelector: () => null,
    getAttribute(name) {
      return name === 'aria-label'
        ? 'Are you legally authorized to work in the United States?'
        : this.attributes.get(name) || null;
    },
    closest: () => null,
  };
  const createRadio = (id, label) => ({
    tagName: 'DIV',
    type: '',
    name: '',
    value: '',
    isConnected: true,
    parentElement: group,
    attributes: new Map([
      ['id', id],
      ['role', 'radio'],
      ['aria-label', label],
      ['aria-checked', 'false'],
    ]),
    classList: [],
    getAttribute(name) { return this.attributes.get(name) || null; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    dispatchEvent() { return true; },
    getBoundingClientRect() { return { width: 60, height: 30 }; },
    closest(selector) { return selector.includes('[role="radiogroup"]') ? group : null; },
    click() {
      for (const member of [yes, no]) member.setAttribute('aria-checked', 'false');
      this.setAttribute('aria-checked', 'true');
    },
  });
  const yes = createRadio('authorized-yes', 'Yes');
  const no = createRadio('authorized-no', 'No');
  const unavailable = createRadio('authorized-unavailable', 'Not available');
  unavailable.setAttribute('aria-disabled', 'true');
  const setup = loadFormScanner(yes, [no, unavailable]);
  const scan = setup.scan();

  assert.equal(scan.fields.length, 1);
  assert.equal(scan.fields[0].fieldType, 'radio');
  assert.equal(scan.fields[0].label, 'Are you legally authorized to work in the United States?');
  assert.equal(scan.fields[0].required, true);
  assert.deepEqual(Array.from(scan.fields[0].options), ['Yes', 'No']);

  const filled = await setup.fill([{
    stableFieldId: scan.fields[0].stableFieldId,
    selectorHints: { id: 'stale-authorized-id' },
    fieldType: 'radio',
    label: scan.fields[0].label,
    options: Array.from(scan.fields[0].options),
    fillValue: 'Yes',
  }]);
  assert.equal(filled.results[0].ok, true);
  assert.equal(yes.getAttribute('aria-checked'), 'true');
});
