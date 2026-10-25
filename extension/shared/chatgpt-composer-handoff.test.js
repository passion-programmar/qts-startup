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
      if (!event?.type?.startsWith('key')) return;
      keyboardEventCount += 1;
      if (event.type !== 'keydown' || !acceptEnter) return;
      const submittedText = editor.textContent;
      setTimeout(() => {
        editor.textContent = '';
        editor.innerText = '';
        userMessages.push({ innerText: submittedText });
      }, 20);
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
      const submittedText = editor.textContent;
      sentMessages.push(submittedText);
      if (!acceptSend || ignoreSendClick) return;
      setTimeout(() => {
        editor.textContent = '';
        editor.innerText = '';
        // ChatGPT shows a long sent message collapsed, only its beginning.
        if (addUserMessage) userMessages.push({ innerText: collapseSent ? `${submittedText.slice(0, 150)}... Show more` : submittedText });
      }, 20);
    }
  }
  class FakeForm extends FakeHTMLElement {
    requestSubmit() {
      if (!acceptFormSubmit) return;
      const submittedText = editor.textContent;
      setTimeout(() => {
        editor.textContent = '';
        editor.innerText = '';
        if (addUserMessage) userMessages.push({ innerText: submittedText });
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
  let acceptEnter = false;
  let collapseSent = false;
  let addUserMessage = true;
  const fast = { timing: { confirmMs: 300, fallbackMs: 200 } };
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
  const previousKeyboardEvent = global.KeyboardEvent;
  global.KeyboardEvent = class FakeKeyboardEvent {
    constructor(type) {
      this.type = type;
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
    assert.equal(composer.version, 12);
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
    assert.equal(result.method, 'matching_user_message_added');
    assert.equal(sendClickCount, 1);
    assert.equal(userMessages.length, 1);

    editor.textContent = 'A different unsent draft';
    editor.innerText = editor.textContent;
    const replacedDraft = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text');
    assert.equal(replacedDraft.sent, true);
    assert.equal(replacedDraft.method, 'matching_user_message_added');
    assert.equal(sendClickCount, 2);
    assert.equal(sentMessages[1], 'Scanner prompt text');
    assert.equal(userMessages.length, 2);

    editor.textContent = 'Scanner prompt text';
    editor.innerText = editor.textContent;
    // Nothing sends it: the click, then Enter (the prompt is still in the box), then form submit all fail.
    acceptSend = false;
    const ambiguous = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text', fast);
    assert.equal(ambiguous.sent, false);
    assert.equal(ambiguous.needsManualSend, true);
    assert.equal(ambiguous.phase, 'typed_needs_send');
    assert.equal(ambiguous.sendButtonFound, true);
    assert.equal(ambiguous.sendButtonLabel, 'Send');
    assert.equal(ambiguous.sendButtonType, 'submit');
    assert.equal(sendClickCount, 3);
    assert.equal(keyboardEventCount, 3);
    assert.equal(editor.textContent, 'Scanner prompt text');

    // The box emptied but no message appeared: never press Enter on an empty box.
    editor.textContent = 'Scanner prompt text';
    editor.innerText = editor.textContent;
    acceptSend = true;
    addUserMessage = false;
    const composerCleared = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text', fast);
    assert.equal(composerCleared.sent, false);
    assert.equal(composerCleared.needsManualSend, true);
    assert.equal(composerCleared.method, 'send_uncertain');
    assert.equal(sendClickCount, 4);
    assert.equal(keyboardEventCount, 3);

    // The click is ignored and Enter sends the prompt.
    editor.textContent = 'Scanner prompt text';
    editor.innerText = editor.textContent;
    ignoreSendClick = true;
    acceptEnter = true;
    addUserMessage = true;
    const enterFallback = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text', fast);
    assert.equal(enterFallback.sent, true);
    assert.equal(enterFallback.method, 'enter_matching_user_message_added');
    assert.equal(sendClickCount, 5);
    assert.equal(keyboardEventCount, 6);
    assert.equal(userMessages.length, 3);

    // Neither the click nor Enter work; form submit does.
    editor.textContent = 'Scanner prompt text';
    editor.innerText = editor.textContent;
    acceptEnter = false;
    acceptFormSubmit = true;
    const formFallback = await composer.runUnifiedComposerHandoffAsync('Scanner prompt text', fast);
    assert.equal(formFallback.sent, true);
    assert.equal(formFallback.method, 'form_matching_user_message_added');
    assert.equal(sendClickCount, 6);
    assert.equal(keyboardEventCount, 9);
    assert.equal(userMessages.length, 4);

    // A long prompt that ChatGPT shows collapsed ("Show more") is still confirmed as sent.
    const longPrompt = `QTS_GENERATION_ID: 6f2c9a1e-1b2c-4d3e-8f90-123456789abc\n${'Candidate profile and job description. '.repeat(200)}`;
    editor.textContent = longPrompt;
    editor.innerText = longPrompt;
    ignoreSendClick = false;
    acceptFormSubmit = false;
    collapseSent = true;
    const collapsed = await composer.runUnifiedComposerHandoffAsync(longPrompt, fast);
    assert.equal(collapsed.sent, true);
    assert.equal(collapsed.method, 'matching_user_message_added');
    assert.equal(sendClickCount, 7);
    assert.equal(keyboardEventCount, 9);
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
    if (previousKeyboardEvent === undefined) delete global.KeyboardEvent;
    else global.KeyboardEvent = previousKeyboardEvent;
    if (previous.helper === undefined) delete global.__qtsChatGptComposerHandoff;
    else global.__qtsChatGptComposerHandoff = previous.helper;
    delete require.cache[require.resolve('./chatgpt-composer-handoff')];
  }
});
