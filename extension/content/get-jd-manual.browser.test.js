const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
test('manual review selects categories and individuals, displays filled Labels and saves edited fields', { skip: !CHROME, timeout: 60000 }, async () => {
 const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
 try {
  const page = await browser.newPage(); await page.setContent('<h1>Job</h1>');
  await page.evaluate(() => {
   const attach = Element.prototype.attachShadow;
   Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.testRoot = root; return root; };
   window.launcherOpen = false;
   window.__qtsPageLauncher = {
    setOpen: value => { window.launcherOpen = value; },
    syncModeActions: async () => {},
    click: () => { window.__qtsPageLauncher.setOpen(false); window.__qtsGetJdReview.openReview(); },
   };
   window.calls = [];
   window.chrome = { runtime: { id: 'test', getURL: p => p, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async m => {
    window.calls.push(m);
    if (m.type === 'SAVE_GET_JD_SELECTION') {
     return { ok: true, result: {
      ...window.result,
      status: 'saved',
      classification: { ...window.result.classification, job: { ...window.result.classification.job, ...m.manualJob } },
      jobDescription: m.manualJob.description,
      evaluationMode: 'manual',
      closeAfterSeconds: 2,
      saveResponse: { savedCount: 1, results: [{ profileId: 'a', status: 'saved', message: 'Job added.' }] },
      profiles: window.result.profiles.map(profile => profile.id === 'a' ? { ...profile, state: 'has_job' } : profile),
     } };
    }
    return { ok: true, selectedProfileIds: m.profileIds };
   } }, storage: { local: { get: async () => ({ authExpiresAt: Date.now() + 60000, qtsGetJdOn: true }) }, onChanged: { addListener() {}, removeListener() {} } } };
  });
  await page.addScriptTag({ path: path.resolve('extension/content/get-jd-review.js') });
  await page.waitForFunction(() => Boolean(window.__qtsGetJdReview));
  await page.evaluate(() => {
   window.result = { runId: 'manual-test', pageUrl: location.href, status: 'complete', classification: { job: { jobUrl: 'https://example.test/job', title: '', company: '' } }, jobDescription: '', profiles: [
    { id: 'a', name: 'Alice', categoryId: 'engineering', categoryName: 'Engineering', label: 'Remote only', labelColor: '#0f172a' },
    { id: 'b', name: 'Bob', categoryId: 'engineering', categoryName: 'Engineering', label: 'Senior', labelColor: '#fef08a' },
    { id: 'c', name: 'Chris', categoryId: 'design', categoryName: 'Design', label: 'UI', labelColor: '#10b981' }
   ] };
   window.__qtsGetJdReview.applyResult(window.result);
  });
  await page.waitForFunction(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden') === 'false');
  assert.equal(await page.evaluate(() => window.__qtsGetJdReview.manualReviewAvailable()), true);
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.save').disabled), true, 'Save is disabled when no candidate is checked');
  assert.deepEqual(await page.evaluate(() => ({
   categories: [...window.testRoot.querySelectorAll('.category-group-heading')].map(e => e.textContent),
   profiles: [...window.testRoot.querySelectorAll('[data-profile-id]')].map(e => e.dataset.profileId),
  })), { categories: ['Design', 'Engineering'], profiles: ['c', 'a', 'b'] });
  assert.equal(await page.evaluate(() => window.testRoot.querySelectorAll('[data-manual-field]').length), 4);
  await page.evaluate(() => {
   window.testRoot.querySelector('[data-profile-id="a"]').click();
  });
  await page.waitForFunction(() => !window.testRoot.querySelector('[data-profile-id="a"]').disabled);
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.save').disabled), false);
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId)), ['a']);
  // Cancel hides review without discarding selection; the edge launcher reopens it.
  await page.evaluate(() => {
   window.testRoot.querySelector('.cancel').click();
  });
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden')), 'true');
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-qts-manual-get-jd-review')), false);
  await page.evaluate(() => window.__qtsPageLauncher.click());
  await page.waitForFunction(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden') === 'false');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-qts-manual-get-jd-review')), 'true');
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId)), ['a']);
  await page.evaluate(() => window.testRoot.querySelector('.cancel').click());
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden')), 'true');
  // A new manual run on the same page opens automatically.
  await page.evaluate(() => { window.result.runId = 'manual-test-2'; window.__qtsGetJdReview.applyResult(window.result); });
  await page.waitForFunction(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden') === 'false');
  const layout = await page.evaluate(() => {
   const root = window.testRoot;
   return {
    categorySelectionPosition: getComputedStyle(root.querySelector('.category-selection')).position,
    branding: getComputedStyle(root.querySelector('.manager-brand-header')).display,
    header: getComputedStyle(root.querySelector('.panel-header')).display,
    accountHeading: getComputedStyle(root.querySelector('.account-heading')).display,
    actions: [...root.querySelectorAll('.actions button')].map(b => b.textContent),
    listOrder: getComputedStyle(root.querySelector('.profiles')).order,
    fieldsOrder: getComputedStyle(root.querySelector('.details')).order,
   };
  });
  // Manual review is a page of the QTS panel: its header shows, the old panel heading does not.
  assert.deepEqual(layout, { categorySelectionPosition: 'sticky', branding: 'grid', header: 'none', accountHeading: 'none', actions: ['Save', 'Cancel'], listOrder: '0', fieldsOrder: '1' });
  // "‹ QTS" goes back to the QTS panel and keeps the ticks; the launcher brings the review back.
  const ticked = await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId));
  await page.evaluate(() => window.testRoot.querySelector('.review-back').click());
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden')), 'true');
  assert.equal(await page.evaluate(() => window.launcherOpen), true);
  await page.evaluate(() => window.__qtsPageLauncher.click());
  await page.waitForFunction(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden') === 'false');
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId)), ticked);
  // Title and Company are empty in this result, so the job fields open by themselves.
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.panel').classList.contains('fields-open')), true);
  const badge = await page.evaluate(() => { const e = window.testRoot.querySelector('[data-profile-id="a"]').parentElement.querySelector('.candidate-label'); return [e.textContent, e.style.backgroundColor, e.style.color]; });
  assert.deepEqual(badge, ['Remote only', 'rgb(15, 23, 42)', 'rgb(255, 255, 255)']);
  await page.evaluate(() => {
   const root = window.testRoot;
   const title = root.querySelector('[data-manual-field="title"]');
   title.value = 'Draft kept while switching categories';
   title.dispatchEvent(new Event('input'));
   root.querySelector('.profiles').style.cssText += 'height:130px;flex:none;';
   [...root.querySelectorAll('.category-jump')].find(button => button.textContent === 'Engineering').click();
  });
  await page.waitForFunction(() => {
   const root = window.testRoot;
   const container = root.querySelector('.profiles');
   const heading = root.querySelector('[data-category-id="engineering"]');
   const sticky = root.querySelector('.category-selection');
   return Math.abs(heading.getBoundingClientRect().top - container.getBoundingClientRect().top - sticky.getBoundingClientRect().height) < 5;
  });
  await page.evaluate(() => [...window.testRoot.querySelectorAll('.category-jump')].find(button => button.textContent === 'Design').click());
  await page.waitForFunction(() => {
   const root = window.testRoot;
   const container = root.querySelector('.profiles');
   const heading = root.querySelector('[data-category-id="design"]');
   const sticky = root.querySelector('.category-selection');
   return Math.abs(heading.getBoundingClientRect().top - container.getBoundingClientRect().top - sticky.getBoundingClientRect().height) < 5;
  });
  await page.evaluate(() => window.testRoot.querySelector('[aria-label="Back to candidate categories"]').click());
  await page.waitForFunction(() => window.testRoot.querySelector('.profiles').scrollTop === 0);
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-manual-field="title"]').value), 'Draft kept while switching categories');
  await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-category-ids]')].find(e => JSON.parse(e.dataset.categoryIds).includes('a')).click());
  await page.waitForFunction(() => !window.testRoot.querySelector('[data-profile-id]').disabled);
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId)), ['a', 'b']);
  await page.evaluate(() => window.testRoot.querySelector('[data-profile-id="b"]').click());
  await page.waitForFunction(() => !window.testRoot.querySelector('[data-profile-id]').disabled);
  assert.equal(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-category-ids]')].find(e => JSON.parse(e.dataset.categoryIds).includes('a')).indeterminate), true);
  await page.evaluate(() => {
   for (const [key, value] of Object.entries({ title: 'Fixed title', company: 'Fixed company', description: 'Full manual JD' })) {
    const input = window.testRoot.querySelector('[data-manual-field="' + key + '"]'); input.value = value; input.dispatchEvent(new Event('input'));
   }
   window.__qtsGetJdReview.openReview();
  });
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-manual-field="title"]').value), 'Fixed title');
  await page.evaluate(() => [...window.testRoot.querySelectorAll('button')].find(b => b.textContent === 'Save').click());
  await page.waitForFunction(() => window.calls.some(m => m.type === 'SAVE_GET_JD_SELECTION'));
  const saved = await page.evaluate(() => window.calls.find(m => m.type === 'SAVE_GET_JD_SELECTION'));
  assert.deepEqual(saved.profileIds, ['a']); assert.equal(saved.manualJob.title, 'Fixed title'); assert.equal(saved.manualJob.description, 'Full manual JD');
  await page.waitForFunction(() => window.testRoot.querySelector('h2').textContent === 'Save result');
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelector('.panel-header').children].map(element => element.className)), ['status', '']);
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.status').textContent), 'Successfully saved to 1 candidate · Closing this tab in 2 seconds');
  await page.evaluate(() => { window.__qtsGetJdReview.applyResult({ ...window.result, evaluationMode: 'gemini', classification: { ...window.result.classification, isJobPage: true, isRemote: true } }); window.__qtsGetJdReview.openReview(); });
  assert.equal(await page.evaluate(() => window.testRoot.querySelectorAll('[data-manual-field], [data-category-ids]').length), 0);
  await page.evaluate(() => {
   window.__qtsGetJdReview.applyResult({ ...window.result, runId: 'existing-candidate-states', evaluationMode: 'manual', profiles: [
    { id: 'a', name: 'Saved', state: 'has_job', available: false, categoryId: 'engineering', categoryName: 'Engineering' },
    { id: 'b', name: 'Applied', state: 'applied', available: false, categoryId: 'engineering', categoryName: 'Engineering' },
    { id: 'c', name: 'Available', state: 'available', available: true, categoryId: 'design', categoryName: 'Design' },
   ], selectedProfileIds: [] });
   window.__qtsGetJdReview.openReview();
  });
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId).sort()), ['a', 'b']);
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-profile-id="b"]').disabled), true);
  const savesBeforeUnchecking = await page.evaluate(() => window.calls.filter(message => message.type === 'SAVE_GET_JD_SELECTION').length);
  await page.evaluate(() => window.testRoot.querySelector('[data-profile-id="a"]').click());
  await page.waitForFunction(() => !window.testRoot.querySelector('[data-profile-id="a"]').disabled);
  await page.waitForFunction(() => window.calls.some(message => message.type === 'UPDATE_GET_JD_SELECTION'));
  assert.equal(await page.evaluate(() => window.calls.filter(message => message.type === 'SAVE_GET_JD_SELECTION').length), savesBeforeUnchecking, 'unchecking only updates the pending selection; it does not remove a saved job');
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-profile-id="a"]').closest('label').textContent.includes('Has this job')), true, 'the saved job remains until Save is clicked');
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId)), ['b']);
  await page.evaluate(() => window.testRoot.querySelector('[data-profile-id="b"]').click());
  assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-profile-id]:checked')].map(e => e.dataset.profileId)), ['b']);
 } finally { await browser.close(); }
});

