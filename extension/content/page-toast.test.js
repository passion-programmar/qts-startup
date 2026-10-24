const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'page-toast.js'), 'utf8');

// Just enough DOM for page-toast.js: element trees, classes, attributes and listeners.
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.style = { cssText: '', setProperty() {} };
    this.connected = false;
  }

  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (name) => names().includes(name),
      add: (name) => {
        if (!names().includes(name)) this.className = [...names(), name].join(' ');
      },
    };
  }

  get isConnected() {
    return this.connected || Boolean(this.parentNode?.isConnected);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  attachShadow() {
    const shadow = new FakeElement('#shadow');
    shadow.parentNode = this;
    this.shadow = shadow;
    return shadow;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  prepend(node) {
    node.parentNode = this;
    this.children.unshift(node);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  replaceChildren() {
    this.children = [];
  }
}

function loadPageToast() {
  const documentElement = new FakeElement('html');
  documentElement.connected = true;
  const context = vm.createContext({
    document: {
      documentElement,
      createElement: (tagName) => new FakeElement(tagName),
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    Date,
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: 'page-toast.js' });
  const stack = () => documentElement.children[0].shadow.children[1];
  return { toast: context.__qtsPageToast, stack };
}

const messageOf = (toastElement) => toastElement.children[1].textContent;

test('page toasts stack newest first and retire the oldest beyond four', () => {
  const { toast, stack } = loadPageToast();
  for (const message of ['first', 'second', 'third', 'fourth', 'fifth']) toast.show(message);

  const toasts = stack().children;
  assert.deepEqual(toasts.map(messageOf), ['fifth', 'fourth', 'third', 'second', 'first']);
  assert.deepEqual(
    toasts.map((element) => element.classList.contains('leaving')),
    [false, false, false, false, true],
  );
});

test('page toasts share one stack across callers and skip repeated keys', () => {
  const { toast, stack } = loadPageToast();
  toast.show('Get JD is on.', { type: 'info' });
  toast.show('Already in Jobs.', { type: 'info', key: 'run-1:duplicate' });
  toast.show('Already in Jobs.', { type: 'info', key: 'run-1:duplicate' });
  toast.show('Could not reach QTS.', { type: 'fail' });

  const toasts = stack().children;
  assert.deepEqual(toasts.map(messageOf), ['Could not reach QTS.', 'Already in Jobs.', 'Get JD is on.']);
  assert.ok(toasts[0].classList.contains('error'));
  assert.equal(toasts[0].attributes.role, 'alert');
  assert.equal(toasts[2].attributes.role, 'status');
});

test('page toasts ignore empty messages and clear on request', () => {
  const { toast, stack } = loadPageToast();
  toast.show('   ');
  toast.show('Signed in. QTS actions are ready.', { type: 'success' });
  assert.equal(stack().children.length, 1);
  toast.clear();
  assert.equal(stack().children.length, 0);
});
