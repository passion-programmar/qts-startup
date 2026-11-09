const assert = require('node:assert/strict');
const test = require('node:test');
const sessions = require('./site-sessions.js');

const JOB = 'https://apply.acme.com/jobs/1';

test('a site is its last two parts, or three under a country ending', () => {
  assert.equal(sessions.siteOf('nvidia.wd5.myworkdayjobs.com'), 'myworkdayjobs.com');
  assert.equal(sessions.siteOf('careers.acme.co.uk'), 'acme.co.uk');
  assert.equal(sessions.siteOf('acme.com'), 'acme.com');
  assert.equal(sessions.siteOf('127.0.0.1'), '127.0.0.1');
});

test('a site never used here, or last used for this candidate, is left alone', () => {
  assert.equal(sessions.siteStanding({}, JOB, 'ana').standing, 'none');
  const ledger = sessions.rememberSite({}, JOB, 'ana', 1000);
  const known = sessions.siteStanding(ledger, JOB, 'ana');
  assert.equal(known.standing, 'same');
  assert.deepEqual(known.origins, []);
});

test('a site last used for someone else names every address of that site to clear', () => {
  let ledger = sessions.rememberSite({}, 'https://careers.acme.com/x', 'ben', 1000);
  ledger = sessions.rememberSite(ledger, 'https://other-site.com/y', 'ben', 1000);
  const known = sessions.siteStanding(ledger, JOB, 'ana');
  assert.equal(known.standing, 'other');
  assert.deepEqual(known.origins.sort(), ['https://apply.acme.com', 'https://careers.acme.com']);
});

test('two companies on one platform count as one site: Chrome clears its cookies together', () => {
  const ledger = sessions.rememberSite({}, 'https://nvidia.wd5.myworkdayjobs.com/a', 'ben', 1000);
  assert.equal(sessions.siteStanding(ledger, 'https://intel.wd1.myworkdayjobs.com/b', 'ana').standing, 'other');
});

test('nobody is ever signed out of mail, LinkedIn, or the like', () => {
  const ledger = sessions.rememberSite({}, 'https://www.linkedin.com/jobs/1', 'ben', 1000);
  const known = sessions.siteStanding(ledger, 'https://www.linkedin.com/jobs/1', 'ana');
  assert.equal(known.standing, 'shared');
  assert.deepEqual(known.origins, []);
});

test('forgetting sites, and old records going by themselves', () => {
  const ledger = sessions.rememberSite({}, JOB, 'ana', 1000);
  assert.deepEqual(sessions.forgetSites(ledger, ['https://apply.acme.com']), {});
  const later = sessions.rememberSite(ledger, 'https://b.com/', 'ana', 1000 + 91 * 24 * 60 * 60 * 1000);
  assert.deepEqual(Object.keys(later), ['https://b.com']);
});

const ANA = { firstName: 'Ana', lastName: 'Popescu', email: 'Ana@Example.com' };

test('what the page shows decides who is signed in', () => {
  assert.equal(sessions.accountStanding({ signedIn: false, emails: ['ben@x.com'] }, ANA).standing, 'none');
  assert.equal(sessions.accountStanding({ signedIn: true, emails: ['ana@example.com'], text: '' }, ANA).standing, 'same');
  assert.deepEqual(sessions.accountStanding({ signedIn: true, emails: ['ben@x.com'], text: '' }, ANA), { standing: 'other', shown: 'ben@x.com' });
  assert.equal(sessions.accountStanding({ signedIn: true, emails: [], text: 'Hello, Ana Popescu  Sign out' }, ANA).standing, 'same');
  assert.equal(sessions.accountStanding({ signedIn: true, emails: [], text: 'Hello, Ana  Sign out' }, ANA).standing, 'unknown');
  assert.equal(sessions.accountStanding({ signedIn: true, emails: [], text: 'My account' }, ANA).standing, 'unknown');
});

test('an email already in the form tells whose account is signed in', () => {
  assert.equal(sessions.accountStanding({ signedIn: true, emails: [], text: '', formEmail: 'ben@x.com' }, ANA).standing, 'other');
  assert.equal(sessions.accountStanding({ signedIn: true, emails: [], text: '', formEmail: 'ana@example.com' }, ANA).standing, 'same');
});

test('the account the site shows outweighs the email in its form', () => {
  assert.deepEqual(sessions.accountStanding({ signedIn: true, emails: ['ben@x.com'], text: '', formEmail: 'ana@example.com' }, ANA), { standing: 'other', shown: 'ben@x.com' });
});

test('documents must be named after the candidate', () => {
  const own = ['QTS_Resume/MSK/Ana Popescu/2026_Dev_Acme/Ana Popescu.pdf', 'QTS_Resume/MSK/Ana Popescu/2026_Dev_Acme/Ana Popescu_Cover_Letter.pdf'];
  assert.equal(sessions.documentsBelong(own, ANA), true);
  assert.equal(sessions.documentsBelong(['QTS_Resume/Ana_Popescu_Resume.pdf'], ANA), true);
  assert.equal(sessions.documentsBelong(['QTS_Resume/MSK/Ben Stone/2026/Ben Stone.pdf'], ANA), false);
  // The manager's folder name is not the candidate's document.
  assert.equal(sessions.documentsBelong(['QTS_Resume/Ana Popescu/Ben/2026/Ben Stone.pdf'], ANA), false);
});

test('two candidates never hold one site at once; the same candidate may', () => {
  const holds = sessions.createSiteHolds();
  assert.equal(holds.tryHold('acme.com', 'attempt-1', 'ana'), true);
  assert.equal(holds.tryHold('acme.com', 'attempt-2', 'ana'), true);
  assert.equal(holds.tryHold('acme.com', 'attempt-3', 'ben'), false);
  holds.release('attempt-1');
  assert.equal(holds.tryHold('acme.com', 'attempt-3', 'ben'), false);
  holds.release('attempt-2');
  assert.equal(holds.tryHold('acme.com', 'attempt-3', 'ben'), true);
  assert.equal(holds.holder('acme.com'), 'ben');
});

test('a run moving to another site lets the first one go, so two runs cannot wait for each other', () => {
  const holds = sessions.createSiteHolds();
  assert.equal(holds.tryHold('one.com', 'a', 'ana'), true);
  assert.equal(holds.tryHold('two.com', 'b', 'ben'), true);
  assert.equal(holds.tryHold('two.com', 'a', 'ana'), false);
  assert.equal(holds.holder('one.com'), null);
  assert.equal(holds.tryHold('one.com', 'b', 'ben'), true);
  assert.equal(holds.holder('two.com'), null);
  assert.equal(holds.tryHold('two.com', 'a', 'ana'), true);
});
