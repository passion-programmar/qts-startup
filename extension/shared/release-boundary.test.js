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
  const serviceWorker = fs.readFileSync(
    path.join(extensionRoot, 'background', 'service-worker.js'),
    'utf8',
  );

  assert.ok(scripts.includes('content/page-launcher.js'));
  assert.ok(scripts.includes('shared/page-exclusions.js'));
  assert.ok(
    scripts.indexOf('shared/page-exclusions.js')
      < scripts.indexOf('content/page-launcher.js'),
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
  assert.ok(launcher.includes("document.readyState === 'complete'"));
  assert.ok(launcher.includes("window.addEventListener('load', initializeQtsPageLauncher, { once: true })"));
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
  assert.ok(serviceWorker.includes("[EXTENSION_STATUS_KEY]: 'cancel'"));
  assert.ok(launcher.includes("'Sign In'"));
  assert.ok(launcher.includes("'Sign Out'"));
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

  assert.ok(profilesRoute.includes('getExtensionManager(request)'));
  assert.ok(profilesRoute.includes('eq(users.parentUserId, manager.id)'));
  assert.ok(profilesRoute.includes('category: categories.name'));
  assert.ok(review.includes("type: 'GET_MANAGER_CANDIDATE_PROFILES'"));
  assert.ok(review.includes('position: fixed; inset: 0 0 0 auto'));
  assert.ok(review.includes('if (!sessionIsValid(stored))'));
  assert.ok(review.includes('result.classification.matchingProfileIds'));
  assert.ok(serviceWorker.includes('selectionModified: true'));
  assert.ok(serviceWorker.includes('profiles.filter((profile) => profile.available !== false)'));
  assert.ok(serviceWorker.includes("status: 'complete'"));
  assert.ok(review.includes("checkbox.disabled = !selectionEnabled || profile.available === false"));
  assert.ok(review.includes("elements.heading.textContent = 'Save result'"));
  assert.ok(review.includes('Successfully saved ${savedCount}'));
  assert.ok(review.includes("? 'Already applied.'"));
  assert.ok(review.includes("? 'Already added.'"));
  assert.ok(review.includes("result.toastMessage || 'New job.'"));
  assert.ok(serviceWorker.includes('result.exists === true || result.allCandidatesAssigned === true'));
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
  const forms = fs.readFileSync(
    path.join(extensionRoot, '..', 'src', 'app', 'components', 'record-forms.tsx'),
    'utf8',
  );

  assert.ok(jobsPage.includes('<JobActions'));
  assert.ok(actions.includes('export async function updateJobAction'));
  assert.ok(actions.includes('export async function deleteJobAction'));
  assert.ok(actions.includes('eq(jobs.managerId, manager.id)'));
  assert.ok(actions.includes('eq(users.parentUserId, manager.id)'));
  assert.ok(actions.includes('description: description || null'));
  assert.ok(forms.includes('label="Job description"'));
  assert.ok(forms.includes('updateJobAction'));
  assert.ok(forms.includes('deleteJobAction'));
  assert.ok(actions.includes('generationStatus, "processing"'));
});

test('the login panel submits completed credentials without a timer or button', () => {
  const popupHtml = fs.readFileSync(path.join(extensionRoot, 'popup', 'popup.html'), 'utf8');
  const popupScript = fs.readFileSync(path.join(extensionRoot, 'popup', 'popup.js'), 'utf8');

  assert.equal(popupHtml.includes('id="btn-login"'), false);
  assert.ok(popupHtml.includes('<form id="login-form"'));
  assert.ok(popupScript.includes("loginPassword.addEventListener('change', submitCompletedLogin)"));
  assert.equal(popupScript.includes('setTimeout(submitCompletedLogin'), false);
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
