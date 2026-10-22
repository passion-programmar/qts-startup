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
  assert.ok(launcher.includes('initializeQtsPageLauncher().catch'));
  assert.equal(launcher.includes("window.addEventListener('load', initializeQtsPageLauncher"), false);
  assert.ok(launcher.includes('conic-gradient(from 0deg'));
  assert.ok(launcher.includes('qts-border-rotate'));
  assert.ok(launcher.includes('animation: qts-border-rotate 1.5s linear infinite'));
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

test('Get JD locally rejects non-job pages before duplicate checks and profile requests', () => {
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const review = fs.readFileSync(
    path.join(extensionRoot, 'content', 'get-jd-review.js'),
    'utf8',
  );
  const preflightIndex = serviceWorker.indexOf('classifyJobPageEvidence({');
  const duplicateCheckIndex = serviceWorker.indexOf("workerApiRequest('POST', '/api/extension/get-jd/check'");

  assert.ok(preflightIndex >= 0);
  assert.ok(duplicateCheckIndex > preflightIndex);
  assert.ok(serviceWorker.includes("status: 'not_job_page'"));
  assert.ok(serviceWorker.includes("msg.type === 'CHECK_EXTENSION_PAGE_ALLOWED'"));
  assert.ok(review.includes("result.status === 'not_job_page'"));
  assert.equal(review.includes("type: 'GET_MANAGER_CANDIDATE_PROFILES'"), false);
  assert.ok(serviceWorker.includes("document.addEventListener('DOMContentLoaded', resolve, { once: true })"));
});

test('manager URL exclusions are permission-gated and applied before page UI runs', () => {
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

  assert.ok(launcher.includes("type: 'CHECK_EXTENSION_PAGE_ALLOWED'"));
  assert.ok(launcher.includes("url.searchParams.set('panel', panel)"));
  assert.ok(launcher.includes("'page-exclusions'"));
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
  assert.ok(jobDetectionItemRoute.includes('export async function DELETE'));
  assert.ok(managerSettings.includes('ManagerJobDetectionUrlAccessForm'));
  assert.ok(serviceWorker.includes('configuredDetailUrl'));
  assert.ok(serviceWorker.includes("msg.type === 'UPDATE_MANAGER_PAGE_EXCLUSION'"));
});

