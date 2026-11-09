// Apply's review panel on the application page (injected by the service worker into the form's tab).
// It shows the job, the résumé folder, and every answer with where it came from (ChatGPT answers
// flagged), marks what needs the Manager, and carries the Manager's choices back to the worker:
// Continue / Skip / Later / Fill again / Ask ChatGPT (or Gemini) again / I submitted it, then Yes / No / Not
// submitted. On the last step it notices the Manager's own click on the site's Submit; with Auto Apply it
// holds that Submit back while a provisional AI answer is neither accepted nor edited.
(function initApplyReview(global) {
  if (global.__qtsApplyReview) return;
  // A prior extension context may have left its host in this page after an update.
  for (const stale of document.querySelectorAll('[data-qts-apply-review], [data-qts-auto-apply-dock]')) stale.remove();

  const PANEL_WIDTH = 'min(480px, 48vw)';
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
  `;
  const panel = document.createElement('div');
  panel.className = 'panel';
  const tab = document.createElement('button');
  tab.className = 'review-tab'; tab.type = 'button'; tab.hidden = true;
  tab.setAttribute('aria-label', 'Show Auto Apply review');
  for (const letter of ['q', 't', 's']) {
    const span = document.createElement('span'); span.className = letter; span.textContent = letter.toUpperCase(); tab.append(span);
  }
  tab.addEventListener('click', () => { collapsed = false; render(); });
  root.append(style, panel, tab);
  (document.documentElement || document.body).appendChild(host);

  let state = null;
  let busy = false;
  let collapsed = false;
  let disposed = false;
  let heartbeatTimer = null;
  let editRender = null;
  // The site's Submit was held back because provisional answers were still waiting.
  let submitHeld = false;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

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
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('submit', onDocumentSubmit, true);
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
    hide.addEventListener('click', () => { collapsed = true; render(); });
    brand.append(logo, center, hide);
    return brand;
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

  function referencePanel(data) {
    const container = element('details', 'references');
    container.open = referenceOpen.has('all');
    container.append(element('summary', '', 'Profile, documents & reusable answers'));
    container.addEventListener('toggle', () => { if (container.open) referenceOpen.add('all'); else referenceOpen.delete('all'); });
    container.append(element('div', 'reference-note', 'Click an item to copy, then paste into the form. Approved reusable answers are shared across all candidates.'));
    const status = element('div', 'copy-status');
    status.setAttribute('role', 'status');
    function card(key, title, entries) {
      const section = element('details', 'reference-card');
      section.dataset.reference = key;
      section.open = referenceOpen.has(key);
      section.append(element('summary', '', `${title} (${entries.length})`));
      section.addEventListener('toggle', () => { if (section.open) referenceOpen.add(key); else referenceOpen.delete(key); });
      for (const [label, value, note] of entries) {
        const item = element('button', 'reference-item');
        item.type = 'button'; item.title = 'Click to copy';
        item.append(element('span', 'reference-label', label), element('span', 'reference-value', value));
        item.addEventListener('click', async () => { status.textContent = await copyReference(value) ? `Copied: ${label}` : 'Could not copy. Try again.'; });
        section.append(item);
        if (note) section.append(element('div', 'reference-note', note));
      }
      if (!entries.length) section.append(element('div', 'reference-note', 'No saved information.'));
      container.append(section);
    }
    const p = data.profile || {};
    const fields = [['First name', 'firstName'], ['Last name', 'lastName'], ['Email', 'email'], ['Phone', 'phone'], ['Headline', 'headline'], ['Street', 'addressLine1'], ['Postal code', 'postalCode'], ['City', 'city'], ['State / province', 'province'], ['Country', 'country'], ['Birthday', 'birthday'], ['Nationality', 'nationality'], ['Languages', 'languages'], ['Years of experience', 'yearsOfExperience'], ['LinkedIn', 'linkedinUrl'], ['GitHub', 'githubUrl'], ['Portfolio', 'portfolioUrl']];
    card('profile', 'Profile', fields.filter(([, key]) => String(p[key] ?? '').trim()).map(([label, key]) => [label, String(p[key])]));
    const dates = (entry) => [entry.startDate, entry.isCurrent ? 'Present' : entry.endDate].filter(Boolean).join(' – ');
    card('experience', 'Experience', (data.experiences || []).map((entry) => [
      [entry.jobTitle, entry.companyName].filter(Boolean).join(' — '),
      [[entry.jobTitle, entry.companyName].filter(Boolean).join(' — '), [entry.location, entry.workMode, dates(entry)].filter(Boolean).join(' · '), entry.description].filter(Boolean).join('\n'),
    ]));
    card('education', 'Education', (data.educations || []).map((entry) => [entry.institution || 'Education',
      [entry.institution, [entry.degree, entry.fieldOfStudy].filter(Boolean).join(', '), dates(entry), entry.description].filter(Boolean).join('\n'),
    ]));
    card('reusable', 'Reusable answers', (data.reusable || []).map((entry) => [entry.question, entry.answer, entry.note]));
    card('documents', 'Documents & job description', [['Résumé', data.resumeText], ['Cover letter', data.coverLetterText], ['Job description', data.jobDescription]].filter(([, value]) => String(value || '').trim()));
    container.append(status);
    return container;
  }

  function render() {
    const scrollTop = panel.querySelector('.body')?.scrollTop || 0;
    panel.replaceChildren();
    if (!state) return;
    const auto = state.auto === true;
    panel.classList.toggle('auto', auto);
    panel.classList.toggle('collapsed', collapsed && !auto);
    panel.hidden = auto && collapsed;
    tab.hidden = !(auto && collapsed);
    host.toggleAttribute('data-qts-auto-apply-review', auto);
    if (auto && !collapsed) {
      global.__qtsPageLauncher?.setOpen?.(false);
      if (!dock.isConnected) (document.head || document.documentElement).append(dock);
      document.documentElement.setAttribute('data-qts-apply-docked', 'true');
    } else clearDock();

    const head = element('div', 'head');
    const headText = element('div', 'head-text');
    headText.append(
      element('div', 'head-title', state.mode === 'confirm' ? 'Submitted successfully?' : state.mode === 'working' ? `${state.auto ? 'Auto Apply' : 'Apply'} is working…` : state.final ? 'Review, then Submit' : `Review step ${state.step}`),
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
    if (auto) body.append(head);
    const job = element('div', 'job');
    job.append(element('div', 'job-title', `${state.job.title} — ${state.job.company}`));
    const facts = [state.job.location, state.job.workType, state.job.salary ? `Salary: ${state.job.salary}` : ''].filter(Boolean).join(' · ');
    if (facts) job.append(element('div', 'row muted', facts));
    job.append(element('div', 'row muted', state.job.url));
    if (state.resumeFolder) {
      const folder = element('button', 'folder', `📁 Downloads\\${state.resumeFolder.replace(/\//g, '\\').replace(/\\+$/, '')}`);
      folder.type = 'button';
      folder.title = 'Open the résumé folder in Windows Explorer';
      folder.addEventListener('click', () => send('open_folder'));
      job.append(folder);
    }
    if (state.promptName || state.templateName) {
      job.append(element('div', 'row muted', [state.promptName && `Prompt: ${state.promptName}`, state.templateName && `Template: ${state.templateName}`].filter(Boolean).join(' · ')));
    }
    body.append(job);

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
      if (submitHeld && waiting) box.append(element('div', 'held', 'Submit was held: accept or edit each provisional answer first.'));
      body.append(box);
    }

    const steps = [...new Set((state.answers || []).map((answer) => answer.step))].sort((a, b) => a - b);
    for (const step of steps) {
      const answers = state.answers.filter((answer) => answer.step === step);
      body.append(element('div', 'section', steps.length > 1 ? `Step ${step} · ${answers.length} answers` : `Filled answers (${answers.length})`));
      for (const answer of answers) body.append(answerRow(answer));
    }
    if (state.auto && state.references) body.append(referencePanel(state.references));
    panel.append(body);

    const foot = element('div', 'foot');
    const buttons = element('div', 'buttons');
    if (state.mode === 'working') {
      const working = element('div', 'working');
      working.append(element('span', 'spinner'), element('span', '', state.workingText || 'Filling the form…'));
      foot.append(working);
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
      foot.append(element('div', 'note', state.blocked
        ? 'This candidate is blocked: skip this job.'
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
      if (!state.blocked && state.final) {
        const submittedButton = button('I submitted it', '', 'submitted', () => ({ answers: currentAnswers() }));
        if (blocking) {
          submittedButton.disabled = true;
          submittedButton.title = listed ? 'Deal with every item the checklist marks first, then Check.' : 'Accept or edit each provisional answer first.';
        }
        buttons.append(submittedButton);
      }
      // Auto Apply: the page read again after the Manager's changes (nothing is filled).
      if (listed) buttons.append(button('Check', 'primary', 'recheck', () => ({ manualCheck: true, answers: currentAnswers() })));
      buttons.append(button('Skip', '', 'skip'));
      if (!state.blocked) {
        buttons.append(button('Later', '', 'later'));
        buttons.append(button('Fill again', '', 'fill_again'));
        if (state.canAskAgain && (!state.auto || state.aiOn)) buttons.append(button(`Ask ${state.aiName || 'ChatGPT'} again`, '', 'ask_again'));
        // Auto Apply: the answers the Manager changed go to Super Admin as drafts (never approved by this).
      }
      foot.append(buttons);
    }
    panel.append(foot);
    if (auto) body.scrollTop = scrollTop;
  }

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

  // What on the checklist stops "I submitted it" and holds the site's Submit: provisional answers
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
      : `✓ Nothing blocks Submit · ${totals.verified} verified · ${totals.optional_empty} optional left empty`));
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
    if (submitHeld && blocking) box.append(element('div', 'held', 'Submit was held: deal with what is marked (then Check), or use "Submit anyway".'));
    if (submitHeld && blocking) {
      // The Manager's own decision: the next click on the site's Submit goes through.
      const anyway = element('button', '', 'Submit anyway');
      anyway.type = 'button';
      anyway.addEventListener('click', () => { submitAnyway = true; submitHeld = false; render(); });
      box.append(anyway);
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

  // Auto Apply's last step: the site's Submit is held back while anything blocks (a provisional answer
  // waits, a required answer is missing or did not take); the first one is shown on the form, and
  // "Submit anyway" lets the Manager's next Submit through. True when held.
  let submitAnyway = false;
  function holdSubmit(event) {
    if (!state || !state.auto || state.mode !== 'review' || !state.final || submitAnyway) return false;
    if (!blockingNow()) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitHeld = true;
    render();
    const first = pendingProvisional()[0]?.id || state.checklist?.items.find((item) => BLOCKING.has(item.category) && item.fieldId)?.fieldId;
    if (first) global.__qtsApplyForm?.focusField?.(first);
    return true;
  }

  // On the last step, the Manager's own click on the site's Submit moves the panel to Yes/No. The
  // form's values are read at that moment, before the page changes.
  let submitNoticedAt = 0;
  function noticeSubmit() {
    if (!state || state.mode !== 'review' || !state.final || state.blocked) return;
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
  const onDocumentClick = (event) => {
    if (!contextAvailable()) { dispose(); return; }
    const submitLike = global.__qtsApplyForm?.isSubmitControl?.(event.target);
    // Before the last step a submit-type button is the site's Next.
    if (!submitLike || !state?.final) noticeStepButton(event.target);
    if (!submitLike) return;
    if (!holdSubmit(event)) noticeSubmit();
  };
  const onDocumentSubmit = (event) => {
    if (!contextAvailable()) { dispose(); return; }
    if (!holdSubmit(event)) noticeSubmit();
  };
  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('submit', onDocumentSubmit, true);
  // An edit on the form may settle a provisional answer: the panel shows it shortly after.
  const onEdit = () => {
    if (!contextAvailable()) { dispose(); return; }
    if (!state?.provisional?.length && !state?.checklist) return;
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
