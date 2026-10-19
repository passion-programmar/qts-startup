const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'field-classifier.js'), 'utf8');
const classifierContext = { self: {}, importScripts() {} };
vm.runInNewContext(source, classifierContext);
const { classifyField } = classifierContext.self.__qtsFieldClassifier;

test('account profile fields are classified to their matching profile keys', () => {
  const fields = [
    { label: 'Address', fieldType: 'text', required: true },
    { label: 'City', fieldType: 'text', required: true },
    { label: 'Country', fieldType: 'text', required: true },
  ];
  const expectedKeys = ['address', 'city', 'country'];

  fields.forEach((field, index) => {
    const result = classifyField(field);
    assert.equal(result.category, 'candidate_profile');
    assert.equal(result.profileKey, expectedKeys[index]);
  });
});

test('address profile mapping is also inferred from autocomplete and field names', () => {
  const autocompleteResult = classifyField({
    label: '',
    fieldType: 'text',
    autocompleteAttr: 'street-address',
    required: true,
  });
  const nameResult = classifyField({
    label: '',
    fieldType: 'text',
    nameAttr: 'address',
    required: true,
  });

  assert.equal(autocompleteResult.category, 'candidate_profile');
  assert.equal(autocompleteResult.profileKey, 'address');
  assert.equal(nameResult.category, 'candidate_profile');
  assert.equal(nameResult.profileKey, 'address');
});