test('manager URL exclusions update UI and workflows across SPA navigation', () => {
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
  assert.ok(serviceWorker.includes('changes[PAGE_EXCLUSIONS_STORAGE_KEY]'));
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
  assert.ok(highlighter.includes("'authToken'"));
  assert.ok(highlighter.includes("changes.authToken"));
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

  assert.ok(launcher.includes("['generation', 'Generation', '▤', 'generation']"));
  assert.ok(launcher.includes("button.dataset.modeAction = active ? 'cancel_status' : action"));
  assert.ok(serviceWorker.includes("'/api/extension/generation/cancel-all'"));
  assert.ok(serviceWorker.includes('ACTIVE_GENERATION_JOB_KEY'));
  assert.ok(serviceWorker.includes('removeQueuedGenerationDownloads(downloadIds)'));
  assert.ok(cancelAllRoute.includes('generationStatus: "not_queued"'));
  assert.ok(cancelAllRoute.includes('inArray(jobs.generationStatus, ["queued", "processing"])'));
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
  assert.ok(review.includes('visible && signedIn && profilesLoaded && extensionStatus === \'get_jd\''));
  assert.ok(review.includes('!profilesLoaded'));
  assert.ok(review.includes('Loading your candidate accounts...'));
  assert.ok(review.includes('prefers-reduced-motion: reduce'));
  assert.ok(review.includes('if (!sessionIsValid(stored))'));
  assert.ok(review.includes('result.classification.matchingProfileIds'));
  assert.ok(serviceWorker.includes('selectionModified: true'));
  assert.ok(serviceWorker.includes('profiles.filter((profile) => profile.available !== false)'));
  assert.ok(serviceWorker.includes("status: 'complete'"));
  assert.ok(review.includes("checkbox.disabled = !selectionEnabled || profile.available === false"));
  assert.ok(review.includes('checkbox.checked = selectedIds.has(profile.id)'));
  assert.ok(review.includes('readSelectedIds().filter((id) => availableIds.has(id))'));
  assert.ok(review.includes("profile.jobStatus === 'todo'"));
  assert.ok(review.includes("'In Jobs · To do'"));
  assert.ok(review.includes("elements.heading.textContent = 'Save result'"));
  assert.ok(review.includes('Successfully saved ${savedCount}'));
  assert.ok(review.includes("? 'Already applied.'"));
  assert.ok(review.includes("? 'Already added.'"));
  assert.ok(review.includes("result.toastMessage || 'New job.'"));
  assert.ok(serviceWorker.includes('if (result.allCandidatesAssigned === true || availableProfiles.length === 0)'));
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
  assert.ok(forms.includes('whitespace-nowrap'));
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
  assert.ok(launcher.includes("url.searchParams.set('panel', panel)"));
  assert.ok(launcher.includes("highlightButton.hidden = response?.ok !== true || response.canManageTextHighlights !== true"));
  assert.ok(highlighter.includes('changes.authToken'));
  assert.ok(highlighter.includes('changes.authExpiresAt'));
  assert.ok(featureRoute.includes('managerCanManageTextHighlights(manager.id)'));
  assert.ok(highlightsRoute.includes('managerCanManageTextHighlights(manager.id)'));
  assert.ok(settingsPage.includes('<ManagerTextHighlightAccessForm'));
  assert.ok(settingsActions.includes('actor.role !== "super_admin"'));
  assert.ok(settingsActions.includes('canManageTextHighlights: enabledValue === "true"'));
  assert.ok(manifest.web_accessible_resources.some((entry) => (
    entry.resources || []
  ).includes('popup/*')));
});

test('page Sign In uses the two-field top-right form instead of the embedded panel', () => {
  const launcher = fs.readFileSync(
    path.join(extensionRoot, 'content', 'page-launcher.js'),
    'utf8',
  );
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const signInBranch = serviceWorker.slice(
    serviceWorker.indexOf("if (action === 'sign_in')"),
    serviceWorker.indexOf("if (action === 'sign_out')"),
  );

  assert.ok(launcher.includes("signInForm.className = 'sign-in-form'"));
  assert.ok(launcher.includes("userLabel.textContent = 'User Name'"));
  assert.ok(launcher.includes("passwordLabel.textContent = 'Password'"));
  assert.ok(launcher.includes("passwordInput.addEventListener('change', submitSignIn)"));
  assert.equal(signInBranch.includes('openCapturePanel'), false);
});

test('PDF downloads use the extension bridge without a directory picker', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'manifest.json'), 'utf8'));
  const workspace = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'pdf', 'pdf-workspace.tsx'),
    'utf8',
  );
  const worker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );
  const contentScripts = manifest.content_scripts.flatMap((entry) => entry.js || []);

  assert.ok(contentScripts.includes('content/pdf-download-bridge.js'));
  assert.equal(workspace.includes('showDirectoryPicker'), false);
  assert.ok(workspace.includes('QTS_DOWNLOAD_APPLICATION_FILES'));
  assert.ok(worker.includes("filename: file.downloadPath"));
  assert.ok(worker.includes('saveAs: false'));
});

test('page toasts use a modern theme and keep the newest notice on top', () => {
  const toast = fs.readFileSync(
    path.join(extensionRoot, 'content', 'detect-toast.js'),
    'utf8',
  );

  assert.ok(toast.includes('host.insertBefore(toast, host.firstChild)'));
  assert.ok(toast.includes("!toast.classList.contains('is-leaving')"));
  assert.ok(toast.includes('activeToasts.pop()'));
  assert.ok(toast.includes('backdrop-filter: blur(12px)'));
  assert.ok(toast.includes('border-left: 4px solid var(--qts-toast-accent'));
  assert.ok(toast.includes('@media (prefers-reduced-motion: reduce)'));
});
