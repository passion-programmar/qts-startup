const assert = require('node:assert/strict');
const test = require('node:test');
const detection = require('./job-page-detection.js');
const { countPageDetectionKeywordMatches } = require('./page-exclusions.js');

const keywords = ['responsibilities', 'qualifications', 'apply now', 'remote'].map((url) => ({ url }));
const evaluate = (snapshot, rules = keywords) => detection.evaluateJobPage(
  { url: 'https://example.com/article', text: '', headingMatches: 0, jobLinkCount: 0, ...snapshot },
  rules,
  countPageDetectionKeywordMatches,
);

test('Manager keyword settings cannot make unrelated pages pass', () => {
  const result = evaluate({ text: 'Responsibilities and qualifications for this role' });
  assert.equal(result.isJobPage, false);
  assert.equal(evaluate({ title: 'Backend Engineer', text: 'Responsibilities include building reliable services.' }, []).isJobPage, true);
});

test('structured JobPosting data passes even without keywords', () => {
  assert.equal(evaluate({ hasJobPostingData: true }, []).isJobPage, true);
});

test('job signals pass a page that has no Manager keywords', () => {
  const result = evaluate({
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    hasApplyControl: true,
  }, []);
  assert.equal(result.isJobPage, true);
  assert.equal(result.reason, 'score');
});

test('one strong signal plus one keyword passes', () => {
  assert.equal(evaluate({ text: 'Remote role', hasApplyControl: true }).isJobPage, true);
});

test('ordinary pages and a single weak signal are rejected', () => {
  assert.equal(evaluate({ text: 'Breaking news about remote work' }).isJobPage, false);
  assert.equal(evaluate({ url: 'https://acme.com/careers/' }, []).isJobPage, false);
});

test('closed or expired postings without a description are rejected even with keywords', () => {
  const result = evaluate({
    text: 'Responsibilities, qualifications. No longer accepting applications.',
  });
  assert.equal(result.isJobPage, false);
  assert.equal(result.reason, 'closed');
});

test('a current closed notice rejects a job even when its description remains', () => {
  assert.equal(evaluate({
    text: 'Responsibilities, qualifications. Applications are closed for the internship program.',
    hasJobPostingData: true,
  }).isJobPage, false);
  assert.equal(evaluate({
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    text: 'Applications are closed for our 2025 program.',
    headingMatches: 3,
    hasApplyControl: true,
  }).isJobPage, false);
});

test('a closed notice on a page without job signals is not a closed job', () => {
  assert.equal(evaluate({ text: 'Registration for the conference: applications are closed.' }, []).reason, 'not-job');
});

test('closed notices from real job sites are recognized', () => {
  for (const text of [
    'This job opening is no longer available.',
    'The job you are looking for is no longer open.',
    'We couldn’t find this job',
    '404: Page not found',
    'Leider können wir diese Seite nicht finden',
  ]) {
    assert.equal(evaluate({ url: 'https://jobs.example.com/jobs/123', text }, []).reason, 'closed', text);
  }
});

test('a browser check or sign-in page on a job site is reported as not loaded', () => {
  const result = evaluate({ url: 'https://acme.icims.com/jobs/6645/login', blocked: true }, []);
  assert.equal(result.isJobPage, false);
  assert.equal(result.reason, 'not-loaded');
});

test('plausible individual postings proceed without a Manager approval step', () => {
  assert.equal(evaluate({ url: 'https://talent.example.com/jobs/engineer', title: 'Engineer', specificUrl: true }, []).reason, 'plausible');
  assert.equal(evaluate({ url: 'https://jobs.lever.co/acme', jobLinkCount: 40 }, []).reason, 'not-job');
  assert.equal(evaluate({ text: 'Breaking news' }, []).reason, 'not-job');
});

test('a search page showing one selected job is marked as a list page', () => {
  const result = evaluate({ url: 'https://www.linkedin.com/jobs/search/?currentJobId=123', hasJobPostingData: true });
  assert.equal(result.isJobPage, true);
  assert.equal(result.listPage, true);
  assert.equal(evaluate({ url: 'https://jobs.lever.co/acme/123', hasJobPostingData: true }).listPage, false);
});

test('apply-form pages map to their description pages', () => {
  const cases = [
    ['https://jobs.eu.lever.co/xtb/adf8faf4-bbaa-42d9-af90-d65b18eed659/apply', 'https://jobs.eu.lever.co/xtb/adf8faf4-bbaa-42d9-af90-d65b18eed659'],
    ['https://jobs.lever.co/houzz/d8088166-0fad-44d6-befe-30aa1cccc1ea/apply?lever-source=LinkedInJobs', 'https://jobs.lever.co/houzz/d8088166-0fad-44d6-befe-30aa1cccc1ea'],
    ['https://apply.workable.com/minderacraft/j/C2FEAE1CE0/apply/', 'https://apply.workable.com/minderacraft/j/C2FEAE1CE0'],
    ['https://docusketch.peopleforce.io/careers/v/104091-aiml-engineer/a/new', 'https://docusketch.peopleforce.io/careers/v/104091-aiml-engineer'],
    ['https://career.proxify.io/apply?utm_source=linkedin', ''],
    ['https://jobs.lever.co/houzz/d8088166-0fad-44d6-befe-30aa1cccc1ea', ''],
  ];
  for (const [page, description] of cases) assert.equal(detection.descriptionUrlForApplyPage(page), description, page);
});

