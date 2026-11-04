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
      remove: (name) => {
        this.className = names().filter((entry) => entry !== name).join(' ');
      },
    };
  }

  get isConnected() {
    return this.connected || Boolean(this.parentNode?.isConnected);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
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
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
}

function loadPageToast() {
  const documentElement = new FakeElement('html');
  documentElement.connected = true;
  const timers = new Map();
  const listeners = new Map();
  let now = 1000;
  let nextTimerId = 1;
  const setTimeout = (callback, delay = 0) => {
    const id = nextTimerId++;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  const clearTimeout = (id) => timers.delete(id);
  const advance = (milliseconds) => {
    now += milliseconds;
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > now) break;
      timers.delete(next[0]);
      next[1].callback();
    }
  };
  class FakeDate extends Date {
    static now() { return now; }
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const runtimeListeners = new Set();
  const windowListeners = new Map();
  const context = vm.createContext({
    document: {
      documentElement,
      createElement: (tagName) => new FakeElement(tagName),
    },
    setTimeout,
    clearTimeout,
    Date: FakeDate,
    URL,
    chrome: { runtime: { onMessage: {
      addListener: (listener) => runtimeListeners.add(listener),
      removeListener: (listener) => runtimeListeners.delete(listener),
    } } },
    window: {
      addEventListener: (type, listener) => windowListeners.set(type, listener),
      removeEventListener: (type) => windowListeners.delete(type),
    },
    __qtsGetJdNotifications: require('../shared/get-jd-notifications.js'),
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: 'page-toast.js' });
  const stack = () => documentElement.children[0].shadow.children[1];
  return {
    toast: context.__qtsPageToast,
    stack,
    advance,
    timers,
    runtimeListeners,
    windowListeners,
  };
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

test('Get JD outcomes update one toast and aggregate simultaneous results', () => {
  const { toast, stack } = loadPageToast();
  const item = (operationId, status) => ({
    operationId, status, message: `${status} message`, updatedAt: 1000, pageTitle: operationId,
  });
  toast.showGetJdSummary({ id: 'batch-1', updatedAt: 1000, items: [item('one', 'success')] });
  toast.showGetJdSummary({
    id: 'batch-1', updatedAt: 1200,
    items: [item('one', 'success'), item('two', 'failed'), item('three', 'skipped')],
  });

  const active = stack().children.filter((element) => !element.classList.contains('leaving'));
  assert.equal(active.length, 1);
  assert.ok(active[0].classList.contains('error'));
  assert.match(messageOf(active[0]), /Success 1 · Failed 1 · Skipped 1/);
  assert.match(messageOf(active[0]), /3 results/);
});

test('Get JD processing updates in place and duplicate snapshots do not reset dismissal', () => {
  const { toast, stack, advance, timers } = loadPageToast();
  const batch = (updatedAt, status) => ({
    id: 'batch-1', updatedAt,
    items: [{ operationId: 'run-1', status, message: 'Reading page', updatedAt }],
  });
  toast.showGetJdSummary(batch(1000, 'processing'));
  const original = stack().children[0];
  advance(3000);
  toast.showGetJdSummary(batch(4000, 'success'));
  assert.equal(stack().children[0], original);
  assert.match(messageOf(original), /Success 1 · Failed 0/);
  toast.showGetJdSummary(batch(4000, 'success'));
  advance(4999);
  assert.equal(original.isConnected, true);
  advance(1);
  assert.equal(original.isConnected, false);
  assert.equal(timers.size, 0);
});

test('Get JD notifications can be dismissed manually and clean up on navigation', () => {
  const { toast, stack, windowListeners, runtimeListeners, advance } = loadPageToast();
  toast.showGetJdSummary({
    id: 'batch-1', updatedAt: 1000,
    items: [{ operationId: 'run-1', status: 'failed', updatedAt: 1000 }],
  });
  const notification = stack().children[0];
  notification.children[2].listeners.click();
  assert.equal(notification.isConnected, false);

  toast.showGetJdSummary({
    id: 'batch-2', updatedAt: 2000,
    items: [{ operationId: 'run-2', status: 'success', updatedAt: 2000 }],
  });
  assert.equal(runtimeListeners.size, 1);
  windowListeners.get('pagehide')();
  assert.equal(stack().children.length, 0);
  assert.equal(runtimeListeners.size, 0);
  advance(10000);
  assert.equal(stack().children.length, 0);
});
