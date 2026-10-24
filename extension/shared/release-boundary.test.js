const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.resolve(__dirname, '..');

test('the page launcher is the only user entry point', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'),
  );
  const scripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  assert.ok(manifest.content_scripts.some((entry) => entry.run_at === 'document_start'));
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );

  assert.ok(scripts.includes('content/page-launcher.js'));
  assert.ok(scripts.includes('content/text-highlighter.js'));
  assert.ok(scripts.includes('shared/page-exclusions.js'));
  assert.ok(serviceWorker.includes("'../shared/job-detection-url-rules.js'"));
  assert.ok(scripts.includes('shared/text-highlighting.js'));
  assert.ok(
    scripts.indexOf('shared/page-exclusions.js')
      < scripts.indexOf('content/page-launcher.js'),
  );
  assert.ok(
    scripts.indexOf('shared/text-highlighting.js')
      < scripts.indexOf('content/text-highlighter.js'),
  );
  assert.ok(serviceWorker.includes("'../shared/page-exclusions.js'"));
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(serviceWorker.includes('chrome.action.onClicked.addListener'), false);
  assert.ok(manifest.web_accessible_resources.some((entry) => (
    entry.resources || []
  ).includes('assets/wys-launcher.png')));
  assert.ok(fs.existsSync(path.join(extensionRoot, 'assets', 'wys-launcher.png')));
  const launcher = fs.readFileSync(
    path.join(extensionRoot, 'content', 'page-launcher.js'),
    'utf8',
  );
  const review = fs.readFileSync(
    path.join(extensionRoot, 'content', 'get-jd-review.js'),
    'utf8',
  );
  const highlighter = fs.readFileSync(
    path.join(extensionRoot, 'content', 'text-highlighter.js'),
    'utf8',
  );
  assert.ok(launcher.includes('initializeQtsPageLauncher().catch'));
  assert.ok(launcher.includes('hasValidExtensionContext'));
  assert.ok(launcher.includes("window.addEventListener('load', initializePageLauncherAfterLoad, { once: true })"));
  assert.ok(review.includes("window.addEventListener('load', initializeGetJdReviewAfterLoad, { once: true })"));
  assert.ok(highlighter.includes("window.addEventListener('load', startPageTextHighlighterAfterLoad, { once: true })"));
  assert.ok(launcher.includes('conic-gradient(from 0deg'));
  assert.ok(launcher.includes('qts-border-rotate'));
  assert.ok(launcher.includes('animation: qts-border-rotate 1.5s linear infinite'));
  assert.ok(launcher.includes('.launcher:not(.signed-in)::before'));
  assert.ok(launcher.includes('.launcher:not(.signed-in) .action'));
  assert.ok(launcher.includes('.launcher.signed-in .main { border-color: #c7d2fe; background: #fff; }'));
  assert.ok(launcher.includes("launcher.classList.toggle('signed-in', signedIn)"));
  assert.ok(launcher.includes("if (!signedIn) {\n      showSignInForm();"));
  assert.equal(launcher.includes("launcher.classList.toggle('loading'"), false);
});

test('Get JD monitoring uses the non-Gemini duplicate check', () => {
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const launcher = fs.readFileSync(
    path.join(extensionRoot, 'content', 'page-launcher.js'),
    'utf8',
  );

  assert.ok(serviceWorker.includes("'/api/extension/get-jd/check'"));
  assert.equal(serviceWorker.includes('requestGeminiJson'), false);
  assert.ok(serviceWorker.includes("[EXTENSION_STATUS_KEY]: 'get_jd'"));
  assert.ok(launcher.includes("Let's start finding Your Remote Job!"));
  assert.ok(launcher.includes("active ? 'Cancel' : defaultLabel"));
  assert.ok(launcher.includes("document.documentElement?.getAttribute('data-qts-get-jd-docked') === 'true'"));
  assert.ok(launcher.includes("attributeFilter: ['data-qts-get-jd-docked']"));
  assert.ok(launcher.includes('.launcher { position: fixed; right: 180px; bottom: 24px;'));
  assert.ok(launcher.includes('.generation { --x: -122px; --y: -88px; }'));
  assert.ok(launcher.includes('.apply { --x: -46px; --y: -143px; }'));
  assert.ok(launcher.includes('.logout { --x: 46px; --y: -143px; }'));
  assert.ok(launcher.includes('.page-exclusions { --x: 150px; --y: 0px; }'));
  assert.ok(launcher.includes('.launcher.get-jd-active { right: calc(min(400px, 48vw) + 180px); }'));
  assert.ok(serviceWorker.includes("[EXTENSION_STATUS_KEY]: 'cancel'"));
  assert.ok(launcher.includes("'Sign In'"));
  assert.ok(launcher.includes("'Sign Out'"));
});