test('stored manual results open after delayed session loading; stored Gemini results stay closed', { skip: !CHROME, timeout: 60000 }, async () => {
 const browser = await require('puppeteer-core').launch({ executablePath: CHROME, headless: true, pipe: true });
 try {
  for (const mode of ['manual', 'gemini']) {
   const page = await browser.newPage(); await page.setContent('<h1>Stored job</h1>');
   await page.evaluate(mode => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); window.testRoot = root; return root; };
    const result = { runId: 'stored', pageUrl: location.href, status: 'complete', evaluationMode: mode,
     classification: { isJobPage: true, isRemote: true, job: { title: 'Engineer', company: 'Example', jobUrl: 'https://example.test/job' } },
     profiles: [{ id: 'a', name: 'Alice', state: 'available' }], jobDescription: 'Full JD' };
    window.chrome = { runtime: { id: 'test', getURL: p => p, onMessage: { addListener() {}, removeListener() {} },
     sendMessage: async m => m.type === 'GET_JD_PAGE_RESULT' ? { ok: true, result } : { ok: true } },
     storage: { local: { get: async () => { await new Promise(resolve => setTimeout(resolve, 100)); window.sessionRead = true; return { authExpiresAt: Date.now() + 60000, qtsGetJdOn: true }; } }, onChanged: { addListener() {}, removeListener() {} } } };
   }, mode);
   await page.addScriptTag({ path: path.resolve('extension/content/get-jd-review.js') });
   await page.waitForFunction(() => window.sessionRead && window.testRoot?.querySelectorAll('[data-profile-id]').length === 1);
   assert.equal(await page.evaluate(() => window.testRoot.querySelector('.panel').getAttribute('aria-hidden')), mode === 'manual' ? 'false' : 'true');
   await page.close();
  }
 } finally { await browser.close(); }
});
