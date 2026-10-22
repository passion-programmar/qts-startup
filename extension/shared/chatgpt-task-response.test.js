const assert = require('node:assert/strict');
const test = require('node:test');

const previousWindow = global.window;
const previousSelf = global.self;
global.window = global;
global.self = global;
const handoff = require('./chatgpt-composer-handoff');
if (previousWindow === undefined) delete global.window;
else global.window = previousWindow;
if (previousSelf === undefined) delete global.self;
else global.self = previousSelf;

test('matches the assistant turn following the exact Generation marker', () => {
  const previousDocument = global.document;
  const previousNode = global.Node;
  const generationId = '807bc8f8-64c3-4072-936a-598ffe85af8b';
  const marker = `QTS_GENERATION_ID: ${generationId}`;
  const earlierAssistant = { innerText: 'Old response' };
  const userMessage = {
    innerText: marker,
    compareDocumentPosition(node) {
      return node === earlierAssistant ? 2 : 4;
    },
  };
  const matchingAssistant = {
    innerText: 'Current response',
    compareDocumentPosition() {
      return 2;
    },
  };
  const laterAssistant = {
    innerText: 'Unrelated later response',
    compareDocumentPosition(node) {
      return node === matchingAssistant ? 2 : 4;
    },
  };

  global.Node = {
    DOCUMENT_POSITION_FOLLOWING: 4,
  };
  global.document = {
    querySelectorAll(selector) {
      if (selector.includes('assistant')) return [earlierAssistant, matchingAssistant, laterAssistant];
      if (selector.includes('user')) return [userMessage];
      return [];
    },
  };

  try {
    assert.equal(
      handoff.findAssistantResponseForTask(generationId),
      matchingAssistant,
    );
    assert.equal(handoff.findAssistantResponseForTask('invalid'), null);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousNode === undefined) delete global.Node;
    else global.Node = previousNode;
  }
});