test('Get JD supports Super-selected manual and Gemini matching flows', () => {
  const serviceWorker = fs.readFileSync(path.join(extensionRoot, 'background', 'service-worker.js'), 'utf8');
  const apiWorker = fs.readFileSync(path.join(extensionRoot, 'shared', 'api-worker.js'), 'utf8');
  assert.ok(apiWorker.includes("path === '/api/extension/get-jd/mode'"));
  assert.ok(apiWorker.includes("path === '/api/extension/get-jd'"));
  assert.ok(serviceWorker.includes("modeResult.mode === 'gemini'"));
  assert.ok(serviceWorker.includes('pageText,'));
  assert.ok(serviceWorker.includes('document.body?.innerText'));
  assert.ok(!serviceWorker.includes('bodyHtml'));
  assert.ok(serviceWorker.includes("geminiResult.classification?.isJobPage !== true"));
  assert.ok(serviceWorker.includes("result.classification?.isRemote !== true"));
  assert.ok(serviceWorker.includes('isJobPage: result.classification.isJobPage'));
  assert.ok(serviceWorker.includes('isRemote: result.classification.isRemote'));
  assert.equal(serviceWorker.includes('passesJobPolicy'), false);
  const saveRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'get-jd', 'save', 'route.ts'),
    'utf8',
  );
  const evaluationRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'get-jd', 'route.ts'),
    'utf8',
  );
  const reviewPanel = fs.readFileSync(
    path.join(extensionRoot, 'content', 'get-jd-review.js'),
    'utf8',
  );
  assert.ok(saveRoute.includes('!isGetJdEvaluationAccepted(readEvaluationDecision(body))'));
  assert.ok(evaluationRoute.includes('if (!classification.isJobPage)'));
  assert.ok(evaluationRoute.includes('if (!classification.isRemote)'));
  assert.ok(evaluationRoute.includes('jobUrl: pageUrl'));
  assert.ok(evaluationRoute.includes('classification.job.reason'));
  assert.equal(evaluationRoute.includes('passesJobPolicy'), false);
  assert.ok(reviewPanel.includes("currentResult.classification?.isRemote === true"));
  assert.ok(reviewPanel.includes("'Eligibility reason'"));
  assert.equal(reviewPanel.includes('passesJobPolicy'), false);
  assert.ok(serviceWorker.includes('matchingProfileIds'));
});

test('Get JD applies Manager URL blocks and page-keyword detection after load before duplicate checks', () => {
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const completedPageIndex = serviceWorker.indexOf("tab.status !== 'complete'");
  const blockedRuleIndex = serviceWorker.indexOf(
    'if (await isPageBlockedForManager(url)) return;',
  );
  const detectionIndex = serviceWorker.indexOf(
    'if (!(await isPageDetectedAsJobForManager(tabId))) return;',
    blockedRuleIndex,
  );
  const extractionIndex = serviceWorker.indexOf(
    'const extraction = await extractJobFromTab(tabId, { requireCompany: true });',
  );
  const duplicateCheckIndex = serviceWorker.indexOf("workerApiRequest('POST', '/api/extension/get-jd/check'");

  assert.ok(completedPageIndex >= 0);
  assert.ok(blockedRuleIndex > completedPageIndex);
  assert.ok(detectionIndex > blockedRuleIndex);
  assert.ok(extractionIndex > detectionIndex);
  assert.ok(duplicateCheckIndex > extractionIndex);
  assert.equal(serviceWorker.includes('classifyJobPageEvidence({'), false);
  assert.equal(serviceWorker.includes("status: 'not_job_page'"), false);
  assert.ok(serviceWorker.includes("msg.type === 'CHECK_EXTENSION_PAGE_ALLOWED'"));
  assert.ok(serviceWorker.includes("workerApiRequest('GET', '/api/extension/job-detection-url-rules')"));
  assert.ok(serviceWorker.includes('excluded: isManagerBlockedUrl(sender.tab.url, rules)'));
  assert.equal(serviceWorker.includes('__qtsPageExclusions.shouldSkipPage'), false);
  assert.equal(serviceWorker.includes('function isIgnoredSite('), false);
  assert.equal(serviceWorker.includes("const ignored = new Set(["), false);
  assert.ok(serviceWorker.includes("await processGetJdPage(tabId, url, 'complete');"));
  const committedListener = serviceWorker.slice(
    serviceWorker.indexOf('chrome.webNavigation.onCommitted.addListener'),
    serviceWorker.indexOf('chrome.webNavigation.onHistoryStateUpdated.addListener'),
  );
  assert.equal(committedListener.includes('processGetJdPage('), false);
  assert.equal(committedListener.includes('maybePrewarmCustomGptOnJobPage('), false);
});

