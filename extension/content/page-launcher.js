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

  // While the actions panel is open the page moves left, so the panel never covers it (the Apply
  // and Get JD panels, which dock in the same place, take precedence).
  const MENU_WIDTH = 'min(320px, 48vw)';
  document.querySelectorAll('[data-qts-menu-dock]').forEach((node) => node.remove());
  const dock = document.createElement('style');
  dock.setAttribute('data-qts-menu-dock', '');
  dock.textContent = `
    html[data-qts-menu-docked="true"]:not([data-qts-apply-docked="true"]):not([data-qts-get-jd-docked="true"]) body { box-sizing: border-box !important; padding-right: ${MENU_WIDTH} !important; }
    html body { transition: padding-right .28s cubic-bezier(.2,.8,.2,1); }
  `;
  (document.head || document.documentElement).appendChild(dock);

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    /* Closed, the actions wait as a tab on the right edge, like the Apply panel when hidden. */
    .launcher { position: fixed; top: 50%; right: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; pointer-events: auto; transform: translateY(-50%); transition: right .28s cubic-bezier(.2,.8,.2,1); }
    /* Signed out, the launcher is hidden; the toolbar icon opens the Sign In card instead. */
    .launcher:not(.signed-in) { display: none; }
    /* Open, the docked panel takes its place. */
    .launcher.open { display: none; }
    /* Q · T · S stacked in the header's Quality + Time + Speed colours, on a slim edge. */
    .main { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; width: 34px; padding: 10px 0 8px; border: 1px solid rgb(148 163 184 / .18); border-right: 0; border-radius: 14px 0 0 14px; background: linear-gradient(180deg, #131c31, #0a0f1c); box-shadow: -8px 0 24px rgb(2 6 23 / .45), inset 1px 0 0 rgb(255 255 255 / .05); font: 800 12px/1 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; transition: transform .2s cubic-bezier(.2,.8,.2,1), background .2s ease; }
    .main::before { content: ""; position: absolute; top: 12px; bottom: 12px; left: -1px; width: 2px; border-radius: 2px; background: linear-gradient(180deg, #fcd34d, #e2e8f0 50%, #60a5fa); }
    .letter { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; }
    .letter.q { background: rgb(252 211 77 / .12); color: #fcd34d; }
    .letter.t { background: rgb(226 232 240 / .08); color: #e2e8f0; }
    .letter.s { background: rgb(96 165 250 / .14); color: #60a5fa; }
    .chev { margin-top: 2px; color: #66758c; font-size: 13px; transition: color .2s ease, transform .2s ease; }
    .main:hover .chev { color: #e2e8f0; transform: translateX(-2px); }
    .main:hover { transform: translateX(-4px); background: linear-gradient(180deg, #18233b, #0d1526); }
    .launcher.activated .main { animation: qts-pop .5s ease; }
    @keyframes qts-pop { 50% { transform: translateX(-6px); } }
    .main:focus-visible, .action:focus-visible, .close:focus-visible, .hide:focus-visible { outline: 3px solid #a78bfa; outline-offset: 3px; }
    /* One dot, the most urgent state: needs you (orange) > failed (red) > running (green). */
    .status-dot { position: absolute; top: -5px; left: -5px; z-index: 2; display: none; width: 12px; height: 12px; border: 2px solid #0a0f1c; border-radius: 50%; pointer-events: none; }
    .launcher.running .status-dot { display: block; background: #10b981; }
    .launcher.failed .status-dot { display: block; background: #ef4444; }
    .launcher.needs .status-dot { display: block; background: #f97316; }
    /* The actions, docked on the right like the Apply panel: the page moves left instead of being covered. */
    .menu { position: fixed; inset: 0 0 0 auto; display: flex; flex-direction: column; width: ${MENU_WIDTH}; height: 100vh; height: 100dvh; border-left: 1px solid #243047; overflow: hidden; background: #0a0f1c; color: #e2e8f0; color-scheme: dark; box-shadow: -12px 0 32px rgb(0 0 0 / 35%); font: 13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; pointer-events: auto; }
    .menu[hidden] { display: none; }
    .brand { display: grid; flex: 0 0 64px; grid-template-columns: 42px 1fr auto; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #243047; background: #0d1526; }
    .brand-logo { width: 42px; height: 42px; border: 1px solid #243047; border-radius: 9px; object-fit: contain; background: #070b13; }
    .brand-center { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 4px; }
    .pills { display: flex; align-items: center; gap: 3px; }
    .pill { padding: 4px 7px; border: 1px solid #34425a; border-radius: 999px; background: #111a2e; font-size: 10px; font-weight: 700; line-height: 1; white-space: nowrap; }
    .pill.q { color: #fcd34d; } .pill.t { color: #e2e8f0; } .pill.s { color: #60a5fa; }
    .plus { color: #66758c; font-size: 9px; }
    .subline { color: #66758c; font-size: 7px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; }
    .hide { width: 30px; height: 30px; border: 1px solid #34425a; border-radius: 9px; background: #111a2e; color: #cbd5e1; font-size: 15px; cursor: pointer; }
    .hide:hover { background: #1a2438; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 6px; }
    .stat { display: flex; flex-direction: column; gap: 4px; padding: 9px 10px 8px; border: 1px solid #243047; border-radius: 12px; background: #0d1526; }
    .stat-label { font: 800 10px/1 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; }
    .stat-value { color: #f1f5f9; font: 750 20px/1 Inter, ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
    .stat.urls .stat-label { color: #fcd34d; }
    .stat.jobs .stat-label { color: #e2e8f0; }
    .stat.applied .stat-label { color: #60a5fa; }
    .menu-list { display: flex; flex: 1 1 auto; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; padding: 16px; scrollbar-color: #34425a transparent; scrollbar-width: thin; }
    .label-top { margin-top: 6px; color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .label-top:first-child { margin-top: 0; }
    .menu-foot { flex: 0 0 auto; padding: 12px 16px 14px; border-top: 1px solid #243047; background: #0d1526; }
    .action { --tint: rgb(99 102 241 / .16); --ink: #a5b4fc; display: grid; grid-template-columns: 34px 1fr auto; align-items: center; column-gap: 10px; row-gap: 2px; width: 100%; min-height: 48px; padding: 7px 10px; border: 1px solid #243047; border-radius: 12px; background: #111a2e; color: #e2e8f0; font: 700 13px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
    .action[hidden] { display: none; }
    .action:hover:not(:disabled) { border-color: #34425a; background: #1a2438; }
    .action:disabled { opacity: .6; cursor: progress; }
    .action-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: var(--tint); color: var(--ink); font-size: 16px; line-height: 1; }
    .action-tag { padding: 2px 7px; border: 1px solid #34425a; border-radius: 999px; color: #94a3b8; font-size: 10px; font-weight: 700; white-space: nowrap; }
    .action-tag:empty { display: none; }
    .action-tag.on { border-color: rgb(16 185 129 / .5); color: #6ee7b7; }
    .action-tag.needs { border-color: rgb(249 115 22 / .55); color: #fdba74; }
    .action-tag.failed { border-color: rgb(239 68 68 / .55); color: #fca5a5; }
    /* What the mode is doing now, under its name; it stays until the next change. */
    .action-detail { grid-column: 2 / -1; color: #94a3b8; font: 500 11.5px/1.35 Inter, ui-sans-serif, system-ui, sans-serif; overflow-wrap: anywhere; }
    .action-detail:empty { display: none; }
    .action-detail.warn { color: #fdba74; }
    .action-detail.error { color: #fca5a5; }
    .action-detail.good { color: #6ee7b7; }
    .action.busy { cursor: not-allowed; opacity: .7; }
    /* A row's list (Apply's applications): items under the row, on a guide line. */
    .row { display: flex; flex-direction: column; }
    .action-sub { display: flex; flex-direction: column; gap: 6px; margin: 6px 0 2px 26px; padding-left: 12px; border-left: 2px solid rgb(249 115 22 / .35); }
    .action-sub[hidden] { display: none; }
    .action-sub.running { border-left-color: rgb(16 185 129 / .4); }
    .action-sub.failed { border-left-color: rgb(239 68 68 / .45); }
    .sub-status { display: flex; align-items: center; gap: 7px; margin-top: 3px; color: #a7f3d0; font: 600 11px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-status.error { color: #fca5a5; }
    .sub-bar { flex: 0 0 46px; height: 4px; overflow: hidden; border-radius: 4px; background: #243047; }
    .sub-fill { display: block; height: 100%; border-radius: 4px; background: #10b981; transition: width .3s ease; }
    .sub-item { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; padding: 7px 9px; border: 1px solid #243047; border-radius: 10px; background: #0d1526; color: #e2e8f0; text-align: left; cursor: pointer; transition: border-color .15s ease, background .15s ease; }
    .sub-item:hover { border-color: rgb(249 115 22 / .5); background: #111a2e; }
    .sub-avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: rgb(16 185 129 / .14); color: #6ee7b7; font: 800 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-text { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
    .sub-name, .sub-job { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub-name { font: 650 12.5px/1.25 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-job { color: #94a3b8; font: 500 11.5px/1.25 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-go { color: #fdba74; font: 700 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
    .action.get-jd { --tint: rgb(14 165 233 / .16); --ink: #7dd3fc; }
    .action.generation { --tint: rgb(168 85 247 / .16); --ink: #d8b4fe; }
    .action.apply { --tint: rgb(16 185 129 / .16); --ink: #6ee7b7; }
    .action.custom { --tint: rgb(100 116 139 / .2); --ink: #cbd5e1; }
    .action.custom:disabled { cursor: not-allowed; }
    .action.text-highlights { --tint: rgb(245 158 11 / .16); --ink: #fcd34d; }
    .action.page-exclusions { --tint: rgb(99 102 241 / .16); --ink: #a5b4fc; }
    .action.logout { --tint: rgb(244 63 94 / .16); --ink: #fda4af; }
    /* A running mode: a green edge, and its icon becomes a red × that stops it. */
    .action.running { --tint: rgb(244 63 94 / .18); --ink: #fda4af; border-color: rgb(16 185 129 / .45); background: rgb(16 185 129 / .06); }
    /* Cards stay clear of the docked actions. */
    :host([data-menu-open]) .preview, :host([data-menu-open]) .outcome { right: calc(${MENU_WIDTH} + 16px); }
    /* Signed out, the panel holds only the sign-in form; signed in, only the actions. */
    .menu.signed-out .menu-list, .menu.signed-out .menu-foot { display: none; }
    .sign-in-form { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow: auto; padding: 36px 20px 18px; }
    .sign-in-mark { display: flex; justify-content: center; gap: 6px; margin-bottom: 18px; }
    .sign-in-mark .letter { width: 40px; height: 40px; border-radius: 12px; font: 800 18px/1 Inter, ui-sans-serif, system-ui, sans-serif; box-shadow: inset 0 1px 0 rgb(255 255 255 / .06); }
    .sign-in-form[hidden] { display: none; }
    .sign-in-title { margin: 0 0 6px; color: #f8fafc; font: 750 21px/1.25 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: -.02em; text-align: center; }
    .sign-in-note { margin: 0 auto 24px; max-width: 240px; color: #94a3b8; font: 500 13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; text-align: center; }
    .sign-in-secure { margin: auto 0 0; padding-top: 18px; color: #66758c; font: 500 11px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; text-align: center; }
    .sign-in-form iframe { display: block; width: 100%; height: 206px; border: 0; background: transparent; color-scheme: dark; transition: height .2s ease; }
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
    .apply-pick .pick-job { margin: 0 0 4px; font-weight: 700; }
    .apply-pick .pick-note { margin: 0 0 6px; color: #475569; }
    .apply-pick .pick-account { display: block; width: 100%; margin-top: 8px; padding: 9px 12px; border: 1px solid #10b981; border-radius: 10px; background: #ecfdf5; color: #065f46; font: 700 13px/1.3 system-ui, sans-serif; text-align: left; cursor: pointer; }
    .apply-pick .pick-account:hover:not(:disabled) { background: #d1fae5; }
    .apply-pick .pick-account:disabled { opacity: .6; cursor: wait; }
    .launcher.get-jd-active { right: min(400px, 48vw); }
    /* A Get JD page that needs the Manager keeps an orange badge until the notice is resolved. */
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
    @media (prefers-reduced-motion: reduce) {
      .main, .action, .launcher, .sign-in-form iframe { transition: none; }
      .main { animation: none !important; }
    }
`;

  const launcher = document.createElement('div');
  launcher.className = 'launcher';
  const main = document.createElement('button');
  main.className = 'main';
  main.type = 'button';
  main.setAttribute('aria-label', 'Open QTS actions');
  main.setAttribute('aria-expanded', 'false');
  for (const letter of ['q', 't', 's']) {
    main.append(Object.assign(document.createElement('span'), { className: `letter ${letter}`, textContent: letter.toUpperCase() }));
  }
  main.append(Object.assign(document.createElement('span'), { className: 'chev', textContent: '‹' }));
  main.title = 'Show the QTS panel';
  const statusDot = document.createElement('span');
  statusDot.className = 'status-dot';
  launcher.append(main, statusDot);

  // The actions panel, docked on the right like the Apply panel (same header).
  const menu = document.createElement('aside');
  menu.className = 'menu';
  menu.hidden = true;
  menu.setAttribute('aria-label', 'QTS actions');
  const menuBrand = document.createElement('header');
  menuBrand.className = 'brand';
  const menuLogo = document.createElement('img');
  menuLogo.className = 'brand-logo';
  menuLogo.alt = 'WYS';
  menuLogo.src = chrome.runtime.getURL('assets/account-logo.png');
  const menuBrandCenter = document.createElement('div');
  menuBrandCenter.className = 'brand-center';
  const pills = document.createElement('div');
  pills.className = 'pills';
  for (const [className, text] of [['pill q', 'Quality'], ['plus', '+'], ['pill t', 'Time'], ['plus', '+'], ['pill s', 'Speed']]) {
    pills.append(Object.assign(document.createElement('span'), { className, textContent: text }));
  }
  menuBrandCenter.append(pills, Object.assign(document.createElement('span'), { className: 'subline', textContent: 'Built for precision bidding' }));
  const menuHide = document.createElement('button');
  menuHide.className = 'hide';
  menuHide.type = 'button';
  menuHide.textContent = '›';
  menuHide.title = 'Hide the panel';
  menuHide.setAttribute('aria-label', 'Close QTS actions');
  menuBrand.append(menuLogo, menuBrandCenter, menuHide);
  const menuList = document.createElement('div');
  menuList.className = 'menu-list';
  const menuFoot = document.createElement('div');
  menuFoot.className = 'menu-foot';
  menu.append(menuBrand, menuList, menuFoot);

  // In this order; Highlight and Site Setting show only for a Manager assigned them, Custom is not built yet.
  const actions = [
    ['Work'],
    ['get_jd', 'Get JD', '⌕', 'get-jd'],
    ['generation', 'Generation', '▤', 'generation'],
    ['apply', 'Apply', '→', 'apply'],
    ['custom', 'Custom', '✦', 'custom'],
    ['Tools'],
    ['text_highlights', 'Highlight', '✎', 'text-highlights'],
    ['page_exclusions', 'Site Setting', '⊘', 'page-exclusions'],
    ['session', 'Sign In', '↪', 'logout'],
  ];
  // Today's counts, above the actions: new job URLs (each job once), job rows added, applications.
  const stats = document.createElement('div');
  stats.className = 'stats';
  for (const [key, label, title] of [
    ['urls', 'URL', 'New jobs added today: each job once, however many candidates got it'],
    ['jobs', 'JOB', 'Job rows added today: one per candidate'],
    ['applied', 'APPLY', 'Applications submitted today'],
  ]) {
    const tile = document.createElement('div');
    tile.className = `stat ${key}`;
    tile.title = title;
    tile.append(
      Object.assign(document.createElement('span'), { className: 'stat-label', textContent: label }),
      Object.assign(document.createElement('span'), { className: 'stat-value', textContent: '–' }),
    );
    stats.append(tile);
  }
  menuList.append(Object.assign(document.createElement('div'), { className: 'label-top', textContent: 'Today' }), stats);

  for (const [action, label, icon, className] of actions) {
    if (!label) {
      const heading = document.createElement('div');
      heading.className = 'label-top';
      heading.textContent = action;
      menuList.appendChild(heading);
      continue;
    }
    const button = document.createElement('button');
    button.className = `action ${className}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    const iconElement = document.createElement('span');
    iconElement.className = 'action-icon';
    iconElement.textContent = icon;
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    const tag = document.createElement('span');
    tag.className = 'action-tag';
    const detail = document.createElement('span');
    detail.className = 'action-detail';
    button.append(iconElement, labelElement, tag, detail);
    if (action === 'custom') {
      button.disabled = true;
      tag.textContent = 'Coming soon';
    }
    if (['get_jd', 'generation', 'apply'].includes(action)) {
      // A work row: its button, then a list under it (the applications waiting, for Apply).
      const row = document.createElement('div');
      row.className = 'row';
      const sub = document.createElement('div');
      sub.className = 'action-sub';
      sub.dataset.subFor = action;
      sub.hidden = true;
      row.append(button, sub);
      menuList.appendChild(row);
      continue;
    }
    (action === 'session' ? menuFoot : menuList).appendChild(button);
  }
  // The Tools heading shows only when one of its tools does.
  const toolsHeading = [...menuList.querySelectorAll('.label-top')].find((heading) => heading.textContent === 'Tools');

  // Credentials are typed in an extension-origin frame, never in this page's DOM,
  // so page scripts and session-replay tools cannot observe the key presses.
  // It is a section of the actions panel: signed out, the panel shows only this.
  const signInForm = document.createElement('section');
  signInForm.className = 'sign-in-form';
  signInForm.hidden = true;
  signInForm.setAttribute('aria-label', 'QTS Manager sign in');
  const signInMark = document.createElement('div');
  signInMark.className = 'sign-in-mark';
  for (const letter of ['q', 't', 's']) {
    signInMark.append(Object.assign(document.createElement('span'), { className: `letter ${letter}`, textContent: letter.toUpperCase() }));
  }
  const signInSecure = document.createElement('p');
  signInSecure.className = 'sign-in-secure';
  signInSecure.textContent = '🔒 Typed in QTS’s own secure frame: this page cannot see it.';
  signInForm.append(
    signInMark,
    Object.assign(document.createElement('h2'), { className: 'sign-in-title', textContent: 'Welcome back' }),
    Object.assign(document.createElement('p'), { className: 'sign-in-note', textContent: 'Sign in to your QTS Manager account to start bidding.' }),
    signInSecure,
  );
  menu.insertBefore(signInForm, menuFoot);
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

  // "Apply this page" while Apply is on: the accounts with this page's generated job, to start one here.
  const applyPick = document.createElement('section');
  applyPick.className = 'preview apply-pick';
  applyPick.hidden = true;
  applyPick.setAttribute('aria-label', 'Apply this page');

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

  root.append(style, cleanupStyle, launcher, menu, preview, applyPick, outcomeCard, cleanup);
  (document.documentElement || document.body).appendChild(host);

  function setOpen(open) {
    launcher.classList.toggle('open', open);
    menu.hidden = !open;
    host.toggleAttribute('data-menu-open', open);
    document.documentElement?.setAttribute('data-qts-menu-docked', open ? 'true' : 'false');
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
    // The Get JD panel docks where the actions panel does: it takes the place.
    if (docked && launcher.classList.contains('open')) setOpen(false);
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

  /**
   * While Apply is on, the launcher opened on a job page shows the accounts whose job here is
   * generated and can be applied to now (no bid, open in no Chrome), as buttons that start it here.
   * Nothing shows when no account has one.
   */
  async function showApplyPick() {
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'QTS_APPLY_PAGE_ACCOUNTS' });
    } catch {
      reply = null;
    }
    // Only the accounts whose job here is generated and can be applied to now.
    const applications = (reply?.applications || []).filter((application) => application.state === 'ready');
    if (!reply?.ok || !reply.applyOn || (!reply.openHere && !applications.length)) {
      applyPick.hidden = true;
      return;
    }
    const header = document.createElement('div');
    header.className = 'preview-header';
    const title = document.createElement('h2');
    title.textContent = 'Apply this page';
    const closeButton = document.createElement('button');
    closeButton.className = 'close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close Apply this page');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => { applyPick.hidden = true; });
    header.append(title, closeButton);
    const line = (className, text) => Object.assign(document.createElement('p'), { className, textContent: text });
    applyPick.replaceChildren(header);
    if (reply.openHere) {
      applyPick.append(line('pick-note', `This tab is already ${reply.openHere}'s application.`));
    } else {
      applyPick.append(line('pick-job', `${applications[0].title} · ${applications[0].company}`), line('pick-note', 'Choose the account to apply for:'));
      for (const application of applications) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pick-account';
        button.textContent = application.candidateName;
        button.addEventListener('click', () => startPick(application));
        applyPick.append(button);
      }
    }
    applyPick.hidden = false;
  }

  async function startPick(application) {
    const buttons = [...applyPick.querySelectorAll('.pick-account')];
    for (const button of buttons) button.disabled = true;
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'QTS_APPLY_PAGE_START', jobId: application.jobId });
    } catch {
      reply = null;
    }
    if (reply?.ok) {
      applyPick.hidden = true;
      setOpen(false);
      showToast(`Applying for ${application.candidateName}: QTS fills this page.`, 'success');
      return;
    }
    for (const button of buttons) button.disabled = false;
    showToast(reply?.error || 'QTS could not start this job.', 'error');
  }

  function showSignInForm() {
    menu.classList.add('signed-out');
    setOpen(true);
    if (!signInFrame) {
      signInFrame = document.createElement('iframe');
      signInFrame.title = 'QTS Manager sign in';
      signInFrame.src = chrome.runtime.getURL('signin/signin.html');
      signInFrame.addEventListener('load', () => signInFrame?.focus(), { once: true });
      signInForm.insertBefore(signInFrame, signInSecure);
    } else {
      signInFrame.focus();
    }
    signInForm.hidden = false;
  }

  // closePanel: false when signing in succeeded, so the panel turns to the actions.
  function hideSignInForm(closePanel = true) {
    const shown = !signInForm.hidden;
    signInForm.hidden = true;
    // Removing the frame discards anything typed into it.
    signInFrame?.remove();
    signInFrame = null;
    if (shown && closePanel && menu.classList.contains('signed-out')) setOpen(false);
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
    const highlightButton = menu.querySelector('[data-action="text_highlights"]');
    const exclusionsButton = menu.querySelector('[data-action="page_exclusions"]');
    if (!highlightButton && !exclusionsButton) return;
    const signedIn = await syncSessionAction();
    if (!signedIn) {
      if (highlightButton) highlightButton.hidden = true;
      if (exclusionsButton) exclusionsButton.hidden = true;
      toolsHeading.hidden = true;
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
    toolsHeading.hidden = Boolean(highlightButton?.hidden !== false && exclusionsButton?.hidden !== false);
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
    syncModeActions().catch(() => {});
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
      const urlButton = menu.querySelector('[data-action="page_exclusions"]');
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
    outcomeCard.hidden = false;
    syncModeActions().catch(() => {});
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
    // Hiding a notice keeps the orange dot (opening the panel shows it again); hiding a countdown also keeps the tab open.
    if (currentOutcome?.kind === 'notice') {
      clearOutcomeTimers();
      outcomeCard.hidden = true;
    } else {
      clearOutcome();
    }
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
    const button = menu.querySelector('[data-action="session"], [data-session-action]');
    if (!button) return launcher.classList.contains('signed-in');
    // The service worker publishes only the session expiry; the token never reaches this page.
    const stored = await chrome.storage.local.get(['authExpiresAt']);
    const expiresAt = Number(stored.authExpiresAt) || 0;
    const signedIn = expiresAt > Date.now();
    launcher.classList.toggle('signed-in', signedIn);
    menu.classList.toggle('signed-out', !signedIn);
    button.dataset.sessionAction = signedIn ? 'sign_out' : 'sign_in';
    button.setAttribute('aria-label', signedIn ? 'Sign Out' : 'Sign In');
    const icon = button.querySelector('.action-icon');
    const label = button.querySelector('.action-icon + span');
    if (icon) icon.textContent = signedIn ? '↪' : '→';
    if (label) label.textContent = signedIn ? 'Sign Out' : 'Sign In';
    // Signed out, an open Sign In card stays put: sign-in clears the old session first, which lands here mid-login.
    if (signedIn) {
      hideSignInForm(false);
    } else {
      if (signInForm.hidden) setOpen(false);
      preview.hidden = true;
      if (expiresAt > 0) {
        chrome.storage.local.set({ qtsExtensionStatus: null, qtsGetJdOn: false }).catch((error) => {
          console.error('[QTS extension] Could not clear expired extension status:', error);
        });
      }
    }
    return signedIn;
  }

  // Every status has one home: each mode's row (a chip and one line of what it is doing), this
  // page's Get JD result in its card, and the tab's one dot for the most urgent state. What a click
  // answered (a failure, or a warning) stays under its row until the next click: [text, 'error' | 'warn'].
  const rowNotes = new Map();
  let pageNote = null;

  // A row's list: one card per item (an application waiting, the job Generation writes). Each card
  // has who and which job, an optional status line (with a step bar), and Open, which shows its tab.
  // tone colours the list's guide line: needs (orange), running (green) or failed (red).
  function renderSub(action, items, tone = '') {
    const list = menu.querySelector(`[data-sub-for="${action}"]`);
    list.replaceChildren();
    list.hidden = !items.length;
    list.className = `action-sub ${tone}`.trim();
    for (const entry of items) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sub-item';
      item.title = entry.openTitle || 'Show its page';
      const initials = entry.avatar || String(entry.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('');
      const text = document.createElement('span');
      text.className = 'sub-text';
      text.append(
        Object.assign(document.createElement('span'), { className: 'sub-name', textContent: entry.name || 'Candidate' }),
        Object.assign(document.createElement('span'), { className: 'sub-job', textContent: [entry.company, entry.title].filter(Boolean).join(' · ') }),
      );
      if (entry.status) {
        const status = Object.assign(document.createElement('span'), { className: `sub-status ${entry.statusType || ''}`.trim() });
        if (entry.progress != null) {
          const bar = Object.assign(document.createElement('span'), { className: 'sub-bar' });
          const fill = Object.assign(document.createElement('span'), { className: 'sub-fill' });
          fill.style.width = `${Math.round(Math.min(Math.max(entry.progress, 0), 1) * 100)}%`;
          bar.append(fill);
          status.append(bar);
        }
        status.append(Object.assign(document.createElement('span'), { textContent: entry.status }));
        text.append(status);
      }
      item.append(
        Object.assign(document.createElement('span'), { className: 'sub-avatar', textContent: initials || '?' }),
        text,
        Object.assign(document.createElement('span'), { className: 'sub-go', textContent: entry.goLabel || 'Open ›' }),
      );
      item.addEventListener('click', async () => {
        const reply = entry.onOpen ? await entry.onOpen().catch((error) => ({ ok: false, error: error?.message })) : await chrome.runtime.sendMessage(entry.open).catch(() => null);
        if (!reply?.ok) showToast(reply?.error || 'QTS could not show that page.', 'error');
      });
      list.appendChild(item);
    }
  }

  // Today's counts, read while the panel is open: when it opens, and (at most every 5 seconds)
  // after a job is saved or an application changes.
  let countsAskedAt = 0;
  let countsTimer = null;
  function refreshDailyCounts(now = false) {
    if (!launcher.classList.contains('open') || !launcher.classList.contains('signed-in')) return;
    clearTimeout(countsTimer);
    const wait = now ? 0 : Math.max(0, countsAskedAt + 5000 - Date.now());
    countsTimer = setTimeout(async () => {
      countsAskedAt = Date.now();
      const reply = await chrome.runtime.sendMessage({ type: 'QTS_DAILY_COUNTS' }).catch(() => null);
      if (!reply?.ok) return;
      for (const key of ['urls', 'jobs', 'applied']) {
        stats.querySelector(`.stat.${key} .stat-value`).textContent = String(Number(reply[key]) || 0);
      }
    }, wait);
  }

  // Generation's steps, as its browser state names them (6 in all).
  const GENERATION_STEPS = {
    preparing_prompt: [1, 'Preparing the prompt'],
    opening_chatgpt: [2, 'Opening ChatGPT'],
    sending_prompt: [3, 'Sending the prompt'],
    waiting_for_response: [4, 'ChatGPT is writing'],
    validating_response: [5, 'Checking the answer'],
    response_saved: [6, 'Making the PDFs'],
    downloading: [6, 'Downloading the PDFs'],
  };

  // Two switches per Chrome: Get JD on/off (qtsGetJdOn) and the work slot (qtsExtensionStatus:
  // generation or apply). Each running mode turns its own button into its own Cancel.
  async function syncModeActions() {
    const stored = await chrome.storage.local.get([
      'qtsExtensionStatus', 'qtsGetJdOn', 'qtsGenerationBrowserState', 'qtsGenerationNotice', 'qtsApplyState',
    ]);
    const workStatus = stored.qtsExtensionStatus;
    const getJdOn = stored.qtsGetJdOn === true;
    const rows = {
      get_jd: { label: 'Get JD', icon: '⌕', active: getJdOn },
      generation: { label: 'Generation', icon: '▤', active: workStatus === 'generation' },
      apply: { label: 'Apply', icon: '→', active: workStatus === 'apply' },
    };

    if (getJdOn) {
      rows.get_jd.chip = ['On', 'on'];
      rows.get_jd.detail = currentOutcome?.kind === 'notice'
        ? ['This page needs you: see the card beside the panel.', 'warn']
        : pageNote?.url === location.href ? [pageNote.text, ''] : ['Checking each job page you open.', ''];
    }
    // Generation's latest step (with its job) or notice, whichever is newer.
    const state = stored.qtsGenerationBrowserState || {};
    const notice = stored.qtsGenerationNotice || {};
    const fromState = state.message ? { text: state.message, type: state.messageType, at: Date.parse(state.updatedAt) || 0, job: true } : null;
    const latest = [
      fromState,
      notice.message && { text: notice.message, type: 'info', at: Date.parse(notice.updatedAt) || 0 },
    ].filter(Boolean).sort((left, right) => right.at - left.at)[0];
    const step = GENERATION_STEPS[state.phase];
    const jobFailed = latest?.job === true && latest.type === 'error';
    let generationCards = [];
    if (rows.generation.active || latest?.type === 'error') {
      rows.generation.chip = latest?.type === 'error' ? ['Failed', 'failed'] : ['Running', 'on'];
      if (state.jobId && (jobFailed || (rows.generation.active && step))) {
        // The job it writes (or the one that failed) in a card under the row.
        generationCards = [{
          name: state.candidateName,
          company: state.company,
          title: state.jobTitle,
          status: jobFailed ? state.message : `${step[0]}/6 · ${step[1]}`,
          statusType: jobFailed ? 'error' : '',
          progress: jobFailed ? null : step[0] / 6,
          open: { type: 'QTS_SHOW_GENERATION' },
          openTitle: 'Show the ChatGPT tab writing it',
        }];
        rows.generation.detail = jobFailed
          ? ['This job failed: see why below.', 'error']
          : ['Writing the résumé and cover letter, one job at a time.', ''];
      } else {
        rows.generation.detail = latest ? [latest.text, latest.type === 'error' ? 'error' : ''] : ['Looking for the next ready job.', ''];
      }
    }
    renderSub('generation', generationCards, jobFailed ? 'failed' : 'running');

    const open = Array.isArray(stored.qtsApplyState?.open) ? stored.qtsApplyState.open : [];
    if (rows.apply.active) {
      rows.apply.chip = open.length ? ['Waiting for you', 'needs'] : ['Running', 'on'];
      rows.apply.detail = open.length
        ? [open.length === 1
          ? 'Fill the form, then click Submitted on its panel.'
          : `${open.length} applications waiting: fill each form, then click Submitted on its panel.`, 'warn']
        : ['Looking for a ready job.', ''];
    }

    // One work slot per Chrome: the other mode says why it cannot start instead of failing on a click.
    const busy = {
      generation: workStatus === 'apply' ? 'Apply is running in this Chrome. Stop it first.' : '',
      apply: workStatus === 'generation' ? 'Generation is running in this Chrome. Stop it first.' : '',
    };

    let failed = false;
    for (const [action, row] of Object.entries(rows)) {
      const button = menu.querySelector(`[data-action="${action}"]`);
      if (!button) continue;
      const note = rowNotes.get(action);
      const chip = note?.[1] === 'error' ? ['Failed', 'failed'] : busy[action] ? ['Busy', ''] : row.chip;
      const detail = note || (busy[action] ? [busy[action], ''] : row.detail);
      if (chip?.[1] === 'failed') failed = true;
      const active = row.active;
      button.classList.toggle('running', active);
      button.classList.toggle('busy', Boolean(busy[action]));
      button.disabled = Boolean(busy[action]);
      button.dataset.modeAction = active ? (action === 'get_jd' ? 'cancel_get_jd' : 'cancel_status') : action;
      const defaultLabel = row.label;
      button.setAttribute('aria-label', active ? `Cancel ${defaultLabel}` : defaultLabel);
      button.querySelector('.action-icon').textContent = active ? '×' : row.icon;
      button.querySelector('.action-icon + span').textContent = active ? `Cancel ${defaultLabel}` : defaultLabel;
      const tag = button.querySelector('.action-tag');
      tag.textContent = chip?.[0] || '';
      tag.className = `action-tag ${chip?.[1] || ''}`.trim();
      const line = button.querySelector('.action-detail');
      line.textContent = detail?.[0] || '';
      line.className = `action-detail ${detail?.[1] || ''}`.trim();
    }

    renderSub('apply', rows.apply.active ? open.map((entry) => ({
      name: entry.candidate,
      company: entry.company,
      title: entry.title,
      open: { type: 'QTS_SHOW_APPLICATION', attemptId: entry.attemptId },
      openTitle: 'Show this application',
    })) : [], 'needs');

    const needs = currentOutcome?.kind === 'notice' || (rows.apply.active && open.length > 0);
    launcher.classList.toggle('needs', needs);
    launcher.classList.toggle('failed', !needs && failed);
    launcher.classList.toggle('running', !needs && !failed && Object.values(rows).some((row) => row.active));
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
    // The panel stays open: the row itself shows what the click changed.
    const row = ['get_jd', 'generation', 'apply'].includes(action) ? action : null;
    if (row) rowNotes.delete(row);
    else setOpen(false);
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
        if (row && response.warning) rowNotes.set(row, [response.message || 'Started with a warning.', 'warn']);
        if (resolvedAction === 'get_jd' && response.appliedCleanupCount > 0) askAppliedCleanup(response.appliedCleanupCount);
        await syncModeActions();
      }
    } catch (error) {
      if (row) rowNotes.set(row, [error?.message || 'Could not run this QTS action.', 'error']);
      else showToast(error?.message || 'Could not run this QTS action.', 'error');
    } finally {
      button.disabled = false;
      if (row) await syncModeActions().catch(() => {});
    }
  }

  main.addEventListener('click', async () => {
    // The launcher is only visible while signed in; a session that just expired hides it here.
    if (!(await syncSessionAction())) return;
    const opening = !launcher.classList.contains('open');
    setOpen(opening);
    // Opening QTS ends any idle back-off: this Chrome checks for work right away.
    if (opening) chrome.runtime.sendMessage({ type: 'QTS_ACTIVITY' }).catch(() => {});
    // While Apply is on, a page with saved jobs offers its accounts ("Apply this page").
    if (opening) showApplyPick().catch(() => {});
    if (opening) refreshDailyCounts(true);
    // A Get JD notice hidden earlier shows again beside the panel (the orange dot stands for it).
    if (opening && currentOutcome?.kind === 'notice') outcomeCard.hidden = false;
  });
  menu.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action, button));
  });
  // Signed out, closing the panel also discards what was typed into the sign-in form.
  menuHide.addEventListener('click', () => {
    if (!signInForm.hidden) hideSignInForm();
    else setOpen(false);
  });
  close.addEventListener('click', () => { preview.hidden = true; });
  // Page-wide listeners belong to this launcher instance and are removed by disable().
  const onStorageChanged = (changes, area) => {
    if (area !== 'local') return;
    if (changes.authExpiresAt) {
      syncSessionAction()
        .then(() => syncTextHighlightAction())
        .catch(() => {});
      // Sign-in always clears the previous session first, so a fresh expiry means a new sign-in.
      // The panel stays open and turns to the actions: that is the confirmation.
      if (changes.authExpiresAt.newValue && !changes.authExpiresAt.oldValue) {
        hideSignInForm(false);
        playActivation();
      }
    }
    if (changes.qtsExtensionStatus || changes.qtsGetJdOn || changes.qtsGenerationBrowserState
      || changes.qtsGenerationNotice || changes.qtsApplyState) syncModeActions().catch(() => {});
    // An application ended (submitted or not): APPLY may have changed.
    if (changes.qtsApplyState) refreshDailyCounts();
  };
  const onRuntimeMessage = (message) => {
    if (message?.type === 'QTS_HIDE_SIGN_IN_FRAME') {
      hideSignInForm();
      return;
    }
    // A job saved here changes today's counts.
    if (message?.type === 'QTS_GET_JD_RESULT_UPDATED') {
      if (['complete', 'saved'].includes(message.result?.status)) refreshDailyCounts();
      return;
    }
    if (message?.type === 'QTS_GET_JD_OUTCOME') {
      showOutcome(message.outcome).catch(() => {});
      return;
    }
    // Get JD found no job on this page: said once, under Get JD in the panel, for this address.
    if (message?.type === 'QTS_NOT_JOB_PAGE') {
      pageNote = { url: location.href, text: 'This page is not a job page.' };
      syncModeActions().catch(() => {});
    }
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
      document.documentElement?.removeAttribute('data-qts-menu-docked');
      dock.remove();
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
