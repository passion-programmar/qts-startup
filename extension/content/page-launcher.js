(function bootstrapPageLauncher() {
// Manifest injection and active-tab restoration can race on a newly opened document.
if (globalThis.__qtsPageLauncherNavigationListener && hasValidExtensionContext()) return;

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
  const revision = globalThis.__qtsLauncherActivityRevision || 0;
  const ownership = await chrome.runtime.sendMessage({ type: 'QTS_GET_LAUNCHER_STATE' });
  if (revision !== (globalThis.__qtsLauncherActivityRevision || 0) && globalThis.__qtsLauncherActive === false) return;
  if (!ownership?.active || document.visibilityState === 'hidden') return;
  globalThis.__qtsLauncherActive = true;
  const pageAccess = await chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_PAGE_ALLOWED', localOnly: true });
  if (!pageAccess?.ok || pageAccess.excluded) {
    globalThis.__qtsPageLauncher = { excluded: true };
    return;
  }

  // A launcher left by this extension before it was reloaded can no longer reach it.
  document.querySelectorAll('[data-qts-page-launcher]').forEach((node) => node.remove());
  const host = document.createElement('div');
  let active = true;
  let activationTimer = null;
  host.setAttribute('data-qts-page-launcher', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });

  // While the actions panel is open the page moves left, so the panel never covers it (the Apply
  // and Get JD panels, which dock in the same place, take precedence).
  const MENU_WIDTH = 'min(384px, 48vw)';
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
    /* Today: one strip of three counts, each with its colour dot and a readable label. */
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); margin-bottom: 4px; border: 1px solid #1f2a40; border-radius: 14px; overflow: hidden; background: linear-gradient(180deg, #111a2d, #0e1627); }
    .stat { display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 11px 12px 12px; }
    .stat + .stat { border-left: 1px solid #1f2a40; }
    .stat-label { display: flex; align-items: center; gap: 6px; overflow: hidden; color: #8b9ab3; font: 650 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
    .stat-label::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; }
    .stat-value { color: #f8fafc; font: 750 22px/1 Inter, ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .stat.urls .stat-label::before { background: #fcd34d; }
    .stat.jobs .stat-label::before { background: #e2e8f0; }
    .stat.applied .stat-label::before { background: #60a5fa; }
    .menu-list { display: flex; flex: 1 1 auto; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; padding: 14px 14px 18px; scrollbar-color: #34425a transparent; scrollbar-width: thin; }
    .menu-list > * { flex-shrink: 0; }
    .label-top { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: #7d8ba3; font-size: 10.5px; font-weight: 750; letter-spacing: .09em; text-transform: uppercase; }
    .label-top::after { content: ""; flex: 1; height: 1px; background: #1a2438; }
    .label-top:first-child { margin-top: 0; }
    .label-top[hidden], .label-top[hidden] + .tools-grid { display: none; }
    /* Signed in: who is signed in on the left, a small Sign Out on the right. */
    .menu-foot { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-top: 1px solid #1f2a40; background: #0d1526; }
    .who { display: flex; min-width: 0; align-items: center; gap: 9px; }
    .who[hidden] { display: none; }
    .who-avatar { display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #6d5bd0, #3b82f6); color: #fff; font: 750 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; }
    .who-text { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
    .who-name { overflow: hidden; color: #e2e8f0; font: 650 12.5px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; text-overflow: ellipsis; white-space: nowrap; }
    .who-role { color: #7d8ba3; font: 500 11px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; text-transform: capitalize; }
    .menu-foot .action { width: auto; min-height: 34px; flex: none; grid-template-columns: 16px auto; column-gap: 7px; margin-left: auto; padding: 6px 12px; border-color: #2c3a55; border-radius: 10px; background: transparent; color: #fda4af; font-size: 12px; }
    .menu-foot .action:hover:not(:disabled) { border-color: rgb(244 63 94 / .5); background: rgb(244 63 94 / .08); }
    .menu-foot .action-icon { width: 16px; height: 16px; background: none; }
    .menu-foot .action-icon svg { width: 16px; height: 16px; }
    /* A mode or tool: icon, name, its status chip, then what a click does (Start, Stop, the switch). */
    .action { --tint: rgb(99 102 241 / .16); --ink: #a5b4fc; display: grid; grid-template-columns: 36px minmax(0, 1fr) auto auto; align-items: center; column-gap: 11px; row-gap: 3px; width: 100%; min-height: 56px; padding: 10px 12px; border: 1px solid #1f2a40; border-radius: 14px; background: #111a2d; color: #e6ebf5; font: 650 13.5px/1.2 Inter, ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
    .action[hidden] { display: none; }
    .action:hover:not(:disabled) { border-color: #2c3a55; background: #16213a; }
    .action:disabled { opacity: .6; cursor: progress; }
    .action-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--tint); color: var(--ink); }
    .action-icon svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .action-tag { grid-column: 3; grid-row: 1; padding: 3px 8px; border: 1px solid #34425a; border-radius: 999px; color: #94a3b8; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
    .action-tag:empty { display: none; }
    .action-tag.on { border-color: rgb(16 185 129 / .45); background: rgb(16 185 129 / .1); color: #6ee7b7; }
    .action-tag.needs { border-color: rgb(249 115 22 / .5); background: rgb(249 115 22 / .1); color: #fdba74; }
    .action-tag.failed { border-color: rgb(239 68 68 / .5); background: rgb(239 68 68 / .1); color: #fca5a5; }
    /* What a click does, so the card never has to put "Cancel" in its name. */
    .work-mode::after { grid-column: 4; grid-row: 1; padding: 6px 11px; border-radius: 8px; background: var(--tint); color: var(--ink); font: 700 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; white-space: nowrap; content: "Start"; }
    .work-mode.running::after { content: "Stop"; background: rgb(244 63 94 / .14); color: #fda4af; }
    .work-mode.busy::after { content: none; }
    /* Get JD is a switch: on while it checks each job page. */
    .work-mode.get-jd::after { content: ""; width: 34px; height: 20px; padding: 0; border-radius: 999px; background: radial-gradient(circle at 10px 50%, #cbd5e1 6px, transparent 6.5px), #2c3a55; }
    .work-mode.get-jd.running::after { background: radial-gradient(circle at 24px 50%, #fff 6px, transparent 6.5px), #10b981; }
    .action.get-jd .action-tag.on { display: none; }
    /* What the mode is doing now, under its name; it stays until the next change. */
    .action-detail { grid-column: 2 / -1; color: #8b9ab3; font: 500 11.5px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; overflow-wrap: anywhere; }
    .action-detail:empty { display: none; }
    .action-detail.warn { color: #fdba74; }
    .action-detail.error { color: #fca5a5; }
    .action-detail.good { color: #6ee7b7; }
    .action.busy { cursor: not-allowed; opacity: .7; }
    /* A mode is one card: its button, its account, its job list and its items. */
    .row { display: flex; flex-direction: column; border: 1px solid #1f2a40; border-radius: 14px; overflow: hidden; background: #111a2d; transition: border-color .2s ease, box-shadow .2s ease; }
    .row .action, .row .action:hover:not(:disabled) { border: 0; border-radius: 0; }
    .row .action { background: transparent; }
    .row:has(.action.running) { border-color: rgb(16 185 129 / .4); box-shadow: inset 3px 0 0 #10b981; background: linear-gradient(90deg, rgb(16 185 129 / .07), #111a2d 70%); }
    .row:has(.action-tag.needs) { border-color: rgb(249 115 22 / .45); box-shadow: inset 3px 0 0 #f97316; }
    .row:has(.action-tag.failed) { border-color: rgb(239 68 68 / .45); box-shadow: inset 3px 0 0 #ef4444; }
    /* A row's list (Apply's applications): items under the row, on a guide line. */
    .action-sub { display: flex; flex-direction: column; gap: 6px; margin: 0 12px 12px 30px; padding-left: 12px; border-left: 2px solid rgb(249 115 22 / .35); }
    .action-sub[hidden] { display: none; }
    .action-sub.running { border-left-color: rgb(16 185 129 / .4); }
    .action-sub.failed { border-left-color: rgb(239 68 68 / .45); }
    .sub-status { display: flex; align-items: center; gap: 7px; margin-top: 3px; color: #a7f3d0; font: 600 11px/1.3 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-status.error { color: #fca5a5; }
    [data-sub-for="get_jd"] .sub-status > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
    .sub-bar { flex: 0 0 46px; height: 4px; overflow: hidden; border-radius: 4px; background: #243047; }
    .sub-fill { display: block; height: 100%; border-radius: 4px; background: #10b981; transition: width .3s ease; }
    .sub-item { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; padding: 7px 9px; border: 1px solid #243047; border-radius: 10px; background: #0b1322; color: #e2e8f0; text-align: left; cursor: pointer; transition: border-color .15s ease, background .15s ease; }
    .sub-item:hover { border-color: rgb(249 115 22 / .5); background: #16213a; }
    .sub-avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: rgb(16 185 129 / .14); color: #6ee7b7; font: 800 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-text { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
    .sub-name, .sub-job { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub-name { font: 650 12.5px/1.25 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-job { color: #94a3b8; font: 500 11.5px/1.25 Inter, ui-sans-serif, system-ui, sans-serif; }
    .sub-go { color: #fdba74; font: 700 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
    .action.get-jd { --tint: rgb(14 165 233 / .16); --ink: #7dd3fc; }
    .action.generation { --tint: rgb(168 85 247 / .16); --ink: #d8b4fe; }
    .action.apply { --tint: rgb(16 185 129 / .16); --ink: #6ee7b7; }
    .action.auto-apply { --tint: rgb(59 130 246 / .16); --ink: #93c5fd; }
    /* Generation, Apply and Auto Apply share one card: the candidate on top, then the three modes. */
    .work-group { display: flex; flex-direction: column; border: 1px solid #1f2a40; border-radius: 14px; overflow: hidden; background: #111a2d; }
    .work-group .row { border: 0; border-top: 1px solid #1f2a40; border-radius: 0; background: transparent; }
    .candidate-block { display: flex; flex-direction: column; gap: 7px; padding: 12px 12px 11px; background: #0e1627; }
    .candidate-label { color: #7d8ba3; font: 750 10.5px/1 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: .09em; text-transform: uppercase; }
    .candidate-summary { color: #8b9ab3; font: 500 11.5px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; }
    .ready { margin-left: 8px; color: #7d8ba3; font: 600 11.5px/1 Inter, ui-sans-serif, system-ui, sans-serif; }
    .ready:empty { display: none; }
    .work-jobs-toggle { align-self: flex-start; margin: -6px 12px 10px 59px; padding: 2px 0; border: 0; background: none; color: #a5b4fc; font: 600 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .work-jobs-toggle:hover { color: #c4b5fd; }
    .work-jobs-toggle[hidden] { display: none; }
    .work-jobs-toggle:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
    .work-account { flex: 1 1 auto; width: 100%; min-width: 0; height: 34px; padding: 0 10px; border: 1px solid #2c3a55; border-radius: 10px; background: #0b1322; color: #cbd5e1; font: 550 12.5px/1.4 Inter, ui-sans-serif, system-ui, sans-serif; color-scheme: dark; cursor: pointer; }
    .work-account:hover:not(:disabled) { border-color: #3b4b69; }
    /* The chosen account's label colour, as an accent on the left of its dropdown. */
    .work-account.labelled { border-left-width: 4px; }
    .work-account:focus-visible, .work-start:focus-visible, .work-refresh:focus-visible, .work-link:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
    /* Tools: compact tiles, two per line, lighter than the work modes. */
    .tools-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .tools-grid .action { grid-template-columns: 30px minmax(0, 1fr); column-gap: 9px; min-height: 48px; padding: 8px 10px; border-radius: 12px; font-size: 12.5px; }
    .tools-grid .action-icon { width: 30px; height: 30px; border-radius: 9px; }
    .tools-grid .action-icon svg { width: 16px; height: 16px; }
    .tools-grid .action-icon + span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .work-picker { margin: 0 12px 12px; padding: 10px; border: 1px solid #263247; border-radius: 12px; background: #0b1322; }
    .work-picker[hidden] { display: none; }
    .work-toolbar, .work-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .work-toolbar { padding-bottom: 8px; color: #94a3b8; font: 500 11px/1.4 system-ui, sans-serif; }
    .work-toolbar label { display: flex; align-items: center; gap: 6px; }
    .work-search { flex: 1; min-width: 0; width: 100%; padding: 6px 8px; border: 1px solid #304158; border-radius: 7px; background: #081323; color: #e2e8f0; font: inherit; outline: none; }
    .work-search:focus { border-color: #a78bfa; box-shadow: 0 0 0 2px #a78bfa22; }
    .work-search::placeholder { color: #8395ad; }
    .work-toolbar label, .work-refresh { flex-shrink: 0; }
    .work-refresh { padding: 3px 6px; border: 0; border-radius: 5px; background: transparent; color: #a5b4fc; font: inherit; cursor: pointer; }
    .work-jobs { max-height: 230px; overflow-y: auto; overscroll-behavior: contain; }
    .work-job { display: flex; align-items: flex-start; gap: 9px; padding: 9px 1px; border-top: 1px solid #1d293b; }
    .work-job input { flex-shrink: 0; margin-top: 3px; accent-color: #a78bfa; }
    .work-link { display: flex; flex-direction: column; gap: 3px; min-width: 0; color: #e2e8f0; text-decoration: none; }
    .work-link:hover .work-title { color: #c4b5fd; }
    .work-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 12px/1.45 system-ui, sans-serif; }
    .work-domain { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #94a3b8; font: 400 11px/1.4 system-ui, sans-serif; }
    .work-note { padding: 9px 0; color: #94a3b8; font: 400 12px/1.5 system-ui, sans-serif; }
    .work-note.error { color: #fca5a5; }
    .work-footer { padding-top: 10px; border-top: 1px solid #263247; color: #94a3b8; font: 500 11px/1.4 system-ui, sans-serif; }
    .work-start { padding: 8px 10px; border: 1px solid #7160b0; border-radius: 8px; background: #29213f; color: #ede9fe; font: 600 12px/1.4 system-ui, sans-serif; cursor: pointer; }
    .work-start:disabled, .work-account:disabled { opacity: .5; cursor: not-allowed; }
    .work-buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
    .work-cancel { padding: 8px 10px; border: 1px solid #704050; border-radius: 8px; background: transparent; color: #fda4af; font: 600 12px/1.4 system-ui, sans-serif; cursor: pointer; }
    .work-cancel:disabled { opacity: .5; cursor: wait; }
    .work-cancel:focus-visible { outline: 2px solid #fda4af; outline-offset: 2px; }
    /* Not available yet: a quiet dashed line, not a full card. */
    .action.custom { --tint: rgb(100 116 139 / .14); --ink: #94a3b8; min-height: 44px; padding: 6px 12px; border-style: dashed; background: transparent; color: #7d8ba3; font-size: 12.5px; }
    .action.custom .action-icon { width: 28px; height: 28px; border-radius: 8px; }
    .action.custom .action-icon svg { width: 15px; height: 15px; }
    .action.custom:disabled { opacity: .75; cursor: not-allowed; }
    .action.text-highlights { --tint: rgb(245 158 11 / .16); --ink: #fcd34d; }
    .action.page-exclusions { --tint: rgb(99 102 241 / .16); --ink: #a5b4fc; }
    .action.custom-urls { --tint: rgb(20 184 166 / .16); --ink: #5eead4; }
    .action.apply-pdf-folder { --tint: rgb(236 72 153 / .14); --ink: #f9a8d4; }
    .action.logout { --tint: rgb(244 63 94 / .16); --ink: #fda4af; }
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
    .launcher.get-jd-active { right: min(384px, 48vw); }
    /* A Get JD page that needs the Manager keeps an orange badge until the notice is resolved. */
    .outcome { position: fixed; right: 16px; bottom: 100px; z-index: 5; width: min(340px, calc(100vw - 32px)); padding: 14px 14px 12px; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 14px; background: #fff; color: #0f172a; box-shadow: 0 18px 44px -12px #0f172a59; font: 13px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; pointer-events: auto; animation: qts-card-in .28s cubic-bezier(.2,.9,.3,1.2) both; }
    .outcome[hidden] { display: none; }
    .outcome.tone-info { border-left-color: #3b82f6; }
    .outcome.tone-warn { border-left-color: #f97316; }
    .outcome.tone-error { border-left-color: #ef4444; }
    .outcome.get-jd-active { right: calc(min(384px, 48vw) + 16px); }
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

  // Line icons (24×24, stroked), built as SVG nodes: no markup strings reach the page's DOM.
  const ICONS = {
    get_jd: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M20 20l-4.2-4.2'],
    generation: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
    apply: ['M21 3L10 14', 'M21 3l-6.5 18-4.5-7-7-4.5z'],
    auto_apply: ['M13 2L4 14h8l-1 8 9-12h-8z'],
    custom: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M19 16v4', 'M17 18h4'],
    text_highlights: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
    page_exclusions: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M5.6 5.6l12.8 12.8'],
    auto_apply_custom_urls: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
    apply_pdf_folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    sign_out: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    sign_in: ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'M10 17l5-5-5-5', 'M15 12H3'],
  };
  function setIcon(element, name) {
    if (!element || element.dataset.icon === name) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || []) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    element.dataset.icon = name;
    element.replaceChildren(svg);
  }

  // In this order; tools show only for a Manager assigned them.
  const actions = [
    ['Work'],
    ['get_jd', 'Get JD', 'get_jd', 'get-jd'],
    ['generation', 'Generation', 'generation', 'generation'],
    ['apply', 'Apply', 'apply', 'apply'],
    ['auto_apply', 'Auto Apply', 'auto_apply', 'auto-apply'],
    ['custom', 'Custom', 'custom', 'custom'],
    ['Tools'],
    ['text_highlights', 'Highlight', 'text_highlights', 'text-highlights'],
    ['page_exclusions', 'Site Setting', 'page_exclusions', 'page-exclusions'],
    ['auto_apply_custom_urls', 'Custom URLs', 'auto_apply_custom_urls', 'custom-urls'],
    ['apply_pdf_folder', 'Apply PDFs folder', 'apply_pdf_folder', 'apply-pdf-folder'],
    ['session', 'Sign In', 'sign_in', 'logout'],
  ];
  // Today's counts, above the actions: new job URLs (each job once), job rows added, applications.
  const stats = document.createElement('div');
  stats.className = 'stats';
  for (const [key, label, title] of [
    ['urls', 'New URLs', 'New jobs added today: each job once, however many candidates got it'],
    ['jobs', 'Job rows', 'Job rows added today: one per candidate'],
    ['applied', 'Applied', 'Applications submitted today'],
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

  // One candidate for Generation, Apply and Auto Apply; each mode keeps its own job list for it.
  const WORK_MODES = ['generation', 'apply', 'auto_apply'];
  const WORK_CANDIDATE_KEY = 'qtsWorkCandidate';
  const WORK_ACCOUNTS_CACHE_TTL_MS = 30_000;
  const workPickers = new Map();
  let accountsRequest = null;
  let accountsVersion = 0;
  const workGroup = Object.assign(document.createElement('div'), { className: 'work-group' });
  const candidateBlock = Object.assign(document.createElement('div'), { className: 'candidate-block' });
  const candidateSelect = Object.assign(document.createElement('select'), { className: 'work-account' });
  candidateSelect.dataset.workCandidate = '';
  candidateSelect.setAttribute('aria-label', 'Candidate for Generation, Apply and Auto Apply');
  candidateSelect.add(new Option('All accounts', ''));
  const candidateSummary = Object.assign(document.createElement('div'), { className: 'candidate-summary' });
  candidateBlock.append(
    Object.assign(document.createElement('span'), { className: 'candidate-label', textContent: 'Candidate' }),
    candidateSelect,
    candidateSummary,
  );
  workGroup.append(candidateBlock);
  const candidate = { select: candidateSelect, accounts: [], loaded: false };
  // Tools sit in a two-column grid after their heading; who is signed in sits beside Sign Out.
  const toolsGrid = Object.assign(document.createElement('div'), { className: 'tools-grid' });
  const who = Object.assign(document.createElement('div'), { className: 'who', hidden: true });
  const whoAvatar = Object.assign(document.createElement('span'), { className: 'who-avatar' });
  const whoName = Object.assign(document.createElement('span'), { className: 'who-name' });
  const whoRole = Object.assign(document.createElement('span'), { className: 'who-role' });
  const whoText = Object.assign(document.createElement('span'), { className: 'who-text' });
  whoText.append(whoName, whoRole);
  who.append(whoAvatar, whoText);
  menuFoot.append(who);
  const TOOL_ACTIONS = ['text_highlights', 'page_exclusions', 'auto_apply_custom_urls', 'apply_pdf_folder'];
  for (const [action, label, icon, className] of actions) {
    if (!label) {
      const heading = document.createElement('div');
      heading.className = 'label-top';
      heading.textContent = action;
      menuList.appendChild(heading);
      if (action === 'Tools') menuList.appendChild(toolsGrid);
      continue;
    }
    const button = document.createElement('button');
    button.className = `action ${className}${['get_jd', 'generation', 'apply', 'auto_apply'].includes(action) ? ' work-mode' : ''}`;
    if (TOOL_ACTIONS.includes(action)) button.title = label;
    button.type = 'button';
    button.dataset.action = action;
    if (action === 'apply_pdf_folder') button.hidden = true;
    button.setAttribute('aria-label', label);
    const iconElement = document.createElement('span');
    iconElement.className = 'action-icon';
    setIcon(iconElement, icon);
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
    if (['get_jd', 'generation', 'apply', 'auto_apply'].includes(action)) {
      // A work row: its button, then a list under it (the applications waiting, for Apply).
      const row = document.createElement('div');
      row.className = 'row';
      const sub = document.createElement('div');
      sub.className = 'action-sub';
      sub.dataset.subFor = action;
      sub.hidden = true;
      row.append(button, sub);
      if (WORK_MODES.includes(action)) {
        // The mode's ready count for the chosen candidate, beside its name.
        labelElement.append(Object.assign(document.createElement('span'), { className: 'ready' }));
        const toggle = Object.assign(document.createElement('button'), { type: 'button', className: 'work-jobs-toggle', hidden: true });
        toggle.dataset.workToggle = action;
        const panel = Object.assign(document.createElement('div'), { className: 'work-picker', hidden: true });
        panel.dataset.workPicker = action;
        workPickers.set(action, { label, toggle, panel, open: false, loaded: false, jobs: [], selected: new Set(), version: 0, loading: false });
        toggle.addEventListener('click', () => toggleWorkJobs(action));
        row.replaceChildren(button, toggle, panel, sub);
        workGroup.append(row);
        if (action === 'generation') menuList.appendChild(workGroup);
        continue;
      }
      menuList.appendChild(row);
      continue;
    }
    (action === 'session' ? menuFoot : TOOL_ACTIONS.includes(action) ? toolsGrid : menuList).appendChild(button);
  }
  // The Tools heading shows only when one of its tools does.
  const toolsHeading = [...menuList.querySelectorAll('.label-top')].find((heading) => heading.textContent === 'Tools');

  // The accounts once, with every mode's ready count (one request, cached briefly).
  async function loadWorkAccounts() {
    const cached = accountsRequest;
    if (cached && (cached.expiresAt === Infinity || cached.expiresAt > Date.now())) return cached.promise;
    const version = accountsVersion;
    const select = candidate.select;
    const previous = select.value;
    select.replaceChildren(new Option('Loading accounts…', ''));
    select.options[0].disabled = true;
    const entry = { promise: null, expiresAt: Infinity };
    const request = (async () => {
      const [reply, stored] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'QTS_WORK_ITEMS', mode: 'all' }),
        chrome.storage.local.get([WORK_CANDIDATE_KEY]).catch(() => ({})),
      ]);
      if (version !== accountsVersion) return;
      if (!reply?.ok) throw new Error(reply?.error || 'Could not load accounts.');
      candidate.accounts = Array.isArray(reply.accounts) ? reply.accounts : [];
      candidate.loaded = true;
      select.replaceChildren(new Option(candidate.accounts.length ? 'All accounts' : 'No accounts', ''));
      for (const account of candidate.accounts) {
        const ready = WORK_MODES.some((mode) => readyCount(account, mode) > 0);
        // Category · Candidate Name · Label; a missing part is left out.
        const text = [account.categoryName, account.name, account.category].filter(Boolean).join(' · ');
        const option = new Option(ready ? text : `${text} — nothing ready`, account.id);
        option.title = option.text;
        option.disabled = !ready;
        select.add(option);
      }
      const wanted = previous || (typeof stored?.[WORK_CANDIDATE_KEY] === 'string' ? stored[WORK_CANDIDATE_KEY] : '');
      select.value = wanted;
      if (select.value !== wanted || select.selectedOptions[0]?.disabled) select.value = '';
      if (select.value !== previous) resetWorkPickers();
      entry.expiresAt = Date.now() + WORK_ACCOUNTS_CACHE_TTL_MS;
      renderCandidate();
    })().catch((error) => {
      if (version !== accountsVersion) return;
      if (accountsRequest === entry) accountsRequest = null;
      select.replaceChildren(new Option('Could not load accounts — focus to retry', ''));
      select.options[0].disabled = true;
      renderCandidate();
      showToast(error.message, 'error');
      throw error;
    });
    entry.promise = request;
    accountsRequest = entry;
    return request;
  }

  function readyCount(account, mode) {
    return Number(account?.counts?.[mode]) || 0;
  }

  function chosenAccount() {
    return candidate.accounts.find((account) => account.id === candidate.select.value) || null;
  }

  // The dropdown's accent (the label colour), the summary line, and each mode's ready count.
  function renderCandidate() {
    const account = chosenAccount();
    const select = candidate.select;
    const color = /^#[0-9a-f]{6}$/i.test(account?.categoryColor || '') ? account.categoryColor : '';
    select.classList.toggle('labelled', Boolean(color));
    select.style.borderLeftColor = color;
    select.title = account ? select.selectedOptions[0]?.text || '' : 'Every account';
    const counts = Object.fromEntries(WORK_MODES.map((mode) => [mode, account
      ? readyCount(account, mode)
      : candidate.accounts.reduce((sum, item) => sum + readyCount(item, mode), 0)]));
    candidateSummary.textContent = !candidate.loaded ? 'Choose one candidate for all three modes, or work through every account.'
      : `${account ? '' : 'Every account: '}${counts.generation} to generate · ${counts.apply} to apply · ${counts.auto_apply} for Auto Apply`;
    for (const mode of WORK_MODES) {
      const ready = menu.querySelector(`[data-action="${mode}"] .ready`);
      if (ready) ready.textContent = candidate.loaded ? `${counts[mode]} ready` : '';
      renderWorkPicker(mode);
    }
  }

  function resetWorkPickers() {
    for (const picker of workPickers.values()) {
      picker.version += 1;
      picker.open = false; picker.loaded = false; picker.loading = false;
      picker.jobs = []; picker.selected.clear(); picker.error = ''; picker.hasMore = false; picker.search = '';
    }
  }

  function chooseCandidate() {
    resetWorkPickers();
    for (const mode of WORK_MODES) rowNotes.delete(mode);
    // Remembered in this Chrome, so every tab's panel starts with the same candidate.
    chrome.storage.local.set({ [WORK_CANDIDATE_KEY]: candidate.select.value }).catch(() => {});
    renderCandidate();
  }
  candidateSelect.addEventListener('focus', () => loadWorkAccounts().catch(() => {}));
  candidateSelect.addEventListener('change', chooseCandidate);
  renderCandidate();

  function loadAllWorkAccounts() {
    loadWorkAccounts().catch(() => {});
  }

  function toggleWorkJobs(mode) {
    const picker = workPickers.get(mode);
    picker.open = !picker.open;
    if (picker.open && !picker.loaded && !picker.loading) loadWorkJobs(mode);
    else renderWorkPicker(mode);
  }

  // A mode's jobs for the chosen candidate, all eligible ones checked; loaded when first needed.
  async function loadWorkJobs(mode) {
    const picker = workPickers.get(mode), version = ++picker.version;
    const candidateId = candidate.select.value;
    picker.jobs = []; picker.selected.clear(); picker.error = ''; picker.hasMore = false; picker.search = '';
    picker.loading = Boolean(candidateId);
    picker.loaded = false;
    renderWorkPicker(mode);
    if (!candidateId) return;
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'QTS_WORK_ITEMS', mode, candidateId });
      if (picker.version !== version) return;
      if (!reply?.ok) throw new Error(reply?.error || 'Could not load jobs.');
      picker.jobs = reply.jobs;
      picker.hasMore = reply.hasMore;
      picker.selected = new Set(reply.jobs.filter(job => job.selectable !== false).map(job => job.id));
      picker.loaded = true;
    } catch (error) {
      if (picker.version === version) picker.error = error.message;
    } finally {
      if (picker.version === version) { picker.loading = false; renderWorkPicker(mode); }
    }
  }

  async function cancelWorkPicker(action) {
    const picker = workPickers.get(action);
    if (picker.cancelling) return;
    const scroll = picker.panel.querySelector('.work-jobs')?.scrollTop || 0;
    picker.cancelling = true;
    candidate.select.disabled = true;
    renderWorkPicker(action);
    const cancellingList = picker.panel.querySelector('.work-jobs');
    if (cancellingList) cancellingList.scrollTop = scroll;
    try {
      const stored = await chrome.storage.local.get(['qtsExtensionStatus', 'qtsApplyKind']);
      const running = action === 'generation' ? stored.qtsExtensionStatus === 'generation'
        : stored.qtsExtensionStatus === 'apply' && (stored.qtsApplyKind === 'auto') === (action === 'auto_apply');
      if (running) {
        const reply = await chrome.runtime.sendMessage({ type: 'QTS_PAGE_ACTION', action: 'cancel_status', expectedAction: action });
        if (!reply?.ok) throw new Error(reply?.error || 'Could not cancel this run.');
        if (reply.warning) rowNotes.set(action, [reply.message, 'warn']);
        else rowNotes.delete(action);
      }
      // Stop the run, keeping this account's list and checked jobs available for review.
      // Choosing another account uses loadWorkJobs and its existing stale-response guard.
      picker.error = '';
    } catch (error) {
      picker.error = error.message || 'Could not cancel this run.';
    } finally {
      picker.cancelling = false;
      await syncModeActions();
      const list = picker.panel.querySelector('.work-jobs');
      if (list) list.scrollTop = scroll;
    }
  }

  function renderWorkPicker(action) {
    const picker = workPickers.get(action), panel = picker.panel;
    const account = chosenAccount();
    // "Choose jobs" shows for a chosen candidate with something ready (or a list already open).
    const count = readyCount(account, action);
    picker.toggle.hidden = !account || (!count && !picker.open);
    const checked = picker.loaded ? `${picker.selected.size} of ${picker.jobs.length}` : `all ${count}`;
    picker.toggle.textContent = `${picker.open ? '▾' : '▸'} Choose jobs (${checked})`;
    picker.toggle.setAttribute('aria-expanded', String(picker.open));
    panel.replaceChildren(); panel.hidden = !account || !picker.open;
    if (panel.hidden) return;
    const toolbar = Object.assign(document.createElement('div'), { className: 'work-toolbar' });
    const query = String(picker.search || '').trim().toLowerCase();
    const visible = picker.jobs.filter(job => !query || [job.title, job.company, job.url].some(value => String(value || '').toLowerCase().includes(query)));
    const allLabel = document.createElement('label');
    const selectedVisible = visible.filter(job => picker.selected.has(job.id)).length;
    const all = Object.assign(document.createElement('input'), { type: 'checkbox', checked: visible.length > 0 && selectedVisible === visible.length });
    all.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    all.disabled = !visible.length || Boolean(picker.cancelling);
    all.addEventListener('change', () => { for (const job of visible) { if (all.checked) picker.selected.add(job.id); else picker.selected.delete(job.id); } renderWorkPicker(action); });
    allLabel.append(all, 'Select all');
    const refresh = Object.assign(document.createElement('button'), { type: 'button', className: 'work-refresh', textContent: 'Refresh', disabled: picker.loading || Boolean(picker.cancelling) });
    refresh.addEventListener('click', () => loadWorkJobs(action));
    const search = Object.assign(document.createElement('input'), { type: 'search', className: 'work-search', placeholder: 'Title, URL, company', value: picker.search || '' });
    search.setAttribute('aria-label', 'Filter jobs by title, URL or company');
    search.addEventListener('input', () => { const position = search.selectionStart; picker.search = search.value; renderWorkPicker(action); const next = panel.querySelector('.work-search'); next.focus({ preventScroll: true }); if (position !== null) next.setSelectionRange(position, position); });
    toolbar.append(allLabel, search, refresh); panel.append(toolbar);
    const list = Object.assign(document.createElement('div'), { className: 'work-jobs' });
    for (const job of visible) {
      const row = Object.assign(document.createElement('div'), { className: `work-job${job.busy ? ' busy' : ''}`, title: job.busy ? 'Already in progress; cannot select.' : job.url });
      const check = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !job.busy && picker.selected.has(job.id) });
      check.disabled = Boolean(picker.cancelling || job.busy || job.selectable === false);
      check.setAttribute('aria-label', `Select ${job.title}`);
      check.dataset.jobId = job.id;
      check.addEventListener('change', () => {
        if (check.checked) picker.selected.add(job.id);
        else picker.selected.delete(job.id);
        const scroll = list.scrollTop;
        renderWorkPicker(action);
        picker.panel.querySelector('.work-jobs').scrollTop = scroll;
        picker.panel.querySelector(`[data-job-id="${job.id}"]`)?.focus({ preventScroll: true });
      });
      let url;
      try { const parsed = new URL(job.url); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed; } catch { /* Invalid saved addresses are never executable links. */ }
      const link = Object.assign(document.createElement(url ? 'a' : 'span'), { className: 'work-link', title: job.url });
      if (url) { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      const title = Object.assign(document.createElement('span'), { className: 'work-title', textContent: job.title, title: job.url });
      const domain = Object.assign(document.createElement('span'), { className: 'work-domain', textContent: [url?.hostname.replace(/^www\./, '') || 'Link unavailable', job.company, job.busy ? 'In progress · unavailable' : ''].filter(Boolean).join(' · '), title: job.url });
      link.append(title, domain); row.append(check, link); list.append(row);
    }
    panel.append(list);
    if (query && !visible.length && !picker.loading) panel.append(Object.assign(document.createElement('div'), { className: 'work-note', textContent: 'No jobs match your search.' }));
    const hiddenSelected = picker.selected.size - selectedVisible;
    if (query && hiddenSelected > 0) panel.append(Object.assign(document.createElement('div'), { className: 'work-note', textContent: `${hiddenSelected} selected job${hiddenSelected === 1 ? ' is' : 's are'} hidden by this filter.` }));
    if (picker.loading || picker.error || !picker.jobs.length || picker.hasMore) {
      panel.append(Object.assign(document.createElement('div'), { className: `work-note${picker.error ? ' error' : ''}`, textContent: picker.loading ? 'Loading jobs…' : picker.error || (picker.hasMore ? 'Showing the first 200 eligible jobs. Refresh after this batch.' : 'No eligible jobs for this account.') }));
    }
    const footer = Object.assign(document.createElement('div'), { className: 'work-footer' });
    const start = Object.assign(document.createElement('button'), { type: 'button', className: 'work-start', textContent: { generation: 'Generate selected', apply: 'Apply to selected', auto_apply: 'Auto Apply selected' }[action] });
    const button = menu.querySelector(`[data-action="${action}"]`);
    start.disabled = picker.cancelling || picker.loading || !picker.selected.size || button.disabled || button.classList.contains('running');
    start.addEventListener('click', () => runAction(action, button));
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'work-cancel', textContent: picker.cancelling ? 'Cancelling…' : 'Cancel', disabled: Boolean(picker.cancelling) });
    cancel.setAttribute('aria-label', `Cancel ${picker.label} selection or run`);
    cancel.addEventListener('click', () => cancelWorkPicker(action));
    const buttons = Object.assign(document.createElement('div'), { className: 'work-buttons' });
    buttons.append(cancel, start);
    footer.append(`${picker.selected.size} selected${query ? ` · ${visible.length} shown` : ''}`, buttons); panel.append(footer);
  }

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
    if (!open) clearTimeout(countsTimer);
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
    globalThis.__qtsPageToast?.show(message, { type, key: `qts-launcher:${type}:${message}` });
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
      if (launcher.classList.contains('open')) loadAllWorkAccounts();
      main.focus();
      return;
    }
    if (signInForm.hidden) showSignInForm();
    else hideSignInForm();
  }

  function playActivation() {
    if (!active) return;
    launcher.classList.remove('activated');
    void launcher.offsetWidth; // Restart the ripple if it is still running.
    launcher.classList.add('activated');
    clearTimeout(activationTimer);
    activationTimer = setTimeout(() => launcher.classList.remove('activated'), 1800);
  }

  // The sign-in frame reports its content height so the card fits an error message without a scrollbar.
  const onWindowMessage = (event) => {
    if (!signInFrame || event.source !== signInFrame.contentWindow) return;
    const height = Number(event.data?.qtsSignInHeight);
    if (Number.isFinite(height) && height > 0) signInFrame.style.height = `${Math.min(Math.ceil(height), 400)}px`;
  };

  async function syncTextHighlightAction(refresh = false) {
    const highlightButton = menu.querySelector('[data-action="text_highlights"]');
    const exclusionsButton = menu.querySelector('[data-action="page_exclusions"]');
    const customUrlsButton = menu.querySelector('[data-action="auto_apply_custom_urls"]');
    const applyPdfFolderButton = menu.querySelector('[data-action="apply_pdf_folder"]');
    if (!highlightButton && !exclusionsButton && !customUrlsButton && !applyPdfFolderButton) return;
    const signedIn = await syncSessionAction();
    if (!signedIn) {
      if (highlightButton) highlightButton.hidden = true;
      if (exclusionsButton) exclusionsButton.hidden = true;
      if (customUrlsButton) customUrlsButton.hidden = true;
      if (applyPdfFolderButton) applyPdfFolderButton.hidden = true;
      toolsHeading.hidden = true;
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: 'GET_MANAGER_EXTENSION_FEATURES', localOnly: !refresh });
    if (highlightButton) {
      highlightButton.hidden = response?.ok !== true || response.canManageTextHighlights !== true;
      highlightButton.dataset.tabId = response?.tabId == null ? '' : String(response.tabId);
    }
    if (exclusionsButton) {
      exclusionsButton.hidden = response?.ok !== true
        || (response.canManagePageExclusions !== true && response.canManageJobDetectionUrlRules !== true);
      exclusionsButton.dataset.tabId = response?.tabId == null ? '' : String(response.tabId);
    }
    if (customUrlsButton) {
      customUrlsButton.hidden = response?.ok !== true || response.canManageJobDetectionUrlRules !== true;
      customUrlsButton.dataset.tabId = response?.tabId == null ? '' : String(response.tabId);
    }
    if (applyPdfFolderButton) {
      applyPdfFolderButton.hidden = response?.ok !== true || response.canUseApply !== true;
    }
    toolsHeading.hidden = Boolean(
      highlightButton?.hidden !== false
      && exclusionsButton?.hidden !== false
      && customUrlsButton?.hidden !== false
      && applyPdfFolderButton?.hidden !== false
    );
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
        canUseApply: response.canUseApply === true,
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

  async function openAutoApplyCustomUrlsPanel(button) {
    await openManagerPanel(
      button,
      'auto-apply-custom-urls',
      'canManageJobDetectionUrlRules',
      'Custom URLs access',
    );
  }

  async function openApplyPdfFolderPanel(button) {
    await openManagerPanel(
      button,
      'apply-pdf-folder',
      'canUseApply',
      'Apply access',
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
    refreshModeActions();
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
    if (!active) return;
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
    if (!active || currentOutcome !== outcome) return;
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
    refreshModeActions();
    const seconds = outcome.closeDeadline
      ? Math.max(0, Math.ceil((outcome.closeDeadline - Date.now()) / 1000))
      : Number(outcome.closeInSeconds) || 0;
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
      keepOutcomeTabOpen();
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
    if (currentOutcome?.kind === 'done') keepOutcomeTabOpen();
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
      keepOutcomeTabOpen();
      clearOutcomeTimers();
      outcomeCountdown.textContent = 'Auto-close is off. This tab stays open.';
      outcomeActions.querySelector('.primary')?.remove();
      outcomeHideTimer = setTimeout(clearOutcome, 4000);
    }
  });

  function keepOutcomeTabOpen() {
    chrome.runtime.sendMessage({ type: 'QTS_GET_JD_KEEP_OPEN' }).catch(() => {});
    if (currentOutcome) {
      currentOutcome = { ...currentOutcome, closeInSeconds: 0, closeDeadline: 0 };
      globalThis.__qtsPendingLauncherOutcome = currentOutcome;
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

  // The footer names who is signed in (display name and role only; never a token).
  async function syncWho(signedIn) {
    const user = signedIn ? (await chrome.storage.local.get(['qtsSessionUser'])).qtsSessionUser : null;
    const name = String(user?.displayName || user?.name || '').trim();
    who.hidden = !name;
    if (!name) return;
    whoName.textContent = name;
    whoName.title = name;
    whoRole.textContent = String(user.role || '').replace(/_/g, ' ');
    whoAvatar.textContent = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
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
    const label = button.querySelector('.action-icon + span');
    setIcon(button.querySelector('.action-icon'), signedIn ? 'sign_out' : 'sign_in');
    if (label) label.textContent = signedIn ? 'Sign Out' : 'Sign In';
    syncWho(signedIn).catch(() => {});
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
  function refreshDailyCounts() {
    if (!active) return;
    if (!launcher.classList.contains('open') || !launcher.classList.contains('signed-in')) return;
    clearTimeout(countsTimer);
    const wait = Math.max(0, countsAskedAt + 5000 - Date.now());
    countsTimer = setTimeout(async () => {
      if (!active || !launcher.classList.contains('open') || !launcher.classList.contains('signed-in')) return;
      countsAskedAt = Date.now();
      const reply = await chrome.runtime.sendMessage({ type: 'QTS_DAILY_COUNTS' })
        .catch((error) => ({ ok: false, error }));
      if (!reply?.ok) {
        console.warn('[QTS launcher] Could not refresh daily counts:', reply?.error || reply?.message || 'Unknown error.');
        return;
      }
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
      'qtsApplyKind', 'qtsAutoApplyState', 'qtsGetJdNotificationState', 'authExpiresAt', 'qtsSessionUser',
    ]);
    const workStatus = stored.qtsExtensionStatus;
    const getJdOn = stored.qtsGetJdOn === true;
    // Apply and Auto Apply share the work slot ('apply'); qtsApplyKind says which holds it.
    const autoApplyOn = workStatus === 'apply' && stored.qtsApplyKind === 'auto';
    const rows = {
      get_jd: { label: 'Get JD', active: getJdOn },
      generation: { label: 'Generation', active: workStatus === 'generation' },
      apply: { label: 'Apply', active: workStatus === 'apply' && !autoApplyOn },
      auto_apply: { label: 'Auto Apply', active: autoApplyOn },
    };

    if (getJdOn) {
      rows.get_jd.chip = ['On', 'on'];
      rows.get_jd.detail = currentOutcome?.kind === 'notice'
        ? ['This page needs you: see the card beside the panel.', 'warn']
        : pageNote?.url === location.href ? [pageNote.text, ''] : ['Checking each job page you open.', ''];
    }
    const results = getJdOn && Number(stored.authExpiresAt) > Date.now()
      ? globalThis.__qtsGetJdNotifications?.recentResults(stored.qtsGetJdNotificationState, stored) || [] : [];
    // This page's manual review, left with "‹ QTS" or Cancel: one click goes back to it.
    const review = globalThis.__qtsGetJdReview;
    const reviewItems = getJdOn && review?.manualReviewAvailable?.() ? [{
      name: 'Choose candidates for this page', company: document.title || location.hostname,
      avatar: '✓', goLabel: 'Review ›', openTitle: 'Show the candidates for this job',
      onOpen: async () => { setOpen(false); review.openReview(); return { ok: true }; },
    }] : [];
    renderSub('get_jd', [...reviewItems, ...results.map((entry) => {
      let site = ''; try { site = new URL(entry.pageUrl).hostname; } catch { /* Historical entries can lack a URL. */ }
      const time = Number(entry.updatedAt) > 0 ? new Date(entry.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      return {
        name: entry.title || entry.pageTitle || site || 'Job result', company: entry.company || site,
        title: entry.label || (entry.status === 'success' ? 'Completed' : entry.status),
        avatar: ({ saved: '✓', updated: '✓', review: '!', partial: '!', failed: '×', skipped: '↷', cancelled: '–' })[entry.outcome] || '•',
        status: [entry.message, time].filter(Boolean).join(' · '),
        statusType: ['failed', 'partial'].includes(entry.outcome) ? 'error' : '',
        openTitle: 'Show the existing job tab, or reopen its page if it has closed',
        goLabel: 'Open page ›', open: { type: 'QTS_OPEN_GET_JD_RESULT', operationId: entry.operationId },
      };
    })]);
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

    // Auto Apply's application: its step and what it waits for, from its own run state.
    const autoRun = autoApplyOn ? (stored.qtsAutoApplyState?.runs || [])[0] : null;
    const AUTO_PHASES = {
      starting: 'Opening the form',
      filling: 'Filling',
      ai: 'Asking the AI about the questions left',
      next: 'Going to the next step',
      needs_you: 'Needs you: see the panel on the form',
      final: 'Ready: check it, then click the site\'s Submit',
      submitted: 'Submitted? Answer on the panel',
    };
    if (autoApplyOn) {
      const waiting = ['needs_you', 'final', 'submitted'].includes(autoRun?.phase);
      rows.auto_apply.chip = waiting ? ['Waiting for you', 'needs'] : ['Running', 'on'];
      rows.auto_apply.detail = autoRun
        ? [`Step ${autoRun.step || 1} · ${autoRun.phase === 'ai' && autoRun.ai ? `Asking ${autoRun.ai.provider}${autoRun.ai.focused ? ' (its tab is shown while it answers)' : ' (in the background)'}` : AUTO_PHASES[autoRun.phase] || 'Working'}${autoRun.unresolved ? ` · ${autoRun.unresolved} left for you` : ''}`, waiting ? 'warn' : '']
        : ['Looking for a ready job.', ''];
    }

    // One work slot per Chrome: the other mode says why it cannot start instead of failing on a click.
    const busy = {
      generation: workStatus === 'apply' ? `${autoApplyOn ? 'Auto Apply' : 'Apply'} is running in this Chrome. Stop it first.` : '',
      apply: workStatus === 'generation' ? 'Generation is running in this Chrome. Stop it first.'
        : autoApplyOn ? 'Auto Apply is running in this Chrome. Stop it first.' : '',
      auto_apply: workStatus === 'generation' ? 'Generation is running in this Chrome. Stop it first.'
        : workStatus === 'apply' && !autoApplyOn ? 'Apply is running in this Chrome. Stop it first.' : '',
    };
    if (workStatus === 'cancel') {
      for (const action of ['generation', 'apply', 'auto_apply']) busy[action] = 'Stopping the previous run. You can choose the next account while it finishes.';
    }

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
      // The name stays; the Stop button (or Get JD's switch) at the end says what a click does.
      button.setAttribute('aria-label', active ? `Cancel ${defaultLabel}` : defaultLabel);
      button.title = active ? `Stop ${defaultLabel}` : `Start ${defaultLabel}`;
      if (action === 'get_jd') button.setAttribute('aria-pressed', String(active));
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
    renderSub('auto_apply', autoRun ? [{
      name: autoRun.candidate,
      company: autoRun.company,
      title: autoRun.title,
      status: `Step ${autoRun.step || 1} · ${AUTO_PHASES[autoRun.phase] || 'Working'}`,
      statusType: ['needs_you', 'final', 'submitted'].includes(autoRun.phase) ? 'warn' : '',
      open: { type: 'QTS_SHOW_APPLICATION', attemptId: autoRun.attemptId },
      openTitle: 'Show this application',
    }] : [], 'running');

    const needs = currentOutcome?.kind === 'notice' || (rows.apply.active && open.length > 0)
      || ['needs_you', 'final', 'submitted'].includes(autoRun?.phase);
    launcher.classList.toggle('needs', needs);
    launcher.classList.toggle('failed', !needs && failed);
    launcher.classList.toggle('running', !needs && !failed && Object.values(rows).some((row) => row.active));
    // The candidate stays fixed while a run uses it.
    candidate.select.disabled = ['generation', 'apply'].includes(workStatus)
      || [...workPickers.values()].some((picker) => picker.cancelling);
    for (const [action, picker] of workPickers) {
      const scroll = picker.panel.querySelector('.work-jobs')?.scrollTop || 0;
      renderWorkPicker(action);
      const list = picker.panel.querySelector('.work-jobs');
      if (list) list.scrollTop = scroll;
    }
  }

  function refreshModeActions() {
    syncModeActions().catch((error) => {
      console.warn('[QTS launcher] Could not refresh workflow status:', error);
    });
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
    if (action === 'auto_apply_custom_urls') {
      await openAutoApplyCustomUrlsPanel(button);
      return;
    }
    if (action === 'apply_pdf_folder') {
      await openApplyPdfFolderPanel(button);
      return;
    }
    // The panel stays open: the row itself shows what the click changed.
    const row = ['get_jd', 'generation', 'apply', 'auto_apply'].includes(action) ? action : null;
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
      // A chosen candidate scopes the run to its checked jobs (all of them if the list was never opened);
      // "All accounts" sends no selection, so the mode works through every account.
      const picker = workPickers.get(resolvedAction);
      let selection;
      if (picker && candidate.select.value) {
        if (!picker.loaded && !picker.loading) await loadWorkJobs(resolvedAction);
        if (picker.loading) throw new Error('The jobs are still loading. Try again in a moment.');
        if (picker.error) throw new Error(picker.error);
        if (!picker.selected.size) {
          throw new Error(picker.jobs.length ? 'Select at least one job before starting.' : `Nothing is ready for ${picker.label} for this candidate.`);
        }
        selection = { candidateId: candidate.select.value, jobIds: [...picker.selected] };
      }
      const response = await chrome.runtime.sendMessage({
        type: 'QTS_PAGE_ACTION',
        action: resolvedAction,
        ...(resolvedAction === 'cancel_status' ? { expectedAction: action } : {}),
        ...(selection ? { selection } : {}),
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not run this QTS action.');
      if (resolvedAction === 'sign_out') {
        preview.hidden = true;
        hideSignInForm();
        globalThis.__qtsPageToast?.clear();
        await syncSessionAction();
      } else if (['get_jd', 'generation', 'apply', 'auto_apply', 'cancel_status', 'cancel_get_jd'].includes(resolvedAction)) {
        if (row && response.warning) rowNotes.set(row, [response.message || 'Started with a warning.', 'warn']);
        if (resolvedAction === 'get_jd' && response.appliedCleanupCount > 0) askAppliedCleanup(response.appliedCleanupCount);
        await syncModeActions();
      }
    } catch (error) {
      if (row) rowNotes.set(row, [error?.message || 'Could not run this QTS action.', 'error']);
      else showToast(error?.message || 'Could not run this QTS action.', 'error');
    } finally {
      button.disabled = false;
      if (row) refreshModeActions();
    }
  }

  async function handleLauncherClick() {
    // The launcher is only visible while signed in; a session that just expired hides it here.
    if (!(await syncSessionAction())) return;
    const review = globalThis.__qtsGetJdReview;
    if (review?.manualReviewAvailable?.()) {
      setOpen(false);
      review.openReview();
      return;
    }
    const opening = !launcher.classList.contains('open');
    setOpen(opening);
    // Opening QTS ends any idle back-off: this Chrome checks for work right away.
    if (opening) chrome.runtime.sendMessage({ type: 'QTS_ACTIVITY' }).catch(() => {});
    // While Apply is on, a page with saved jobs offers its accounts ("Apply this page").
    if (opening) showApplyPick().catch(() => {});
    if (opening) refreshDailyCounts();
    if (opening) loadAllWorkAccounts();
    if (opening) syncTextHighlightAction(true).catch(() => {});
    // A Get JD notice hidden earlier shows again beside the panel (the orange dot stands for it).
    if (opening && currentOutcome?.kind === 'notice') outcomeCard.hidden = false;
  }
  main.addEventListener('click', () => {
    handleLauncherClick().catch((error) => {
      console.warn('[QTS launcher] Could not switch panels:', error);
    });
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
    if (!active || area !== 'local') return;
    if (changes.authExpiresAt) {
      accountsVersion += 1;
      accountsRequest = null;
      candidate.accounts = []; candidate.loaded = false;
      candidate.select.replaceChildren(new Option('All accounts', ''));
      resetWorkPickers();
      renderCandidate();
      syncSessionAction()
        .then(() => syncTextHighlightAction())
        .catch((error) => console.warn('[QTS launcher] Could not sync session after authentication changed:', error));
      // Sign-in always clears the previous session first, so a fresh expiry means a new sign-in.
      // The panel stays open and turns to the actions: that is the confirmation.
      if (changes.authExpiresAt.newValue && !changes.authExpiresAt.oldValue) {
        hideSignInForm(false);
        playActivation();
      }
    }
    if (changes.qtsExtensionStatus || changes.qtsGetJdOn || changes.qtsGenerationBrowserState
      || changes.qtsGenerationNotice || changes.qtsApplyState || changes.qtsApplyKind || changes.qtsAutoApplyState
      || changes.qtsGetJdNotificationState || changes.authExpiresAt || changes.qtsSessionUser) refreshModeActions();
    // An application ended (submitted or not): APPLY may have changed.
    if (changes.qtsApplyState) refreshDailyCounts();
  };
  const onRuntimeMessage = (message) => {
    if (!active) return;
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
      refreshModeActions();
    }
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      preview.hidden = true;
      hideSignInForm();
    }
  };
  function attachListeners() {
    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('message', onWindowMessage);
  }
  function detachListeners() {
    chrome.storage.onChanged.removeListener(onStorageChanged);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('message', onWindowMessage);
  }
  attachListeners();

  syncSessionAction().catch((error) => {
    console.warn('[QTS launcher] Could not refresh session status:', error);
  });
  refreshModeActions();
  // Get JD injects its review only after an admitted navigation produces a result.
  // Launcher activation alone must not initialize candidate loading on an old page.
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
    setActive(value) {
      if (active === value && (!value || host.isConnected)) return;
      active = value;
      if (!active) {
        setOpen(false);
        hideSignInForm();
        getJdDockObserver.disconnect();
        detachListeners();
        clearTimeout(countsTimer);
        clearTimeout(activationTimer);
        clearOutcomeTimers();
        launcher.classList.remove('activated');
        dock.remove();
        host.remove();
      } else {
        (document.head || document.documentElement).appendChild(dock);
        document.documentElement.appendChild(host);
        attachListeners();
        getJdDockObserver.observe(document.documentElement, {
          attributes: true, attributeFilter: ['data-qts-get-jd-docked'],
        });
        syncGetJdDocking();
        syncSessionAction().catch((error) => {
          console.warn('[QTS launcher] Could not refresh session status:', error);
        });
        refreshModeActions();
        syncTextHighlightAction().catch((error) => {
          console.warn('[QTS launcher] Could not refresh Manager tools:', error);
        });
        const outcome = globalThis.__qtsPendingLauncherOutcome;
        if (outcome) showOutcome(outcome).catch(() => {});
      }
    },
    disable() {
      setOpen(false);
      preview.hidden = true;
      hideSignInForm();
      getJdDockObserver.disconnect();
      active = false;
      detachListeners();
      clearTimeout(countsTimer);
      clearTimeout(activationTimer);
      clearOutcomeTimers();
      document.documentElement?.removeAttribute('data-qts-menu-docked');
      dock.remove();
      host.remove();
      globalThis.__qtsPageLauncher = { excluded: true };
    },
  };
  // A focus switch can arrive while asynchronous access/session checks were running.
  if (globalThis.__qtsLauncherActive === false || document.visibilityState === 'hidden') {
    globalThis.__qtsPageLauncher.setActive(false);
  } else if (globalThis.__qtsPendingLauncherOutcome) {
    showOutcome(globalThis.__qtsPendingLauncherOutcome).catch(() => {});
  }
}

let pageLauncherInitialization = null;

// Overlapping restores (navigation plus a rule change) share one initialization instead of adding two launchers.
function initializeQtsPageLauncherOnce() {
  if (globalThis.__qtsPageLauncher) return Promise.resolve();
  if (!pageLauncherInitialization) {
    pageLauncherInitialization = initializeQtsPageLauncher().finally(() => {
      pageLauncherInitialization = null;
      // Focus can return while the first ownership query is still resolving. Reconcile that
      // one missed activation after it settles, rather than starting another concurrent mount.
      if (globalThis.__qtsLauncherActive === true && !globalThis.__qtsPageLauncher) {
        refreshPageLauncherActivity().catch(() => {});
      }
    });
  }
  return pageLauncherInitialization;
}

function restorePageLauncher() {
  if (globalThis.__qtsLauncherActive !== true) return;
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
    if (message?.type === 'QTS_GET_JD_OUTCOME') {
      globalThis.__qtsPendingLauncherOutcome = message.outcome;
      return;
    }
    if (message?.type === 'QTS_LAUNCHER_ACTIVE') {
      updatePageLauncherActivity(message.active === true);
      return;
    }
    if (message?.type === 'QTS_TOOLBAR_ICON_CLICKED') {
      // A click before the page finishes loading starts the launcher early instead of being dropped.
      refreshPageLauncherActivity()
        .then(() => initializeQtsPageLauncherOnce())
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
    if (globalThis.__qtsLauncherActive !== true) return;
    chrome.runtime.sendMessage({ type: 'CHECK_EXTENSION_PAGE_ALLOWED', localOnly: true })
      .then((response) => {
        if (!response?.ok) return;
        if (response.excluded) globalThis.__qtsPageLauncher?.disable?.();
        else restorePageLauncher();
      })
      .catch((error) => console.error('[QTS extension] Could not apply URL exclusions:', error));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') updatePageLauncherActivity(false);
    else refreshPageLauncherActivity().catch(() => {});
  });
  window.addEventListener('pagehide', () => updatePageLauncherActivity(false));
  window.addEventListener('pageshow', () => refreshPageLauncherActivity().catch(() => {}));
  window.addEventListener('focus', () => refreshPageLauncherActivity().catch(() => {}));
}

function updatePageLauncherActivity(value) {
  globalThis.__qtsLauncherActivityRevision = (globalThis.__qtsLauncherActivityRevision || 0) + 1;
  const active = value && document.visibilityState !== 'hidden';
  globalThis.__qtsLauncherActive = active;
  const instance = globalThis.__qtsPageLauncher;
  if (instance?.setActive) instance.setActive(active);
  else if (active) {
    if (instance?.excluded) globalThis.__qtsPageLauncher = null;
    initializeQtsPageLauncherOnce().catch(() => {});
  }
}

async function refreshPageLauncherActivity() {
  const revision = globalThis.__qtsLauncherActivityRevision || 0;
  const result = await chrome.runtime.sendMessage({ type: 'QTS_GET_LAUNCHER_STATE' });
  if (revision !== (globalThis.__qtsLauncherActivityRevision || 0)) return;
  updatePageLauncherActivity(result?.active === true);
}

function initializePageLauncherAfterLoad() {
  refreshPageLauncherActivity().catch((error) => {
    console.error('[QTS extension] Could not verify page access:', error);
  });
}

if (document.readyState !== 'loading') initializePageLauncherAfterLoad();
else document.addEventListener('DOMContentLoaded', initializePageLauncherAfterLoad, { once: true });
})();