test('Manager URL rule CRUD is permission-gated and scoped to its owner', () => {
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const launcher = fs.readFileSync(
    path.join(extensionRoot, 'content', 'page-launcher.js'),
    'utf8',
  );
  const featureRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'features', 'me', 'route.ts'),
    'utf8',
  );
  const exclusionsRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'page-exclusions', 'route.ts'),
    'utf8',
  );
  const exclusionItemRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'page-exclusions', '[exclusionId]', 'route.ts'),
    'utf8',
  );

  assert.ok(launcher.includes("type: 'CHECK_EXTENSION_PAGE_ALLOWED'"));
  assert.ok(launcher.includes('managerPanel.openManagerSettings(panel, response.tabId, {'));
  assert.equal(launcher.includes('highlight-panel'), false);
  assert.ok(launcher.includes("'page-exclusions'"));
  const review = fs.readFileSync(
    path.join(extensionRoot, 'content', 'get-jd-review.js'),
    'utf8',
  );
  assert.ok(review.includes('buildManagerSettingsView'));
  assert.ok(review.includes('chrome?.runtime?.id'));
  assert.ok(review.includes('managerSettingsOpen'));
  assert.ok(review.includes('data-settings-view="text-highlights"'));
  assert.ok(review.includes('data-settings-view="page-exclusions"'));
  assert.ok(review.includes('manager-brand-header'));
  assert.ok(review.includes('manager-settings-color-options'));
  assert.ok(review.includes('data-highlight-preview'));
  assert.ok(review.includes('manager-settings-rule-edit'));
  assert.equal(review.includes('managerSettingsFrame'), false);
  assert.equal(review.includes("chrome.runtime.getURL('popup/popup.html')"), false);
  assert.ok(review.includes("type: 'MANAGE_GLOBAL_TEXT_HIGHLIGHT'"));
  assert.ok(serviceWorker.includes("'/api/extension/page-exclusions'"));
  assert.ok(featureRoute.includes('canManagePageExclusions'));
  assert.ok(exclusionsRoute.includes('managerCanManagePageExclusions(manager.id)'));
  const jobDetectionRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'job-detection-url-rules', 'route.ts'),
    'utf8',
  );
  const jobDetectionItemRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'job-detection-url-rules', '[ruleId]', 'route.ts'),
    'utf8',
  );
  const managerSettings = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'settings', 'page.tsx'),
    'utf8',
  );
  assert.ok(jobDetectionRoute.includes('managerCanManageJobDetectionUrlRules(manager.id)'));
  assert.ok(jobDetectionRoute.includes('export async function POST'));
  assert.ok(jobDetectionItemRoute.includes('export async function PUT'));
  assert.ok(jobDetectionItemRoute.includes('export async function DELETE')  );
  assert.ok(jobDetectionItemRoute.includes('eq(extensionJobDetectionUrlRules.managerId, manager.id)'));
  assert.ok(exclusionsRoute.includes('export async function POST'));
  assert.ok(exclusionItemRoute.includes('export async function PUT'));
  assert.ok(exclusionItemRoute.includes('export async function DELETE'));
  assert.ok(exclusionItemRoute.includes('eq(extensionPageExclusions.managerId, manager.id)'));
  assert.ok(serviceWorker.includes("msg.type === 'ADD_MANAGER_PAGE_EXCLUSION'"));
  assert.ok(serviceWorker.includes("msg.type === 'UPDATE_MANAGER_PAGE_EXCLUSION'"));
  assert.ok(serviceWorker.includes("msg.type === 'DELETE_MANAGER_PAGE_EXCLUSION'"));
  assert.ok(serviceWorker.includes("msg.type === 'ADD_MANAGER_JOB_DETECTION_URL_RULE'"));
  assert.ok(serviceWorker.includes("msg.type === 'UPDATE_MANAGER_JOB_DETECTION_URL_RULE'"));
  assert.ok(serviceWorker.includes("msg.type === 'DELETE_MANAGER_JOB_DETECTION_URL_RULE'"));
  assert.ok(managerSettings.includes('ManagerJobDetectionUrlAccessForm'));
  assert.ok(serviceWorker.includes('isManagerBlockedUrl'));
  assert.ok(serviceWorker.includes('isPageDetectedAsJobForManager'));
  assert.ok(serviceWorker.includes('pageHasJobDetectionSignals'));
  assert.ok(serviceWorker.includes("msg.type === 'UPDATE_MANAGER_PAGE_EXCLUSION'"));
  const popup = fs.readFileSync(
    path.join(extensionRoot, 'popup', 'popup.js'),
    'utf8',
  );
  assert.ok(popup.includes('!managerExtensionFeatures.canManagePageExclusions'));
  assert.ok(popup.includes('!managerExtensionFeatures.canManageJobDetectionUrlRules'));
});

test('Manager blocked URL rules update UI and workflows across SPA navigation', () => {
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const launcher = fs.readFileSync(
    path.join(extensionRoot, 'content', 'page-launcher.js'),
    'utf8',
  );
  const review = fs.readFileSync(
    path.join(extensionRoot, 'content', 'get-jd-review.js'),
    'utf8',
  );
  const highlighter = fs.readFileSync(
    path.join(extensionRoot, 'content', 'text-highlighter.js'),
    'utf8',
  );
  const navigationHandler = serviceWorker.slice(
    serviceWorker.indexOf('chrome.webNavigation.onHistoryStateUpdated.addListener'),
  );

  assert.ok(navigationHandler.indexOf('notifyPageUrlAccess') < navigationHandler.indexOf('if (!isExtractablePageUrl'));
  assert.ok(serviceWorker.includes('changes[JOB_DETECTION_URL_RULES_STORAGE_KEY]'));
  assert.ok(serviceWorker.includes('recheckLoadedPagesForManagerJobRules'));
  assert.ok(serviceWorker.includes("type: 'QTS_PAGE_URL_CHANGED'"));
  assert.ok(launcher.includes("message?.type !== 'QTS_PAGE_URL_CHANGED'"));
  assert.ok(review.includes("message?.type !== 'QTS_PAGE_URL_CHANGED'"));
  assert.ok(highlighter.includes("message?.type !== 'QTS_PAGE_URL_CHANGED'"));
  assert.ok(launcher.includes('initializeQtsPageLauncher().catch'));
  assert.ok(review.includes('initializeGetJdReview().catch'));
});

