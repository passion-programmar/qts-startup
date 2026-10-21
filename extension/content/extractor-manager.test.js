const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const managerSource = fs.readFileSync(
  path.join(__dirname, 'extractor-manager.js'),
  'utf8',
);

function runManager({
  hostname = 'jobs.smartrecruiters.com',
  href = 'https://jobs.smartrecruiters.com/company/job',
  specific,
  fallback,
}) {
  const window = {
    location: {
      hostname,
      href,
      search: new URL(href).search,
    },
    __smartrecruitersExtract: () => ({ ...specific }),
    __genericExtract: () => ({ ...fallback }),
    __normalizeJobUrl: (url) => url,
  };
  vm.runInNewContext(managerSource, { window, console, URLSearchParams });
  return window.__extractJobData();
}

test('extractor manager fills fields missing from a platform extractor', () => {
  const result = runManager({
    specific: {
      title: 'Platform title',
      company: '',
      description: '',
      location: '',
      country: '',
      employmentType: '',
      workplaceType: '',
      salary: '',
      url: '',
    },
    fallback: {
      title: 'Generic title',
      company: 'Example company',
      description: 'A complete job description',
      location: 'Riga, Latvia',
      country: 'Latvia',
      employmentType: 'Full-time',
      workplaceType: 'Hybrid',
      salary: 'EUR 60,000-80,000 per year',
      url: 'https://example.com/jobs/123',
    },
  });

  assert.equal(result.title, 'Platform title');
  assert.equal(result.company, 'Example company');
  assert.equal(result.description, 'A complete job description');
  assert.equal(result.location, 'Riga, Latvia');
  assert.equal(result.country, 'Latvia');
  assert.equal(result.employmentType, 'Full-time');
  assert.equal(result.workplaceType, 'Hybrid');
  assert.equal(result.salary, 'EUR 60,000-80,000 per year');
  assert.equal(result.url, 'https://example.com/jobs/123');
  assert.equal(result.source, 'smartrecruiters');
});

test('extractor manager identifies ATS source from custom-host job identifiers', () => {
  const greenhouse = runManager({
    hostname: 'www.sentinelone.com',
    href: 'https://www.sentinelone.com/jobs/?gh_jid=7731266003',
    specific: {},
    fallback: { title: 'Staff Backend Engineer', description: 'A complete job description' },
  });
  const ashby = runManager({
    hostname: 'jobs.anyoneai.com',
    href: 'https://jobs.anyoneai.com/?ashby_jid=e80c2c62-6895-41f5-bf9d-89ae5207d2bf',
    specific: {},
    fallback: { title: 'AI Engineer', description: 'A complete job description' },
  });

  assert.equal(greenhouse.source, 'greenhouse');
  assert.equal(ashby.source, 'ashby');
});

test('extractor manager does not replace non-empty platform fields', () => {
  const result = runManager({
    specific: {
      title: 'Platform title',
      company: 'Platform company',
      description: 'Platform description',
      location: 'Platform location',
      country: 'Platform country',
      employmentType: 'Platform type',
      workplaceType: 'Platform arrangement',
      salary: 'Platform salary',
      url: 'https://jobs.smartrecruiters.com/company/job',
    },
    fallback: {
      title: 'Generic title',
      company: 'Generic company',
      description: 'Generic description',
      location: 'Generic location',
      country: 'Generic country',
      employmentType: 'Generic type',
      workplaceType: 'Generic arrangement',
      salary: 'Generic salary',
      url: 'https://example.com/jobs/123',
    },
  });

  assert.equal(result.title, 'Platform title');
  assert.equal(result.company, 'Platform company');
  assert.equal(result.description, 'Platform description');
  assert.equal(result.location, 'Platform location');
  assert.equal(result.country, 'Platform country');
  assert.equal(result.employmentType, 'Platform type');
  assert.equal(result.workplaceType, 'Platform arrangement');
  assert.equal(result.salary, 'Platform salary');
  assert.equal(result.url, 'https://jobs.smartrecruiters.com/company/job');
});
