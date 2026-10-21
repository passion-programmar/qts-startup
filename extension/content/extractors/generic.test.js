const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const genericSource = fs.readFileSync(
  path.join(__dirname, 'generic.js'),
  'utf8',
);

test('generic extractor finds JobPosting in nested JSON-LD graphs', () => {
  const jobPosting = {
    '@type': 'https://schema.org/JobPosting',
    title: 'Senior Software Engineer - Platform',
    hiringOrganization: { name: 'Example Company' },
    description: '<p>Build reliable software.</p>',
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Riga',
        addressCountry: { name: 'Latvia' },
      },
    },
    url: 'https://example.com/jobs/123',
  };
  const document = {
    querySelectorAll() {
      return [{ textContent: JSON.stringify({ '@graph': [{ '@graph': [jobPosting] }] }) }];
    },
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll() {
          return [];
        },
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__extractJsonLd();
  assert.equal(result.title, 'Senior Software Engineer - Platform');
  assert.equal(result.company, 'Example Company');
  assert.equal(result.description, 'Build reliable software.');
  assert.equal(result.location, 'Riga, Latvia');
  assert.equal(result.url, 'https://example.com/jobs/123');
});

test('generic extractor reads country, work arrangement, employment type, and salary from JobPosting data', () => {
  const jobPosting = {
    '@type': 'JobPosting',
    title: 'Applied AI Engineer',
    hiringOrganization: { name: 'Example Company' },
    description: '<p>Build AI systems.</p>',
    jobLocation: {
      address: {
        addressLocality: 'Riga',
        addressCountry: { name: 'LV' },
      },
    },
    jobLocationType: 'TELECOMMUTE',
    employmentType: ['FULL_TIME', 'CONTRACTOR'],
    baseSalary: {
      currency: 'EUR',
      value: { minValue: 60000, maxValue: 80000, unitText: 'YEAR' },
    },
    url: 'https://example.com/jobs/ai-engineer',
  };
  const document = {
    querySelectorAll: () => [{ textContent: JSON.stringify(jobPosting) }],
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__extractJsonLd();
  assert.equal(result.country, 'Latvia');
  assert.equal(result.workplaceType, 'Remote');
  assert.equal(result.employmentType, 'Full-time, Contract');
  assert.equal(result.salary, 'EUR 60,000-80,000 per year');
});

test('generic extractor combines countries from structured multi-location postings', () => {
  const jobPosting = {
    '@type': 'JobPosting',
    title: 'Infrastructure Engineer',
    description: '<p>Build reliable infrastructure.</p>',
    jobLocation: [
      { address: { addressCountry: { name: 'NL' } } },
      { address: { addressCountry: { name: 'PL' } } },
      { address: { addressCountry: { name: 'NL' } } },
    ],
    jobLocationType: 'Remote within EMEA',
  };
  const document = {
    location: { href: 'https://example.com/jobs/infrastructure-engineer' },
    querySelectorAll: () => [{ textContent: JSON.stringify(jobPosting) }],
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__extractJsonLd();
  assert.equal(result.country, 'Netherlands; Poland');
  assert.equal(result.workplaceType, 'Remote');
});

test('generic extractor reads role type and nearby salary while ignoring Remote as a country', () => {
  const jobPosting = {
    '@type': 'JobPosting',
    title: 'Senior Software Engineer',
    description: '<p>Evaluate AI-generated code and provide technical feedback.</p>',
    jobLocation: { address: { addressCountry: 'Remote' } },
    jobLocationType: 'TELECOMMUTE',
  };
  const titleElement = {
    tagName: 'H1',
    innerText: 'Senior Software Engineer',
    textContent: 'Senior Software Engineer',
  };
  const salaryElement = {
    innerText: '$245 - $280/hour pay',
    textContent: '$245 - $280/hour pay',
  };
  titleElement.parentElement = { children: [titleElement, salaryElement] };
  const facts = [{
    innerText: 'Role Type',
    textContent: 'Role Type',
    nextElementSibling: {
      tagName: 'DD',
      innerText: 'Contractor',
      textContent: 'Contractor',
    },
  }];
  const document = {
    title: 'Senior Software Engineer | micro1',
    location: { href: 'https://jobs.micro1.ai/post/example' },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') {
        return [{ textContent: JSON.stringify(jobPosting) }];
      }
      if (selector === 'dt, [role="term"], [aria-label], label, strong, b, span') return facts;
      if (selector === 'h1') return [titleElement];
      return [];
    },
    querySelector(selector) {
      if (selector === 'h1') return titleElement;
      return null;
    },
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.country, '');
  assert.equal(result.employmentType, 'Contract');
  assert.equal(result.workplaceType, 'Remote');
  assert.equal(result.salary, '$245 - $280/hour pay');
});

