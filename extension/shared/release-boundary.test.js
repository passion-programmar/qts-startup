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
  assert.ok(launcher.includes("'Sign In'"));
  assert.ok(launcher.includes("'Sign Out'"));
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
