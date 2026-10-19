const assert = require('node:assert/strict');
const test = require('node:test');

test('Scanner waits asynchronously for ChatGPT to accept a send-button click', async () => {
  const previous = {
    document: global.document,
    window: global.window,
    location: global.location,
    self: global.self,
    HTMLElement: global.HTMLElement,
    HTMLTextAreaElement: global.HTMLTextAreaElement,
    HTMLButtonElement: global.HTMLButtonElement,
    HTMLFormElement: global.HTMLFormElement,
    MouseEvent: global.MouseEvent,
    InputEvent: global.InputEvent,
    helper: global.__qtsChatGptComposerHandoff,
  };

  class FakeHTMLElement {
    constructor() {
      this.isConnected = true;
      this.isContentEditable = true;
      this.textContent = 'Scanner prompt text';
      this.innerText = this.textContent;
      this.disabled = false;
      this.attributes = { 'aria-label': 'Send', type: 'submit' };
    }

    getBoundingClientRect() {
      return { width: 300, height: 40 };
    }

    getAttribute(name) {
      return this.attributes[name] || null;
    }

    closest() {
      return form;
    }

    matches(selector) {
      return selector.includes('data-chatgpt-composer');
    }

    focus() {}

    click() {}

    dispatchEvent(event) {
      if (event?.type?.startsWith('key')) keyboardEventCount += 1;
    }

    scrollIntoView() {}

    querySelector() {
      return null;
    }

    querySelectorAll() {
      return [];
    }
  }
  class FakeButton extends FakeHTMLElement {
    click() {
      sendClickCount += 1;
      sentMessages.push(editor.textContent);
      if (!acceptSend || ignoreSendClick) return;
      setTimeout(() => {
        editor.textContent = '';
        editor.innerText = '';
        if (addUserMessage) userMessages.push({});
      }, 20);
    }
  }
  class FakeForm extends FakeHTMLElement {
    requestSubmit() {
      if (!acceptFormSubmit) return;
      setTimeout(() => {
        editor.textContent = '';
        editor.innerText = '';
        if (addUserMessage) userMessages.push({});
      }, 20);
    }

    querySelector(selector) {
      return selector.includes('ProseMirror') ? editor : null;
    }

    querySelectorAll(selector) {
      return selector.includes('send-button') || selector.includes('aria-label="Send"')
        ? [sendButton]
        : [];
    }
  }

  let sendClickCount = 0;
  let keyboardEventCount = 0;
  let acceptSend = true;
  let ignoreSendClick = false;
  let acceptFormSubmit = false;
  let addUserMessage = true;
  const userMessages = [];
  const sentMessages = [];
  const assistantMessages = [{ innerText: 'Captured ChatGPT response' }];
  const editor = new FakeHTMLElement();
  const threadEditor = new FakeHTMLElement();
  threadEditor.textContent = '';
  threadEditor.innerText = '';
  const sendButton = new FakeButton();
  const form = new FakeForm();
  const threadForm = new FakeForm();
  threadForm.querySelectorAll = () => [];
  threadEditor.closest = () => threadForm;
  const oldSelf = previous.self;

  global.HTMLElement = FakeHTMLElement;
  global.HTMLTextAreaElement = class FakeTextArea extends FakeHTMLElement {};
  global.HTMLButtonElement = FakeButton;
  global.HTMLFormElement = FakeForm;
  global.MouseEvent = class FakeMouseEvent {
    constructor(type) {
      this.type = type;
    }
  };
  global.InputEvent = class FakeInputEvent {
    constructor(type) {
      this.type = type;
      this.defaultPrevented = false;
    }
  };
  global.document = {
    querySelector: (selector) => selector.includes('Ask ChatGPT') ? editor : null,
    execCommand: (command, _showUi, value) => {
      if (command === 'delete') {
        editor.textContent = '';
        editor.innerText = '';
        return true;
      }
      if (command === 'insertText') {
        editor.textContent = value;
        editor.innerText = value;
        return true;
      }
      return true;
    },
    querySelectorAll: (selector) => {
      if (selector.includes('data-markdown-text-tone')) return userMessages;
      if (selector.includes('data-message-author-role')) return [];
      if (selector.includes('user')) return [];
      if (selector.includes('Ask ChatGPT')) return [threadEditor, editor];
      if (selector.includes('data-markdown-text-style')) return assistantMessages;
      return [];
    },
  };
  global.window = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    setTimeout,
  };
  global.location = { href: 'https://chatgpt.com/' };
  global.self = global;
  global.__qtsChatGptComposerHandoff = {
    version: 1,
    runUnifiedComposerHandoffAsync: () => ({ sent: false }),
  };
  delete require.cache[require.resolve('./chatgpt-composer-handoff')];

  try {
    const composer = require('./chatgpt-composer-handoff');
    assert.equal(composer.version, 6);
    assert.equal(composer.findUnifiedComposerEditor(), editor);
    assert.deepEqual(composer.findAssistantMessages(), assistantMessages);
    let sendingStatusShown = false;
    const result = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text', {
      onSending: async () => {
        assert.equal(sendClickCount, 0);
        sendingStatusShown = true;
      },
    });

    assert.equal(sendingStatusShown, true);
    assert.equal(result.sent, true);
    assert.equal(result.method, 'user_message_added');
    assert.equal(sendClickCount, 1);
    assert.equal(userMessages.length, 1);

    editor.textContent = 'A different unsent draft';
    editor.innerText = editor.textContent;
    const replacedDraft = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text');
    assert.equal(replacedDraft.sent, true);
    assert.equal(replacedDraft.method, 'user_message_added');
    assert.equal(sendClickCount, 2);
    assert.equal(sentMessages[1], 'Scanner prompt text');
    assert.equal(userMessages.length, 2);

    editor.textContent = 'Scanner prompt text';
    editor.innerText = editor.textContent;
    acceptSend = false;
    const ambiguous = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text');
    assert.equal(ambiguous.sent, false);
    assert.equal(ambiguous.needsManualSend, true);
    assert.equal(ambiguous.phase, 'typed_needs_send');
    assert.equal(ambiguous.sendButtonFound, true);
    assert.equal(ambiguous.sendButtonLabel, 'Send');
    assert.equal(ambiguous.sendButtonType, 'submit');
    assert.equal(sendClickCount, 3);
    assert.equal(keyboardEventCount, 0);
    assert.equal(editor.textContent, 'Scanner prompt text');

    editor.textContent = 'Scanner prompt text';
    editor.innerText = editor.textContent;
    acceptSend = true;
    addUserMessage = false;
    const composerCleared = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text');
    assert.equal(composerCleared.sent, true);
    assert.equal(composerCleared.method, 'composer_cleared');
    assert.equal(sendClickCount, 4);
    assert.equal(keyboardEventCount, 0);

    editor.textContent = 'Scanner prompt text';
    editor.innerText = editor.textContent;
    acceptSend = true;
    ignoreSendClick = true;
    acceptFormSubmit = true;
    addUserMessage = true;
    const formFallback = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text');
    assert.equal(formFallback.sent, true);
    assert.equal(formFallback.method, 'form_user_message_added');
    assert.equal(sendClickCount, 5);
    assert.equal(userMessages.length, 3);
  } finally {
    if (previous.document === undefined) delete global.document;
    else global.document = previous.document;
    if (previous.window === undefined) delete global.window;
    else global.window = previous.window;
    if (previous.location === undefined) delete global.location;
    else global.location = previous.location;
    if (oldSelf === undefined) delete global.self;
    else global.self = oldSelf;
    if (previous.HTMLElement === undefined) delete global.HTMLElement;
    else global.HTMLElement = previous.HTMLElement;
    if (previous.HTMLTextAreaElement === undefined) delete global.HTMLTextAreaElement;
    else global.HTMLTextAreaElement = previous.HTMLTextAreaElement;
    if (previous.HTMLButtonElement === undefined) delete global.HTMLButtonElement;
    else global.HTMLButtonElement = previous.HTMLButtonElement;
    if (previous.HTMLFormElement === undefined) delete global.HTMLFormElement;
    else global.HTMLFormElement = previous.HTMLFormElement;
    if (previous.MouseEvent === undefined) delete global.MouseEvent;
    else global.MouseEvent = previous.MouseEvent;
    if (previous.InputEvent === undefined) delete global.InputEvent;
    else global.InputEvent = previous.InputEvent;
    if (previous.helper === undefined) delete global.__qtsChatGptComposerHandoff;
    else global.__qtsChatGptComposerHandoff = previous.helper;
    delete require.cache[require.resolve('./chatgpt-composer-handoff')];
  }
});
