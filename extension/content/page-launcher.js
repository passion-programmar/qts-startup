function hasValidExtensionContext() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

async function initializeQtsPageLauncher() {
  if (!hasValidExtensionContext()) {
    document.querySelectorAll('[data-qts-page-launcher]').forEach((node) => node.remove());
    globalThis.__qtsPageLauncher = { excluded: true };
    return;
  }
  if (globalThis.__qtsPageLauncher) return;
  const pageAccess = await chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_PAGE_ALLOWED' });
  if (!pageAccess?.ok || pageAccess.excluded) {
    globalThis.__qtsPageLauncher = { excluded: true };
    return;
  }

  // A launcher left by this extension before it was reloaded can no longer reach it.
  document.querySelectorAll('[data-qts-page-launcher]').forEach((node) => node.remove());
  const host = document.createElement('div');
  host.setAttribute('data-qts-page-launcher', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .launcher { position: fixed; right: 180px; bottom: 24px; width: 60px; height: 60px; font-family: Inter, ui-sans-serif, system-ui, sans-serif; pointer-events: auto; transition: right .28s cubic-bezier(.2,.8,.2,1); }
    /* Signed out, the launcher is hidden; the toolbar icon opens the Sign In card instead. */
    .launcher:not(.signed-in) { display: none; }
    .launcher.signed-in { animation: qts-launcher-enter .7s cubic-bezier(.34,1.56,.64,1) both; }
    @keyframes qts-launcher-enter { from { opacity: 0; transform: translateY(24px) scale(.3) rotate(-120deg); } to { opacity: 1; transform: none; } }
    .launcher::after { content: ""; position: absolute; inset: -16px; z-index: 0; border-radius: 50%; background: radial-gradient(circle, #a78bfa73 0%, #22d3ee40 42%, transparent 70%); filter: blur(6px); animation: qts-breathe 3.2s ease-in-out infinite; pointer-events: none; }
    @keyframes qts-breathe { 0%, 100% { opacity: .55; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.1); } }
    .launcher::before { content: ""; position: absolute; inset: -3px; z-index: 1; border-radius: 50%; background: conic-gradient(from 0deg, #f59e0b, #f43f5e, #d946ef, #6366f1, #06b6d4, #10b981, #f59e0b); box-shadow: 0 0 20px #8b5cf670; animation: qts-border-rotate 4s linear infinite; pointer-events: none; }
    .launcher.open::before { animation-duration: 1.6s; }
    @keyframes qts-border-rotate { to { transform: rotate(360deg); } }
    .burst { position: absolute; inset: 0; z-index: 0; border: 3px solid #8b5cf6; border-radius: 50%; opacity: 0; pointer-events: none; }
    .launcher.activated .burst { animation: qts-burst 1.1s cubic-bezier(.2,.8,.2,1) .35s; }
    .launcher.activated .burst + .burst { border-color: #22d3ee; animation-delay: .55s; }
    @keyframes qts-burst { 0% { opacity: .9; transform: scale(1); } 100% { opacity: 0; transform: scale(2.8); } }
    .main { position: absolute; inset: 3px; z-index: 3; display: grid; place-items: center; width: 54px; height: 54px; padding: 0; overflow: hidden; border: 2px solid #fff; border-radius: 50%; background: radial-gradient(circle at 32% 26%, #fff 0%, #f8fafc 40%, #e0e7ff 100%); box-shadow: inset 0 -8px 16px #6366f12e, 0 10px 28px #4f46e559; cursor: pointer; transition: transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease, background .2s ease; }
    .main::after { content: ""; position: absolute; inset: 0; background: linear-gradient(115deg, transparent 35%, #ffffffe6 50%, transparent 65%); transform: translateX(-130%); animation: qts-sheen 4.5s ease-in-out infinite; pointer-events: none; }
    @keyframes qts-sheen { 0%, 72% { transform: translateX(-130%); } 100% { transform: translateX(130%); } }
    .main:hover { transform: scale(1.08); box-shadow: inset 0 -8px 16px #6366f12e, 0 14px 36px #4f46e580; }
    .launcher.open .main { transform: scale(.94); }
    .launcher.not-job-page .main, .launcher.not-job-page .main:hover { border-color: #fecaca; background: radial-gradient(circle at 32% 26%, #fecaca 0%, #dc2626 100%); box-shadow: 0 0 0 6px #dc262633, 0 12px 32px #dc262666; animation: qts-shake .45s ease; }
    .launcher.not-job-page::before { background: #ef4444; }
    @keyframes qts-shake { 0%, 100% { translate: 0; } 20% { translate: -4px; } 40% { translate: 4px; } 60% { translate: -3px; } 80% { translate: 3px; } }
    .main:focus-visible, .action:focus-visible, .close:focus-visible { outline: 3px solid #a78bfa; outline-offset: 3px; }
    .brand-icon { position: relative; z-index: 1; display: block; width: 38px; height: 38px; object-fit: contain; object-position: center; filter: drop-shadow(0 2px 3px #0f172a47); transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
    .launcher.open .brand-icon { transform: rotate(-12deg) scale(.92); }
    .busy-dot { position: absolute; top: -2px; right: -2px; z-index: 4; display: none; width: 15px; height: 15px; border: 2px solid #fff; border-radius: 50%; background: #10b981; animation: qts-ping 1.6s ease-out infinite; pointer-events: none; }
    .launcher.busy .busy-dot { display: block; }
    @keyframes qts-ping { 0% { box-shadow: 0 0 0 0 #10b981aa; } 100% { box-shadow: 0 0 0 11px #10b98100; } }
    .action { --x: 0px; --y: 0px; --a1: #6366f1; --a2: #8b5cf6; --glow: #6366f166; position: absolute; top: 50%; left: 50%; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; width: 76px; height: 76px; margin: -38px 0 0 -38px; padding: 8px 4px; border: 1.5px solid transparent; border-radius: 24px; background: linear-gradient(160deg, #ffffffee, #f8fafcdb) padding-box, linear-gradient(135deg, var(--a1), var(--a2)) border-box; color: #0f172a; box-shadow: 0 12px 28px -8px var(--glow), 0 3px 8px #0f172a1f; backdrop-filter: blur(14px) saturate(1.5); font: 700 10px/1.1 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: .01em; text-align: center; cursor: pointer; opacity: 0; visibility: hidden; transform: translate(0, 0) scale(.3) rotate(-25deg); transition: transform .42s cubic-bezier(.34,1.56,.64,1), opacity .2s ease, visibility .42s, box-shadow .2s ease; }
    .action[hidden] { display: none; }
    .action-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 11px; background: linear-gradient(135deg, var(--a1), var(--a2)); color: #fff; font-size: 17px; line-height: 1; box-shadow: 0 6px 14px -4px var(--glow), inset 0 1px 0 #ffffff5c; text-shadow: 0 1px 1px #0f172a40; }
    .launcher.open .action { opacity: 1; visibility: visible; transform: translate(var(--x), var(--y)) scale(1); transition-delay: calc(var(--i, 0) * 40ms); }
    .launcher.open .action:hover { transform: translate(var(--x), calc(var(--y) - 4px)) scale(1.08); box-shadow: 0 18px 34px -8px var(--glow), 0 4px 10px #0f172a24; transition-delay: 0s; }
    .launcher.open .action:disabled { opacity: .6; cursor: progress; }
    .action.get-jd { --a1: #06b6d4; --a2: #3b82f6; --glow: #0ea5e966; }
    .action.generation { --a1: #8b5cf6; --a2: #d946ef; --glow: #a855f766; }
    .action.apply { --a1: #10b981; --a2: #14b8a6; --glow: #10b98166; }
    .action.logout { --a1: #f43f5e; --a2: #fb923c; --glow: #f43f5e66; }
    .action.text-highlights { --a1: #f59e0b; --a2: #eab308; --glow: #f59e0b66; }
    .action.page-exclusions { --a1: #64748b; --a2: #6366f1; --glow: #6366f155; }
    /* A running mode turns its button into a pulsing red Cancel. */
    .action.running { --a1: #ef4444; --a2: #f97316; --glow: #ef444466; }
    .action.running .action-icon { animation: qts-pulse 1.4s ease-in-out infinite; }
    @keyframes qts-pulse { 50% { transform: scale(1.14); } }
    .get-jd { --x: -150px; --y: 0px; }
    .generation { --x: -122px; --y: -88px; }
    .apply { --x: -46px; --y: -143px; }
    .logout { --x: 46px; --y: -143px; }
    .text-highlights { --x: 122px; --y: -88px; }
    .page-exclusions { --x: 150px; --y: 0px; }
    .sign-in-form { position: fixed; top: 16px; right: 16px; z-index: 5; width: min(328px, calc(100vw - 32px)); overflow: hidden; padding: 18px 16px 14px; border: 1px solid #ffffffb3; border-radius: 20px; background: linear-gradient(160deg, #ffffffeb, #f5f3ffe6); box-shadow: 0 28px 64px -14px #312e8173, 0 0 0 1px #6366f11f; backdrop-filter: blur(18px) saturate(1.6); color: #0f172a; font-family: Inter, ui-sans-serif, system-ui, sans-serif; pointer-events: auto; animation: qts-card-in .34s cubic-bezier(.2,.9,.3,1.2) both; }
    .sign-in-form::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; background: linear-gradient(90deg, #f59e0b, #f43f5e, #d946ef, #6366f1, #06b6d4); }
    .sign-in-form[hidden] { display: none; }
    @keyframes qts-card-in { from { opacity: 0; transform: translateY(-12px) scale(.96); } to { opacity: 1; transform: none; } }
    .sign-in-header { display: flex; align-items: center; gap: 11px; margin-bottom: 12px; }
    .sign-in-logo { display: grid; flex: none; place-items: center; width: 40px; height: 40px; border-radius: 13px; background: radial-gradient(circle at 32% 26%, #fff 0%, #e0e7ff 100%); box-shadow: inset 0 -4px 10px #6366f12e, 0 6px 16px -4px #4f46e566; }
    .sign-in-logo img { width: 28px; height: 28px; object-fit: contain; filter: drop-shadow(0 1px 2px #0f172a47); }
    .sign-in-title { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
    .sign-in-title strong { font: 800 15px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sign-in-title span { color: #64748b; font: 500 12px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sign-in-form .close { width: 28px; height: 28px; background: #eef2ff; color: #4338ca; font-size: 18px; }
    .sign-in-form iframe { display: block; width: 100%; height: 206px; border: 0; background: transparent; color-scheme: normal; transition: height .2s ease; }
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
    .launcher.get-jd-active { right: calc(min(400px, 48vw) + 180px); }
    /* A Get JD page that needs the Manager keeps an orange badge until the notice is resolved. */
    .notice-badge { position: absolute; top: -4px; left: -4px; z-index: 4; display: none; place-items: center; width: 20px; height: 20px; padding: 0; border: 2px solid #fff; border-radius: 50%; background: #f97316; color: #fff; font: 800 12px/1 Inter, ui-sans-serif, system-ui, sans-serif; box-shadow: 0 2px 8px #f9731688; cursor: pointer; }
    .launcher.has-notice .notice-badge { display: grid; }
    .outcome { position: fixed; right: 16px; bottom: 100px; z-index: 5; width: min(340px, calc(100vw - 32px)); padding: 14px 14px 12px; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 14px; background: #fff; color: #0f172a; box-shadow: 0 18px 44px -12px #0f172a59; font: 13px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; pointer-events: auto; animation: qts-card-in .28s cubic-bezier(.2,.9,.3,1.2) both; }
    .outcome[hidden] { display: none; }
    .outcome.tone-info { border-left-color: #3b82f6; }
    .outcome.tone-warn { border-left-color: #f97316; }
    .outcome.tone-error { border-left-color: #ef4444; }
    .outcome.get-jd-active { right: calc(min(400px, 48vw) + 16px); }
    .outcome-head { display: flex; align-items: flex-start; gap: 10px; }
    .outcome-message { flex: 1; margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .outcome .close { flex: none; width: 24px; height: 24px; font-size: 16px; }
    .outcome-countdown { margin: 6px 0 0; color: #475569; font-size: 12px; }
    .outcome-countdown[hidden] { display: none; }
    .outcome-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .outcome-actions:empty { display: none; }
    .outcome-actions button { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; color: #0f172a; font: 700 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .outcome-actions button.primary { border-color: #4f46e5; background: #4f46e5; color: #fff; }
    .outcome-actions button:disabled { opacity: .6; cursor: progress; }
    .outcome-auto { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: #64748b; font-size: 12px; cursor: pointer; }
    @media (max-width: 520px) {
      .launcher { right: calc(50vw - 30px); bottom: 18px; }
      .action { width: 66px; height: 66px; margin: -33px 0 0 -33px; border-radius: 21px; }
      .action-icon { width: 28px; height: 28px; font-size: 15px; }
      .get-jd { --x: -112px; --y: 0px; }
      .generation { --x: -91px; --y: -66px; }
      .apply { --x: -35px; --y: -106px; }
      .logout { --x: 35px; --y: -106px; }
      .text-highlights { --x: 91px; --y: -66px; }
      .page-exclusions { --x: 112px; --y: 0px; }
      .launcher.get-jd-active { right: calc(50vw - 30px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .main, .action, .launcher, .brand-icon, .sign-in-form iframe { transition: none; }
      .launcher, .launcher::before, .launcher::after, .main::after, .burst, .busy-dot, .action-icon, .main, .sign-in-form { animation: none !important; }
    }
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
  const busyDot = document.createElement('span');
  busyDot.className = 'busy-dot';
  // Two rings ripple out once when the launcher activates after sign-in.
  const bursts = [0, 1].map(() => {
    const ring = document.createElement('span');
    ring.className = 'burst';
    return ring;
  });
  const noticeBadge = document.createElement('button');
  noticeBadge.className = 'notice-badge';
  noticeBadge.type = 'button';
  noticeBadge.textContent = '!';
  noticeBadge.setAttribute('aria-label', 'Show what Get JD needs on this page');
  launcher.append(...bursts, main, busyDot, noticeBadge);

  const actions = [
    ['get_jd', 'Get JD', '⌕', 'get-jd'],
    ['generation', 'Generation', '▤', 'generation'],
    ['text_highlights', 'Text Highlight', '✎', 'text-highlights'],
    ['page_exclusions', 'URL Settings', '⊘', 'page-exclusions'],
    ['apply', 'Apply', '→', 'apply'],
    ['session', 'Sign In', '↪', 'logout'],
  ];
  // Buttons fan out left to right around the arc.
  const revealOrder = ['get-jd', 'generation', 'apply', 'logout', 'text-highlights', 'page-exclusions'];
  for (const [action, label, icon, positionClass] of actions) {
    const button = document.createElement('button');
    button.className = `action ${positionClass}`;
    button.style.setProperty('--i', String(revealOrder.indexOf(positionClass)));
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

  // Credentials are typed in an extension-origin frame, never in this page's DOM,
  // so page scripts and session-replay tools cannot observe the key presses.
  const signInForm = document.createElement('div');
  signInForm.className = 'sign-in-form';
  signInForm.hidden = true;
  signInForm.setAttribute('role', 'dialog');
  signInForm.setAttribute('aria-label', 'QTS Manager sign in');
  const signInHeader = document.createElement('div');
  signInHeader.className = 'sign-in-header';
  const signInLogo = document.createElement('span');
  signInLogo.className = 'sign-in-logo';
  const signInLogoImage = document.createElement('img');
  signInLogoImage.src = chrome.runtime.getURL('assets/wys-launcher.png');
  signInLogoImage.alt = '';
  signInLogo.appendChild(signInLogoImage);
  const signInTitle = document.createElement('div');
  signInTitle.className = 'sign-in-title';
  const signInHeading = document.createElement('strong');
  signInHeading.textContent = 'QTS Manager';
  const signInSubtitle = document.createElement('span');
  signInSubtitle.textContent = 'Sign in to activate the launcher';
  signInTitle.append(signInHeading, signInSubtitle);
  const signInClose = document.createElement('button');
  signInClose.className = 'close';
  signInClose.type = 'button';
  signInClose.setAttribute('aria-label', 'Close sign in');
  signInClose.textContent = '×';
  signInHeader.append(signInLogo, signInTitle, signInClose);
  signInForm.appendChild(signInHeader);
  let signInFrame = null;

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

  // How Get JD ended on this page: a closing countdown, or a notice with the actions that resolve it.
  const outcomeCard = document.createElement('section');
  outcomeCard.className = 'outcome';
  outcomeCard.hidden = true;
  outcomeCard.setAttribute('role', 'status');
  outcomeCard.setAttribute('aria-live', 'polite');
  const outcomeHead = document.createElement('div');
  outcomeHead.className = 'outcome-head';
  const outcomeMessage = document.createElement('p');
  outcomeMessage.className = 'outcome-message';
  const outcomeClose = document.createElement('button');
  outcomeClose.className = 'close';
  outcomeClose.type = 'button';
  outcomeClose.setAttribute('aria-label', 'Hide this message');
  outcomeClose.textContent = '×';
  outcomeHead.append(outcomeMessage, outcomeClose);
  const outcomeCountdown = document.createElement('p');
  outcomeCountdown.className = 'outcome-countdown';
  const outcomeActions = document.createElement('div');
  outcomeActions.className = 'outcome-actions';
  const outcomeAuto = document.createElement('label');
  outcomeAuto.className = 'outcome-auto';
  const outcomeAutoInput = document.createElement('input');
  outcomeAutoInput.type = 'checkbox';
  outcomeAuto.append(outcomeAutoInput, document.createTextNode('Close finished job tabs automatically'));
  outcomeCard.append(outcomeHead, outcomeCountdown, outcomeActions, outcomeAuto);

  // The daily "Clear applied jobs?" question: asked at the first Get JD start after 4:00 PM
  // Romania time, once across all Chromes. Get JD starts either way.
  const cleanupStyle = document.createElement('style');
  cleanupStyle.textContent = `
    .cleanup { position: fixed; inset: 0; z-index: 5; display: grid; place-items: center; padding: 16px; background: #0f172a8c; pointer-events: auto; font: 14px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
    .cleanup[hidden] { display: none; }
    .cleanup-card { width: min(420px, 100%); padding: 22px; border-radius: 16px; background: #fff; color: #0f172a; box-shadow: 0 24px 60px #0f172a59; }
    .cleanup-card h2 { margin: 0 0 8px; font-size: 17px; }
    .cleanup-card p { margin: 0; color: #475569; font-size: 13px; }
    .cleanup-buttons { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
    .cleanup-buttons button { min-height: 38px; padding: 0 16px; border-radius: 10px; font: 600 13px Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .cleanup-later { border: 1px solid #cbd5e1; background: #fff; color: #334155; }
    .cleanup-yes { border: 0; background: #4f46e5; color: #fff; }
  `;
  const cleanup = document.createElement('div');
  cleanup.className = 'cleanup';
  cleanup.hidden = true;
  cleanup.setAttribute('role', 'alertdialog');
  cleanup.setAttribute('aria-modal', 'true');
  const cleanupCard = document.createElement('div');
  cleanupCard.className = 'cleanup-card';
  const cleanupTitle = document.createElement('h2');
  cleanupTitle.textContent = 'Clear applied jobs?';
  const cleanupText = document.createElement('p');
  const cleanupButtons = document.createElement('div');
  cleanupButtons.className = 'cleanup-buttons';
  const cleanupLater = document.createElement('button');
  cleanupLater.type = 'button';
  cleanupLater.className = 'cleanup-later';
  cleanupLater.textContent = 'Not now';
  const cleanupYes = document.createElement('button');
  cleanupYes.type = 'button';
  cleanupYes.className = 'cleanup-yes';
  cleanupYes.textContent = 'Yes, remove';
  cleanupButtons.append(cleanupLater, cleanupYes);
  cleanupCard.append(cleanupTitle, cleanupText, cleanupButtons);
  cleanup.append(cleanupCard);

  function askAppliedCleanup(count) {
    cleanupText.textContent = `${count} job row${count === 1 ? ' is' : 's are'} already applied. Remove ${count === 1 ? 'it' : 'them'} from the Jobs page? Their bids stay on the Bids page.`;
    cleanup.hidden = false;
    cleanupLater.focus();
    cleanupLater.onclick = () => { cleanup.hidden = true; };
    cleanupYes.onclick = async () => {
      cleanupYes.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: 'clear_applied_jobs' });
        if (!result?.ok) throw new Error(result?.error || 'Could not clear the applied jobs.');
        showToast(result.message || 'Applied jobs cleared.', 'success');
      } catch (error) {
        showToast(error?.message || 'Could not clear the applied jobs.', 'error');
      } finally {
        cleanupYes.disabled = false;
        cleanup.hidden = true;
      }
    };
  }

  root.append(style, cleanupStyle, launcher, signInForm, preview, outcomeCard, cleanup);
  (document.documentElement || document.body).appendChild(host);

  function setOpen(open) {
    launcher.classList.toggle('open', open);
    main.setAttribute('aria-expanded', String(open));
    main.setAttribute(
      'aria-label',
      launcher.classList.contains('signed-in')
        ? open ? 'Close QTS actions' : 'Open QTS actions'
        : 'Sign in to QTS',
    );
  }

  function syncGetJdDocking() {
    const docked = document.documentElement?.getAttribute('data-qts-get-jd-docked') === 'true';
    launcher.classList.toggle('get-jd-active', docked);
    outcomeCard.classList.toggle('get-jd-active', docked);
  }

  const getJdDockObserver = new MutationObserver(syncGetJdDocking);
  getJdDockObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-qts-get-jd-docked'],
  });
  syncGetJdDocking();

  // All toasts on the page share one stack (content/page-toast.js).
  function showToast(message, type = 'info') {
    globalThis.__qtsPageToast?.show(message, { type });
  }

  function showSignInForm() {
    setOpen(false);
    if (!signInFrame) {
      signInFrame = document.createElement('iframe');
      signInFrame.title = 'QTS Manager sign in';
      signInFrame.src = chrome.runtime.getURL('signin/signin.html');
      signInFrame.addEventListener('load', () => signInFrame?.focus(), { once: true });
      signInForm.appendChild(signInFrame);
    } else {
      signInFrame.focus();
    }
    signInForm.hidden = false;
  }

  function hideSignInForm() {
    signInForm.hidden = true;
    // Removing the frame discards anything typed into it.
    signInFrame?.remove();
    signInFrame = null;
  }

  // The toolbar icon: signed out it shows or hides the Sign In card; signed in it opens or closes the actions.
  async function toggleFromToolbar() {
    if (await syncSessionAction()) {
      setOpen(!launcher.classList.contains('open'));
      main.focus();
      return;
    }
    if (signInForm.hidden) showSignInForm();
    else hideSignInForm();
  }

  function playActivation() {
    launcher.classList.remove('activated');
    void launcher.offsetWidth; // Restart the ripple if it is still running.
    launcher.classList.add('activated');
    setTimeout(() => launcher.classList.remove('activated'), 1800);
  }

  // The sign-in frame reports its content height so the card fits an error message without a scrollbar.
  const onWindowMessage = (event) => {
    if (!signInFrame || event.source !== signInFrame.contentWindow) return;
    const height = Number(event.data?.qtsSignInHeight);
    if (Number.isFinite(height) && height > 0) signInFrame.style.height = `${Math.min(Math.ceil(height), 400)}px`;
  };

  async function syncTextHighlightAction() {
    const highlightButton = launcher.querySelector('[data-action="text_highlights"]');
    const exclusionsButton = launcher.querySelector('[data-action="page_exclusions"]');
    if (!highlightButton && !exclusionsButton) return;
    const signedIn = await syncSessionAction();
    if (!signedIn) {
      if (highlightButton) highlightButton.hidden = true;
      if (exclusionsButton) exclusionsButton.hidden = true;
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: 'GET_MANAGER_EXTENSION_FEATURES' });
    if (highlightButton) {
      highlightButton.hidden = response?.ok !== true || response.canManageTextHighlights !== true;
      highlightButton.dataset.tabId = response?.tabId == null ? '' : String(response.tabId);
    }
    if (exclusionsButton) {
      exclusionsButton.hidden = response?.ok !== true
        || (response.canManagePageExclusions !== true && response.canManageJobDetectionUrlRules !== true);
      exclusionsButton.dataset.tabId = response?.tabId == null ? '' : String(response.tabId);
    }
  }

  // The Get JD panel is injected on demand instead of on every page.
  async function ensureGetJdPanel() {
    if (typeof globalThis.__qtsInitializeGetJdReview !== 'function') {
      const response = await chrome.runtime.sendMessage({ type: 'QTS_ENSURE_GET_JD_PANEL' });
      if (!response?.ok) throw new Error(response?.error || 'The QTS panel could not load on this page.');
    }
    await globalThis.__qtsInitializeGetJdReview?.();
  }

  async function openManagerPanel(button, panel, permissionKey, permissionName, options = {}) {
    setOpen(false);
    button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_MANAGER_EXTENSION_FEATURES',
        refresh: true,
      });
      const hasPermission = Array.isArray(permissionKey)
        ? permissionKey.some((key) => response?.[key] === true)
        : response?.[permissionKey] === true;
      if (!response?.ok || !hasPermission) {
        button.hidden = true;
        throw new Error(response?.error || `Ask your Super Admin for ${permissionName}.`);
      }
      if (!Number.isInteger(response.tabId)) {
        throw new Error('The current page is unavailable for Manager settings.');
      }
      await ensureGetJdPanel();
      const managerPanel = globalThis.__qtsGetJdReview;
      if (typeof managerPanel?.openManagerSettings !== 'function') {
        throw new Error('The QTS Manager panel is not ready. Reload this page and try again.');
      }
      await managerPanel.openManagerSettings(panel, response.tabId, {
        canManageTextHighlights: response.canManageTextHighlights === true,
        canManagePageExclusions: response.canManagePageExclusions === true,
        canManageJobDetectionUrlRules: response.canManageJobDetectionUrlRules === true,
      }, options);
    } catch (error) {
      showToast(error?.message || 'Could not open Manager settings.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function openHighlightPanel(button) {
    await openManagerPanel(
      button,
      'text-highlights',
      'canManageTextHighlights',
      'text highlight management',
    );
  }

  async function openPageExclusionPanel(button, options = {}) {
    await openManagerPanel(
      button,
      'page-exclusions',
      ['canManagePageExclusions', 'canManageJobDetectionUrlRules'],
      'URL settings access',
      options,
    );
  }

  // Get JD outcome card: the countdown before a finished tab closes, or a notice that keeps the badge.
  let currentOutcome = null;
  let outcomeTimer = null;
  let outcomeHideTimer = null;

  function clearOutcomeTimers() {
    clearInterval(outcomeTimer);
    clearTimeout(outcomeHideTimer);
    outcomeTimer = null;
    outcomeHideTimer = null;
  }

  function clearOutcome() {
    clearOutcomeTimers();
    currentOutcome = null;
    outcomeCard.hidden = true;
    launcher.classList.remove('has-notice');
  }

  const OUTCOME_ACTIONS = {
    open_description: 'Open description',
    try_again: 'Try again',
    send_anyway: 'Send anyway',
    never_on_site: 'Never on this site',
  };

  async function canBlockUrls() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_MANAGER_EXTENSION_FEATURES' }).catch(() => null);
    return response?.ok === true && response.canManageJobDetectionUrlRules === true;
  }

  async function runOutcomeAction(action, button) {
    const outcome = currentOutcome;
    if (!outcome) return;
    if (action === 'open_description' && outcome.descriptionUrl) {
      location.assign(outcome.descriptionUrl);
      return;
    }
    if (action === 'never_on_site') {
      const urlButton = launcher.querySelector('[data-action="page_exclusions"]');
      outcomeCard.hidden = true;
      await openPageExclusionPanel(urlButton || button, { prefillBlockedUrl: outcome.blockedUrlFragment || '' });
      return;
    }
    button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'QTS_GET_JD_RETRY', force: action === 'send_anyway' });
      if (!response?.ok) throw new Error(response?.error || 'Could not run Get JD again.');
      clearOutcome();
      showToast(action === 'send_anyway' ? 'Sending this page to Get JD…' : 'Checking this page again…');
    } catch (error) {
      showToast(error?.message || 'Could not run Get JD again.', 'error');
      button.disabled = false;
    }
  }

  async function showOutcome(outcome) {
    if (outcome?.kind === 'clear') {
      clearOutcome();
      return;
    }
    if (!outcome?.message || (outcome.pageUrl && outcome.pageUrl !== location.href)) return;
    clearOutcomeTimers();
    currentOutcome = outcome;
    outcomeCard.className = `outcome tone-${outcome.tone || 'success'}`;
    syncGetJdDocking();
    outcomeMessage.textContent = outcome.message;
    outcomeAutoInput.checked = outcome.autoClose !== false;
    outcomeActions.replaceChildren();
    const actions = Array.isArray(outcome.actions) ? outcome.actions : [];
    const allowBlocking = actions.includes('never_on_site') && await canBlockUrls();
    if (currentOutcome !== outcome) return;
    actions
      .filter((action) => OUTCOME_ACTIONS[action] && (action !== 'never_on_site' || allowBlocking))
      .forEach((action, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = OUTCOME_ACTIONS[action];
        if (index === 0) button.className = 'primary';
        button.addEventListener('click', () => runOutcomeAction(action, button));
        outcomeActions.appendChild(button);
      });
    launcher.classList.toggle('has-notice', outcome.kind === 'notice');
    outcomeCard.hidden = false;
    const seconds = Number(outcome.closeInSeconds) || 0;
    if (outcome.kind !== 'done') {
      outcomeCountdown.hidden = true;
      return;
    }
    if (seconds <= 0) {
      // Nothing to close here (auto-close is off or not allowed on this tab): the message fades out.
      outcomeCountdown.hidden = true;
      outcomeHideTimer = setTimeout(clearOutcome, 6000);
      return;
    }
    const keepOpen = document.createElement('button');
    keepOpen.type = 'button';
    keepOpen.className = 'primary';
    keepOpen.textContent = 'Keep open';
    keepOpen.addEventListener('click', () => {
      clearOutcomeTimers();
      outcomeCountdown.textContent = 'This tab stays open.';
      keepOpen.remove();
      outcomeHideTimer = setTimeout(clearOutcome, 4000);
    });
    outcomeActions.appendChild(keepOpen);
    let remaining = seconds;
    const tick = () => {
      outcomeCountdown.hidden = false;
      outcomeCountdown.textContent = `Closing this tab in ${remaining} s…`;
    };
    tick();
    outcomeTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        tick();
        return;
      }
      clearOutcomeTimers();
      outcomeCountdown.textContent = 'Closing…';
      chrome.runtime.sendMessage({ type: 'QTS_GET_JD_CLOSE_TAB', pageUrl: outcome.pageUrl })
        .then((response) => {
          if (response?.ok) return;
          outcomeCountdown.textContent = 'This tab stays open.';
          keepOpen.remove();
          outcomeHideTimer = setTimeout(clearOutcome, 4000);
        })
        .catch(() => {});
    }, 1000);
  }

  outcomeClose.addEventListener('click', () => {
    // Hiding a notice keeps its badge; hiding a countdown also keeps the tab open.
    if (currentOutcome?.kind === 'notice') {
      clearOutcomeTimers();
      outcomeCard.hidden = true;
    } else {
      clearOutcome();
    }
  });
  noticeBadge.addEventListener('click', () => {
    if (currentOutcome?.kind === 'notice') outcomeCard.hidden = !outcomeCard.hidden;
  });
  outcomeAutoInput.addEventListener('change', () => {
    const enabled = outcomeAutoInput.checked;
    chrome.runtime.sendMessage({ type: 'QTS_SET_GET_JD_AUTO_CLOSE', enabled }).catch(() => {});
    if (!enabled && outcomeTimer) {
      clearOutcomeTimers();
      outcomeCountdown.textContent = 'Auto-close is off. This tab stays open.';
      outcomeActions.querySelector('.primary')?.remove();
      outcomeHideTimer = setTimeout(clearOutcome, 4000);
    }
  });

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
    if (!button) return launcher.classList.contains('signed-in');
    // The service worker publishes only the session expiry; the token never reaches this page.
    const stored = await chrome.storage.local.get(['authExpiresAt']);
    const expiresAt = Number(stored.authExpiresAt) || 0;
    const signedIn = expiresAt > Date.now();
    launcher.classList.toggle('signed-in', signedIn);
    button.dataset.sessionAction = signedIn ? 'sign_out' : 'sign_in';
    button.setAttribute('aria-label', signedIn ? 'Sign Out' : 'Sign In');
    const icon = button.querySelector('.action-icon');
    const label = button.querySelector('.action-icon + span');
    if (icon) icon.textContent = signedIn ? '↪' : '→';
    if (label) label.textContent = signedIn ? 'Sign Out' : 'Sign In';
    // Signed out, an open Sign In card stays put: sign-in clears the old session first, which lands here mid-login.
    if (signedIn) {
      hideSignInForm();
    } else {
      setOpen(false);
      preview.hidden = true;
      if (expiresAt > 0) {
        chrome.storage.local.set({ qtsExtensionStatus: null, qtsGetJdOn: false }).catch((error) => {
          console.error('[QTS extension] Could not clear expired extension status:', error);
        });
      }
    }
    return signedIn;
  }

  // Two switches per Chrome: Get JD on/off (qtsGetJdOn) and the work slot (qtsExtensionStatus:
  // generation or apply). Each running mode turns its own button into its own Cancel.
  async function syncModeActions() {
    const stored = await chrome.storage.local.get(['qtsExtensionStatus', 'qtsGetJdOn']);
    const workStatus = stored.qtsExtensionStatus;
    const getJdOn = stored.qtsGetJdOn === true;
    const labels = {
      get_jd: 'Get JD',
      generation: 'Generation',
      apply: 'Apply',
    };
    launcher.classList.toggle('busy', getJdOn || workStatus === 'generation' || workStatus === 'apply');
    for (const [action, defaultLabel] of Object.entries(labels)) {
      const button = launcher.querySelector(`[data-action="${action}"]`);
      if (!button) continue;
      const active = action === 'get_jd' ? getJdOn : workStatus === action;
      button.classList.toggle('running', active);
      button.dataset.modeAction = active ? (action === 'get_jd' ? 'cancel_get_jd' : 'cancel_status') : action;
      button.setAttribute('aria-label', active ? `Cancel ${defaultLabel}` : defaultLabel);
      const icon = button.querySelector('.action-icon');
      const label = button.querySelector('.action-icon + span');
      if (icon) icon.textContent = active ? '×' : action === 'get_jd' ? '⌕' : action === 'generation' ? '▤' : '→';
      if (label) label.textContent = active ? 'Cancel' : defaultLabel;
    }
  }

  async function runAction(action, button) {
    if (action === 'text_highlights') {
      await openHighlightPanel(button);
      return;
    }
    if (action === 'page_exclusions') {
      await openPageExclusionPanel(button);
      return;
    }
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
      if (resolvedAction !== 'sign_out' && !(await syncSessionAction())) {
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
        hideSignInForm();
        globalThis.__qtsPageToast?.clear();
        await syncSessionAction();
      } else if (['get_jd', 'generation', 'apply', 'cancel_status', 'cancel_get_jd'].includes(resolvedAction)) {
        showToast(
          response.message || (resolvedAction.startsWith('cancel_') ? 'Cancelled.' : 'Started.'),
          response.warning ? 'warn' : 'info',
        );
        if (resolvedAction === 'get_jd' && response.appliedCleanupCount > 0) askAppliedCleanup(response.appliedCleanupCount);
        await syncModeActions();
      }
    } catch (error) {
      showToast(error?.message || 'Could not run this QTS action.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  main.addEventListener('click', async () => {
    // The launcher is only visible while signed in; a session that just expired hides it here.
    if (!(await syncSessionAction())) return;
    setOpen(!launcher.classList.contains('open'));
  });
  launcher.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action, button));
  });
  close.addEventListener('click', () => { preview.hidden = true; });
  signInClose.addEventListener('click', hideSignInForm);
  // Page-wide listeners belong to this launcher instance and are removed by disable().
  const onStorageChanged = (changes, area) => {
    if (area !== 'local') return;
    if (changes.authExpiresAt) {
      syncSessionAction()
        .then(() => syncTextHighlightAction())
        .catch(() => {});
      // Sign-in always clears the previous session first, so a fresh expiry means a new sign-in.
      if (changes.authExpiresAt.newValue && !changes.authExpiresAt.oldValue) {
        hideSignInForm();
        playActivation();
        showToast('Signed in. QTS actions are ready.', 'success');
      }
    }
    if (changes.qtsExtensionStatus || changes.qtsGetJdOn) syncModeActions().catch(() => {});
  };
  let notJobPageTimer = null;
  const onRuntimeMessage = (message) => {
    if (message?.type === 'QTS_HIDE_SIGN_IN_FRAME') {
      hideSignInForm();
      return;
    }
    if (message?.type === 'QTS_GET_JD_OUTCOME') {
      showOutcome(message.outcome).catch(() => {});
      return;
    }
    // Get JD found no job on this page: flash the launcher red once instead of showing a toast.
    if (message?.type === 'QTS_NOT_JOB_PAGE') {
      clearTimeout(notJobPageTimer);
      launcher.classList.add('not-job-page');
      notJobPageTimer = setTimeout(() => launcher.classList.remove('not-job-page'), 1200);
      return;
    }
    if (message?.type !== 'QTS_GENERATION_PROGRESS') return;
    showToast(
      String(message.message || 'Generation updated.'),
      message.statusType || 'info',
    );
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      preview.hidden = true;
      hideSignInForm();
    }
  };
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('message', onWindowMessage);

  syncSessionAction().catch(() => {});
  syncModeActions().catch(() => {});
  chrome.storage.local.get(['qtsGetJdOn', 'authExpiresAt'])
    .then((stored) => {
      // Restore a saved review after reloads while Get JD is active.
      if (stored.qtsGetJdOn !== true || !((Number(stored.authExpiresAt) || 0) > Date.now())) return;
      return ensureGetJdPanel();
    })
    .catch((error) => console.warn('[QTS Get JD] Could not restore the review panel:', error));
  syncTextHighlightAction().catch((error) => {
    console.warn('[QTS text highlights] Could not verify Manager access:', error);
  });
  globalThis.__qtsPageLauncher = {
    excluded: false,
    setOpen,
    showPreview,
    syncSessionAction,
    syncModeActions,
    syncTextHighlightAction,
    openPageExclusionPanel,
    toggleFromToolbar,
    disable() {
      setOpen(false);
      preview.hidden = true;
      hideSignInForm();
      getJdDockObserver.disconnect();
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('message', onWindowMessage);
      host.remove();
      globalThis.__qtsPageLauncher = { excluded: true };
    },
  };
}

let pageLauncherInitialization = null;

// Overlapping restores (navigation plus a rule change) share one initialization instead of adding two launchers.
function initializeQtsPageLauncherOnce() {
  if (globalThis.__qtsPageLauncher) return Promise.resolve();
  if (!pageLauncherInitialization) {
    pageLauncherInitialization = initializeQtsPageLauncher().finally(() => {
      pageLauncherInitialization = null;
    });
  }
  return pageLauncherInitialization;
}

function restorePageLauncher() {
  if (!globalThis.__qtsPageLauncher?.excluded) return;
  globalThis.__qtsPageLauncher = null;
  initializeQtsPageLauncherOnce().catch((error) => {
    console.error('[QTS extension] Could not restore page actions:', error);
  });
}

globalThis.__qtsInitializePageLauncher = initializeQtsPageLauncherOnce;
// These listeners outlive any one launcher so a disabled launcher can come back.
if (!globalThis.__qtsPageLauncherNavigationListener) {
  globalThis.__qtsPageLauncherNavigationListener = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'QTS_TOOLBAR_ICON_CLICKED') {
      // A click before the page finishes loading starts the launcher early instead of being dropped.
      initializeQtsPageLauncherOnce()
        .then(async () => {
          const pageLauncher = globalThis.__qtsPageLauncher;
          if (!pageLauncher || pageLauncher.excluded) {
            sendResponse({ ok: false, excluded: true });
            return;
          }
          await pageLauncher.toggleFromToolbar();
          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error('[QTS extension] Could not respond to the toolbar icon:', error);
          sendResponse({ ok: false });
        });
      return true;
    }
    if (message?.type !== 'QTS_PAGE_URL_CHANGED') return;
    if (message.excluded) {
      globalThis.__qtsPageLauncher?.disable?.();
      return;
    }
    restorePageLauncher();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.qtsManagerJobDetectionUrlRules || changes.authExpiresAt)) return;
    chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_PAGE_ALLOWED' })
      .then((response) => {
        if (!response?.ok) return;
        if (response.excluded) globalThis.__qtsPageLauncher?.disable?.();
        else restorePageLauncher();
      })
      .catch((error) => console.error('[QTS extension] Could not apply URL exclusions:', error));
  });
}

function initializePageLauncherAfterLoad() {
  initializeQtsPageLauncherOnce().catch((error) => {
    console.error('[QTS extension] Could not verify page access:', error);
  });
}

if (document.readyState === 'complete') initializePageLauncherAfterLoad();
else window.addEventListener('load', initializePageLauncherAfterLoad, { once: true });