test('shared text highlights run independently of site and manager URL exclusions', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'),
  );
  const highlighter = fs.readFileSync(
    path.join(extensionRoot, 'content', 'text-highlighter.js'),
    'utf8',
  );

  assert.ok(manifest.content_scripts.some((entry) => (
    entry.matches?.includes('<all_urls>')
    && entry.js?.includes('content/text-highlighter.js')
  )));
  assert.equal(highlighter.includes('CHECK_EXTENSION_PAGE_ALLOWED'), false);
  assert.equal(highlighter.includes('__qtsPageExclusions'), false);
  assert.ok(highlighter.includes("'authExpiresAt'"));
  assert.ok(highlighter.includes('changes.authExpiresAt'));
});

test('Generation launcher shows a document icon and can cancel an active run', () => {
  const launcher = fs.readFileSync(
    path.join(extensionRoot, 'content', 'page-launcher.js'),
    'utf8',
  );
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const cancelAllRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'generation', 'cancel-all', 'route.ts'),
    'utf8',
  );
  const claimRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'generation', 'claim', 'route.ts'),
    'utf8',
  );
  const releaseRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'generation', 'release', 'route.ts'),
    'utf8',
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));

  assert.ok(launcher.includes("['generation', 'Generation', '▤', 'generation']"));
  assert.ok(launcher.includes("button.dataset.modeAction = active ? 'cancel_status' : action"));
  assert.ok(serviceWorker.includes("'/api/extension/generation/cancel-all'"));
  assert.ok(serviceWorker.includes("'/api/extension/generation/heartbeat'"));
  assert.equal(serviceWorker.includes("'/api/extension/generation/queue'"), false);
  assert.equal(serviceWorker.includes('Generation must be started from a job page.'), false);
  assert.ok(serviceWorker.includes('Checking the oldest eligible saved job'));
  assert.ok(serviceWorker.includes('pinned: true'));
  assert.ok(serviceWorker.includes('while (Date.now() - waitStartedAt < GENERATION_RESPONSE_MAX_WAIT_MS)'));
  assert.ok(serviceWorker.includes('GENERATION_RESPONSE_START_TIMEOUT_MS'));
  assert.ok(serviceWorker.includes('excludedJobIds: [...excludedJobIds]'));
  assert.ok(serviceWorker.includes('persistGenerationQueueRun(runId, excludedJobIds)'));
  assert.ok(serviceWorker.includes('notifyGenerationManager'));
  assert.ok(serviceWorker.includes('ACTIVE_GENERATION_JOB_KEY'));
  assert.ok(serviceWorker.includes('removeQueuedGenerationDownloads(downloadIds)'));
  assert.ok(cancelAllRoute.includes('generationStatus: "cancelled"'));
  assert.ok(cancelAllRoute.includes('eq(jobs.generationStatus, "processing")'));
  assert.ok(cancelAllRoute.includes('generationAttemptCount: sql`greatest'));
  assert.equal(cancelAllRoute.includes('status: sql`case when'), false);
  assert.equal(cancelAllRoute.includes('resumeLocalPath: sql`case when'), false);
  assert.ok(manifest.permissions.includes('notifications'));
  assert.ok(releaseRoute.includes('generationStatus: "queued"'));
  assert.ok(releaseRoute.includes('generationAttemptCount: sql`greatest'));
  assert.ok(claimRoute.includes('.orderBy(asc(jobs.createdAt), asc(jobs.id))'));
  assert.equal(claimRoute.includes('jobs.status'), false);
  assert.ok(claimRoute.includes('sql`length(btrim(${profiles.jdMatching})) > 0`'));
  assert.ok(claimRoute.includes('isNull(jobs.resumeLocalPath)'));
  assert.ok(claimRoute.includes('lt(jobs.generationAttemptCount, 2)'));
  assert.ok(claimRoute.includes('if (activeJob)'));
});

test('cancelled Generation jobs stay out of the queue until queued again', () => {
  const routeSource = (name) => fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'generation', name, 'route.ts'),
    'utf8',
  );
  const schema = fs.readFileSync(path.join(extensionRoot, '..', 'src', 'db', 'schema.ts'), 'utf8');
  const jobActions = fs.readFileSync(path.join(extensionRoot, '..', 'src', 'app', 'jobs', 'actions.ts'), 'utf8');

  assert.ok(schema.includes('"cancelled",'));
  assert.ok(routeSource('cancel').includes('generationStatus: "cancelled"'));
  assert.ok(routeSource('fail').includes('generationStatus: "cancelled"'));
  assert.ok(jobActions.includes('generationStatus: "cancelled"'));
  assert.equal(routeSource('claim').includes('"cancelled"'), false);
  assert.ok(routeSource('queue').includes('["not_queued", "failed", "cancelled"]'));
});

test('queued Generation recovers from restarts, lost finalize responses, and sign-out', () => {
  const worker = fs.readFileSync(path.join(extensionRoot, 'background', 'service-worker.js'), 'utf8');
  const queueLoop = worker.slice(
    worker.indexOf('async function processQueuedGenerationJobs()'),
    worker.indexOf('self.chrome?.runtime?.onStartup'),
  );
  const signOutBranch = worker.slice(
    worker.indexOf("if (action === 'sign_out')"),
    worker.indexOf("if (action === 'cancel_status')"),
  );
  const heartbeat = worker.slice(
    worker.indexOf('async function ensureQueuedGenerationIsActive(jobId)'),
    worker.indexOf('async function readQueuedGenerationStatus(jobId)'),
  );

  assert.ok(queueLoop.indexOf('await recoverInterruptedGeneration()') < queueLoop.indexOf("'/api/extension/generation/claim'"));
  assert.ok(queueLoop.indexOf("if (serverStatus === 'completed')") < queueLoop.indexOf('removeQueuedGenerationDownloads(downloadIds)'));
  assert.ok(queueLoop.includes('!deliveryUnknown'));
  assert.ok(signOutBranch.indexOf("'/api/extension/generation/release'") < signOutBranch.indexOf('clearAuth'));
  assert.ok(heartbeat.includes('result._httpStatus === 409) throw generationCancelledError()'));
  assert.ok(heartbeat.includes('GENERATION_HEARTBEAT_GRACE_MS'));
  assert.equal(worker.includes("throw new Error('Generation cancelled.')"), false);
});

