const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'job-sites.js'), 'utf8');

function load({ elements = {}, href = 'https://example.com/', jsonLd = null } = {}) {
  const document = {
    location: { href },
    querySelector: (selector) => elements[selector] || null,
  };
  const window = {
    __extractJsonLd: () => jsonLd,
    __stripHtml: (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
  vm.runInNewContext(source, { window, document, URL });
  return window;
}

const element = (text, html = text) => ({ innerText: text, textContent: text, innerHTML: html, getAttribute: () => null });

test('the company is read from job-site URLs', () => {
  const { __companyFromJobSiteUrl: company } = load();
  assert.equal(company('https://jobs.lever.co/acme-labs/5ac21346-8e0c-4494-8e7a-3eb92ff77902'), 'Acme Labs');
  assert.equal(company('https://boards.greenhouse.io/acme/jobs/7781234'), 'Acme');
  assert.equal(company('https://job-boards.greenhouse.io/acme/jobs/7781234'), 'Acme');
  assert.equal(company('https://boards.greenhouse.io/embed/job_app?for=acme&token=123'), 'Acme');
  assert.equal(company('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R12345'), 'Acme');
  assert.equal(company('https://careers-acme.icims.com/jobs/1234/engineer/job'), 'Acme');
  assert.equal(company('https://jobs.jobvite.com/acme/job/o1AbC'), 'Acme');
  assert.equal(company('https://acme.teamtailor.com/jobs/123-engineer'), 'Acme');
  assert.equal(company('https://acme.recruitee.com/o/engineer'), 'Acme');
  assert.equal(company('https://acme.bamboohr.com/careers/42'), 'Acme');
  assert.equal(company('https://acme.breezy.hr/p/abc-engineer'), 'Acme');
  assert.equal(company('https://acme.applytojob.com/apply/xyz/Engineer'), 'Acme');
  assert.equal(company('https://acme.jobs.personio.de/job/123'), 'Acme');
  assert.equal(company('https://ats.rippling.com/acme/jobs/abc'), 'Acme');
  assert.equal(company('https://wellfound.com/company/acme/jobs/123-engineer'), 'Acme');
  assert.equal(company('https://apply.workable.com/acme/j/A1B2C3/'), 'Acme');
  assert.equal(company('https://jobs.smartrecruiters.com/AcmeCorp/743999-engineer'), 'AcmeCorp');
  assert.equal(company('https://career5.successfactors.eu/career?company=acmeprod'), 'Acmeprod');
});

test('generic URLs and unknown sites give no company', () => {
  const { __companyFromJobSiteUrl: company } = load();
  assert.equal(company('https://jobs.lever.co/'), '');
  assert.equal(company('https://boards.greenhouse.io/embed/job_board'), '');
  assert.equal(company('https://acme.com/careers/123'), '');
  assert.equal(company('not a url'), '');
});

test('platform names and page labels are not companies', () => {
  const { __isJobPlatformName: isPlatform } = load();
  for (const name of ['Greenhouse', 'Lever', 'Workday', 'LinkedIn', 'Careers', 'Jobs', 'Job Board', 'Careers Site', '']) {
    assert.equal(isPlatform(name), true, name);
  }
  assert.equal(isPlatform('Lever - Careers'), true);
  assert.equal(isPlatform('Acme'), false);
  assert.equal(isPlatform('Greenhouse Software Inc'), false);
});

test('a Workday page is read from its automation elements', () => {
  const description = 'Build reliable services for millions of customers. '.repeat(3);
  const window = load({
    href: 'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R12345',
    elements: {
      '[data-automation-id="jobPostingHeader"]': element('Senior Engineer'),
      '[data-automation-id="jobPostingDescription"]': element(description, `<p>${description}</p>`),
      '[data-automation-id="locations"] dd': element('Remote, USA'),
    },
  });
  const extract = window.__jobSiteExtractorFor('acme.wd5.myworkdayjobs.com');
  const job = extract();
  assert.equal(job.title, 'Senior Engineer');
  assert.equal(job.location, 'Remote, USA');
  assert.ok(job.description.startsWith('Build reliable services'));
  assert.equal(job.source, 'workday');
  assert.equal(window.__jobSiteSourceFor('www.acme.bamboohr.com'), 'bamboohr');
  assert.equal(window.__jobSiteExtractorFor('acme.com'), null);
});

test('structured job data wins, but a platform name is not kept as the company', () => {
  const window = load({
    href: 'https://acme.teamtailor.com/jobs/1',
    jsonLd: { title: 'Designer', company: 'Teamtailor', description: 'Design things for a living. '.repeat(4) },
    elements: { '[data-controller*="job"] h1': element('Ignored title') },
  });
  const job = window.__jobSiteExtractorFor('acme.teamtailor.com')();
  assert.equal(job.title, 'Designer');
  assert.equal(job.company, '');
});
