// Apply's review panel on the application page (injected by the service worker into the form's tab).
// It shows the job, the résumé folder, and every answer with where it came from (ChatGPT answers
// flagged), marks what needs the Manager, and carries the Manager's choices back to the worker:
// Continue / Skip / Later / Fill again / Ask ChatGPT (or Gemini) again / I submitted it, then Yes / No / Not
// submitted. On the last step it notices the Manager's own click on the site's Submit.
(function initApplyReview(global) {
  if (global.__qtsApplyReview) return;

  const host = document.createElement('div');
  host.setAttribute('data-qts-apply-review', '');
  host.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { width: 380px; max-height: calc(100vh - 24px); display: flex; flex-direction: column; border-radius: 14px; background: #fff; color: #0f172a; box-shadow: 0 18px 50px #0f172a40, 0 0 0 1px #e2e8f0; font: 12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
    .panel.collapsed .body, .panel.collapsed .foot { display: none; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; }
    .head-text { flex: 1; min-width: 0; }
    .head-title { font-weight: 700; font-size: 13px; }
    .head-sub { opacity: .85; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .icon-button { border: 0; background: #ffffff26; color: #fff; width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 14px; }
    .body { overflow-y: auto; padding: 10px 12px; }
    .job { margin-bottom: 8px; }
    .job-title { font-weight: 700; font-size: 13px; }
    .muted { color: #64748b; }
    .row { margin-top: 2px; }
    .folder { display: block; margin-top: 6px; padding: 6px 8px; border: 1px dashed #c7d2fe; border-radius: 8px; background: #eef2ff; color: #3730a3; cursor: pointer; text-align: left; width: 100%; font: inherit; word-break: break-all; }
    .problems { margin: 8px 0; padding: 8px; border-radius: 8px; background: #fff1f2; border: 1px solid #fecdd3; color: #9f1239; }
    .problems strong { display: block; margin-bottom: 4px; }
    .problems li { margin-left: 16px; cursor: pointer; }
    .ok { margin: 8px 0; padding: 6px 8px; border-radius: 8px; background: #ecfdf5; color: #065f46; }
    .section { margin-top: 10px; font-weight: 700; color: #334155; }
    .answer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; padding: 5px 0; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
    .answer:hover { background: #f8fafc; }
    .q { color: #475569; }
    .a { color: #0f172a; white-space: pre-wrap; word-break: break-word; max-height: 72px; overflow: hidden; }
    .src { height: fit-content; padding: 1px 6px; border-radius: 6px; font-size: 10px; font-weight: 600; background: #f1f5f9; color: #475569; white-space: nowrap; }
    .src.ai { background: #f5f3ff; color: #6d28d9; }
    .src.manager { background: #fffbeb; color: #92400e; }
    .foot { padding: 10px 12px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
    .note { margin-bottom: 8px; color: #334155; font-weight: 600; }
    .buttons { display: flex; flex-wrap: wrap; gap: 6px; }
    .buttons button { min-height: 32px; padding: 0 12px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; font: 600 12px Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
    .buttons button.primary { border-color: #4f46e5; background: #4f46e5; color: #fff; }
    .buttons button.yes { border-color: #059669; background: #059669; color: #fff; }
    .buttons button.no { border-color: #fecdd3; color: #be123c; }
    .buttons button:disabled { opacity: .55; cursor: wait; }
    .working { display: flex; align-items: center; gap: 8px; color: #4338ca; font-weight: 600; }
    .spinner { width: 14px; height: 14px; border: 2px solid #c7d2fe; border-top-color: #4f46e5; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;
  const panel = document.createElement('div');
  panel.className = 'panel';
  root.append(style, panel);
  (document.documentElement || document.body).appendChild(host);

  let state = null;
  let busy = false;
  let collapsed = false;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function send(action, extra = {}) {
    if (!state) return Promise.resolve(null);
    return chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', attemptId: state.attemptId, action, ...extra }).catch(() => null);
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
    const sourceLabel = { ai: `${state?.aiName || 'ChatGPT'} ⚑`, saved: 'Saved', reusable: 'Reusable', profile: 'Profile', documents: 'Documents', consent: 'Consent', rule: 'Rule', manager: 'Manager' }[answer.source] || answer.source;
    row.append(
      element('span', 'q', answer.question),
      element('span', 'a', answer.answer || '—'),
      element('span', `src ${answer.source === 'ai' ? 'ai' : answer.source === 'manager' ? 'manager' : ''}`, sourceLabel),
    );
    if (answer.fieldId) row.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(answer.fieldId));
    return row;
  }

  function render() {
    panel.replaceChildren();
    if (!state) return;
    panel.classList.toggle('collapsed', collapsed);

    const head = element('div', 'head');
    const headText = element('div', 'head-text');
    headText.append(
      element('div', 'head-title', state.mode === 'confirm' ? 'Submitted successfully?' : state.mode === 'working' ? 'Apply is working…' : state.final ? 'Review, then Submit' : `Review step ${state.step}`),
      element('div', 'head-sub', `${state.chromeName} · ${state.candidate}`),
    );
    const toggle = element('button', 'icon-button', collapsed ? '▾' : '▴');
    toggle.type = 'button';
    toggle.title = collapsed ? 'Show the panel' : 'Make the panel small';
    toggle.addEventListener('click', () => { collapsed = !collapsed; render(); });
    head.append(headText, toggle);
    panel.append(head);

    const body = element('div', 'body');
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

    if (state.problems?.length) {
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
      body.append(element('div', 'ok', `✓ Nothing marked for you. Check the ${state.aiName || 'ChatGPT'} ⚑ answers first.`));
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
      foot.append(element('div', 'note', state.blocked
        ? 'This candidate is blocked: skip this job.'
        : state.final
          ? state.reviewAll
            ? 'Every step is filled. Check all the answers below, fix what is marked (use the site\'s Back for an earlier step), then click the site\'s Submit.'
            : 'Check everything, fix what is marked, then click the site\'s Submit.'
          : 'Check this step, fix what is marked, then Continue.'));
      if (!state.blocked && !state.final) buttons.append(button('Continue →', 'primary', 'continue'));
      if (!state.blocked && state.final) {
        buttons.append(button('I submitted it', '', 'submitted', () => ({ answers: currentAnswers() })));
      }
      buttons.append(button('Skip', '', 'skip'));
      if (!state.blocked) {
        buttons.append(button('Later', '', 'later'));
        buttons.append(button('Fill again', '', 'fill_again'));
        if (state.canAskAgain) buttons.append(button(`Ask ${state.aiName || 'ChatGPT'} again`, '', 'ask_again'));
      }
      foot.append(buttons);
    }
    panel.append(foot);
  }

  function currentAnswers() {
    try {
      return global.__qtsApplyForm?.currentAnswers?.() || [];
    } catch {
      return [];
    }
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
  document.addEventListener('click', (event) => {
    if (global.__qtsApplyForm?.isSubmitControl?.(event.target)) noticeSubmit();
  }, true);
  document.addEventListener('submit', () => noticeSubmit(), true);

  // The worker sleeps when idle; the panel keeps it awake while the Manager reviews.
  setInterval(() => { if (state) send('ping'); }, 20000);

  global.__qtsApplyReview = {
    render(nextState) {
      state = nextState;
      busy = false;
      render();
      if (nextState?.problemFieldIds) global.__qtsApplyForm?.markProblemFields?.(nextState.problemFieldIds);
      return true;
    },
    remove() {
      state = null;
      global.__qtsApplyForm?.markProblemFields?.([]);
      host.remove();
      delete global.__qtsApplyReview;
    },
  };
})(globalThis);