test('generic extractor reads label and value pairs from semantic spans', () => {
  const labels = [
    ['Locations:', 'Poland, United Kingdom, Italy'],
    ['Salary range:', '$50,000 - $100,000 USD'],
    ['Work arrangement', 'Remote within Europe'],
  ].map(([label, value]) => {
    const valueElement = {
      tagName: 'SPAN',
      innerText: value,
      textContent: value,
    };
    return {
      tagName: 'SPAN',
      innerText: label,
      textContent: label,
      nextElementSibling: valueElement,
      parentElement: {
        innerText: `${label} ${value}`,
        textContent: `${label} ${value}`,
      },
    };
  });
  const titleElement = {
    tagName: 'H1',
    innerText: 'DevOps Engineer',
    textContent: 'DevOps Engineer',
    nextElementSibling: {
      innerText: 'Full-time · Remote within Europe',
      textContent: 'Full-time · Remote within Europe',
    },
  };
  const description = 'Build resilient cloud systems. '.repeat(6);
  const descriptionElement = { innerHTML: `<p>${description}</p>`, textContent: description };
  const document = {
    title: 'DevOps Engineer | Example Company',
    location: { href: 'https://example.com/jobs/devops-engineer' },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return [];
      if (selector === 'dt, [role="term"], [aria-label], label, strong, b, span') return labels;
      if (selector === 'h1, h2') return [titleElement];
      return [];
    },
    querySelector(selector) {
      if (selector === 'h1') return titleElement;
      if (selector === '[itemprop="description"]') return descriptionElement;
      return null;
    },
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.employmentType, 'Full-time');
  assert.equal(result.location, 'Poland, United Kingdom, Italy');
  assert.equal(result.workplaceType, 'Remote');
  assert.equal(result.salary, '$50,000 - $100,000 USD');
});

test('generic extractor reads labeled job facts when structured data is unavailable', () => {
  const description = 'Build analytics systems and partner with product teams. '.repeat(3);
  let facts = [
    ['Country', 'United States'],
    ['Employment type', 'Full-time'],
    ['Work arrangement', 'Hybrid'],
    ['Salary range', '$120,000-$150,000 per year'],
  ].map(([label, value]) => ({
    innerText: label,
    textContent: label,
    nextElementSibling: {
      tagName: 'DD',
      innerText: value,
      textContent: value,
    },
  }));
  const titleElement = {
    tagName: 'H1',
    innerText: 'Senior Data Scientist',
    textContent: 'Senior Data Scientist',
  };
  const descriptionElement = {
    innerHTML: `<p>${description}</p>`,
    textContent: description,
  };
  const document = {
    title: 'Senior Data Scientist | Example Company',
    location: { href: 'https://example.com/jobs/data-scientist' },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return [];
      if (selector === 'dt, [role="term"], [aria-label], label, strong, b, span') return facts;
      return [];
    },
    querySelector(selector) {
      if (selector === 'h1') return titleElement;
      if (selector === '[itemprop="description"]') return descriptionElement;
      if (selector === 'link[rel="canonical"]') {
        return { getAttribute: () => 'https://example.com/jobs/data-scientist' };
      }
      return null;
    },
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, 'Senior Data Scientist');
  assert.equal(result.company, 'Example Company');
  assert.equal(result.description, description);
  assert.equal(result.country, 'United States');
  assert.equal(result.employmentType, 'Full-time');
  assert.equal(result.workplaceType, 'Hybrid');
  assert.equal(result.salary, '$120,000-$150,000 per year');

  facts = [{
    innerText: 'Work modality',
    textContent: 'Work modality',
    nextElementSibling: {
      tagName: 'DD',
      innerText: 'Remote',
      textContent: 'Remote',
    },
  }];
  assert.equal(window.__genericExtract().workplaceType, 'Remote');
});

