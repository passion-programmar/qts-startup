/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extractorSource = fs.readFileSync(
  path.join(__dirname, 'ats.js'),
  'utf8',
);

function createElement({ text = '', alt = '', html = text } = {}) {
  return {
    innerText: text,
    textContent: text,
    innerHTML: html,
    getAttribute(name) {
      return name === 'alt' ? alt : null;
    },
  };
}

function runSmartRecruitersExtractor({
  structured = null,
  descriptionMode = 'selector',
} = {}) {
  const fullDescription = 'A detailed description of the role. '.repeat(12);
  const shortDescription = 'Employees work in a hybrid mode';
  const titleElement = createElement({ text: 'Senior Applied AI Engineer' });
  const descriptionElement = createElement({ html: fullDescription });
  const semanticSection = {
    querySelector() {
      return descriptionElement;
    },
  };
  const semanticHeading = {
    innerText: 'Job Description',
    closest() {
      return semanticSection;
    },
  };
  const main = {
    querySelector(selector) {
      if (selector === '.job-title') return titleElement;
      if (descriptionMode === 'selector' && selector === '#st-jobDescription .wysiwyg') {
        return descriptionElement;
      }
      if (descriptionMode === 'selector' && selector === '#st-jobDescription') {
        return createElement({ html: `Job Description ${fullDescription}` });
      }
      if (selector.includes('description')) {
        return createElement({ text: shortDescription });
      }
      return null;
    },
    querySelectorAll() {
      return descriptionMode === 'heading' ? [semanticHeading] : [];
    },
  };
  const document = {
    title: 'Renesas Electronics Senior Applied AI Engineer | SmartRecruiters',
    location: {
      href: 'https://jobs.smartrecruiters.com/company/job-title',
    },
    querySelector(selector) {
      if (selector === 'main, [role="main"]') return main;
      if (selector === 'header img[alt]') {
        return createElement({ alt: 'Renesas Electronics logo' });
      }
      return null;
    },
  };
  const window = {
    __extractJsonLd: () => structured,
    __stripHtml: (html) => String(html).replace(/<[^>]*>/g, '').trim(),
  };
  vm.runInNewContext(extractorSource, { document, window });
  return window.__smartrecruitersExtract();
}

test('SmartRecruiters extraction reads title, logo company, and the full job description', () => {
  const result = runSmartRecruitersExtractor();

  assert.equal(result.title, 'Senior Applied AI Engineer');
  assert.equal(result.company, 'Renesas Electronics');
  assert.match(result.description, /A detailed description of the role/);
  assert.doesNotMatch(result.description, /^Employees work in a hybrid mode$/);
  assert.equal(result.url, 'https://jobs.smartrecruiters.com/company/job-title');
  assert.equal(result.source, 'smartrecruiters');
});

test('SmartRecruiters fills missing structured fields from the page', () => {
  const result = runSmartRecruitersExtractor({
    structured: {
      title: 'Structured job title',
      company: '',
      description: '',
      url: '',
    },
  });

  assert.equal(result.title, 'Structured job title');
  assert.equal(result.company, 'Renesas Electronics');
  assert.match(result.description, /A detailed description of the role/);
  assert.equal(result.url, 'https://jobs.smartrecruiters.com/company/job-title');
});

test('SmartRecruiters finds the description by its heading on alternate layouts', () => {
  const result = runSmartRecruitersExtractor({ descriptionMode: 'heading' });

  assert.match(result.description, /A detailed description of the role/);
  assert.doesNotMatch(result.description, /^Employees work in a hybrid mode$/);
});