test('queued Generation prompts use saved job and profile data only', () => {
  const repositoryRoot = path.join(extensionRoot, '..');
  const startRoute = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'api', 'extension', 'generation', 'start', 'route.ts'),
    'utf8',
  );
  const schema = fs.readFileSync(path.join(repositoryRoot, 'src', 'db', 'schema.ts'), 'utf8');
  const jobsPage = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'jobs', 'page.tsx'),
    'utf8',
  );
  const actions = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'jobs', 'actions.ts'),
    'utf8',
  );

  assert.ok(startRoute.includes('jobUrl: normalizeJobUrl(savedJob.jobUrl)'));
  assert.ok(startRoute.includes('jobDescription: savedJob.description'));
  assert.ok(startRoute.includes('jdMatching: savedJob.jdMatching'));
  assert.ok(startRoute.includes('educations'));
  assert.ok(startRoute.includes('experiences'));
  assert.equal(startRoute.includes('readGenerationJob'), false);
  assert.ok(schema.includes('generationAttemptCount: integer("generation_attempt_count")'));
  assert.ok(actions.includes('Reset is available only after both Generation attempts fail.'));
  assert.ok(actions.includes('generationAttemptCount: 0'));
  assert.ok(jobsPage.includes('generationAttemptCount: jobs.generationAttemptCount'));
});

test('Generation distinguishes generated documents from delivered files', () => {
  const repositoryRoot = path.join(extensionRoot, '..');
  const schema = fs.readFileSync(path.join(repositoryRoot, 'src', 'db', 'schema.ts'), 'utf8');
  const completeRoute = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'api', 'extension', 'generation', 'complete', 'route.ts'),
    'utf8',
  );
  const finalizeRoute = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'api', 'extension', 'generation', 'finalize', 'route.ts'),
    'utf8',
  );
  const pdfPage = fs.readFileSync(path.join(repositoryRoot, 'src', 'app', 'pdf', 'page.tsx'), 'utf8');

  assert.ok(schema.includes('"delivered"'));
  assert.ok(completeRoute.includes('status: completed ? "completed" : "failed"'));
  assert.ok(completeRoute.includes('jobDescription: generationRuns.jobDescription'));
  assert.equal(completeRoute.includes('readText(body.jobDescription'), false);
  assert.ok(finalizeRoute.includes('.set({ status: "delivered"'));
  assert.ok(finalizeRoute.includes('db.batch(['));
  assert.ok(pdfPage.includes('eq(generationRuns.status, "delivered")'));
});

