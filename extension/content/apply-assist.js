// Apply's assistant panel on a job page (injected by the service worker into each job tab it opens).
// Docked on the right like Get JD's panel, it shows the account and the job, two copy buttons
// (résumé + job description, and with the profile), the candidate's profile, experience, education,
// and Super Admin's reusable answers as cards (every item copied with a click), what QTS filled, and
// the required questions still empty. At the bottom: Submitted (saves the bid, deletes the job row)
// and Cancel (closes the page; the job stays). The Manager's own click on the site's Submit asks
// "Submitted successfully?" Yes / No.
(function initApplyAssist(global) {
  if (global.__qtsApplyAssist) return;

  const PANEL_WIDTH = 'min(400px, 48vw)';
  const host = document.createElement('div');
  host.setAttribute('data-qts-apply-review', '');
  host.setAttribute('data-qts-apply-assist', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0 0 0 auto;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'closed' });

  // The page moves left while the panel is open, so the panel never covers the form.
  const dock = document.createElement('style');
  dock.setAttribute('data-qts-apply-dock', '');
  dock.textContent = `
    html[data-qts-apply-docked="true"] body { box-sizing: border-box !important; padding-right: ${PANEL_WIDTH} !important; }
    html body { transition: padding-right .28s cubic-bezier(.2,.8,.2,1); }
    html[data-qts-apply-docked="true"] [data-qts-page-launcher] { display: none !important; }
  `;
  (document.head || document.documentElement).appendChild(dock);

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { position: fixed; inset: 0 0 0 auto; display: flex; flex-direction: column; width: ${PANEL_WIDTH}; height: 100vh; height: 100dvh;
      border-left: 1px solid #243047; overflow: hidden; background: #0a0f1c; color: #e2e8f0; color-scheme: dark;
      box-shadow: -12px 0 32px rgb(0 0 0 / 35%); font: 13px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
    .panel[hidden], .tab[hidden] { display: none; }
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
    .scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px; scrollbar-color: #34425a transparent; scrollbar-width: thin; }
    .label-top { color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .account { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 3px; }
    h2 { margin: 0; color: #f1f5f9; font-size: 17px; font-weight: 750; letter-spacing: -.01em; overflow-wrap: anywhere; }
    .chrome { color: #94a3b8; font-size: 11px; white-space: nowrap; }
    .copies { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 14px 0; }
    button { font: 700 12px system-ui, sans-serif; cursor: pointer; transition: background .15s ease; }
    button:disabled { opacity: .6; cursor: wait; }
    .copy-all { min-height: 40px; padding: 0 10px; border: 1px solid rgb(99 102 241 / .5); border-radius: 10px; color: #e0e7ff; background: rgb(99 102 241 / .16); }
    .copy-all:hover:not(:disabled) { background: rgb(99 102 241 / .3); }
    .copy-all.alt { border-color: rgb(16 185 129 / .5); color: #a7f3d0; background: rgb(16 185 129 / .16); }
    .copy-all.alt:hover:not(:disabled) { background: rgb(16 185 129 / .3); }
    .job { padding: 12px; border: 1px solid #243047; border-radius: 12px; background: #111a2e; }
    .job-title { color: #f1f5f9; font-weight: 750; overflow-wrap: anywhere; }
    .company { color: #94a3b8; font-size: 12px; }
    .muted { margin-top: 4px; color: #cbd5e1; font-size: 12px; overflow-wrap: anywhere; }
    .link { display: inline-block; margin-top: 4px; color: #60a5fa; font-size: 12px; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .badge { display: inline-block; padding: 0 4px; border-radius: 3px; background: #10b981; color: #052e1f; font-weight: 600; }
    .folder { display: block; width: 100%; margin-top: 10px; padding: 7px 9px; border: 1px dashed #34425a; border-radius: 8px; background: #0e1626; color: #93c5fd; text-align: left; font-weight: 600; word-break: break-all; }
    .folder:hover { background: #1a2438; }
    .status { margin: 12px 0 0; padding: 8px 10px; border: 1px solid rgb(16 185 129 / .3); border-radius: 10px; background: rgb(16 185 129 / .1); color: #6ee7b7; font-size: 12px; }
    .status.working { display: flex; align-items: center; gap: 8px; border-color: rgb(99 102 241 / .3); background: rgb(99 102 241 / .1); color: #a5b4fc; }
    .spinner { flex: 0 0 12px; width: 12px; height: 12px; border: 2px solid rgb(99 102 241 / .3); border-top-color: #818cf8; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .alert { margin: 12px 0 0; padding: 8px 10px; border: 1px solid rgb(244 63 94 / .3); border-radius: 10px; background: rgb(244 63 94 / .1); color: #fda4af; font-size: 12px; }
    .alert strong { display: block; margin-bottom: 3px; color: #fecdd3; }
    .alert li { margin-left: 16px; cursor: pointer; }
    .alert li:hover { text-decoration: underline; }
    .alert.empty { border-color: rgb(245 158 11 / .3); background: rgb(245 158 11 / .1); color: #fcd34d; }
    .alert.empty strong { color: #fde68a; }
    .card { margin-top: 12px; border: 1px solid #243047; border-radius: 12px; background: #111a2e; overflow: hidden; }
    .card-head { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 12px; border: 0; background: #0e1626; color: #94a3b8; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; text-align: left; }
    .card-head:hover { color: #e2e8f0; }
    .card-head .count { min-width: 22px; padding: 1px 7px; border: 1px solid #34425a; border-radius: 999px; color: #cbd5e1; font-size: 10px; letter-spacing: 0; text-align: center; }
    .card-body { padding: 4px 6px 8px; border-top: 1px solid #243047; }
    .card.closed .card-body { display: none; }
    .group { margin: 10px 6px 2px; color: #66758c; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .item { display: grid; grid-template-columns: minmax(84px, 34%) 1fr; gap: 8px; width: 100%; padding: 6px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; font: 12px/1.45 Inter, ui-sans-serif, system-ui, sans-serif; cursor: copy; }
    .item:hover { background: #1a2438; }
    .item .label { color: #94a3b8; overflow-wrap: anywhere; }
    .item .value { color: #f1f5f9; font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 120px; overflow: hidden; }
    .item.copied { background: rgb(16 185 129 / .16); }
    .item.copied .label::after { content: '  ✓ copied'; color: #6ee7b7; font-weight: 700; }
    .entry { margin: 6px 0; padding: 4px 0; border-top: 1px solid #243047; }
    .entry:first-child { border-top: 0; }
    .none { padding: 8px; color: #66758c; font-size: 12px; }
    .foot { flex: 0 0 auto; padding: 12px 16px 14px; border-top: 1px solid #243047; background: #0d1526; }
    .note { margin-bottom: 8px; color: #cbd5e1; font-size: 12px; font-weight: 600; }
    .message { margin-bottom: 8px; color: #fb7185; font-size: 12px; }
    .actions { display: flex; gap: 8px; }
    .actions button { min-height: 42px; padding: 0 16px; border-radius: 10px; }
    .submitted { flex: 1; border: 0; color: #fff; background: #10b981; }
    .submitted:hover:not(:disabled) { background: #059669; }
    .cancel { border: 1px solid #34425a; color: #cbd5e1; background: #111a2e; }
    .cancel:hover:not(:disabled) { background: #1a2438; }
    .no { border: 1px solid rgb(244 63 94 / .5); color: #fda4af; background: rgb(244 63 94 / .1); }
    .tab { position: fixed; top: 40%; right: 0; padding: 12px 8px; border: 1px solid #243047; border-right: 0; border-radius: 10px 0 0 10px; background: #0d1526; color: #e2e8f0; box-shadow: -6px 0 18px rgb(0 0 0 / 35%); font-size: 11px; writing-mode: vertical-rl; }
    .toast { position: fixed; right: 16px; bottom: 88px; padding: 8px 12px; border: 1px solid #243047; border-radius: 10px; background: #111a2e; color: #e2e8f0; font-size: 12px; opacity: 0; transition: opacity .2s; pointer-events: none; }
    .toast.shown { opacity: 1; }
  `;
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'QTS Apply: candidate profile');
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.type = 'button';
  tab.hidden = true;
  tab.title = 'Show the QTS panel';
  const toast = document.createElement('div');
  toast.className = 'toast';
  root.append(style, panel, tab, toast);
  (document.documentElement || document.body).appendChild(host);

  let state = null;
  let busy = false;
  let hidden = false;
  let emptyRequired = [];
  let lastKeyAt = 0;
  // Which cards are open; the profile is open first.
  const openCards = new Set(['profile']);

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  function send(action, extra = {}) {
    if (!state) return Promise.resolve(null);
    return chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', assist: true, attemptId: state.attemptId, jobId: state.jobId, action, ...extra }).catch(() => null);
  }

  function setDocked(docked) {
    document.documentElement.setAttribute('data-qts-apply-docked', docked ? 'true' : 'false');
  }

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('shown');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('shown'), 1600);
  }

  // Copied with the page's own clipboard when allowed, else through a hidden text box.
  async function copyText(text) {
    const value = String(text ?? '');
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const box = document.createElement('textarea');
      box.value = value;
      box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      root.append(box);
      box.select();
      const done = document.execCommand('copy');
      box.remove();
      return done;
    }
  }

  // ---- What the copy buttons and items hold ----

  const words = (value) => String(value || '').replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
  const month = (value) => {
    const match = /^(\d{4})-(\d{2})/.exec(String(value || ''));
    if (!match) return '';
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1] || ''} ${match[1]}`.trim();
  };
  const period = (entry) => {
    const start = month(entry.startDate);
    const end = entry.isCurrent ? 'Present' : month(entry.endDate);
    return [start, end].filter(Boolean).join(' – ');
  };

  /** The profile's facts as [label, value] pairs, in the order forms ask for them; empty ones left out. */
  function profileFacts(profile) {
    const p = profile || {};
    const address = [p.addressLine1, p.postalCode, p.city, p.province, p.country].filter(Boolean).join(', ');
    return [
      ['Full name', [p.firstName, p.lastName].filter(Boolean).join(' ')],
      ['First name', p.firstName],
      ['Last name', p.lastName],
      ['Email', p.email],
      ['Phone', p.phone],
      ['Headline', p.headline],
      ['Address', address],
      ['Street', p.addressLine1],
      ['Postal code', p.postalCode],
      ['City', p.city],
      ['State / province', p.province],
      ['Country', p.country],
      ['Birthday', p.birthday],
      ['Nationality', p.nationality],
      ['Languages', p.languages],
      ['Years of experience', p.yearsOfExperience != null ? String(p.yearsOfExperience) : ''],
      ['LinkedIn', p.linkedinUrl],
      ['GitHub', p.githubUrl],
      ['Portfolio', p.portfolioUrl],
    ].filter(([, value]) => String(value ?? '').trim());
  }

  function disclosureFacts(profile) {
    const p = profile || {};
    return [
      ['Gender', p.gender], ['Race / ethnicity', p.ethnicity], ['Veteran status', p.veteranStatus],
      ['Disability', p.disabilityStatus], ['Sexual orientation', p.sexualOrientation], ['Pronouns', p.pronouns],
    ].filter(([, value]) => String(value ?? '').trim()).map(([label, value]) => [label, words(value)]);
  }

  function experienceLines(entry) {
    const where = [entry.location, entry.workMode && words(entry.workMode)].filter(Boolean).join(', ');
    return [
      `${entry.jobTitle}, ${entry.companyName}${where ? ` (${where})` : ''}${period(entry) ? ` · ${period(entry)}` : ''}`,
      entry.description ? entry.description.trim() : '',
    ].filter(Boolean).join('\n');
  }

  function educationLines(entry) {
    const degree = [entry.degree, entry.fieldOfStudy].filter(Boolean).join(', ');
    return [
      `${degree ? `${degree} — ` : ''}${entry.institution}${period(entry) ? ` · ${period(entry)}` : ''}`,
      entry.description ? entry.description.trim() : '',
    ].filter(Boolean).join('\n');
  }

  function profileText() {
    const lines = ['Candidate profile', ...profileFacts(state.profile).map(([label, value]) => `${label}: ${value}`)];
    const disclosures = disclosureFacts(state.profile);
    if (disclosures.length) lines.push('', 'Voluntary disclosures', ...disclosures.map(([label, value]) => `${label}: ${value}`));
    if (state.experiences?.length) lines.push('', 'Experience', ...state.experiences.map((entry) => `- ${experienceLines(entry).replace(/\n/g, '\n  ')}`));
    if (state.educations?.length) lines.push('', 'Education', ...state.educations.map((entry) => `- ${educationLines(entry).replace(/\n/g, '\n  ')}`));
    return lines.join('\n');
  }

  function resumeAndJobText() {
    const job = state.job || {};
    return [
      'Résumé:',
      state.resumeText?.trim() || '(No résumé text is saved for this job.)',
      '',
      `Job: ${job.title || ''} at ${job.company || ''}${job.location ? ` (${job.location})` : ''}`,
      job.url ? `Link: ${job.url}` : '',
      '',
      'Job description:',
      job.description?.trim() || '(No job description is saved for this job.)',
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
  }

  // ---- Building the panel ----

  function copyButton(label, className, text) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', async () => {
      showToast(await copyText(text()) ? 'Copied' : 'Could not copy');
    });
    return node;
  }

  function item(label, value) {
    const node = element('button', 'item');
    node.type = 'button';
    node.title = 'Click to copy';
    node.append(element('span', 'label', label), element('span', 'value', value));
    node.addEventListener('click', async () => {
      if (!(await copyText(value))) return showToast('Could not copy');
      node.classList.add('copied');
      setTimeout(() => node.classList.remove('copied'), 1200);
    });
    return node;
  }

  function card(key, title, count, fill) {
    const node = element('div', `card${openCards.has(key) ? '' : ' closed'}`);
    const head = element('button', 'card-head');
    head.type = 'button';
    head.append(element('span', '', `${openCards.has(key) ? '▾' : '▸'}  ${title}`), element('span', 'count', count));
    head.addEventListener('click', () => {
      if (openCards.has(key)) openCards.delete(key);
      else openCards.add(key);
      render();
    });
    const body = element('div', 'card-body');
    fill(body);
    node.append(head, body);
    return node;
  }

  function actionButton(label, className, action, extra) {
    const node = element('button', className, label);
    node.type = 'button';
    node.disabled = busy;
    node.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      render();
      const reply = await send(action, typeof extra === 'function' ? extra() : extra);
      if (reply && reply.ok === false) {
        busy = false;
        state = { ...state, message: reply.error || 'That did not work.' };
        render();
      }
    });
    return node;
  }

  function brandHeader() {
    const brand = element('header', 'brand');
    const logo = element('img', 'brand-logo');
    logo.alt = 'WYS';
    try {
      logo.src = chrome.runtime.getURL('assets/account-logo.png');
    } catch {
      // The extension was reloaded: the panel goes with the next page load.
    }
    const center = element('div', 'brand-center');
    const pills = element('div', 'pills');
    pills.append(element('span', 'pill q', 'Quality'), element('span', 'plus', '+'), element('span', 'pill t', 'Time'),
      element('span', 'plus', '+'), element('span', 'pill s', 'Speed'));
    center.append(pills, element('span', 'subline', 'Built for precision bidding'));
    const hide = element('button', 'hide', '›');
    hide.type = 'button';
    hide.title = 'Hide the panel';
    hide.addEventListener('click', () => {
      hidden = true;
      render();
    });
    brand.append(logo, center, hide);
    return brand;
  }

  function render() {
    panel.replaceChildren();
    if (!state) return;
    panel.hidden = hidden;
    tab.hidden = !hidden;
    tab.textContent = `QTS · ${state.candidate}`;
    setDocked(!hidden);
    if (hidden) return;

    const scroll = element('div', 'scroll');
    const account = element('div', 'account');
    account.append(element('h2', '', state.candidate), element('span', 'chrome', state.chromeName || ''));
    scroll.append(element('div', 'label-top', 'Account'), account);

    const copies = element('div', 'copies');
    copies.append(
      copyButton('Copy résumé + JD', 'copy-all', resumeAndJobText),
      copyButton('Copy résumé + JD + profile', 'copy-all alt', () => `${resumeAndJobText()}\n\n${profileText()}`),
    );
    scroll.append(copies);

    const job = element('div', 'job');
    job.append(element('div', 'label-top', 'Job'), element('div', 'job-title', state.job.title), element('div', 'company', state.job.company));
    // As on the Bids page: the location, then the work type with its arrangement marked ("Full-time · Remote").
    const facts = element('div', 'muted');
    const [kind, ...arrangement] = String(state.job.workType || '').split(' · ');
    const parts = [state.job.location, kind].filter(Boolean);
    facts.append(parts.join(' · '));
    if (arrangement.length) {
      if (parts.length) facts.append(' · ');
      facts.append(element('span', 'badge', arrangement.join(' · ')));
    }
    if (state.job.salary) facts.append(` · Salary: ${state.job.salary}`);
    if (facts.textContent) job.append(facts);
    if (state.job.url) {
      const link = element('a', 'link', new URL(state.job.url, location.href).hostname.replace(/^www\./, ''));
      link.href = state.job.url;
      link.target = '_blank';
      link.rel = 'noopener';
      job.append(link);
    }
    if (state.resumeFolder) {
      const folder = element('button', 'folder', `📁 Downloads\\${state.resumeFolder.replace(/\//g, '\\').replace(/\\+$/, '')}`);
      folder.type = 'button';
      folder.title = 'Open the résumé folder in Windows Explorer';
      folder.addEventListener('click', () => send('open_folder'));
      job.append(folder);
    }
    scroll.append(job);

    if (state.filling) {
      const working = element('div', 'status working');
      working.append(element('span', 'spinner'), element('span', '', 'QTS is filling what it knows…'));
      scroll.append(working);
    } else if (state.filled) {
      scroll.append(element('div', 'status', `✓ QTS filled ${state.filled} answer${state.filled === 1 ? '' : 's'} (résumé, profile, reusable answers). Check them, fill the rest, then Submit.`));
    }
    if (state.problems?.length) {
      const box = element('div', 'alert');
      box.append(element('strong', '', 'Needs you'));
      const list = element('ul', '');
      for (const problem of state.problems) {
        const entry = element('li', '', problem.message);
        if (problem.fieldId) entry.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(problem.fieldId));
        list.append(entry);
      }
      box.append(list);
      scroll.append(box);
    }
    if (state.mode === 'assist' && emptyRequired.length) {
      const box = element('div', 'alert empty');
      box.append(element('strong', '', `Still empty (${emptyRequired.length} required)`));
      const list = element('ul', '');
      for (const entry of emptyRequired.slice(0, 12)) {
        const line = element('li', '', entry.label || 'A question without a name');
        line.title = 'Show it on the form';
        line.addEventListener('click', () => global.__qtsApplyForm?.focusField?.(entry.id));
        list.append(line);
      }
      box.append(list);
      scroll.append(box);
    }

    const facts1 = profileFacts(state.profile);
    const disclosures = disclosureFacts(state.profile);
    scroll.append(card('profile', 'Profile', facts1.length, (body) => {
      for (const [label, value] of facts1) body.append(item(label, value));
      if (disclosures.length) {
        body.append(element('div', 'group', 'Voluntary disclosures'));
        for (const [label, value] of disclosures) body.append(item(label, value));
      }
      if (!facts1.length) body.append(element('div', 'none', 'The profile has no facts yet.'));
    }));
    scroll.append(card('experience', 'Experience', state.experiences?.length || 0, (body) => {
      for (const entry of state.experiences || []) {
        const box = element('div', 'entry');
        box.append(
          item('Job title', entry.jobTitle),
          item('Company', entry.companyName),
          ...(entry.location ? [item('Location', entry.location)] : []),
          ...(entry.workMode ? [item('Work mode', words(entry.workMode))] : []),
          ...(month(entry.startDate) ? [item('From', month(entry.startDate))] : []),
          item('To', entry.isCurrent ? 'Present' : month(entry.endDate) || '—'),
          ...(entry.description ? [item('Description', entry.description)] : []),
        );
        body.append(box);
      }
      if (!state.experiences?.length) body.append(element('div', 'none', 'No experience in the profile.'));
    }));
    scroll.append(card('education', 'Education', state.educations?.length || 0, (body) => {
      for (const entry of state.educations || []) {
        const box = element('div', 'entry');
        box.append(
          item('School', entry.institution),
          ...(entry.degree ? [item('Degree', entry.degree)] : []),
          ...(entry.fieldOfStudy ? [item('Field of study', entry.fieldOfStudy)] : []),
          ...(month(entry.startDate) ? [item('From', month(entry.startDate))] : []),
          item('To', entry.isCurrent ? 'Present' : month(entry.endDate) || '—'),
          ...(entry.description ? [item('Description', entry.description)] : []),
        );
        body.append(box);
      }
      if (!state.educations?.length) body.append(element('div', 'none', 'No education in the profile.'));
    }));
    scroll.append(card('reusable', 'Reusable answers', state.reusable?.length || 0, (body) => {
      for (const entry of state.reusable || []) body.append(item(entry.question, entry.answer));
      if (!state.reusable?.length) body.append(element('div', 'none', 'Super Admin has no reusable answers yet.'));
    }));

    const foot = element('div', 'foot');
    if (state.message) foot.append(element('div', 'message', state.message));
    const actions = element('div', 'actions');
    if (state.mode === 'confirm') {
      foot.append(element('div', 'note', 'Submitted successfully? Check the page (or the email), then answer.'));
      actions.append(
        actionButton('Yes, submitted', 'submitted', 'yes'),
        actionButton('No', 'no', 'no'),
      );
    } else {
      foot.append(element('div', 'note', 'Fill the rest, click the site\'s Submit, then Submitted here.'));
      actions.append(
        actionButton('Submitted', 'submitted', 'submitted', () => ({ answers: currentAnswers() })),
        actionButton('Cancel', 'cancel', 'cancel'),
      );
    }
    foot.append(actions);
    panel.append(brandHeader(), scroll, foot);
  }

  tab.addEventListener('click', () => {
    hidden = false;
    render();
  });

  function currentAnswers() {
    try {
      return global.__qtsApplyForm?.currentAnswers?.() || [];
    } catch {
      return [];
    }
  }

  // The required questions still empty, as the Manager fills them (only redrawn when they change).
  setInterval(() => {
    if (!state || state.mode !== 'assist') return;
    let now = [];
    try {
      now = (global.__qtsApplyForm?.emptyRequired?.() || []).map((entry) => ({ id: entry.id, label: entry.label }));
    } catch {
      now = [];
    }
    if (JSON.stringify(now) === JSON.stringify(emptyRequired)) return;
    emptyRequired = now;
    render();
  }, 2000);

  // The Manager's own click on the site's Submit, on a page that shows the application's questions
  // (an "Apply" button on the job page only opens the form): Yes / No. The form's values are read now.
  let submitNoticedAt = 0;
  function noticeSubmit(target) {
    if (!state || state.mode !== 'assist' || busy) return;
    if (target && !global.__qtsApplyForm?.isSubmitControl?.(target)) return;
    let questions = 0;
    try {
      questions = (global.__qtsApplyForm?.scanForm?.() || []).filter((field) => !field.hidden).length;
    } catch {
      questions = 0;
    }
    if (questions < 2 || Date.now() - submitNoticedAt < 3000) return;
    submitNoticedAt = Date.now();
    send('submitted', { answers: currentAnswers(), noticed: true });
  }
  document.addEventListener('click', (event) => {
    if (event.composedPath().includes(host)) return;
    noticeSubmit(event.target);
  }, true);
  document.addEventListener('submit', () => noticeSubmit(null), true);
  // QTS waits while the Manager types on this page.
  document.addEventListener('keydown', (event) => {
    if (!event.composedPath().includes(host)) lastKeyAt = Date.now();
  }, true);

  // The worker sleeps when idle; the panel keeps it awake while the page is open.
  setInterval(() => { if (state) send('ping'); }, 20000);

  global.__qtsApplyAssist = {
    render(nextState) {
      state = nextState;
      busy = false;
      if (nextState?.mode !== 'assist') emptyRequired = [];
      render();
      return true;
    },
    lastKeyAt: () => lastKeyAt,
    remove() {
      state = null;
      setDocked(false);
      host.remove();
      dock.remove();
      delete global.__qtsApplyAssist;
    },
  };
})(globalThis);
