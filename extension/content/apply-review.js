// Apply's review panel on the application page (injected by the service worker into the form's tab).
// It shows the job, the résumé folder, and every answer with where it came from (ChatGPT answers
// flagged), marks what needs the Manager, and carries the Manager's choices back to the worker:
// Continue / Skip / Later / Fill again / Ask ChatGPT (or Gemini) again / I submitted it, then Yes / No / Not
// submitted. On the last step it notices the Manager's own click on the site's Submit.
// Auto Apply: the panel stays on the job's page the whole time; Submitted is always there and saves the
// bid at once; Ask AI is the only way the AI is asked; the résumé and cover letter text copy in one
// click; the page's required questions show with the candidate's answer (Copy, Fill). The site's
// Submit is neither held nor watched.
(function initApplyReview(global) {
  if (global.__qtsApplyReview) return;
  // A prior extension context may have left its host in this page after an update.
  for (const stale of document.querySelectorAll('[data-qts-apply-review], [data-qts-auto-apply-dock]')) stale.remove();

  // 3/4 of the old 480 px (the Manager's choice, 2026-11-17).
  const PANEL_WIDTH = 'min(360px, 36vw)';
  const dock = document.createElement('style');
  dock.setAttribute('data-qts-auto-apply-dock', '');
  dock.textContent = `
    html[data-qts-apply-docked="true"] body { box-sizing: border-box !important; padding-right: ${PANEL_WIDTH} !important; }
    html:has(> [data-qts-auto-apply-review]) [data-qts-page-launcher] { display: none !important; }
  `;

  const host = document.createElement('div');
  host.setAttribute('data-qts-apply-review', '');
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    /* The look of the QTS panel (page-launcher.js): dark navy cards, pill tags, the same tints. */
    .panel { width: 380px; max-height: calc(100vh - 24px); display: flex; flex-direction: column; border: 1px solid #243047; border-radius: 14px; background: #0a0f1c; color: #e2e8f0; color-scheme: dark; box-shadow: -12px 0 32px rgb(0 0 0 / 35%); font: 12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
    .panel.collapsed .body, .panel.collapsed .foot { display: none; }
    .panel.auto { position: fixed; inset: 0 0 0 auto; width: ${PANEL_WIDTH}; height: 100vh; height: 100dvh; max-height: none; border: 0; border-left: 1px solid #243047; border-radius: 0; font: 13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
    .panel[hidden], .review-tab[hidden] { display: none; }
    /* Same branding, dimensions and typography as the QTS actions header. */
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
    .review-tab { position: fixed; top: 50%; right: 0; transform: translateY(-50%); display: flex; flex-direction: column; gap: 3px; padding: 10px 6px; border: 1px solid #243047; border-right: 0; border-radius: 14px 0 0 14px; background: #0d1526; color: #e2e8f0; font: 800 12px/1 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .review-tab span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; }
    .review-tab .q { color: #fcd34d; background: rgb(252 211 77 / .12); }
    .review-tab .t { background: rgb(226 232 240 / .08); }
    .review-tab .s { color: #60a5fa; background: rgb(96 165 250 / .14); }
    .panel.auto .body { flex: 1 1 auto; min-height: 0; padding: 16px; scrollbar-width: thin; }
    .panel.auto .head { padding: 0 0 12px; border: 0; background: none; }
    .panel.auto .head::before { display: none; }
    .panel.auto .head-sub { white-space: normal; overflow-wrap: anywhere; }
    .panel.auto .row { overflow-wrap: anywhere; }
    .panel.auto .answer { grid-template-columns: minmax(0, 1fr) auto; }
    .panel.auto .answer .q { grid-column: 1 / -1; }
    .panel.auto .answer .a { max-height: none; overflow: visible; }
    .panel.auto .foot { flex: 0 0 auto; max-height: 45dvh; overflow-y: auto; padding: 12px 16px 14px; }
    .head { position: relative; display: flex; align-items: center; gap: 8px; padding: 10px 12px 10px 14px; border-bottom: 1px solid #243047; background: linear-gradient(180deg, #131c31, #0a0f1c); color: #f1f5f9; }
    .head::before { content: ""; position: absolute; top: 10px; bottom: 10px; left: 0; width: 2px; border-radius: 2px; background: linear-gradient(180deg, #fcd34d, #e2e8f0 50%, #60a5fa); }
    .head-text { flex: 1; min-width: 0; }
    .head-title { font-weight: 750; font-size: 13px; }
    .head-sub { color: #94a3b8; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-button { width: 28px; height: 28px; border: 1px solid #34425a; border-radius: 9px; background: #111a2e; color: #cbd5e1; cursor: pointer; font-size: 13px; }
    .body { overflow-y: auto; padding: 10px 12px; scrollbar-color: #34425a transparent; }
    .job { margin-bottom: 8px; padding: 9px 10px; border: 1px solid #243047; border-radius: 12px; background: #0d1526; }
    .job-title { color: #f1f5f9; font-weight: 750; font-size: 13px; }
    .who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 4px; }
    .who-name { color: #f8fafc; font-size: 17px; font-weight: 800; }
    .who-label { padding: 2px 9px; border: 1px solid #34425a; border-radius: 999px; background: #111a2e; color: #93c5fd; font-size: 14px; font-weight: 750; }
    .muted { color: #94a3b8; }
    .row { margin-top: 2px; color: #94a3b8; font-size: 11px; }
    .folder { display: block; width: 100%; margin-top: 6px; padding: 6px 8px; border: 1px dashed #34425a; border-radius: 9px; background: #111a2e; color: #93c5fd; cursor: pointer; text-align: left; font: inherit; word-break: break-all; }
    .problems, .ok, .provisional { margin: 8px 0; padding: 9px 10px; border: 1px solid #243047; border-radius: 12px; background: #0d1526; color: #cbd5e1; }
    .problems { border-color: rgb(249 115 22 / .55); }
    .ok { border-color: rgb(16 185 129 / .5); }
    .provisional { border-color: rgb(250 204 21 / .45); }
    .problems strong, .ok strong, .provisional strong { display: block; margin-bottom: 4px; font-weight: 750; }
    .problems strong { color: #fdba74; }
    .ok strong, .ok:not(:has(strong)) { color: #6ee7b7; }
    .provisional strong { color: #fcd34d; }
    .problems li, .ok li, .provisional li { margin: 4px 0 4px 16px; cursor: pointer; }
    .problems li:hover, .ok li:hover, .provisional li:hover { color: #f1f5f9; }
    .problems details, .ok details { margin-top: 6px; color: #94a3b8; }
    .problems summary, .ok summary { cursor: pointer; font-weight: 700; color: #94a3b8; }
    .problems li button, .ok li button, .problems > button, .provisional button { margin-left: 6px; padding: 2px 9px; border: 1px solid #34425a; border-radius: 999px; background: #111a2e; color: #e2e8f0; font: 700 10.5px Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .problems li button:hover, .ok li button:hover, .problems > button:hover, .provisional button:hover { border-color: rgb(16 185 129 / .5); color: #6ee7b7; }
    .provisional .done { margin-left: 6px; color: #6ee7b7; font-weight: 700; }
    .provisional .held, .problems .held { margin-top: 6px; font-weight: 700; color: #fca5a5; }
    .section { margin-top: 12px; color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .answer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; padding: 6px 4px; border-bottom: 1px solid #1a2438; cursor: pointer; }
    .answer:hover { background: #111a2e; }
    .q { color: #94a3b8; }
    .a { color: #e2e8f0; white-space: pre-wrap; word-break: break-word; max-height: 72px; overflow: hidden; }
    .src { height: fit-content; padding: 2px 7px; border: 1px solid #34425a; border-radius: 999px; background: #111a2e; color: #94a3b8; font-size: 10px; font-weight: 700; white-space: nowrap; }
    .profile-value { display: block; margin-top: 2px; font-size: 10px; color: #66758c; }
    .src.ai { border-color: rgb(99 102 241 / .5); color: #a5b4fc; }
    .src.manager { border-color: rgb(249 115 22 / .55); color: #fdba74; }
    .references { margin-top: 12px; border: 1px solid #243047; border-radius: 12px; background: #0d1526; }
    .references summary { padding: 9px 10px; cursor: pointer; color: #cbd5e1; font-weight: 700; }
    .reference-card { margin: 0 8px 8px; border: 1px solid #243047; border-radius: 9px; }
    .reference-item { display: block; width: calc(100% - 12px); margin: 6px; padding: 7px 8px; border: 1px solid #34425a; border-radius: 8px; background: #111a2e; color: #e2e8f0; text-align: left; cursor: pointer; font: inherit; overflow-wrap: anywhere; }
    .reference-item:hover, .reference-item:focus-visible { border-color: #818cf8; }
    .reference-label { display: block; color: #94a3b8; font-size: 10px; }
    .reference-value { display: block; white-space: pre-wrap; }
    .reference-note, .copy-status { padding: 0 10px 8px; color: #94a3b8; font-size: 11px; }
    .copy-row { display: flex; gap: 6px; margin-top: 6px; }
    .copy-row.sticky { position: sticky; top: -16px; z-index: 3; margin: 0 -16px 8px; padding: 10px 16px; background: #0a0f1c; border-bottom: 1px solid #1a2438; box-shadow: 0 6px 12px -8px rgb(0 0 0 / 60%); }
    .copy-button, .row-button { padding: 5px 10px; border: 1px solid #34425a; border-radius: 9px; background: #111a2e; color: #e2e8f0; font: 650 11.5px Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
    .copy-button { flex: 1 1 0; padding-left: 6px; padding-right: 6px; }
    .copy-button.folder-copy { flex: 0 0 auto; color: #93c5fd; }
    .copy-button.profile-copy { flex: 0 0 auto; color: #93c5fd; }
    .copy-button.answer-open.on, .copy-button.profile-copy.on, .copy-button.folder-copy.on { border-color: #818cf8; background: #1e2a4a; color: #c7d2fe; }
    .career { margin-top: 8px; padding: 8px 10px; border: 1px solid #243047; border-radius: 12px; background: #0d1526; }
    .career-head { display: flex; align-items: center; justify-content: space-between; margin: 2px 0 4px; color: #94a3b8; font-size: 10.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .career-head button { padding: 0 4px; border: 0; background: none; color: #94a3b8; font: inherit; cursor: pointer; text-transform: none; letter-spacing: 0; }
    .career-item { margin-top: 5px; padding: 6px 7px; border: 1px solid #243047; border-left: 3px solid #6366f1; border-radius: 9px; background: #101a2e; }
    .career-head + .career-item { margin-top: 2px; }
    .career-head:not(:first-child) { margin-top: 9px; }
    .career-line { display: flex; flex-wrap: wrap; gap: 4px; }
    .career-line + .career-line { margin-top: 4px; }
    .chip .chip-label { margin-right: 5px; color: #94a3b8; font-size: 10px; font-weight: 700; }
    .profile-group { margin: 8px 0 3px; color: #64748b; font-size: 10px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .profile-head + .profile-group, .career-head + .profile-group { margin-top: 2px; }
    .profile-row { display: grid; grid-template-columns: 78px minmax(0, 1fr) 14px; align-items: center; gap: 8px; width: 100%; margin: 0 0 4px; padding: 6px 8px; border: 1px solid #243047; border-left: 3px solid #6366f1; border-radius: 9px; background: #101a2e; color: #e2e8f0; font: 600 12px Inter, ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; transition: border-color .15s, background .15s; }
    .profile-row:hover, .profile-row:focus-visible { border-color: #818cf8; background: #15213a; }
    .profile-label { color: #94a3b8; font-size: 10.5px; font-weight: 700; }
    .profile-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .profile-copy-mark { color: #475569; font-size: 11px; text-align: right; }
    .profile-row:hover .profile-copy-mark { color: #a5b4fc; }
    .profile-row.copied { border-color: #10b981; background: #0b2a22; }
    .salary-row { grid-template-columns: 78px minmax(0, 1fr) 22px; cursor: default; }
    .profile-input { min-width: 0; padding: 3px 6px; border: 1px solid #34425a; border-radius: 6px; background: #0b1222; color: #e2e8f0; font: 600 12px Inter, ui-sans-serif, system-ui, sans-serif; }
    .profile-input:focus, .answer-text:focus { outline: none; border-color: #818cf8; }
    .profile-copy-button { padding: 0; border: 0; background: none; color: #a5b4fc; font-size: 13px; cursor: pointer; }
    .answer-label { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 8px 0 3px; color: #94a3b8; font-size: 10.5px; font-weight: 700; }
    .answer-mini { padding: 1px 6px; border: 1px solid #34425a; border-radius: 999px; background: #111a2e; color: #a5b4fc; font: 600 10px Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .answer-text { display: block; width: 100%; padding: 6px 8px; border: 1px solid #34425a; border-left: 3px solid #6366f1; border-radius: 9px; background: #0b1222; color: #e2e8f0; font: 500 12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; resize: vertical; }
    .answer-copy { display: block; width: 100%; margin-top: 8px; color: #c7d2fe; }
    .profile-row.copied .profile-copy-mark { color: #34d399; }
    .chip { max-width: 100%; padding: 3px 8px; border: 1px solid #34425a; border-radius: 999px; background: #111a2e; color: #e2e8f0; font: 600 11.5px Inter, ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .chip.main { color: #c7d2fe; font-weight: 750; }
    .chip:hover, .bullets:hover, .chip:focus-visible, .bullets:focus-visible { border-color: #818cf8; }
    .chip.bullets { border-color: #4f46e5; background: #1e1b4b; color: #c7d2fe; }
    .chip.bullets:hover { background: #2e2a6b; }
    .copy-button:hover:not(:disabled), .row-button:hover:not(:disabled) { border-color: #818cf8; color: #c7d2fe; }
    .copy-button:disabled, .row-button:disabled { opacity: .45; cursor: not-allowed; }
    .job-status { margin-top: 6px; color: #a5b4fc; font-size: 11px; }
    .job-status:empty { display: none; }
    .required { margin-bottom: 8px; padding: 9px 10px; border: 1px solid #243047; border-radius: 12px; background: #0d1526; }
    .required strong { display: block; margin-bottom: 4px; color: #e2e8f0; font-weight: 750; }
    .required-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-top: 1px solid #1a2438; }
    .required-text { flex: 1 1 auto; min-width: 0; cursor: pointer; }
    .required-label { display: block; color: #94a3b8; font-size: 11px; overflow-wrap: anywhere; }
    .required-label.done { color: #6ee7b7; }
    .required-value { display: block; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .required-value.none { color: #66758c; font-style: italic; }
    .copy-status { color: #a5b4fc; }
    .foot { padding: 10px 12px; border-top: 1px solid #243047; background: #0d1526; }
    .note { margin-bottom: 8px; color: #cbd5e1; font-weight: 600; }
    .buttons { display: flex; flex-wrap: wrap; gap: 6px; }
    .buttons button { min-height: 32px; padding: 0 12px; border: 1px solid #34425a; border-radius: 10px; background: #111a2e; color: #e2e8f0; font: 650 12px Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .buttons button:hover:not(:disabled) { border-color: #475569; background: #1a2438; }
    .buttons button.primary { border-color: #6366f1; background: #4f46e5; color: #fff; }
    .buttons button.yes { border-color: #10b981; background: #059669; color: #fff; }
    .buttons button.no { border-color: rgb(239 68 68 / .55); color: #fca5a5; }
    .buttons button:disabled { opacity: .5; cursor: not-allowed; }
    .working { display: flex; align-items: center; gap: 8px; color: #a5b4fc; font-weight: 650; }
    .spinner { width: 14px; height: 14px; border: 2px solid #243047; border-top-color: #6366f1; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    /* Auto Apply: dragged by its title bar it floats; [▴] makes it small (the title bar only). */
    .panel.auto.floating { inset: auto; height: min(86vh, 900px); height: min(86dvh, 900px); border: 1px solid #243047; border-radius: 14px; box-shadow: 0 18px 48px rgb(0 0 0 / 45%); }
    .panel.auto.small { bottom: auto; height: auto; max-height: none; }
    .panel.auto.small .body, .panel.auto.small .foot { display: none; }
    .brand.drag { cursor: grab; user-select: none; touch-action: none; }
    .brand.dragging { cursor: grabbing; }
    .brand-buttons { display: flex; gap: 6px; }
    .tab-notice { margin-bottom: 8px; padding: 8px 10px; border: 1px solid rgb(99 102 241 / .55); border-radius: 12px; background: #111a2e; color: #c7d2fe; font-weight: 650; }
    .tab-notice.bad { border-color: rgb(249 115 22 / .55); color: #fdba74; }
    .ask-tab { margin-bottom: 8px; padding: 9px 10px; border: 1px solid rgb(250 204 21 / .45); border-radius: 12px; background: #0d1526; color: #e2e8f0; }
    .ask-tab strong { display: block; color: #fcd34d; }
    .ask-tab .row { margin: 2px 0 6px; }
    .job-link { display: inline-block; margin-top: 4px; color: #93c5fd; font-size: 11px; font-weight: 700; text-decoration: none; }
    .job-link:hover { text-decoration: underline; }
    .menu { position: absolute; right: 16px; bottom: 16px; z-index: 2; min-width: 200px; padding: 6px; border: 1px solid #34425a; border-radius: 12px; background: #0d1526; box-shadow: 0 12px 32px rgb(0 0 0 / 50%); }
    .menu strong { display: block; padding: 4px 8px 6px; color: #94a3b8; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
    .menu button { display: block; width: 100%; margin: 2px 0; padding: 7px 10px; border: 1px solid transparent; border-radius: 8px; background: none; color: #e2e8f0; font: 650 12.5px Inter, ui-sans-serif, system-ui, sans-serif; text-align: left; cursor: pointer; }
    .menu button:hover, .menu button:focus-visible { border-color: #475569; background: #1a2438; outline: none; }
    /* Auto Apply signals, top left of the page: A (Ask AI) and F (filling). A spinning ring while
       working, a green ring when done, a red one when the AI did not answer; no words. */
    .signals { position: fixed; top: 10px; left: 10px; display: flex; gap: 6px; padding: 5px 6px; border: 1px solid rgb(148 163 184 / .18); border-radius: 999px; background: rgb(10 15 28 / .72); backdrop-filter: blur(10px) saturate(140%); -webkit-backdrop-filter: blur(10px) saturate(140%); box-shadow: 0 6px 20px rgb(0 0 0 / .28); pointer-events: none; }
    .signals[hidden] { display: none; }
    .sig { position: relative; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; color: #cbd5e1; font: 800 11px/1 Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em; }
    .sig::before { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgb(148 163 184 / .28); transition: border-color .25s ease, box-shadow .25s ease; }
    .sig.busy::before { border-color: transparent; background: conic-gradient(from 0deg, #818cf8, #60a5fa 40%, transparent 70%) border-box; -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)); mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px)); animation: sig-spin .8s linear infinite; }
    .sig.busy { color: #c7d2fe; }
    .sig.done::before { border-color: #22c55e; box-shadow: 0 0 0 3px rgb(34 197 94 / .16), 0 0 10px rgb(34 197 94 / .35); }
    .sig.done { color: #bbf7d0; }
    .sig.failed::before { border-color: #ef4444; box-shadow: 0 0 0 3px rgb(239 68 68 / .14); }
    .sig.failed { color: #fecaca; }
    @keyframes sig-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .sig.busy::before { animation-duration: 2.4s; } }
  `;
  const panel = document.createElement('div');
  panel.className = 'panel';
  const tab = document.createElement('button');
  tab.className = 'review-tab'; tab.type = 'button'; tab.hidden = true;
  tab.setAttribute('aria-label', 'Show Auto Apply review');
  for (const letter of ['q', 't', 's']) {
    const span = document.createElement('span'); span.className = letter; span.textContent = letter.toUpperCase(); tab.append(span);
  }
  tab.addEventListener('click', () => { collapsed = false; render(); saveUi(); });
  host.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menuOpen) { menuOpen = false; render(); } });
  // Auto Apply signals: A (Ask AI) and F (filling), top left of the page.
  const signals = document.createElement('div');
  signals.className = 'signals';
  signals.hidden = true;
  signals.setAttribute('aria-hidden', 'true');
  const signalA = document.createElement('span');
  const signalF = document.createElement('span');
  signalA.textContent = 'A';
  signalF.textContent = 'F';
  signals.append(signalA, signalF);
  root.append(style, panel, tab, signals);
  (document.documentElement || document.body).appendChild(host);
  // Auto Apply: the panel in the browser's top layer (above any site pop-up, cookie banner or chat),
  // raised again whenever the site puts something of its own there.
  function raise() {
    try {
      if (!host.isConnected || !host.showPopover) return;
      if (!host.hasAttribute('popover')) host.setAttribute('popover', 'manual');
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch { /* Not in the top layer on an old browser: the highest z-index still holds. */ }
  }
  let raiseTimer = null;
  const raiseSoon = () => { clearTimeout(raiseTimer); raiseTimer = setTimeout(raise, 50); };
  // A site that rebuilds its page (a framework redrawing <html> or <body>) can throw the panel out:
  // it goes straight back, so the panel never goes missing while QTS works or waits.
  function reattach() {
    if (disposed || !state) return false;
    // A panel left by an updated extension (or one whose extension is briefly unreachable) is not put
    // back: the new one takes its place.
    if (!contextAvailable()) return false;
    if (host.isConnected) return false;
    (document.documentElement || document.body).appendChild(host);
    return true;
  }
  const topLayerWatch = new MutationObserver((records) => {
    if (reattach()) { render(); return; }
    for (const record of records) {
      if (record.target === host || host.contains(record.target)) continue;
      if (record.type === 'attributes' || [...record.addedNodes].some((node) => node.nodeType === 1)) { raiseSoon(); return; }
    }
  });
  const onPageToggle = (event) => { if (event.target !== host && event.newState === 'open') raiseSoon(); };

  let state = null;
  let busy = false;
  let collapsed = false;
  // Auto Apply: the panel's own view, carried to the next tab of the application.
  let small = false;
  let floating = null;
  let menuOpen = false;
  let uiApplied = false;
  let lastReveal = 0;
  let uiTimer = null;
  let disposed = false;
  let heartbeatTimer = null;
  let editRender = null;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // Auto Apply: a short message under the job (copied, filled, the folder), kept across redraws.
  const jobStatus = element('div', 'job-status');
  jobStatus.setAttribute('role', 'status');
  let statusTimer = null;
  function say(text) {
    jobStatus.textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { jobStatus.textContent = ''; }, 8000);
  }

  // The job's PDF folder: a click copies its full path (nothing opens). When this Chrome does not
  // know where Downloads is, the path starts with %USERPROFILE%\Downloads, which Explorer and a
  // file picker's address bar both understand.
  async function copyFolderPath() {
    if (!state?.resumeFolder) return;
    const path = /^[a-z]:\\/i.test(state.resumeFolderPath || '')
      ? state.resumeFolderPath
      : `%USERPROFILE%\\Downloads\\${state.resumeFolder.replace(/\//g, '\\').replace(/\\+$/, '')}`;
    say(await copyReference(path) ? 'Copied: the folder\'s full path' : 'Could not copy. Try again.');
  }

  // Texts the Manager edits in the panel (salary lines, the Answer text), remembered in this Chrome
  // for every job and candidate.
  const DEFAULT_ANSWER_TEXT = 'this is my resume. i wanna make answer to fill for compleing job apply.\nmake answer within 3 - 4 sentences if should explain something, or simply if require simple answer.\nnot require evidence or verified information. answers must be shown high senior level enginer experience to match the job highly.';
  const panelTexts = { salaryMonth: '6000 EUR per month', salaryYear: '60000 - 70000 EUR per year', answerText: DEFAULT_ANSWER_TEXT };
  const TEXTS_KEY = 'qtsPanelTexts';
  try {
    global.chrome?.storage?.local?.get?.(TEXTS_KEY)?.then?.((stored) => {
      const saved = stored?.[TEXTS_KEY];
      if (!saved || typeof saved !== 'object') return;
      for (const key of Object.keys(panelTexts)) if (typeof saved[key] === 'string') panelTexts[key] = saved[key];
      if (openBox) render();
    }).catch?.(() => {});
  } catch { /* the defaults stay */ }
  let textsSave = null;
  function saveTexts() {
    clearTimeout(textsSave);
    textsSave = setTimeout(() => { try { global.chrome?.storage?.local?.set?.({ [TEXTS_KEY]: { ...panelTexts } })?.catch?.(() => {}); } catch { /* not saved */ } }, 300);
  }
  // LinkedIn always copies as https://www.linkedin.com/…
  function linkedinFull(url) {
    const rest = String(url || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (!rest) return '';
    // A full address keeps its own site; a bare "in/name" is LinkedIn's.
    return `https://www.${/^[^/\s]+\.[a-z]{2,}(\/|$)/i.test(rest) ? rest : `linkedin.com/${rest.replace(/^\/+/, '')}`}`;
  }

  // The Answer box: the résumé, this page's empty questions ("question:" one per line, optional ones
  // too) and the Manager's text, copied as one. The questions are this job's only (kept while it
  // runs, never saved); the text is remembered for every job.
  let answerQuestions = { key: '', text: '', edited: false };
  const jobKey = () => String(state?.job?.id || state?.job?.url || '');
  function pageQuestions() {
    const clean = (label) => String(label || '').replace(/\s+/g, ' ').replace(/\s*\((required|optional)\)\s*$/i, '').replace(/[\s*✱:]+$/, '').trim();
    let labels = [];
    try {
      const form = global.__qtsApplyForm;
      labels = (form?.scanForm?.() || [])
        .filter((field) => !field.hidden && !field.disabled && field.kind !== 'file' && field.label && form.isUnanswered(field))
        .map((field) => clean(field.label));
    } catch { labels = []; }
    if (!labels.length) labels = (state?.requiredRows || []).filter((row) => !answeredLive(row)).map((row) => clean(row.label));
    return [...new Set(labels.filter(Boolean))];
  }
  function questionsNow() {
    if (answerQuestions.edited && answerQuestions.key === jobKey()) return answerQuestions.text;
    answerQuestions = { key: jobKey(), text: pageQuestions().map((label) => `${label}:`).join('\n'), edited: false };
    return answerQuestions.text;
  }
  const answerText = () => [String(state?.references?.resumeText || '').trim(), questionsNow().trim(), panelTexts.answerText.trim()].filter(Boolean).join('\n\n');
  async function copyAnswer() {
    say(await copyReference(answerText()) ? 'Copied: résumé, empty questions and your text' : 'Could not copy. Try again.');
  }
  function answerBox() {
    const box = element('div', 'career answer-box');
    const head = element('div', 'career-head', 'Answer');
    const hide = element('button', '', 'Hide ✕');
    hide.type = 'button';
    hide.addEventListener('click', () => { openBox = ''; render(); });
    head.append(hide);
    box.append(head);
    const questionsHead = element('div', 'answer-label', 'Empty questions on this page (this job only)');
    const reread = element('button', 'answer-mini', '↻ Read the page again');
    reread.type = 'button';
    reread.addEventListener('click', () => { answerQuestions = { key: '', text: '', edited: false }; render(); });
    questionsHead.append(reread);
    const questions = element('textarea', 'answer-text');
    questions.dataset.keep = 'answer-questions';
    questions.value = questionsNow();
    questions.rows = Math.min(10, Math.max(3, questions.value.split('\n').length + 1));
    questions.placeholder = 'No empty question found on this page.';
    questions.addEventListener('input', () => { answerQuestions = { key: jobKey(), text: questions.value, edited: true }; });
    const textHead = element('div', 'answer-label', 'Your text (remembered for every job)');
    const text = element('textarea', 'answer-text');
    text.dataset.keep = 'answer-text';
    text.value = panelTexts.answerText;
    text.rows = 5;
    text.addEventListener('input', () => { panelTexts.answerText = text.value; saveTexts(); });
    const again = element('button', 'copy-button answer-copy', '⧉ Copy again');
    again.type = 'button';
    again.addEventListener('click', () => copyAnswer());
    box.append(element('div', 'answer-label', 'Résumé (this job\'s) goes first'), questionsHead, questions, textHead, text, again);
    return box;
  }

  // The career box (opened by Copy Path): each job as company, title, dates and its full bullets;
  // education as school, degree, dates; the profile links. Every piece is one click to copy.
  // One box open at a time: 'answer', 'profile' or 'career' (Path); '' for none.
  let openBox = '';
  const toggleBox = (name) => { openBox = openBox === name ? '' : name; render(); };
  const monthYear = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})/);
    return match ? `${match[2]}/${match[1]}` : String(value || '').trim();
  };
  const fromTo = (entry) => [monthYear(entry.startDate), entry.isCurrent ? 'Present' : monthYear(entry.endDate)].filter(Boolean).join(' – ');
  // The job's own résumé, in blocks: a heading line ("Role · Company · Place · Dates") and its "- " bullets.
  function resumeBlocks(text) {
    return String(text || '').split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      return { heading: lines.find((line) => !line.startsWith('- ')) || '', bullets: lines.filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim()) };
    }).filter((block) => block.heading && block.bullets.length);
  }
  const bulletText = (bullets) => bullets.map((bullet) => `• ${bullet}`).join('\n');
  // One job's bullets as one small chip on its line: a click copies them all (hover shows them).
  function bulletsButton(text, label, copy) {
    const node = element('button', 'chip bullets', 'Bullets');
    node.type = 'button';
    node.title = text;
    node.addEventListener('click', () => copy(label, text));
    return node;
  }
  // The profile box (opened by Profile): every saved profile item as "label value"; a click copies the value.
  function profileBox(profile, sitePassword = '') {
    const box = element('div', 'career profile-box');
    const head = element('div', 'career-head', 'Profile');
    const hide = element('button', '', 'Hide ✕');
    hide.type = 'button';
    hide.addEventListener('click', () => { openBox = ''; render(); });
    head.append(hide);
    box.append(head);
    // In groups, one row each: the label on the left, the value on the right; a click on the row
    // copies the value (the row flashes "Copied").
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    const groups = [
      ['Name', [['Full name', fullName], ['First name', profile.firstName], ['Last name', profile.lastName]]],
      ['Contact', [['Email', profile.email], ['Phone', profile.phone]]],
      ['Links', [['LinkedIn', linkedinFull(profile.linkedinUrl)], ['GitHub', profile.githubUrl], ['Portfolio', profile.portfolioUrl]]],
      ['Address', [['City, Country', [profile.city, profile.country].map((part) => String(part ?? '').trim()).filter(Boolean).join(', ')], ['Street', profile.addressLine1], ['State', profile.province], ['Postal code', profile.postalCode]]],
      ['More', [['Headline', profile.headline], ['Experience', profile.yearsOfExperience ? `${profile.yearsOfExperience} years` : ''], ['Nationality', profile.nationality], ['Birthday', profile.birthday], ['Languages', Array.isArray(profile.languages) ? profile.languages.join(', ') : profile.languages]]],
    ].map(([title, rows]) => [title, rows.map(([label, value]) => [label, String(value ?? '').trim()]).filter(([, value]) => value)])
      .filter(([, rows]) => rows.length);
    for (const [title, rows] of groups) {
      box.append(element('div', 'profile-group', title));
      for (const [label, value] of rows) {
        const row = element('button', 'profile-row');
        row.type = 'button';
        row.title = `Copy ${label}: ${value}`;
        row.append(element('span', 'profile-label', label), element('span', 'profile-value', value), element('span', 'profile-copy-mark', '⧉'));
        row.addEventListener('click', async () => {
          const ok = await copyReference(value);
          say(ok ? `Copied: ${label}` : 'Could not copy. Try again.');
          if (!ok) return;
          row.classList.add('copied');
          setTimeout(() => row.classList.remove('copied'), 1200);
        });
        box.append(row);
      }
    }
    if (!groups.length) box.append(element('div', 'reference-note', 'No profile details saved.'));
    // Account: the Manager's password for job sites (Settings), masked; a click copies it in full.
    if (String(sitePassword || '').trim()) {
      box.append(element('div', 'profile-group', 'Account'));
      const row = element('button', 'profile-row password-row');
      row.type = 'button';
      row.title = 'Copy the password for job sites';
      row.append(element('span', 'profile-label', 'Password'), element('span', 'profile-value', '•'.repeat(Math.min(12, Math.max(8, sitePassword.length)))), element('span', 'profile-copy-mark', '⧉'));
      row.addEventListener('click', async () => {
        const ok = await copyReference(sitePassword);
        say(ok ? 'Copied: Password' : 'Could not copy. Try again.');
        if (!ok) return;
        row.classList.add('copied');
        setTimeout(() => row.classList.remove('copied'), 1200);
      });
      box.append(row);
    }
    // Salary: the same two lines for every candidate; the Manager edits them here (remembered).
    box.append(element('div', 'profile-group', 'Salary'));
    for (const [key, label] of [['salaryMonth', 'Per month'], ['salaryYear', 'Per year']]) {
      const row = element('div', 'profile-row salary-row');
      const input = element('input', 'profile-input');
      input.dataset.keep = `salary-${key}`;
      input.value = panelTexts[key];
      input.title = 'Edit: remembered for every job';
      input.addEventListener('input', () => { panelTexts[key] = input.value; saveTexts(); });
      const copy = element('button', 'profile-copy-button', '⧉');
      copy.type = 'button';
      copy.title = `Copy ${label}`;
      copy.addEventListener('click', async () => {
        const ok = await copyReference(input.value);
        say(ok ? `Copied: ${input.value}` : 'Could not copy. Try again.');
        if (!ok) return;
        row.classList.add('copied');
        setTimeout(() => row.classList.remove('copied'), 1200);
      });
      row.append(element('span', 'profile-label', label), input, copy);
      box.append(row);
    }
    return box;
  }
  function careerBox(data) {
    const box = element('div', 'career');
    const copyItem = async (label, value) => { say(await copyReference(value) ? `Copied: ${label}` : 'Could not copy. Try again.'); };
    const chip = (label, value, main = false) => {
      const node = element('button', `chip${main ? ' main' : ''}`, value);
      node.type = 'button';
      node.title = `Copy ${label}`;
      node.addEventListener('click', () => copyItem(label, value));
      return node;
    };
    const heading = (text, close = false) => {
      const head = element('div', 'career-head', text);
      if (close) {
        const hide = element('button', '', 'Hide ✕');
        hide.type = 'button';
        hide.addEventListener('click', () => { openBox = ''; render(); });
        head.append(hide);
      }
      return head;
    };
    // Bullets from this job's résumé (the one sent), matched by company; else the profile's own text.
    const blocks = resumeBlocks(data.resumeText);
    const used = new Set();
    const bulletsFor = (entry) => {
      const company = String(entry.companyName || '').trim().toLowerCase();
      const title = String(entry.jobTitle || '').trim().toLowerCase();
      const pick = (test) => blocks.findIndex((block, index) => !used.has(index) && test(block.heading.toLowerCase()));
      let index = company ? pick((text) => text.includes(company) && (!title || text.includes(title))) : -1;
      if (index < 0 && company) index = pick((text) => text.includes(company));
      if (index >= 0) { used.add(index); return bulletText(blocks[index].bullets); }
      return String(entry.description || '').trim();
    };
    const experiences = data.experiences || [];
    box.append(heading('Experience', true));
    for (const entry of experiences) {
      const item = element('div', 'career-item');
      // Two rows: company, title / dates, Bullets.
      const line = element('div', 'career-line');
      if (entry.companyName) line.append(chip('company', entry.companyName, true));
      if (entry.jobTitle) line.append(chip('title', entry.jobTitle));
      const second = element('div', 'career-line');
      if (fromTo(entry)) second.append(chip('dates', fromTo(entry)));
      // Each job's place (the profile's), copied by itself.
      if (String(entry.location || '').trim()) second.append(chip('location', String(entry.location).trim()));
      const bullets = bulletsFor(entry);
      if (bullets) second.append(bulletsButton(bullets, `${entry.companyName || 'job'} bullets`, copyItem));
      item.append(line);
      if (second.childNodes.length) item.append(second);
      box.append(item);
    }
    // No work history in the profile: the résumé's own jobs, as they are written there.
    if (!experiences.length) {
      for (const block of blocks) {
        const item = element('div', 'career-item');
        const line = element('div', 'career-line');
        line.append(chip('heading', block.heading, true), bulletsButton(bulletText(block.bullets), 'bullets', copyItem));
        item.append(line);
        box.append(item);
      }
    }
    if (!experiences.length && !blocks.length) box.append(element('div', 'reference-note', 'No work history saved.'));
    const educations = data.educations || [];
    if (educations.length) {
      box.append(heading('Education'));
      for (const entry of educations) {
        const item = element('div', 'career-item');
        const line = element('div', 'career-line');
        if (entry.institution) line.append(chip('school', entry.institution, true));
        // Degree and field of study copy separately (forms ask for them in two boxes).
        if (entry.degree) line.append(chip('degree', entry.degree));
        if (entry.fieldOfStudy) line.append(chip('field of study', entry.fieldOfStudy));
        if (fromTo(entry)) line.append(chip('dates', fromTo(entry)));
        item.append(line);
        box.append(item);
      }
    }
    const profile = data.profile || {};
    const links = [['LinkedIn', linkedinFull(profile.linkedinUrl)], ['GitHub', profile.githubUrl], ['Portfolio', profile.portfolioUrl]].filter(([, url]) => String(url || '').trim());
    if (links.length) {
      box.append(heading('Profiles'));
      const line = element('div', 'career-line');
      for (const [label, url] of links) {
        const node = chip(label, url);
        node.textContent = `${label}: ${url}`;
        line.append(node);
      }
      box.append(line);
    }
    return box;
  }

  // A required question answered on the form now (read live, so the Manager's typing counts).
  function answeredLive(row) {
    try {
      return Boolean(row.fieldId && global.__qtsApplyForm?.isUnanswered && !global.__qtsApplyForm.isUnanswered({ id: row.fieldId, kind: row.kind }));
    } catch {
      return false;
    }
  }

  /** The page's required questions still empty (read live: a filled one leaves the list), each with
   * the candidate's answer: Copy, or Fill it into its box. Nothing shows when all are filled. */
  function requiredBox() {
    const rows = (state.requiredRows || []).filter((row) => !answeredLive(row));
    if (!rows.length) return null;
    const box = element('div', 'required');
    box.append(element('strong', '', `Still empty on this page (${rows.length})`));
    for (const row of rows) {
      const line = element('div', 'required-row');
      const text = element('div', 'required-text');
      text.title = 'Show this question on the form';
      text.append(
        element('span', 'required-label', row.label),
        element('span', `required-value${row.value ? '' : ' none'}`, row.value || 'Not in the profile'),
      );
      text.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(row.fieldId));
      const copy = element('button', 'row-button', 'Copy');
      const fill = element('button', 'row-button', 'Fill');
      for (const node of [copy, fill]) { node.type = 'button'; node.disabled = !row.value; }
      copy.addEventListener('click', async () => say(await copyReference(row.value) ? `Copied: ${row.label}` : 'Could not copy. Try again.'));
      fill.addEventListener('click', async () => {
        fill.disabled = true;
        const result = await send('fill_field', { fieldId: row.fieldId });
        say(result?.ok ? `Filled: ${row.label}` : `Not filled: ${result?.error || 'try again'}`);
        render();
      });
      line.append(text, copy, fill);
      box.append(line);
    }
    return box;
  }

  function contextAvailable() {
    try { return !disposed && Boolean(global.chrome?.runtime?.id); } catch { return false; }
  }

  async function send(action, extra = {}) {
    if (!state || disposed) return null;
    if (!contextAvailable()) { dispose(); return null; }
    try {
      return await chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', attemptId: state.attemptId, action, ...extra });
    } catch (error) {
      // sendMessage can throw synchronously before returning a Promise after an extension reload.
      if (!contextAvailable() || /extension context invalidated/i.test(String(error?.message || error))) dispose();
      return null;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    state = null;
    clearInterval(heartbeatTimer);
    clearTimeout(editRender);
    clearTimeout(statusTimer);
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('auxclick', onAuxClick, true);
    document.removeEventListener('submit', onDocumentSubmit, true);
    window.removeEventListener('keydown', onShortcut, true);
    document.removeEventListener('toggle', onPageToggle, true);
    topLayerWatch.disconnect();
    documentWatch.disconnect();
    clearTimeout(raiseTimer);
    clearTimeout(uiTimer);
    document.removeEventListener('input', onEdit, true);
    document.removeEventListener('change', onEdit, true);
    for (const type of ['input', 'change', 'click']) document.removeEventListener(type, markManagerChange, true);
    try { global.__qtsApplyForm?.markProblemFields?.([]); } catch { /* Old context already disposed. */ }
    clearDock();
    host.remove();
    if (global.__qtsApplyReview?.remove === dispose) delete global.__qtsApplyReview;
  }

  function clearDock() {
    if (!dock.isConnected) return;
    dock.remove();
    document.documentElement.removeAttribute('data-qts-apply-docked');
  }

  function brandHeader() {
    const brand = element('header', 'brand');
    const logo = element('img', 'brand-logo');
    logo.alt = 'WYS';
    const logoUrl = global.chrome?.runtime?.getURL?.('assets/account-logo.png');
    if (logoUrl) logo.src = logoUrl;
    const center = element('div', 'brand-center'), pills = element('div', 'pills');
    for (const [className, text] of [['pill q', 'Quality'], ['plus', '+'], ['pill t', 'Time'], ['plus', '+'], ['pill s', 'Speed']]) pills.append(element('span', className, text));
    center.append(pills, element('span', 'subline', 'Built for precision bidding'));
    const hide = element('button', 'hide', '›'); hide.type = 'button'; hide.title = 'Hide the panel';
    hide.setAttribute('aria-label', 'Hide Auto Apply review');
    hide.addEventListener('click', () => { collapsed = true; render(); saveUi(); });
    const shrink = element('button', 'hide shrink', small ? '▾' : '▴'); shrink.type = 'button';
    shrink.title = small ? 'Show the whole panel' : 'Make the panel small';
    shrink.setAttribute('aria-label', shrink.title);
    shrink.addEventListener('click', () => { small = !small; render(); saveUi(); });
    const tools = element('div', 'brand-buttons');
    tools.append(hide, shrink);
    // Remove (🗑): the job row leaves the Jobs table (asked first); not once the site's Submit was answered.
    if (state?.mode !== 'confirm') tools.append(removeButton());
    tools.style.flexDirection = 'row-reverse';
    brand.append(logo, center, tools);
    // Dragged by its title bar, the panel floats where it is put (the page is no longer pushed aside).
    brand.classList.add('drag');
    brand.title = 'Drag to move the panel';
    brand.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const box = panel.getBoundingClientRect();
      const dx = event.clientX - box.left;
      const dy = event.clientY - box.top;
      brand.setPointerCapture?.(event.pointerId);
      brand.classList.add('dragging');
      const move = (next) => {
        floating = {
          x: Math.max(0, Math.min(window.innerWidth - 120, next.clientX - dx)),
          y: Math.max(0, Math.min(window.innerHeight - 48, next.clientY - dy)),
        };
        placePanel();
      };
      const up = () => {
        brand.classList.remove('dragging');
        brand.removeEventListener('pointermove', move);
        brand.removeEventListener('pointerup', up);
        brand.removeEventListener('pointercancel', up);
        render();
        saveUi();
      };
      brand.addEventListener('pointermove', move);
      brand.addEventListener('pointerup', up);
      brand.addEventListener('pointercancel', up);
      event.preventDefault();
    });
    return brand;
  }

  // Auto Apply: "Save for this site": every box the Manager filled or changed by hand becomes this
  // job site's form of its saved answer (used at once, and on every later job of the site).
  let savingForSite = false;
  async function saveForSite() {
    if (savingForSite) return;
    savingForSite = true;
    say('Saving your answers for this site…');
    const result = await send('site_forms');
    savingForSite = false;
    say(result?.ok ? result.message || 'Saved for this site.' : `Not saved: ${result?.error || 'try again'}`);
  }
  function siteFormsButton() {
    const node = element('button', '', 'Save for this site');
    node.type = 'button';
    node.title = 'Keep the answers you filled or changed on this page as this job site\'s answers (used on every job of this site)';
    node.disabled = busy;
    node.addEventListener('click', () => saveForSite());
    return node;
  }

  function button(label, className, action, extra) {
    const node = element('button', className, label);
    node.type = 'button';
    node.disabled = busy;
    node.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      render();
      await send(action, typeof extra === 'function' ? extra() : extra);
    });
    return node;
  }

  function answerRow(answer) {
    const row = element('div', 'answer');
    row.title = 'Show this question on the form';
    const sourceLabel = { ai: `${state?.aiName || 'ChatGPT'} ⚑`, saved: 'Saved', reusable: 'Reusable', profile: 'Profile', documents: 'Documents', consent: 'Consent', rule: 'Rule', manager: 'Manager', site: 'Site (from résumé)' }[answer.source] || answer.source;
    // A profile fact given in the field's own words shows the profile's value under it.
    const value = element('span', 'a', answer.answer || '—');
    if (answer.profileValue) value.append(element('span', 'profile-value', `${answer.valueFrom || 'profile'}: ${answer.profileValue}`));
    row.append(
      element('span', 'q', answer.question),
      value,
      element('span', `src ${answer.source === 'ai' ? 'ai' : answer.source === 'manager' ? 'manager' : ''}`, sourceLabel),
    );
    if (answer.fieldId) row.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(answer.fieldId));
    return row;
  }

  // Read-only references: copying never fills a field, accepts an answer, or sends a proposal.
  const referenceOpen = new Set();
  async function copyReference(value) {
    try {
      await navigator.clipboard.writeText(String(value));
      return true;
    } catch {
      const box = element('textarea');
      box.value = String(value);
      box.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
      root.append(box);
      box.select();
      try { return document.execCommand('copy'); } catch { return false; } finally { box.remove(); }
    }
  }

  // (The "Profile, documents & reusable answers" section is gone, the Manager's choice of 2026-11-17:
  // Answer, Profile and Path hold what is copied now.)


  function render() {
    const active = root.activeElement;
    const keep = active?.dataset?.keep ? { key: active.dataset.keep, start: active.selectionStart, end: active.selectionEnd, scroll: active.scrollTop } : null;
    try { renderPanel(); } finally {
      const again = keep && root.querySelector(`[data-keep="${keep.key}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        try { again.setSelectionRange(keep.start, keep.end); again.scrollTop = keep.scroll; } catch { /* not a text box */ }
      }
    }
  }
  function renderPanel() {
    reattach();
    const scrollTop = panel.querySelector('.body')?.scrollTop || 0;
    panel.replaceChildren();
    if (!state) return;
    const auto = state.auto === true;
    panel.classList.toggle('auto', auto);
    panel.classList.toggle('collapsed', collapsed && !auto);
    if (auto) {
      // The view the panel had in the application's previous tab (once), and "bring to front" (its shortcut, when the Manager sets one).
      if (state.ui && !uiApplied) applyUi(state.ui);
      uiApplied = true;
      if (state.revealAt && state.revealAt !== lastReveal) {
        lastReveal = state.revealAt;
        collapsed = false;
        small = false;
      }
      raise();
    }
    panel.classList.toggle('small', auto && small);
    panel.classList.toggle('floating', auto && Boolean(floating));
    placePanel();
    panel.hidden = auto && collapsed;
    tab.hidden = !(auto && collapsed);
    host.toggleAttribute('data-qts-auto-apply-review', auto);
    if (auto && !collapsed && !floating && !small) {
      global.__qtsPageLauncher?.setOpen?.(false);
      if (!dock.isConnected) (document.head || document.documentElement).append(dock);
      document.documentElement.setAttribute('data-qts-apply-docked', 'true');
    } else clearDock();

    const head = element('div', 'head');
    const headText = element('div', 'head-text');
    headText.append(
      element('div', 'head-title', state.mode === 'confirm' ? 'Submitted successfully?' : state.mode === 'stopped' ? 'Auto Apply stopped' : state.mode === 'working' ? `${state.auto ? 'Auto Apply' : 'Apply'} is working…` : state.final ? 'Review, then Submit' : `Review step ${state.step}`),
      element('div', 'head-sub', `${state.chromeName} · ${state.candidate}`),
    );
    const toggle = element('button', 'icon-button', collapsed ? '▾' : '▴');
    toggle.type = 'button';
    toggle.title = collapsed ? 'Show the panel' : 'Make the panel small';
    toggle.addEventListener('click', () => { collapsed = !collapsed; render(); });
    head.append(headText);
    if (!auto) head.append(toggle);
    panel.append(auto ? brandHeader() : head);

    const body = element('div', 'body');
    let copyBar = [];
    // Auto Apply: only the candidate (name and label, larger), the job, and the PDF folder's full path.
    const job = element('div', 'job');
    if (auto) {
      const who = element('div', 'who');
      who.append(element('span', 'who-name', state.candidateName || state.candidate));
      if (state.candidateLabel) who.append(element('span', 'who-label', state.candidateLabel));
      job.append(who);
    }
    job.append(element('div', 'job-title', `${state.job.title} — ${state.job.company}`));
    // Auto Apply: the job's own page, at hand after its tab has closed.
    if (auto && /^https?:\/\//i.test(state.job.url || '')) {
      const link = element('a', 'job-link', 'Job page ↗');
      link.href = state.job.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = state.job.url;
      job.append(link);
    }
    if (!auto) {
      const facts = [state.job.location, state.job.workType, state.job.salary ? `Salary: ${state.job.salary}` : ''].filter(Boolean).join(' · ');
      if (facts) job.append(element('div', 'row muted', facts));
      job.append(element('div', 'row muted', state.job.url));
    }
    // (Auto Apply: the folder is the small "Copy Path" button between the two copy buttons below.)
    if (state.resumeFolder && !auto) {
      const shortPath = `Downloads\\${state.resumeFolder.replace(/\//g, '\\').replace(/\\+$/, '')}`;
      const folder = element('button', 'folder', `📁 ${auto && state.resumeFolderPath ? state.resumeFolderPath : shortPath}`);
      folder.type = 'button';
      folder.title = 'Copy the folder\'s full path';
      folder.addEventListener('click', () => copyFolderPath());
      job.append(folder);
    }
    if (!auto && (state.promptName || state.templateName)) {
      job.append(element('div', 'row muted', [state.promptName && `Prompt: ${state.promptName}`, state.templateName && `Template: ${state.templateName}`].filter(Boolean).join(' · ')));
    }
    // Auto Apply: one line — Copy Resume, the folder's full path, Copy Cover Letter (one click each).
    if (auto && (state.references || state.resumeFolder)) {
      const copies = element('div', 'copy-row');
      const textButton = (label, text) => {
        const copy = element('button', 'copy-button', `✉ ${label}`);
        copy.type = 'button';
        copy.disabled = !String(text || '').trim();
        copy.title = copy.disabled ? `This job has no ${label.toLowerCase()} text.` : `Copy the ${label.toLowerCase()} text`;
        copy.addEventListener('click', async () => say(await copyReference(text) ? `Copied: ${label}` : 'Could not copy. Try again.'));
        return copy;
      };
      // Answer: copies the résumé, this page's empty questions and the Manager's text in one, and
      // opens the box to edit them (a toggle, as Profile and Path; one box open at a time).
      if (state.references) {
        const answer = element('button', `copy-button answer-open${openBox === 'answer' ? ' on' : ''}`, '💬 Answer');
        answer.type = 'button';
        answer.title = 'Copy the résumé, the empty questions and your text';
        answer.setAttribute('aria-pressed', String(openBox === 'answer'));
        answer.addEventListener('click', () => { answerQuestions.edited && answerQuestions.key === jobKey() || (answerQuestions = { key: '', text: '', edited: false }); copyAnswer(); toggleBox('answer'); });
        copies.append(answer);
      }
      // Profile: a toggle that opens the profile box (name, email, phone, links, address…), each one copy.
      if (state.references) {
        const profileButton = element('button', `copy-button profile-copy${openBox === 'profile' ? ' on' : ''}`, '👤 Profile');
        profileButton.type = 'button';
        profileButton.title = 'Show the profile: each item copies with one click';
        profileButton.setAttribute('aria-pressed', String(openBox === 'profile'));
        profileButton.addEventListener('click', () => toggleBox('profile'));
        copies.append(profileButton);
      }
      if (state.resumeFolder) {
        const folder = element('button', 'copy-button folder-copy', '📁 Path');
        folder.type = 'button';
        folder.title = `Copy the folder's full path: ${state.resumeFolderPath || `Downloads\\${state.resumeFolder.replace(/\//g, '\\').replace(/\\+$/, '')}`}`;
        // The click also opens the career box: work history, education and links, each item one copy.
        // A toggle: each click copies the path and opens or closes the box (lit while open).
        folder.setAttribute('aria-pressed', String(Boolean(openBox === 'career' && state.references)));
        if (openBox === 'career' && state.references) folder.classList.add('on');
        folder.addEventListener('click', () => { copyFolderPath(); if (state.references) toggleBox('career'); });
        copies.append(folder);
      }
      if (state.references) copies.append(textButton('Letter', state.references.coverLetterText));
      // The button line stays pinned at the top of the panel while it scrolls (its box right under it).
      copies.classList.add('sticky');
      copyBar = [copies];
      if (openBox === 'answer' && state.references) copyBar.push(answerBox());
      if (openBox === 'profile' && state.references) copyBar.push(profileBox(state.references.profile || {}, state.references.sitePassword || ''));
      if (openBox === 'career' && state.references) copyBar.push(careerBox(state.references));
    }
    if (auto) job.append(jobStatus);
    // Auto Apply: the application and its tabs (waiting for a new one, moved, a tab that did not open).
    if (auto && state.tabNotice) body.append(element('div', `tab-notice${/did not open/i.test(state.tabNotice) ? ' bad' : ''}`, state.tabNotice));
    for (const entry of auto ? state.askTabs || [] : []) {
      const ask = element('div', 'ask-tab');
      ask.append(element('strong', '', 'Is this tab this application?'), element('div', 'row', `${entry.title}${entry.url ? ` · ${entry.url}` : ''}`));
      const buttons = element('div', 'buttons');
      for (const [label, action, className] of [['Use this tab', 'use_tab', 'primary'], ['Ignore', 'ignore_tab', '']]) {
        const node = element('button', className, label);
        node.type = 'button';
        node.addEventListener('click', async () => {
          node.disabled = true;
          const result = await send(action, { tabId: entry.tabId });
          if (result && result.ok === false) say(result.error || 'Try again.');
        });
        buttons.append(node);
      }
      ask.append(buttons);
      body.append(ask);
    }
    body.append(job);
    if (copyBar.length) body.append(...copyBar);
    const stillEmpty = auto && state.requiredRows?.length ? requiredBox() : null;
    if (stillEmpty) body.append(stillEmpty);

    // Auto Apply: one checklist of every question met on every step, checked on the page itself; it
    // takes the place of the separate lists below.
    const listed = Boolean(state.auto && state.checklist);
    if (listed) body.append(checklistBox());
    if (listed) {
      // (The checklist above holds problems, questions left, and provisional answers.)
    } else if (state.problems?.length) {
      const box = element('div', 'problems');
      box.append(element('strong', '', `⚠ Needs you (${state.problems.length})`));
      const list = element('ul', '');
      for (const problem of state.problems) {
        const item = element('li', '', problem.message);
        if (problem.fieldId) item.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(problem.fieldId));
        list.append(item);
      }
      box.append(list);
      body.append(box);
    } else if (state.mode !== 'working') {
      body.append(element('div', 'ok', state.auto && !state.aiOn
        ? '✓ Nothing marked for you. Every answer came from the profile, the documents, or an approved reusable answer.'
        : `✓ Nothing marked for you. Check the ${state.aiName || 'ChatGPT'} ⚑ answers first.`));
    }
    if (state.notice) body.append(element('div', /Not saved/i.test(state.notice) ? 'problems' : 'ok', state.notice));
    if (state.savedChanges?.length) {
      const saved = element('section', 'ok');
      saved.append(element('strong', '', 'Saved changes'));
      for (const entry of state.savedChanges) {
        const row = element('div', 'answer');
        const scope = entry.scope === 'candidate' ? 'This candidate' : entry.scope === 'manager' ? 'My reusable answers' : 'Context uncertain · this application';
        row.append(element('span', 'q', entry.question), element('span', 'a', entry.answer), element('span', 'src', scope));
        if (entry.globalOverride) row.append(element('small', '', 'Global answer takes priority in future applications.'));
        if (entry.canReuse) row.append(button('Move to my reusable answers', '', 'reuse_answer', () => ({ answerId: entry.id })));
        saved.append(row);
      }
      body.append(saved);
    }
    // Auto Apply: questions nothing QTS knows for sure answered (AI answers come later); the required
    // ones are also listed above as still empty.
    if (!listed && state.auto && state.unresolved?.length) {
      const box = element('div', 'problems');
      box.append(element('strong', '', state.aiOn
        ? `Left for you (${state.unresolved.length}): nothing supports an answer`
        : `Left for you (${state.unresolved.length}): no profile fact or approved answer`));
      const list = element('ul', '');
      for (const entry of state.unresolved) {
        const item = element('li', '', `${entry.label}${entry.required ? ' (required)' : ''} · step ${entry.step}${entry.reason ? ` · not filled: ${entry.reason}` : ''}`);
        if (entry.id) item.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(entry.id));
        list.append(item);
      }
      box.append(list);
      body.append(box);
    }

    // Auto Apply: AI answers the documents do not show, filled but provisional until the Manager
    // accepts each as it is or edits it on the form; the site's Submit waits for that.
    if (!listed && state.auto && state.provisional?.length) {
      const entries = provisionalStatus();
      const waiting = entries.filter((entry) => !entry.accepted && !entry.edited).length;
      const box = element('div', 'provisional');
      box.append(element('strong', '', waiting
        ? `Provisional ${state.aiName || 'ChatGPT'} answers: accept or edit ${waiting} of ${entries.length} before Submit`
        : `Provisional ${state.aiName || 'ChatGPT'} answers: all ${entries.length} accepted or edited`));
      const list = element('ul', '');
      for (const entry of entries) {
        const item = element('li', '', `${entry.label} = "${entry.value}" · step ${entry.step} · ${entry.reason}`);
        if (entry.accepted || entry.edited) item.append(element('span', 'done', entry.edited ? '✓ edited' : '✓ accepted'));
        else if (state.mode === 'review') item.append(button('Accept', '', 'accept_provisional', { label: entry.label }));
        if (entry.id) item.addEventListener('click', (event) => { if (event.target === item) global.__qtsApplyForm?.focusField?.(entry.id); });
        list.append(item);
      }
      box.append(list);
      body.append(box);
    }

    const steps = [...new Set((state.answers || []).map((answer) => answer.step))].sort((a, b) => a - b);
    for (const step of steps) {
      const answers = state.answers.filter((answer) => answer.step === step);
      body.append(element('div', 'section', steps.length > 1 ? `Step ${step} · ${answers.length} answers` : `Filled answers (${answers.length})`));
      for (const answer of answers) body.append(answerRow(answer));
    }
    panel.append(body);

    const foot = element('div', 'foot');
    const buttons = element('div', 'buttons');
    // Auto Apply: Submitted is always there and always works, at any step, also while QTS is working:
    // one click saves the bid (the job leaves the list and this tab closes).
    const submittedNow = () => button('Submitted', 'yes', 'submitted', () => ({ answers: currentAnswers() }));
    if (auto && state.mode === 'stopped') {
      // Auto Apply stopped by itself (not the Manager): the tab, the form and this panel stay. The
      // Manager saves the bid, or gives the job back unchanged (the tab closes).
      // The whole panel stays: Fill again, Ask AI and Check take the job up again in this tab; Skip,
      // Later and Give back return it unchanged.
      // (No description above the buttons: the Manager's choice, 2026-11-17.)
      buttons.append(submittedNow());
      buttons.append(button('Check', '', 'recheck'), button('Skip', '', 'skip'), button('Later', '', 'later'), button('Fill again', '', 'fill_again'), button('Give back', 'no', 'give_back'));
      foot.append(buttons);
    } else if (state.mode === 'working') {
      const working = element('div', 'working');
      working.append(element('span', 'spinner'), element('span', '', state.workingText || 'Filling the form…'));
      foot.append(working);
      if (auto) {
        buttons.style.marginTop = '8px';
        buttons.append(submittedNow());
        foot.append(buttons);
      }
    } else if (state.mode === 'confirm') {
      foot.append(element('div', 'note', 'Did the site take the application? Check the page or the email, then answer — any time.'));
      buttons.append(
        button('Yes, submitted', 'yes', 'yes'),
        button('No', 'no', 'no'),
        button('Not submitted — back to review', '', 'back_to_review'),
      );
      foot.append(buttons);
    } else {
      const blocking = blockingNow();
      // Auto Apply: no description above the buttons (the Manager's choice, 2026-11-17), only the
      // blocked-candidate warning.
      if (!auto || state.blocked) foot.append(element('div', 'note', state.blocked
        ? 'This candidate is blocked: skip this job.'
        : auto
          ? [
            state.final ? 'Check the answers, click the site\'s Submit, then Submitted here.' : 'Check this step, then click the site\'s own Next (or Continue). QTS fills the next step when it shows.',
            blocking ? `${blocking} thing${blocking === 1 ? '' : 's'} on the checklist still need${blocking === 1 ? 's' : ''} you.` : '',
            // (Ask AI is the Manager's Alt+A, and in the Alt+S menu: no button.)
            state.aiOn ? 'Alt+A asks the AI for the boxes still empty.' : '',
            'Submitted saves the bid at any time.',
          ].filter(Boolean).join(' ')
        : listed && state.final
          ? blocking
            ? `${blocking} thing${blocking === 1 ? '' : 's'} on the checklist still need${blocking === 1 ? 's' : ''} you. Fix ${blocking === 1 ? 'it' : 'them'} on the form, click Check, then the site's Submit.`
            : 'Everything QTS could check is in order. Look over the answers, then click the site\'s Submit.'
          : state.final
            ? state.reviewAll
              ? 'Every step is filled. Check all the answers below, fix what is marked (use the site\'s Back for an earlier step), then click the site\'s Submit.'
              : 'Check everything, fix what is marked, then click the site\'s Submit.'
            : listed
              // Auto Apply: the Manager moves the form on; QTS fills each new step when it shows.
              ? 'Check this step and fix what is marked, then click the site\'s own Next (or Continue). QTS fills the next step when it shows.'
              : 'Check this step, fix what is marked, then Continue.'));
      if (!state.blocked && !state.final && !listed) buttons.append(button('Continue →', 'primary', 'continue'));
      if (auto) buttons.append(submittedNow());
      if (!auto && !state.blocked && state.final) {
        const submittedButton = button('I submitted it', '', 'submitted', () => ({ answers: currentAnswers() }));
        if (blocking) {
          submittedButton.disabled = true;
          submittedButton.title = listed ? 'Deal with every item the checklist marks first, then Check.' : 'Accept or edit each provisional answer first.';
        }
        buttons.append(submittedButton);
      }
      // Auto Apply: the page read again after the Manager's changes (nothing is filled).
      if (listed) buttons.append(button('Check', auto ? '' : 'primary', 'recheck', () => ({ manualCheck: true, answers: currentAnswers() })));
      buttons.append(button('Skip', '', 'skip'));
      if (!state.blocked) {
        buttons.append(button('Later', '', 'later'));
        buttons.append(button('Fill again', '', 'fill_again'));
        if (auto) buttons.append(siteFormsButton());
        if (!auto && state.canAskAgain) buttons.append(button(`Ask ${state.aiName || 'ChatGPT'} again`, '', 'ask_again'));
        // Auto Apply: the answers the Manager changed go to Super Admin as drafts (never approved by this).
      }
      foot.append(buttons);
    }
    panel.append(foot);
    if (auto && menuOpen) panel.append(actionsMenu());
    // The signals: each 'busy', 'done', 'failed' or idle.
    signals.hidden = !auto;
    if (auto) {
      const look = (value) => `sig${['busy', 'done', 'failed'].includes(value) ? ` ${value}` : ''}`;
      signalA.className = look(state.signals?.ai);
      signalF.className = look(state.signals?.fill);
      signalA.title = 'Ask AI';
      signalF.title = 'Filling';
    }
    if (auto) {
      body.scrollTop = uiScroll ?? scrollTop;
      uiScroll = null;
      body.addEventListener('scroll', () => { clearTimeout(uiTimer); uiTimer = setTimeout(saveUi, 400); }, { passive: true });
    }
  }

  // Auto Apply: where a dragged panel stands (kept inside the window).
  function placePanel() {
    if (!state?.auto || !floating) { panel.style.left = ''; panel.style.top = ''; return; }
    panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, floating.x))}px`;
    panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 48, floating.y))}px`;
  }
  // Auto Apply: the panel's own view, sent to QTS so the application's next tab shows it the same way.
  let uiScroll = null;
  function currentUi() {
    return { collapsed, small, floating, referenceOpen: [...referenceOpen], scrollTop: panel.querySelector('.body')?.scrollTop || 0 };
  }
  function saveUi() {
    if (!state?.auto) return;
    send('ui_state', { ui: currentUi() });
  }
  function applyUi(ui) {
    collapsed = ui.collapsed === true;
    small = ui.small === true;
    floating = ui.floating && Number.isFinite(ui.floating.x) && Number.isFinite(ui.floating.y) ? { x: ui.floating.x, y: ui.floating.y } : null;
    referenceOpen.clear();
    for (const key of Array.isArray(ui.referenceOpen) ? ui.referenceOpen : []) referenceOpen.add(String(key));
    uiScroll = Number(ui.scrollTop) || 0;
  }

  // Auto Apply: Remove, as Normal Apply's: asked first, then the job row leaves the Jobs table (the PDFs stay).
  const confirmRemove = () => confirm(`Remove "${state.job.title}" at ${state.job.company} from the Jobs table?`);
  function removeButton() {
    const node = element('button', 'hide remove', '🗑');
    node.type = 'button';
    node.title = 'Remove this job from the Jobs table';
    node.setAttribute('aria-label', 'Remove this job from the Jobs table');
    node.disabled = busy;
    node.addEventListener('click', async () => {
      if (busy || !confirmRemove()) return;
      busy = true;
      render();
      await send('remove');
    });
    return node;
  }

  // Auto Apply: Alt+S opens the panel's actions (Ask AI, Fill again, Submitted, Cancel, Remove) in this tab.
  function actionsMenu() {
    const menu = element('div', 'menu');
    menu.setAttribute('role', 'menu');
    menu.append(element('strong', '', 'Actions · Alt+S'));
    const reviewing = state.mode === 'review';
    const stopped = state.mode === 'stopped';
    const items = [
      reviewing && state.aiOn && !state.blocked ? [`Ask ${state.aiName || 'AI'} · Alt+A`, 'ask_ai'] : null,
      reviewing && !state.blocked ? ['Fill again', 'fill_again'] : null,
      reviewing ? ['Save for this site', 'site_forms'] : null,
      ['Submitted', 'submitted'],
      stopped ? ['Give back', 'give_back'] : ['Cancel', 'cancel'],
      state.mode !== 'confirm' ? ['Remove', 'remove'] : null,
    ].filter(Boolean);
    for (const [label, action] of items) {
      const node = element('button', '', label);
      node.type = 'button';
      node.setAttribute('role', 'menuitem');
      node.addEventListener('click', async () => {
        if (action === 'remove' && !confirmRemove()) return;
        menuOpen = false;
        // Save for this site answers with a message and changes nothing in the review.
        if (action === 'site_forms') {
          render();
          await saveForSite();
          return;
        }
        busy = true;
        render();
        await send(action, action === 'submitted' ? { answers: currentAnswers() } : {});
      });
      menu.append(node);
    }
    setTimeout(() => menu.querySelector('button')?.focus(), 0);
    return menu;
  }
  const onShortcut = (event) => {
    if (!contextAvailable()) { dispose(); return; }
    if (!state?.auto || !event.altKey || event.ctrlKey || event.metaKey) return;
    // Alt+S: QTS stops filling this step at once (and an AI request under way); what is filled stays.
    if (event.code === 'KeyS') {
      event.preventDefault();
      event.stopPropagation();
      send('stop_filling');
    } else if (event.code === 'KeyF') {
      // Alt+F: QTS fills this step now (also takes a stopped job up again), as Fill again. Caught before
      // the page and before Chrome's own Alt+F menu.
      event.preventDefault();
      event.stopPropagation();
      send('fill_again');
    } else if (event.key === 'Escape' && menuOpen) {
      menuOpen = false;
      render();
    }
  };
  // (On the window, before the page's own key handlers, so a site cannot swallow Alt+S.)
  window.addEventListener('keydown', onShortcut, true);
  document.addEventListener('toggle', onPageToggle, true);
  topLayerWatch.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'popover'] });
  // A page that replaces its whole <html> (the watcher above was on the old one): the panel goes into the new one.
  const documentWatch = new MutationObserver(() => {
    if (!document.documentElement) return;
    topLayerWatch.disconnect();
    topLayerWatch.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'popover'] });
    if (reattach()) render();
  });
  documentWatch.observe(document, { childList: true });

  function currentAnswers() {
    try {
      return global.__qtsApplyForm?.currentAnswers?.() || [];
    } catch {
      return [];
    }
  }

  // Provisional answers as the form has them now: edited when the box no longer holds the AI's answer.
  const plain = (value) => String(Array.isArray(value) ? value.join(', ') : value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  function provisionalStatus() {
    const now = new Map(currentAnswers().map((entry) => [entry.id, entry.value]));
    return (state?.provisional || []).map((entry) => ({ ...entry, edited: now.has(entry.id) && plain(now.get(entry.id)) !== plain(entry.value) }));
  }
  function pendingProvisional() {
    return state?.auto ? provisionalStatus().filter((entry) => !entry.accepted && !entry.edited) : [];
  }

  // What on the checklist still needs the Manager (shown, never blocking Submitted): provisional answers
  // still waiting (read live, so an edit counts at once), and items that need the Manager, did not
  // take (required), or are blocked. Not-verified items are shown, never blocking.
  const BLOCKING = new Set(['needs_input', 'failed', 'blocked']);
  // A question of this step the Manager has answered on the form since the last check (read live):
  // no longer blocking. Page-wide items (a human check, an error) wait for "Check".
  function settledLive(item) {
    const form = global.__qtsApplyForm;
    if (!item.fieldId || !item.kind || item.kind === 'page' || !form?.isUnanswered) return false;
    try {
      const answered = item.kind === 'file' ? form.uploadAccepted?.(item.fieldId) : !form.isUnanswered({ id: item.fieldId, kind: item.kind });
      return Boolean(answered) && !form.fieldIssue?.(item.fieldId);
    } catch {
      return false;
    }
  }
  function openItems() {
    if (!state?.checklist) return [];
    const waiting = new Set(pendingProvisional().map((entry) => entry.label));
    return state.checklist.items.filter((item) => (item.category === 'provisional'
      ? waiting.has(item.label)
      : (BLOCKING.has(item.category) || item.category === 'unknown') && !settledLive(item)));
  }
  function blockingNow() {
    if (!state?.auto) return 0;
    if (!state.checklist) return pendingProvisional().length;
    return openItems().filter((item) => item.category === 'provisional' || (BLOCKING.has(item.category) && (item.required || item.category !== 'failed'))).length;
  }

  /** The checklist: what needs the Manager first (each with its question, issue, and step), then the rest folded. */
  function checklistBox() {
    const { items, totals } = state.checklist;
    const open = openItems();
    const blocking = blockingNow();
    const box = element('div', blocking ? 'problems' : 'ok');
    box.append(element('strong', '', blocking
      ? `⚠ Needs you (${blocking}) · ${totals.verified} verified · ${totals.optional_empty} optional left empty`
      : `✓ Nothing needs you · ${totals.verified} verified · ${totals.optional_empty} optional left empty`));
    // The whole application at a glance: questions found, what is open, uploads, and barriers.
    const questions = items.filter((item) => item.kind !== 'page');
    const uploads = questions.filter((item) => item.kind === 'file');
    const attached = uploads.filter((item) => item.category === 'verified').length;
    const requiredOpen = open.filter((item) => item.required && ['needs_input', 'failed'].includes(item.category)).length;
    const barriers = items.filter((item) => item.category === 'blocked').map((item) => item.label);
    box.append(element('div', 'row', [
      `${questions.length} question${questions.length === 1 ? '' : 's'} found`,
      `${requiredOpen} required unresolved`,
      `${open.filter((item) => item.category === 'provisional').length} provisional`,
      `${open.filter((item) => item.category === 'unknown').length} not verified`,
      uploads.length ? `uploads: ${attached} of ${uploads.length} attached` : 'no uploads',
      barriers.length ? `barriers: ${barriers.join(', ')}` : 'no sign-in or CAPTCHA barrier seen',
    ].join(' · ')));
    if (open.length) {
      const list = element('ul', '');
      for (const item of open) {
        const li = element('li', '', `${item.title}: "${item.label}"${item.issue ? ` — ${item.issue}` : ''} · ${item.where}`);
        if (item.category === 'provisional' && state.mode === 'review') li.append(button('Accept', '', 'accept_provisional', { label: item.label }));
        if (item.fieldId) li.addEventListener('click', (event) => { if (event.target === li) global.__qtsApplyForm?.focusField?.(item.fieldId); });
        list.append(li);
      }
      box.append(list);
    }
    // The rest, folded: verified answers and optional questions left empty.
    for (const category of ['verified', 'optional_empty']) {
      const rest = items.filter((item) => item.category === category);
      if (!rest.length) continue;
      const fold = element('details', '');
      fold.append(element('summary', '', `${rest[0].title} (${rest.length})`));
      const list = element('ul', '');
      for (const item of rest) {
        const li = element('li', '', `"${item.label}"${item.issue ? ` — ${item.issue}` : ''} · ${item.where}`);
        if (item.fieldId) li.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(item.fieldId));
        list.append(li);
      }
      fold.append(list);
      box.append(fold);
    }
    return box;
  }

  // On the last step, the Manager's own click on the site's Submit moves the panel to Yes/No. The
  // form's values are read at that moment, before the page changes.
  let submitNoticedAt = 0;
  function noticeSubmit() {
    // Auto Apply does not watch the site's Submit: its bid comes only from the panel's Submitted.
    if (!state || state.auto || state.mode !== 'review' || !state.final || state.blocked) return;
    if (Date.now() - submitNoticedAt < 3000) return;
    submitNoticedAt = Date.now();
    send('submitted', { answers: currentAnswers(), noticed: true });
  }
  // Auto Apply: the Manager's click on the site's own Next, Continue, or Back: the step is read at
  // that moment (before the page changes), so the checklist keeps it as the Manager left it.
  const STEP_BUTTON = /^(next|continue|save (and|&) continue|save (and|&) next|review( (your )?application)?|proceed|back|previous|go back)\b/i;
  function noticeStepButton(target) {
    if (!state?.auto || !state.checklist || state.mode !== 'review') return;
    const control = target?.closest?.('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if (!control || host.contains(control)) return;
    const text = String(control.innerText || control.value || control.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!STEP_BUTTON.test(text)) return;
    let look = null;
    try { look = global.__qtsApplyForm?.auditForm?.() || null; } catch { look = null; }
    send('step_leaving', { look });
  }
  // Auto Apply: which control the Manager clicked, so a tab it opens is judged by it. A start /
  // continue control (Apply, Start application, I'm interested, Quick apply, Next, Continue, Save and
  // Continue, Review…) opens the application's next step; a sign-in, policy, help, social or upload
  // control, or any other link, opens a side tab; an unclear one (Learn more, View job, Details) is
  // judged by what its tab shows.
  const SIDE_CONTROL = /\b(sign ?in|log ?in|sign ?up|continue with|connect with|google|microsoft|apple id|linkedin|facebook|twitter|instagram|youtube|dropbox|google drive|one ?drive|box\.com|upload|terms|privacy|cookies?|legal|help|support|faq|about( us)?|contact|website|home ?page|blog|news|job page)\b/i;
  const START_CONTROL = /^(apply|start|begin|i'?m interested|express interest|quick apply|easy apply|next|continue|save (and|&) (continue|next)|review|proceed|get started)\b/i;
  const UNCLEAR_CONTROL = /^(learn more|view( the)? job|view( job)? details|details|more (info|information|details)|read more|see more|show more|see (the )?job|open|view|click here|here|more)\b/i;
  function clickKind(control, submitLike) {
    const text = String(control.innerText || control.value || control.getAttribute('aria-label') || control.title || '').replace(/\s+/g, ' ').trim();
    if (SIDE_CONTROL.test(text)) return 'side';
    if (START_CONTROL.test(text) || (submitLike && !state?.final)) return 'start';
    if (UNCLEAR_CONTROL.test(text) || !text) return 'unclear';
    return 'side';
  }
  function noticePageClick(event, submitLike) {
    if (!state?.auto || !event.isTrusted) return;
    const control = event.target?.closest?.('button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]');
    if (!control || host.contains(control)) return;
    send('page_click', { kind: clickKind(control, submitLike) });
  }
  const onAuxClick = (event) => {
    if (!contextAvailable()) { dispose(); return; }
    if (event.button === 1) noticePageClick(event, false);
  };
  const onDocumentClick = (event) => {
    if (!contextAvailable()) { dispose(); return; }
    const submitLike = global.__qtsApplyForm?.isSubmitControl?.(event.target);
    noticePageClick(event, submitLike);
    // Before the last step a submit-type button is the site's Next.
    if (!submitLike || !state?.final) noticeStepButton(event.target);
    if (!submitLike) return;
    noticeSubmit();
  };
  const onDocumentSubmit = (event) => {
    if (!contextAvailable()) { dispose(); return; }
    noticeSubmit();
  };
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('auxclick', onAuxClick, true);
  document.addEventListener('submit', onDocumentSubmit, true);
  // An edit on the form may settle a provisional answer: the panel shows it shortly after.
  const onEdit = (event) => {
    if (!contextAvailable()) { dispose(); return; }
    if (event?.target === host) return;
    if (!state?.provisional?.length && !state?.checklist && !state?.requiredRows?.length) return;
    clearTimeout(editRender);
    editRender = setTimeout(render, 300);
  };
  document.addEventListener('input', onEdit, true);
  document.addEventListener('change', onEdit, true);
  // Auto Apply with APIs: what the Manager types or picks while reviewing is marked on the box itself,
  // so QTS never empties or replaces it, on this step or after the Manager moves on.
  const markManagerChange = (event) => {
    if (!event.isTrusted || !state?.apiFlow || state.mode !== 'review' || host.contains(event.target)) return;
    const path = event.composedPath().filter((node) => node?.setAttribute);
    const box = event.type === 'click'
      ? path.find((node) => node.matches('[role="radio"], [role="checkbox"], [role="combobox"], [aria-pressed], [data-qts-apply-field]'))
      : path[0];
    box?.setAttribute('data-qts-manager-changed', '1');
  };
  for (const type of ['input', 'change', 'click']) document.addEventListener(type, markManagerChange, true);

  // The worker sleeps when idle; the panel keeps it awake while the Manager reviews.
  heartbeatTimer = setInterval(() => { if (state) send('ping'); }, 20000);

  global.__qtsApplyReview = {
    render(nextState) {
      if (!contextAvailable()) { dispose(); return false; }
      state = nextState;
      busy = false;
      render();
      if (nextState?.problemFieldIds) global.__qtsApplyForm?.markProblemFields?.(nextState.problemFieldIds);
      return true;
    },
    remove: dispose,
  };
})(globalThis);