test('Get JD review lists candidates and reports per-candidate saves', () => {
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const review = fs.readFileSync(
    path.join(extensionRoot, 'content', 'get-jd-review.js'),
    'utf8',
  );
  const profilesRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'get-jd', 'profiles', 'route.ts'),
    'utf8',
  );
  const duplicateCheckRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'get-jd', 'check', 'route.ts'),
    'utf8',
  );
  const duplicateHelper = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'server', 'jobs', 'get-jd-jobs.ts'),
    'utf8',
  );
  const autoSavedJobRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'get-jd', 'auto-saved-jobs', '[jobId]', 'route.ts'),
    'utf8',
  );
  const apiWorker = fs.readFileSync(
    path.join(extensionRoot, 'shared', 'api-worker.js'),
    'utf8',
  );
  const evaluationRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'get-jd', 'route.ts'),
    'utf8',
  );

  assert.ok(profilesRoute.includes('getExtensionManager(request)'));
  assert.ok(profilesRoute.includes('eq(users.parentUserId, manager.id)'));
  assert.ok(profilesRoute.includes('category: categories.name'));
  assert.ok(review.includes('result.profiles || []'));
  assert.equal(review.includes("type: 'GET_MANAGER_CANDIDATE_PROFILES'"), false);
  assert.ok(review.includes('position: fixed; inset: 0 0 0 auto'));
  assert.ok(review.includes('width: min(400px, 48vw)'));
  assert.ok(review.includes('padding-right: min(400px, 48vw)'));
  assert.ok(review.includes("extensionStatus !== 'get_jd'"));
  assert.ok(review.includes('data-qts-get-jd-docked'));
  assert.ok(review.includes("panel.classList.add('is-visible')"));
  assert.ok(review.includes("panel.classList.remove('is-visible')"));
  assert.ok(review.includes('transition: padding-right .28s'));
  assert.ok(review.includes('profile-skeleton'));
  assert.ok(review.includes('profilesLoaded = true'));
  assert.ok(review.includes('managerSettingsOpen'));
  assert.ok(review.includes('visible && profilesLoaded && extensionStatus === \'get_jd\''));
  assert.ok(review.includes('!profilesLoaded'));
  assert.ok(review.includes('Loading your candidate accounts...'));
  assert.ok(review.includes('prefers-reduced-motion: reduce'));
  assert.ok(review.includes('if (!sessionIsValid(stored))'));
  assert.ok(review.includes('result.classification.matchingProfileIds'));
  assert.ok(serviceWorker.includes('selectionModified: true'));
  assert.ok(serviceWorker.includes('profiles.filter((profile) => profile.available !== false)'));
  assert.ok(serviceWorker.includes("status: 'complete'"));
  assert.ok(review.includes("profile.available === false && profile.autoSaved !== true"));
  assert.ok(review.includes('checkbox.checked = selectedIds.has(profile.id)'));
  assert.ok(review.includes('readSelectedIds().filter((id) => availableIds.has(id))'));
  assert.ok(review.includes("profile.jobStatus === 'todo'"));
  assert.ok(review.includes("'In Jobs · To do'"));
  assert.ok(review.includes("elements.heading.textContent = 'Save result'"));
  assert.ok(review.includes('Successfully saved ${savedCount}'));
  assert.ok(review.includes("? 'Already applied.'"));
  assert.ok(review.includes("? 'Already added.'"));
  assert.ok(review.includes("result.toastMessage || 'New job.'"));
  assert.ok(evaluationRoute.includes('insertGetJdJob(jobToSave)'));
  assert.ok(evaluationRoute.includes('updateExistingGetJdJobDetails(jobToSave)'));
  const detailUpdater = duplicateHelper.slice(
    duplicateHelper.indexOf('export async function updateExistingGetJdJobDetails'),
  );
  assert.ok(detailUpdater.includes('eq(jobs.managerId, job.managerId)'));
  assert.ok(detailUpdater.includes('duplicateConditions(jobs, job)'));
  assert.equal(detailUpdater.includes('eq(jobs.candidateId, job.candidateId)'), false);
  assert.ok(evaluationRoute.includes('autoSavedProfileIds: [...autoSavedProfileIds]'));
  assert.ok(serviceWorker.includes('autoSavedProfileIds.length === 0'));
  assert.ok(serviceWorker.includes('autoSavedProfileIds,'));
  assert.ok(serviceWorker.includes("'DELETE'"));
  assert.ok(serviceWorker.includes('/api/extension/get-jd/auto-saved-jobs/${encodeURIComponent(job.jobId)}'));
  assert.ok(serviceWorker.includes('uncheckedAutoSavedJobs = autoSavedJobs.filter'));
  assert.ok(autoSavedJobRoute.includes('eq(jobs.autoSavedByGetJd, true)'));
  assert.ok(autoSavedJobRoute.includes('eq(jobs.managerId, manager.id)'));
  assert.ok(autoSavedJobRoute.includes('eq(jobs.generationStatus, "not_queued")'));
  assert.ok(apiWorker.includes("get-jd\\/auto-saved-jobs\\/"));
  assert.ok(review.includes('profile.available === false && profile.autoSaved !== true'));
  assert.ok(review.includes("profile.autoSaved === true ? 'Saved automatically' : ''"));
  assert.ok(review.includes("result.autoSavedProfileIds.length > 0"));
  assert.equal(serviceWorker.includes('result.exists === true || result.allCandidatesAssigned === true'), false);
  assert.ok(serviceWorker.includes('.filter((profile) => profile.duplicateKind)'));
  assert.ok(duplicateCheckRoute.includes('findGetJdDuplicateDetails('));
  assert.ok(duplicateHelper.includes('.from(jobs)'));
  assert.ok(duplicateHelper.includes('.from(bids)'));
  assert.ok(duplicateHelper.includes('jobStatus: row.status'));
  assert.ok(duplicateHelper.includes('current.jobStatus === "todo"'));
  assert.ok(serviceWorker.includes('savedCount !== profileIds.length'));
  assert.ok(serviceWorker.includes('duplicateCount > 0'));
});

test('manager job rows support safe manual edits and deletion', () => {
  const jobsPage = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'jobs', 'page.tsx'),
    'utf8',
  );
  const actions = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'jobs', 'actions.ts'),
    'utf8',
  );
  const actionState = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'record-action-state.ts'),
    'utf8',
  );
  const forms = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'components', 'record-forms.tsx'),
    'utf8',
  );

  assert.ok(jobsPage.includes('<JobEditAction'));
  assert.ok(jobsPage.includes('<JobDeleteAction'));
  assert.ok(jobsPage.includes('<JobGenerationQueueAction'));
  assert.ok(jobsPage.includes('label: "Candidate Name"'));
  assert.ok(jobsPage.includes('label: "Job Title"'));
  assert.ok(jobsPage.includes('label: "Resume Path"'));
  assert.ok(jobsPage.includes('target="_blank"'));
  assert.ok(actions.includes('export async function updateJobAction'));
  assert.ok(actions.includes('eq(jobs.managerId, manager.id)'));
  assert.ok(actions.includes('eq(users.parentUserId, manager.id)'));
  assert.ok(actions.includes('description: description || null'));
  assert.ok(forms.includes('label="Job description"'));
  assert.ok(forms.includes('updateJobAction'));
  assert.ok(forms.includes('deleteJobAction'));
  assert.ok(actionState.includes('export const initialRecordState'));
  assert.equal(actions.includes('export const initialRecordState'), false);
  assert.ok(actions.includes('generationStatus, "processing"'));
  assert.ok(actions.includes('revalidatePath("/jobs")'));
  assert.ok(actions.includes('Job deleted. Refresh the page if it is still visible.'));
  assert.ok(forms.includes('aria-label={`Edit ${record.title}`}'));
  assert.ok(forms.includes('aria-label={`Delete ${record.title}`}'));
  assert.ok(forms.includes('role="alertdialog"'));
  assert.ok(forms.includes('This action cannot be undone.'));
  assert.equal(forms.includes('window.confirm('), false);
  assert.ok(forms.includes('ListPlus'));
  assert.ok(forms.includes('"Reset Generation"'));
  assert.ok(forms.includes('size-9 shrink-0 items-center justify-center'));
});