test('a removed posting is rejected', () => {
  const result = evaluate({ url: 'https://jobs.ashbyhq.com/pleo/56c51ea0', text: 'Job not found. The job you requested was not found.' });
  assert.equal(result.reason, 'closed');
});

test('a closed notice that the page does not show does not reject it', () => {
  const result = evaluate({
    text: 'Responsibilities, qualifications. No longer accepting applications.',
    visibleText: 'Responsibilities, qualifications.',
    hasJobPostingData: true,
  });
  assert.equal(result.isJobPage, true);
});

test('job lists are penalized, but a list with a selected job is judged on that job', () => {
  const list = { url: 'https://www.linkedin.com/jobs/search/?keywords=engineer', hasApplyControl: true, headingMatches: 2, jobLinkCount: 25 };
  assert.equal(evaluate(list, []).isJobPage, false);
  assert.equal(evaluate({ ...list, headingMatches: 0 }, []).isJobPage, false);
  assert.equal(evaluate({ ...list, headingMatches: 0, url: `${list.url}&currentJobId=4012345678` }, []).isJobPage, true);
});

test('an embedded job board frame counts as a job signal', () => {
  const embeddingPage = { url: 'https://acme.com/careers?gh_jid=7781234', hasJobBoardFrame: true };
  assert.equal(evaluate(embeddingPage, []).isJobPage, true);
  assert.equal(evaluate({ url: 'https://acme.com/about', hasJobBoardFrame: true }, []).isJobPage, false);
});

test('built-in vocabulary is grouped and ships without remote settings', () => {
  const size=Object.values(detection.KEYWORDS).flat().length;
  assert.ok(size>=60 && size<=110, String(size));
  assert.equal(detection.keywordGroups('Responsibilities responsibilities responsibilities').responsibilities,true);
});
const labeled = [
  ['custom no structured data',true,{title:'Backend Engineer',text:'Responsibilities include developing services.'}],
  ['custom no Apply control',true,{title:'Finance Analyst',text:'Requirements include accounting experience.'}],
  ['unusual headings',true,{title:'Platform Engineer',text:'You will build deployment tooling and improve our systems.'}],
  ['healthcare',true,{title:'Clinical Nurse',text:'Your work includes caring for patients and coordinating treatment.'}],
  ['manufacturing',true,{title:'Machine Operator',text:'We seek operators for the production line.'}],
  ['retail',true,{title:'Store Associate',text:'Join us to support customers and manage inventory.'}],
  ['hospitality',true,{title:'Commis Chef',text:'What you bring: kitchen experience and food safety training.'}],
  ['legal',true,{title:'Legal Counsel',text:'Required qualifications include professional registration.'}],
  ['remote unknown ATS',true,{title:'Data Engineer',specificUrl:true,url:'https://acme.test/jobs/data-engineer',text:'Remote'}],
  ['Greenhouse',true,{url:'https://boards.greenhouse.io/acme/jobs/123',hasApplyControl:true}],
  ['Lever',true,{url:'https://jobs.lever.co/acme/123',hasApplyControl:true}],
  ['Workday',true,{url:'https://acme.myworkdayjobs.com/job/req123',hasApplyControl:true}],
  ['Indeed',true,{url:'https://indeed.com/viewjob?jk=12345678',hasApplyControl:true}],
  ['LinkedIn selected job',true,{url:'https://linkedin.com/jobs/search/?currentJobId=123',hasJobDetailPane:true,hasApplyControl:true}],
  ['current structured metadata',true,{hasJobPostingData:true}],
  ['plain job overview',true,{title:'Security Analyst',text:'Position overview: investigate security events.'}],
  ['qualifications only',true,{title:'Research Fellow',text:'Qualifications: relevant doctorate.'}],
  ['specific plausible role',true,{title:'Systems Architect',specificUrl:true,url:'https://acme.test/jobs/architect'}],
  ['article',false,{title:'Remote Work News',articlePage:true,text:'Responsibilities and qualifications for remote work.'}],
  ['career advice',false,{title:'How to write a resume',text:'Your role and responsibilities, requirements and qualifications.'}],
  ['career homepage',false,{title:'Careers',text:'Join our team. Responsibilities and requirements. Full-time opportunities.'}],
  ['job list',false,{title:'Open positions',jobLinkCount:20,structuredCount:4,hasApplyControl:true}],
  ['unrelated',false,{title:'Mountain photography',text:'Explore our latest pictures.'}],
  ['closed primary posting',false,{title:'Engineer',text:'This job has expired.',hasJobPostingData:true}],
  ['metadata expiry',false,{title:'Engineer',postingExpired:true,hasJobPostingData:true}],
  ['browser challenge',false,{blocked:true,url:'https://acme.test/jobs/engineer'}],
  ['loading shell',false,{title:'Loading...',specificUrl:true,url:'https://acme.test/jobs/engineer'}],
];
for(const [label,expected,snapshot] of labeled) test('labeled detector fixture: '+label,()=>assert.equal(evaluate(snapshot,[]).isJobPage,expected));
