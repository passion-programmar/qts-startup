function initializeQtsPageLauncher() {
  if (globalThis.__qtsPageLauncher) return;
  if (globalThis.__qtsPageExclusions?.shouldSkipPage(location.href)) return;

  const host = document.createElement('div');
  host.setAttribute('data-qts-page-launcher', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .launcher { position: fixed; right: 112px; bottom: 28px; width: 58px; height: 58px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; pointer-events: auto; }
    .main { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; width: 58px; height: 58px; padding: 5px; border: 1px solid #c7d2fe; border-radius: 50%; background: #fff; box-shadow: 0 12px 32px #0f172a42; cursor: pointer; transition: transform .18s ease, background .18s ease; }
    .main:hover { transform: scale(1.06); background: #f8fafc; }
    .main:focus-visible, .action:focus-visible, .close:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
    .brand-icon { display: block; width: 46px; height: 46px; object-fit: contain; object-position: center; }
    .action { --x: 0px; --y: 0px; position: absolute; top: -7px; left: -7px; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; width: 72px; height: 72px; padding: 7px; border: 1px solid #c7d2fe; border-radius: 50%; background: #fff; color: #1e293b; box-shadow: 0 9px 24px #0f172a30; font: 700 10px/1.05 system-ui, sans-serif; text-align: center; cursor: pointer; opacity: 0; visibility: hidden; transform: translate(0, 0) scale(.45); transition: transform .2s ease, opacity .16s ease, visibility .2s; }
    .action:hover { color: #3730a3; background: #eef2ff; border-color: #818cf8; }
    .action-icon { color: #4f46e5; font-size: 20px; line-height: 1; }
    .launcher.open .action { opacity: 1; visibility: visible; transform: translate(var(--x), var(--y)) scale(1); }
    .get-jd { --x: -112px; --y: 0px; }
    .generation { --x: -80px; --y: -82px; }
    .apply { --x: 0px; --y: -116px; }
    .logout { --x: 82px; --y: -82px; }
    .toast { position: fixed; top: 16px; left: 16px; max-width: min(360px, calc(100vw - 32px)); padding: 11px 14px; border-radius: 9px; background: #172554; color: #fff; box-shadow: 0 9px 28px #0f172a38; font: 600 13px/1.4 system-ui, sans-serif; pointer-events: none; opacity: 0; transform: translateY(-6px); transition: opacity .16s ease, transform .16s ease; }
    .toast.visible { opacity: 1; transform: translateY(0); }
    .toast.error { background: #991b1b; }
    .sign-in-form { position: fixed; top: 24px; right: 24px; z-index: 5; display: flex; flex-direction: column; gap: 13px; width: min(300px, calc(100vw - 48px)); pointer-events: auto; }
    .sign-in-form[hidden] { display: none; }
    .sign-in-field { display: flex; flex-direction: column; gap: 6px; }
    .sign-in-field label { color: #172554; font: 800 12px/1.2 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 1px 0 #fff; }
    .sign-in-field input { width: 100%; height: 48px; padding: 0 14px; border: 2px solid #4f46e5; border-radius: 12px; background: #fff; color: #0f172a; box-shadow: 0 10px 30px #312e8150, 0 0 0 4px #eef2ff; font: 700 15px/1 system-ui, sans-serif; outline: none; }
    .sign-in-field input:focus { border-color: #f59e0b; box-shadow: 0 12px 34px #312e8150, 0 0 0 4px #fef3c7; }
    .preview { position: fixed; top: 16px; right: 16px; width: min(390px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 17px; border: 1px solid #cbd5e1; border-radius: 13px; background: #fff; color: #0f172a; box-shadow: 0 14px 42px #0f172a38; font: 13px/1.45 system-ui, sans-serif; pointer-events: auto; }
    .preview[hidden] { display: none; }
    .preview-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 11px; }
    .preview h2 { margin: 0; font-size: 17px; }
    .close { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 50%; background: #e2e8f0; color: #334155; font-size: 19px; cursor: pointer; }
    .local-note { margin: 0 0 12px; padding: 8px 10px; border-radius: 8px; background: #eef2ff; color: #3730a3; font-weight: 600; }
    .details { margin: 0; }
    .details div { margin-top: 9px; }
    .details dt { color: #64748b; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .details dd { margin: 2px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
    .description { max-height: 180px; overflow: auto; padding: 9px; border-radius: 8px; background: #f8fafc; }
    @media (max-width: 520px) {
      .launcher { right: 96px; bottom: 24px; }
      .action { width: 66px; height: 66px; }
      .logout { --x: 68px; --y: -78px; }
      .get-jd { --x: -96px; }
    }
    @media (prefers-reduced-motion: reduce) { .main, .action, .toast { transition: none; } }
  `;

  const launcher = document.createElement('div');
  launcher.className = 'launcher';
  const main = document.createElement('button');
  main.className = 'main';
  main.type = 'button';
  main.setAttribute('aria-label', 'Open QTS actions');
  main.setAttribute('aria-expanded', 'false');
  const brandIcon = document.createElement('img');
  brandIcon.className = 'brand-icon';
  brandIcon.src = chrome.runtime.getURL('assets/wys-launcher.png');
  brandIcon.alt = '';
  brandIcon.setAttribute('aria-hidden', 'true');
  main.appendChild(brandIcon);
  launcher.appendChild(main);

  const actions = [
    ['get_jd', 'Get JD', '⌕', 'get-jd'],
    ['generation', 'Generation', '✦', 'generation'],
    ['apply', 'Apply', '→', 'apply'],
    ['session', 'Sign In', '↪', 'logout'],
  ];
  for (const [action, label, icon, positionClass] of actions) {
    const button = document.createElement('button');
    button.className = `action ${positionClass}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    const iconElement = document.createElement('span');
    iconElement.className = 'action-icon';
    iconElement.textContent = icon;
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    button.append(iconElement, labelElement);
    launcher.appendChild(button);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const signInForm = document.createElement('form');
  signInForm.className = 'sign-in-form';
  signInForm.hidden = true;
  signInForm.setAttribute('aria-label', 'Manager sign in');
  const userField = document.createElement('div');
  userField.className = 'sign-in-field';
  const userLabel = document.createElement('label');
  userLabel.htmlFor = 'qts-page-login-user';
  userLabel.textContent = 'User Name';
  const userInput = document.createElement('input');
  userInput.id = 'qts-page-login-user';
  userInput.type = 'text';
  userInput.autocomplete = 'username';
  userInput.required = true;
  const passwordField = document.createElement('div');
  passwordField.className = 'sign-in-field';
  const passwordLabel = document.createElement('label');
  passwordLabel.htmlFor = 'qts-page-login-password';
  passwordLabel.textContent = 'Password';
  const passwordInput = document.createElement('input');
  passwordInput.id = 'qts-page-login-password';
  passwordInput.type = 'password';
  passwordInput.autocomplete = 'current-password';
  passwordInput.required = true;
  userField.append(userLabel, userInput);
  passwordField.append(passwordLabel, passwordInput);
  signInForm.append(userField, passwordField);

  const preview = document.createElement('section');
  preview.className = 'preview';
  preview.hidden = true;
  preview.setAttribute('aria-label', 'Extracted job details');
  const previewHeader = document.createElement('div');
  previewHeader.className = 'preview-header';
  const heading = document.createElement('h2');
  heading.textContent = 'Get JD preview';
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close Get JD preview');
  close.textContent = '×';
  previewHeader.append(heading, close);
  const localNote = document.createElement('p');
  localNote.className = 'local-note';
  localNote.textContent = 'Local extraction only. Gemini was not called.';
  const details = document.createElement('dl');
  details.className = 'details';
  preview.append(previewHeader, localNote, details);

  root.append(style, launcher, toast, signInForm, preview);
  (document.documentElement || document.body).appendChild(host);

  let toastTimer = null;
  let loginInFlight = false;
  function setOpen(open) {
    launcher.classList.toggle('open', open);
    main.setAttribute('aria-expanded', String(open));
    main.setAttribute('aria-label', open ? 'Close QTS actions' : 'Open QTS actions');
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
  }

  function showSignInForm() {
    setOpen(false);
    signInForm.hidden = false;
    userInput.focus();
  }

  async function submitSignIn() {
    const loginName = userInput.value.trim();
    const password = passwordInput.value;
    if (!loginName || !password || loginInFlight) return;
    loginInFlight = true;
    userInput.disabled = true;
    passwordInput.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'QTS_PAGE_ACTION',
        action: 'sign_in',
        loginName,
        password,
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not sign in.');
      passwordInput.value = '';
      signInForm.hidden = true;
      await syncSessionAction();
    } catch (error) {
      showToast(error?.message || 'Could not sign in.', true);
      passwordInput.select();
    } finally {
      loginInFlight = false;
      userInput.disabled = false;
      passwordInput.disabled = false;
    }
  }

  function appendDetail(label, value, className = '') {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || 'Not detected';
    if (className) description.className = className;
    wrapper.append(term, description);
    details.appendChild(wrapper);
  }

  function showPreview(job) {
    details.replaceChildren();
    appendDetail('Title', job?.title);
    appendDetail('Company', job?.company);
    appendDetail('URL', job?.jobUrl);
    appendDetail('Job description', job?.description, 'description');
    preview.hidden = false;
  }

  async function syncSessionAction() {
    const button = launcher.querySelector('[data-action="session"], [data-session-action]');
    if (!button) return false;
    const stored = await chrome.storage.local.get(['authToken', 'authExpiresAt']);
    let expiresAt = Number(stored.authExpiresAt) || 0;
    if (stored.authToken) {
      try {
        const payloadSegment = String(stored.authToken).split('.')[1];
        const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(normalized));
        if (Number.isFinite(payload.exp)) expiresAt = payload.exp * 1000;
      } catch {
        // Use the separately stored expiry when the token is not a readable JWT.
      }
    }
    const signedIn = Boolean(stored.authToken && expiresAt > Date.now());
    button.dataset.sessionAction = signedIn ? 'sign_out' : 'sign_in';
    button.setAttribute('aria-label', signedIn ? 'Sign Out' : 'Sign In');
    const icon = button.querySelector('.action-icon');
    const label = button.querySelector('.action-icon + span');
    if (icon) icon.textContent = signedIn ? '↪' : '→';
    if (label) label.textContent = signedIn ? 'Sign Out' : 'Sign In';
    return signedIn;
  }

  async function syncModeActions() {
    const stored = await chrome.storage.local.get(['qtsExtensionStatus']);
    const activeStatus = stored.qtsExtensionStatus;
    const labels = {
      get_jd: 'Get JD',
      generation: 'Generation',
      apply: 'Apply',
    };
    for (const [action, defaultLabel] of Object.entries(labels)) {
      const button = launcher.querySelector(`[data-action="${action}"]`);
      if (!button) continue;
      const active = activeStatus === action;
      button.dataset.modeAction = active ? 'cancel_status' : action;
      button.setAttribute('aria-label', active ? `Cancel ${defaultLabel}` : defaultLabel);
      const icon = button.querySelector('.action-icon');
      const label = button.querySelector('.action-icon + span');
      if (icon) icon.textContent = active ? '×' : action === 'get_jd' ? '⌕' : action === 'generation' ? '✦' : '→';
      if (label) label.textContent = active ? 'Cancel' : defaultLabel;
    }
  }

  async function runAction(action, button) {
    setOpen(false);
    button.disabled = true;
    try {
      const resolvedAction = action === 'session'
        ? button.dataset.sessionAction || 'sign_in'
        : button.dataset.modeAction || action;
      if (resolvedAction === 'sign_in') {
        showSignInForm();
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: 'QTS_PAGE_ACTION',
        action: resolvedAction,
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not run this QTS action.');
      if (resolvedAction === 'sign_out') {
        preview.hidden = true;
        showToast(response.message || 'Signed out.');
        await syncSessionAction();
      } else if (resolvedAction === 'get_jd' || resolvedAction === 'cancel_status') {
        showToast(response.message || (resolvedAction === 'cancel_status' ? 'Get JD cancelled.' : "Let's start finding Your Remote Job!"));
        await syncModeActions();
      }
    } catch (error) {
      showToast(error?.message || 'Could not run this QTS action.', true);
    } finally {
      button.disabled = false;
    }
  }

  main.addEventListener('click', () => setOpen(!launcher.classList.contains('open')));
  launcher.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action, button));
  });
  close.addEventListener('click', () => { preview.hidden = true; });
  signInForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitSignIn();
  });
  userInput.addEventListener('change', submitSignIn);
  passwordInput.addEventListener('change', submitSignIn);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.authToken || changes.authExpiresAt) {
      syncSessionAction().catch(() => {});
      if (changes.authToken?.newValue) {
        signInForm.hidden = true;
        passwordInput.value = '';
        showToast('Signed in successfully.');
      }
    }
    if (changes.qtsExtensionStatus) syncModeActions().catch(() => {});
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      preview.hidden = true;
      signInForm.hidden = true;
    }
  });

  syncSessionAction().catch(() => {});
  syncModeActions().catch(() => {});
  globalThis.__qtsPageLauncher = { setOpen, showPreview, syncSessionAction, syncModeActions };
}

if (document.readyState === 'complete') {
  initializeQtsPageLauncher();
} else {
  window.addEventListener('load', initializeQtsPageLauncher, { once: true });
}