test('document generation uses saved manager prompt assignments and gates prompt access', () => {
  const repositoryRoot = path.join(extensionRoot, '..');
  const promptActions = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'settings', 'actions.ts'),
    'utf8',
  );
  const promptResolver = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'server', 'generation', 'manager-prompt.ts'),
    'utf8',
  );
  const promptPage = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'prompts', 'page.tsx'),
    'utf8',
  );
  const workspaceShell = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'components', 'workspace-shell.tsx'),
    'utf8',
  );
  const workspaceClient = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'components', 'workspace-shell-client.tsx'),
    'utf8',
  );
  const promptForms = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'app', 'settings', 'prompt-forms.tsx'),
    'utf8',
  );

  assert.ok(promptResolver.includes('managerPromptAssignments'));
  assert.ok(promptResolver.includes('assignedRows[0]?.promptTemplate'));
  assert.ok(promptResolver.includes('eq(prompts.isActive, true)'));
  assert.ok(promptResolver.includes('MissingDocumentPromptError'));
  assert.ok(promptActions.includes('update manager_prompt_assignments'));
  assert.ok(!promptActions.includes('promptChoice === "random"'));
  assert.ok(!promptForms.includes('Random active prompt'));
  assert.ok(promptPage.includes('modeRows[0]?.value !== "private"'));
  assert.ok(workspaceShell.includes('modeRows[0]?.value === "private"'));
  assert.ok(workspaceClient.includes('user.role === "manager" && managerPromptEnabled'));
  assert.ok(workspaceClient.includes('useState(true)'));
});

test('candidate profiles use grouped subcategories and legacy assignments are preserved', () => {
  const schema = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'db', 'schema.ts'),
    'utf8',
  );
  const migration = fs.readFileSync(
    path.join(extensionRoot, '..', 'drizzle', '0025_outgoing_zzzax.sql'),
    'utf8',
  );
  const userActions = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'users', 'actions.ts'),
    'utf8',
  );
  const userForms = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'users', 'user-forms.tsx'),
    'utf8',
  );

  assert.ok(schema.includes('export const subCategories = pgTable('));
  assert.ok(schema.includes('subCategoryId: uuid("category_id").references(() => subCategories.id'));
  assert.ok(migration.includes("VALUES ('General')"));
  assert.ok(migration.includes('SELECT "id", general_category_id, "name"'));
  assert.ok(migration.includes('profiles_category_id_sub_categories_id_fk'));
  assert.ok(userActions.includes('from(subCategories)'));
  assert.ok(userForms.includes('label="Subcategory"'));
  assert.ok(userForms.includes('<optgroup key={categoryName} label={categoryName}>'));
});

test('the login panel submits completed credentials without a timer or button', () => {
  const popupHtml = fs.readFileSync(path.join(extensionRoot, 'popup', 'popup.html'), 'utf8');
  const popupScript = fs.readFileSync(path.join(extensionRoot, 'popup', 'popup.js'), 'utf8');

  assert.equal(popupHtml.includes('id="btn-login"'), false);
  assert.ok(popupHtml.includes('<form id="login-form"'));
  assert.ok(popupScript.includes("loginPassword.addEventListener('change', submitCompletedLogin)"));
  assert.equal(popupScript.includes('setTimeout(submitCompletedLogin'), false);
});

test('shared text highlights are manager-gated and available from the page launcher', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const runtime = fs.readFileSync(path.join(extensionRoot, 'shared', 'runtime-config.js'), 'utf8');
  const workerApi = fs.readFileSync(path.join(extensionRoot, 'shared', 'api-worker.js'), 'utf8');
  const worker = fs.readFileSync(path.join(extensionRoot, 'background', 'service-worker.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(extensionRoot, 'content', 'page-launcher.js'), 'utf8');
  const highlighter = fs.readFileSync(path.join(extensionRoot, 'content', 'text-highlighter.js'), 'utf8');
  const featureRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'features', 'me', 'route.ts'),
    'utf8',
  );
  const highlightsRoute = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'api', 'extension', 'highlights', 'route.ts'),
    'utf8',
  );
  const settingsPage = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'settings', 'page.tsx'),
    'utf8',
  );
  const settingsActions = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'settings', 'actions.ts'),
    'utf8',
  );

  assert.ok(runtime.includes('textHighlights: true'));
  assert.ok(workerApi.includes("path === '/api/extension/highlights'"));
  assert.ok(worker.includes("'/api/extension/highlights'"));
  assert.ok(worker.includes("'/api/extension/features/me'"));
  assert.ok(launcher.includes("['text_highlights', 'Text Highlight', '✎', 'text-highlights']"));
  assert.ok(launcher.includes("type: 'GET_MANAGER_EXTENSION_FEATURES'"));
  assert.ok(launcher.includes('managerPanel.openManagerSettings(panel, response.tabId, {'));
  assert.ok(launcher.includes('await globalThis.__qtsInitializeGetJdReview?.()'));
  assert.ok(launcher.includes("highlightButton.hidden = response?.ok !== true || response.canManageTextHighlights !== true"));
  assert.ok(highlighter.includes('changes.authExpiresAt'));
  assert.ok(highlighter.includes('changes.authExpiresAt'));
  assert.ok(featureRoute.includes('managerCanManageTextHighlights(manager.id)'));
  assert.ok(highlightsRoute.includes('managerCanManageTextHighlights(manager.id)'));
  assert.ok(settingsPage.includes('<ManagerTextHighlightAccessForm'));
  assert.ok(settingsActions.includes('actor.role !== "super_admin"'));
  assert.ok(settingsActions.includes('canManageTextHighlights: enabledValue === "true"'));
  const exposedResources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);
  assert.equal(exposedResources.includes('popup/*'), false);
  assert.equal(exposedResources.includes('shared/*'), false);
});