test('generic extractor prefers a complete page description over a short structured summary', () => {
  const structuredDescription = 'A short job summary.';
  const pageDescription = 'Detailed responsibilities and requirements. '.repeat(12);
  const jobPosting = {
    '@type': 'JobPosting',
    title: 'Staff Backend Engineer',
    description: structuredDescription,
  };
  const descriptionElement = {
    innerHTML: `<p>${pageDescription}</p>`,
    textContent: pageDescription,
  };
  const titleElement = {
    tagName: 'H1',
    innerText: 'Staff Backend Engineer',
    textContent: 'Staff Backend Engineer',
  };
  const document = {
    title: 'Staff Backend Engineer | Example Company',
    location: { href: 'https://example.com/jobs/staff-backend-engineer' },
    querySelectorAll(selector) {
      return selector === 'script[type="application/ld+json"]'
        ? [{ textContent: JSON.stringify(jobPosting) }]
        : [];
    },
    querySelector(selector) {
      if (selector === 'h1') return titleElement;
      if (selector === '[class*="job-content"]') return descriptionElement;
      return null;
    },
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.description, pageDescription);
});

test('generic extractor decodes HTML-escaped JobPosting descriptions into readable text', () => {
  const encodedDescription = '&lt;p&gt;&lt;strong&gt;About the role:&lt;/strong&gt;&lt;/p&gt;'
    + '&lt;p&gt;We&amp;#39;re looking for a &lt;strong&gt;Staff Data Scientist&lt;/strong&gt;'
    + ' to lead production machine learning systems.&lt;/p&gt;'
    + '&lt;ul&gt;&lt;li&gt;&lt;p&gt;Build recommendation models.&lt;/p&gt;&lt;/li&gt;&lt;/ul&gt;';
  const jobPosting = {
    '@type': 'JobPosting',
    title: 'Staff Data Scientist',
    hiringOrganization: { name: 'FYUL' },
    description: encodedDescription,
    url: 'https://careers.example/jobs/staff-data-scientist',
  };
  const document = {
    querySelectorAll: () => [{
      textContent: JSON.stringify(jobPosting),
    }],
    createElement(tagName) {
      if (tagName === 'textarea') {
        return {
          set innerHTML(value) {
            this.value = value
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, '&');
          },
          value: '',
        };
      }
      return {
        set innerHTML(value) {
          this.innerText = value
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__extractJsonLd();
  assert.equal(result.title, 'Staff Data Scientist');
  assert.equal(result.company, 'FYUL');
  assert.match(result.description, /About the role:/);
  assert.match(result.description, /We're looking for a Staff Data Scientist/);
  assert.match(result.description, /Build recommendation models\./);
  assert.doesNotMatch(result.description, /<\/?p>|<\/?strong>|<\/?ul>|<\/?li>/);
});

test('generic extractor reads job details from semantic metadata without site classes', () => {
  const description = 'Build agentic workflows and production AI systems. '.repeat(8);
  const elements = new Map([
    ['h1', { textContent: 'Senior AI Engineer - Agentic Workflows' }],
    ['[itemprop="hiringOrganization"]', {
      getAttribute: (name) => (name === 'content' ? 'Zurich Insurance Company Ltd.' : null),
    }],
    ['[itemprop="description"]', {
      innerHTML: `<p>${description}</p>`,
    }],
    ['[itemprop="addressCountry"]', { textContent: 'Poland' }],
    ['[itemprop="employmentType"]', { textContent: 'Full time' }],
    ['[itemprop="jobLocationType"]', { textContent: 'Remote within EMEA' }],
    ['link[rel="canonical"]', {
      getAttribute: () => 'https://www.careers.zurich.com/job/1361067157/',
    }],
  ]);
  const document = {
    title: 'Senior AI Engineer - Agentic Workflows Job Details | Zurich Insurance Company Ltd.',
    location: { href: 'https://www.careers.zurich.com/job/1361067157/?source=jobs' },
    querySelectorAll: () => [],
    querySelector: (selector) => elements.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, 'Senior AI Engineer - Agentic Workflows');
  assert.equal(result.company, 'Zurich Insurance Company Ltd.');
  assert.match(result.description, /Build agentic workflows/);
  assert.equal(result.country, 'Poland');
  assert.equal(result.employmentType, 'Full-time');
  assert.equal(result.workplaceType, 'Remote');
  assert.equal(result.url, 'https://www.careers.zurich.com/job/1361067157/');
});

test('generic extractor prefers the semantic job heading over a jobTitle wrapper with Apply text', () => {
  const elements = new Map([
    ['[class*="jobTitle"]', { innerText: 'Apply now »' }],
    ['h1', { innerText: 'Senior AI Engineer - Agentic Workflows' }],
    ['[itemprop="title"]', null],
    ['link[rel="canonical"]', {
      getAttribute: () => 'https://www.careers.zurich.com/job/1361067157/',
    }],
  ]);
  const document = {
    title: 'Senior AI Engineer - Agentic Workflows Job Details | Zurich Insurance Company Ltd.',
    location: { href: 'https://www.careers.zurich.com/job/1361067157/' },
    querySelectorAll: () => [],
    querySelector: (selector) => elements.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, 'Senior AI Engineer - Agentic Workflows');
  assert.notEqual(result.title, 'Apply now »');
});

test('generic extractor ignores a generic page heading and separates job details from its wrapper', () => {
  const descriptionText = `The GWDG is seeking a Generative AI Developer. ${'Build AI services and support scientific computing. '.repeat(16)}`;
  const description = { innerHTML: descriptionText, innerText: descriptionText };
  const wrapperText = `About the Job Everything you need before applying. Generative AI Developer (m/f/d) GWDG ${descriptionText}`;
  const wrapper = { innerHTML: wrapperText, innerText: wrapperText };
  const companyText = 'Gesellschaft für wissenschaftliche Datenverarbeitung mbH Göttingen';
  const companyIcon = {
    getAttribute: (name) => (name === 'alt' ? 'company' : null),
    parentElement: { innerText: companyText },
  };
  const elements = new Map([
    ['h1', { innerText: 'About the Job', textContent: 'About the Job' }],
    ['h2', { innerText: 'Generative AI Developer (m/f/d)', textContent: 'Generative AI Developer (m/f/d)' }],
    ['img[alt="company" i]', companyIcon],
    ['[class*="jobDescription"]', wrapper],
    ['link[rel="canonical"]', {
      getAttribute: () => 'https://www.fetchjobs.co/job-description-deg/3193064669',
    }],
  ]);
  const document = {
    title: 'Job Description – FetchJobs',
    location: { href: 'https://www.fetchjobs.co/job-description-deg/3193064669?src=LinkedIn' },
    querySelectorAll: (selector) => {
      if (selector === 'h1, h2, h3, h4') return [elements.get('h1'), elements.get('h2')];
      if (selector === '[class*="jobDescription"]') return [wrapper, description];
      return [];
    },
    querySelector: (selector) => elements.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, 'Generative AI Developer (m/f/d)');
  assert.equal(result.company, companyText);
  assert.match(result.description, /^The GWDG is seeking/);
  assert.doesNotMatch(result.description, /About the Job|Everything you need before applying/);
  assert.equal(result.url, 'https://www.fetchjobs.co/job-description-deg/3193064669');
});

test('generic extractor reads values paired with semantic field headings', () => {
  const jobTitle = { innerText: 'Security Data Scientist', textContent: 'Security Data Scientist', innerHTML: 'Security Data Scientist' };
  const employer = { innerText: 'Vbeyond', textContent: 'Vbeyond', innerHTML: 'Vbeyond' };
  const descriptionText = `We are seeking an experienced security data scientist. ${'Develop analytical methods for cyber security problems. '.repeat(12)}`;
  const description = { innerText: descriptionText, textContent: descriptionText, innerHTML: descriptionText };
  const headings = [
    { innerText: 'Job Overview', textContent: 'Job Overview', nextElementSibling: null },
    { innerText: 'Title:', textContent: 'Title:', nextElementSibling: jobTitle },
    { innerText: 'Description:', textContent: 'Description:', nextElementSibling: description },
    { innerText: 'Company:', textContent: 'Company:', nextElementSibling: employer },
    { innerText: 'Location:', textContent: 'Location:', nextElementSibling: { innerHTML: 'Not Specified, London' } },
  ];
  const canonicalUrl = {
    getAttribute: () => 'https://www.bestjobtool.com/job-description-uk/3191064124',
  };
  const document = {
    title: 'Job Description | United Kingdom | Best Job Tool',
    location: { href: 'https://www.bestjobtool.com/job-description-uk/3191064124?src=LinkedIn' },
    querySelectorAll: (selector) => (
      selector === 'h1, h2, h3, h4, [role="heading"]' ? headings : []
    ),
    querySelector: (selector) => (
      selector === 'link[rel="canonical"]' ? canonicalUrl : null
    ),
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, 'Security Data Scientist');
  assert.equal(result.company, 'Vbeyond');
  assert.match(result.description, /^We are seeking an experienced/);
  assert.equal(result.url, 'https://www.bestjobtool.com/job-description-uk/3191064124');
});

test('generic extractor reads location from a labeled definition list without confusing remote status', () => {
  const locationDefinition = {
    tagName: 'DD',
    innerText: 'Latvia',
    textContent: 'Latvia',
    innerHTML: 'Latvia',
  };
  const terms = [
    { innerText: 'Department', textContent: 'Department', nextElementSibling: { tagName: 'DD', innerText: 'Product' } },
    { innerText: 'Location', textContent: 'Location', nextElementSibling: locationDefinition },
    { innerText: 'Remote status', textContent: 'Remote status', nextElementSibling: { tagName: 'DD', innerText: 'Fully Remote' } },
  ];
  const elements = new Map([
    ['h1', { innerText: 'Staff Data Scientist', textContent: 'Staff Data Scientist' }],
    ['[itemprop="hiringOrganization"] [itemprop="name"]', null],
    ['[itemprop="hiringOrganization"]', null],
    ['[data-testid*="company"]', null],
    ['[class*="company-name"]', null],
    ['[class*="companyName"]', null],
    ['[id*="company"]', null],
    ['[class*="employer"]', null],
    ['[data-company]', null],
  ]);
  const document = {
    title: 'Staff Data Scientist - Example Company',
    location: { href: 'https://example.com/jobs/staff-data-scientist' },
    querySelectorAll: (selector) => {
      if (selector === 'dt') return terms;
      return [];
    },
    querySelector: (selector) => elements.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.location, 'Latvia');
  assert.notEqual(result.location, 'Fully Remote');
});

test('generic extractor uses role headings and page-title branding instead of corporate metadata', () => {
  const introText = 'AI Consultant to help enterprises identify, design, and launch high-value AI agents. '
    + 'The role is based in Munich, Germany.';
  const responsibilitiesText = `Collaborate with customers to develop AI adoption roadmaps. ${'Design AI agent solutions and workflows. '.repeat(4)}`;
  const roleIntro = {
    tagName: 'P',
    innerText: introText,
    textContent: introText,
    innerHTML: introText,
  };
  const responsibilities = {
    tagName: 'UL',
    innerText: responsibilitiesText,
    textContent: responsibilitiesText,
    innerHTML: responsibilitiesText,
  };
  const applyHeading = {
    tagName: 'H3',
    innerText: 'Apply now',
    textContent: 'Apply now',
  };
  const headings = [
    {
      tagName: 'H1',
      innerText: 'AI Consultant',
      textContent: 'AI Consultant',
    },
    {
      tagName: 'H3',
      innerText: "Who we're looking for:",
      textContent: "Who we're looking for:",
      nextElementSibling: roleIntro,
    },
    {
      tagName: 'H3',
      innerText: 'Key Responsibilities:',
      textContent: 'Key Responsibilities:',
      nextElementSibling: responsibilities,
    },
    applyHeading,
  ];
  roleIntro.nextElementSibling = headings[2];
  responsibilities.nextElementSibling = applyHeading;
  const elements = new Map([
    ['h1', headings[0]],
    ['meta[name="description"],meta[property="description"]', {
      getAttribute: () => 'Creatio is an AI CRM and workflow platform.',
    }],
    ['link[rel="canonical"]', {
      getAttribute: () => 'https://www.creatio.example/company/careers/ai-consultant',
    }],
  ]);
  const document = {
    title: 'AI Consultant | Creatio',
    location: { href: 'https://www.creatio.example/company/careers/ai-consultant' },
    querySelectorAll: (selector) => {
      if (selector === 'h1, h2, h3, h4, [role="heading"]') return headings;
      if (selector === 'p, li') return [roleIntro];
      return [];
    },
    querySelector: (selector) => elements.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, 'AI Consultant');
  assert.equal(result.company, 'Creatio');
  assert.match(result.description, /AI Consultant to help enterprises/);
  assert.match(result.description, /Key Responsibilities/);
  assert.match(result.description, /Collaborate with customers/);
  assert.doesNotMatch(result.description, /AI CRM and workflow platform/);
  assert.equal(result.location, 'Munich, Germany');
});

test('generic extractor reads rich-text job content and reversed employer-title branding', () => {
  const description = `The fastest-growing European SaaS company is searching for an AI/ML Engineer. `
    + `${'Research and deploy machine-learning models for computer-vision use cases. '.repeat(4)}`
    + 'The position will be remote in any location of choice in Europe (outside Russia, Belarus, and Ukraine).';
  const richText = {
    innerHTML: `<p>${description}</p>`,
    innerText: description,
    textContent: description,
  };
  const heading = {
    innerText: 'AI/ML Engineer',
    textContent: 'AI/ML Engineer',
    nextElementSibling: {
      innerText: 'Remote',
      textContent: 'Remote',
    },
  };
  const elements = new Map([
    ['h1', heading],
    ['meta[name="description"],meta[property="description"]', {
      getAttribute: () => 'A shortened social preview of this vacancy.',
    }],
  ]);
  const document = {
    title: 'docusketch - AI/ML Engineer',
    location: { href: 'https://docusketch.peopleforce.example/careers/v/104091-aiml-engineer' },
    querySelectorAll: (selector) => {
      if (selector === 'h1') return [heading];
      if (selector === 'h1, h2, h3, h4, [role="heading"]') return [heading];
      if (selector === 'p, li') {
        return [{
          innerText: description,
          textContent: description,
        }];
      }
      if (selector === 'article' || selector === 'main' || selector === 'section' || selector === 'div') {
        return [richText];
      }
      return [];
    },
    querySelector: (selector) => elements.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, 'AI/ML Engineer');
  assert.equal(result.company, 'docusketch');
  assert.match(result.description, /fastest-growing European SaaS company/);
  assert.match(result.description, /computer-vision use cases/);
  assert.doesNotMatch(result.description, /shortened social preview/);
  assert.equal(
    result.location,
    'remote in any location of choice in Europe (outside Russia, Belarus, and Ukraine)',
  );
});

test('generic extractor prefers title-matched employer branding and limits role text before company sections', () => {
  const overview = 'We are looking for a Lead Solutions Architect focused on Generative AI. '
    + 'This is a customer-facing role working across the EMEA region.';
  const responsibilities = `Build hands-on GenAI proofs of concept. ${'Lead technical customer engagements. '.repeat(4)}`;
  const qualifications = `Strong understanding of LLM systems. ${'Experience with production machine learning. '.repeat(3)}`;
  const corporateCopy = 'Databricks is the Data and AI company serving organizations worldwide. '
    + 'This corporate overview must not be part of the role description.';
  const makeElement = (tagName, text) => ({
    tagName,
    innerText: text,
    textContent: text,
    innerHTML: text,
  });
  const h1 = makeElement('H1', 'Lead Solutions Architect - Generative AI (EMEA Emerging DNB)');
  const location = makeElement('DIV', 'Remote - Germany');
  const about = makeElement('H2', 'About the Role');
  const overviewElement = makeElement('P', overview);
  const whatDo = makeElement('H2', "What You'll Do");
  const responsibilitiesElement = makeElement('UL', responsibilities);
  const lookingFor = makeElement('H2', "What We're Looking For");
  const qualificationsElement = makeElement('UL', qualifications);
  const aboutCompany = makeElement('H2', 'About Databricks');
  const corporateElement = makeElement('P', corporateCopy);
  h1.nextElementSibling = location;
  about.nextElementSibling = overviewElement;
  overviewElement.nextElementSibling = whatDo;
  whatDo.nextElementSibling = responsibilitiesElement;
  responsibilitiesElement.nextElementSibling = lookingFor;
  lookingFor.nextElementSibling = qualificationsElement;
  qualificationsElement.nextElementSibling = aboutCompany;
  aboutCompany.nextElementSibling = corporateElement;

  const selectors = new Map([
    ['h1', h1],
    ['[itemprop="hiringOrganization"] [itemprop="name"]', null],
    ['[itemprop="hiringOrganization"]', null],
    ['[data-testid*="company"]', makeElement('DIV', 'Who We Are Our Team Databricks Ventures Contact Us')],
    ['[class*="company-name"]', null],
    ['[class*="companyName"]', null],
    ['[id*="company"]', null],
    ['[class*="employer"]', null],
    ['[data-company]', null],
    ['link[rel="canonical"]', {
      getAttribute: () => 'https://www.databricks.example/company/careers/lead-solutions-architect',
    }],
  ]);
  const headings = [h1, about, whatDo, lookingFor, aboutCompany];
  const document = {
    title: `${h1.innerText} - Databricks`,
    location: { href: 'https://www.databricks.example/company/careers/lead-solutions-architect' },
    querySelectorAll: (selector) => {
      if (selector === 'h1, h2, h3, h4, [role="heading"]') return headings;
      if (selector === 'h1') return [h1];
      if (selector === 'p, li') return [overviewElement, corporateElement];
      return [];
    },
    querySelector: (selector) => selectors.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(result.title, h1.innerText);
  assert.equal(result.company, 'Databricks');
  assert.equal(result.location, 'Remote - Germany');
  assert.match(result.description, /Lead Solutions Architect focused on Generative AI/);
  assert.match(result.description, /Build hands-on GenAI proofs of concept/);
  assert.match(result.description, /Strong understanding of LLM systems/);
  assert.doesNotMatch(result.description, /Who We Are Our Team|corporate overview/);
});

test('generic extractor prefers explicitly labeled job location over nearby remote controls', () => {
  const title = {
    tagName: 'H1',
    innerText: 'Lead Solutions Architect',
    textContent: 'Lead Solutions Architect',
    nextElementSibling: {
      innerText: 'Remote - Germany Apply now',
      textContent: 'Remote - Germany Apply now',
      cloneNode() {
        return {
          innerText: 'Remote - Germany',
          textContent: 'Remote - Germany',
          querySelectorAll: () => [],
        };
      },
    },
  };
  const labeledLocation = {
    tagName: 'P',
    innerText: 'Location: Germany (Remote/Hybrid) - will require travel across Europe',
    textContent: 'Location: Germany (Remote/Hybrid) - will require travel across Europe',
    cloneNode() {
      return {
        innerText: this.innerText,
        textContent: this.textContent,
        querySelectorAll: () => [],
      };
    },
  };
  const elements = new Map([
    ['h1', title],
    ['link[rel="canonical"]', {
      getAttribute: () => 'https://example.test/jobs/lead-architect',
    }],
  ]);
  const document = {
    title: 'Lead Solutions Architect - Example',
    location: { href: 'https://example.test/jobs/lead-architect' },
    querySelectorAll: (selector) => {
      if (selector === 'h1') return [title];
      if (selector === 'p, li, [role="term"], [aria-label]') return [labeledLocation];
      return [];
    },
    querySelector: (selector) => elements.get(selector) || null,
    createElement() {
      return {
        set innerHTML(value) {
          this.innerText = value.replace(/<[^>]*>/g, '');
        },
        innerText: '',
        querySelectorAll: () => [],
      };
    },
  };
  const window = {};
  vm.runInNewContext(genericSource, { document, window, URL });

  const result = window.__genericExtract();
  assert.equal(
    result.location,
    'Germany (Remote/Hybrid) - will require travel across Europe',
  );
});
