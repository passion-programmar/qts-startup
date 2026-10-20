const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const managerSource = fs.readFileSync(
  path.join(__dirname, 'extractor-manager.js'),
  'utf8',
);

function runManager({ specific, fallback }) {
  const window = {
    location: {
      hostname: 'jobs.smartrecruiters.com',
      href: 'https://jobs.smartrecruiters.com/company/job',
    },
    __smartrecruitersExtract: () => ({ ...specific }),
    __genericExtract: () => ({ ...fallback }),
    __normalizeJobUrl: (url) => url,
  };
  vm.runInNewContext(managerSource, { window, console });
  return window.__extractJobData();
}

test('extractor manager fills fields missing from a platform extractor', () => {
  const result = runManager({
    specific: { title: 'Platform title', company: '', description: '', location: '', url: '' },
    fallback: {
      title: 'Generic title',
      company: 'Example company',
      description: 'A complete job description',
      location: 'Riga, Latvia',
      url: 'https://example.com/jobs/123',
    },
  });

  assert.equal(result.title, 'Platform title');
  assert.equal(result.company, 'Example company');
  assert.equal(result.description, 'A complete job description');
  assert.equal(result.location, 'Riga, Latvia');
  assert.equal(result.url, 'https://example.com/jobs/123');
  assert.equal(result.source, 'smartrecruiters');
});

test('extractor manager does not replace non-empty platform fields', () => {
  const result = runManager({
    specific: {
      title: 'Platform title',
      company: 'Platform company',
      description: 'Platform description',
      location: 'Platform location',
      url: 'https://jobs.smartrecruiters.com/company/job',
    },
    fallback: {
      title: 'Generic title',
      company: 'Generic company',
      description: 'Generic description',
      location: 'Generic location',
      url: 'https://example.com/jobs/123',
    },
  });

  assert.equal(result.title, 'Platform title');
  assert.equal(result.company, 'Platform company');
  assert.equal(result.description, 'Platform description');
  assert.equal(result.location, 'Platform location');
  assert.equal(result.url, 'https://jobs.smartrecruiters.com/company/job');
});