test('signing out or switching Managers clears stored Get JD reviews', () => {
  const worker = fs.readFileSync(path.join(extensionRoot, 'background', 'service-worker.js'), 'utf8');
  const authRemovedBranch = worker.slice(
    worker.indexOf("if (area === 'local' && changes.authExpiresAt) {"),
    worker.indexOf('chrome.runtime.onInstalled.addListener'),
  );

  assert.ok(authRemovedBranch.includes('chrome.storage.local.remove(GET_JD_RESULTS_KEY)'));
});

test('the page launcher disable path only touches elements it defines', () => {
  const launcher = fs.readFileSync(path.join(extensionRoot, 'content', 'page-launcher.js'), 'utf8');

  assert.equal(launcher.includes('highlightPanel'), false);
});

test('page Sign In collects credentials only inside the extension-origin frame', () => {
  const read = (...parts) => fs.readFileSync(path.join(extensionRoot, ...parts), 'utf8');
  const launcher = read('content', 'page-launcher.js');
  const serviceWorker = read('background', 'service-worker.js');
  const signInPage = read('signin', 'signin.html');
  const signInScript = read('signin', 'signin.js');
  const manifest = JSON.parse(read('manifest.json'));
  const signInBranch = serviceWorker.slice(
    serviceWorker.indexOf("if (action === 'sign_in')"),
    serviceWorker.indexOf("if (action === 'sign_out')"),
  );

  assert.ok(launcher.includes("signInForm.className = 'sign-in-form'"));
  assert.ok(launcher.includes("chrome.runtime.getURL('signin/signin.html')"));
  assert.equal(launcher.includes("type = 'password'"), false);
  assert.equal(launcher.includes("action: 'sign_in'"), false);
  assert.ok(signInPage.includes('<label for="login-user">User Name</label>'));
  assert.ok(signInPage.includes('<label for="login-password">Password</label>'));
  assert.ok(signInScript.includes("passwordInput.addEventListener('change', submitSignIn)"));
  assert.ok(signInBranch.includes("sender.url !== chrome.runtime.getURL('signin/signin.html')"));
  assert.ok(manifest.web_accessible_resources.some((entry) => (
    entry.resources || []
  ).includes('signin/signin.html')));
  assert.equal(signInBranch.includes('openCapturePanel'), false);
});

test('content scripts never read the bearer token', () => {
  const contentScripts = ['page-launcher.js', 'get-jd-review.js', 'text-highlighter.js'];
  for (const file of contentScripts) {
    const source = fs.readFileSync(path.join(extensionRoot, 'content', file), 'utf8');
    assert.equal(source.includes('authToken'), false, `${file} must not read authToken`);
  }
  const authStorage = fs.readFileSync(path.join(extensionRoot, 'shared', 'account-auth-storage.js'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(extensionRoot, 'background', 'service-worker.js'), 'utf8');
  assert.ok(authStorage.includes('await tokenStore().write(token || \'\')'));
  assert.ok(serviceWorker.indexOf("'../shared/auth-token-store.js'") < serviceWorker.indexOf("'../shared/account-auth-storage.js'"));
});

test('resume PDF downloads remember a user-selected folder without requiring the extension', () => {
  const workspace = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'pdf', 'pdf-workspace.tsx'),
    'utf8',
  );

  assert.ok(workspace.includes('showDirectoryPicker'));
  assert.ok(workspace.includes('qts-resume-downloads'));
  assert.ok(workspace.includes('savePdfPairToDirectory'));
  assert.ok(workspace.includes('downloadPdfPairInBrowser'));
  assert.equal(workspace.includes('QTS_DOWNLOAD_APPLICATION_FILES'), false);
});

test('page toasts use a modern theme and keep the newest notice on top', () => {
  const toast = fs.readFileSync(
    path.join(extensionRoot, 'content', 'detect-toast.js'),
    'utf8',
  );

  assert.ok(toast.includes('host.insertBefore(toast, host.firstChild)'));
  assert.ok(toast.includes('const AUTO_HIDE_MS = 4000;'));
  assert.ok(toast.includes('transform: translateX(-36px)'));
  assert.ok(toast.includes('transform: translateX(36px)'));
  assert.ok(toast.includes('backdrop-filter: blur(12px)'));
  assert.ok(toast.includes('border-left: 4px solid var(--qts-toast-accent'));
  assert.ok(toast.includes('@media (prefers-reduced-motion: reduce)'));
});
