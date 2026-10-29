// Apply's assistant panel on a job page (injected by the service worker into each job tab it opens).
// Docked on the right like Get JD's panel, it shows the account and the job, two copy buttons
// (résumé + job description, and with the profile), the candidate's profile, experience, education,
// and Super Admin's reusable answers as cards (every item copied with a click), what QTS filled, and
// the required questions still empty. At the bottom: Submitted (saves the bid, deletes the job row)
// and Cancel (closes the page; the job stays). The site's own buttons are never watched. When new
// boxes show on the page, the panel tells QTS so it fills them at once.
(function initApplyAssist(global) {
  if (global.__qtsApplyAssist) return;
  // A panel left by an earlier run of the extension (reloaded or updated) can no longer reach QTS:
  // this one takes its place.
  for (const stale of document.querySelectorAll('[data-qts-apply-assist], [data-qts-apply-dock]')) stale.remove();

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
    /* While an application is open its own tab stands for QTS: the launcher's would be a second one. */
    html:has(> [data-qts-apply-assist]) [data-qts-page-launcher] { display: none !important; }
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
    .status.idle { border-color: #243047; background: #0d1526; color: #94a3b8; }
    .refill { margin-top: 6px; padding: 5px 10px; border: 1px solid rgb(99 102 241 / .5); border-radius: 8px; color: #c7d2fe; background: transparent; font: 600 12px/1.4 inherit; cursor: pointer; }
    .refill:hover { background: rgb(99 102 241 / .18); }
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
    .remove { border: 1px solid rgb(244 63 94 / .5); color: #fda4af; background: rgb(244 63 94 / .1); font-size: 16px; }
    .actions .remove { padding: 0 12px; }
    .remove:hover:not(:disabled) { background: rgb(244 63 94 / .2); }
    .no { border: 1px solid rgb(244 63 94 / .5); color: #fda4af; background: rgb(244 63 94 / .1); }
    /* The same tab as the QTS launcher's (Q · T · S), with the candidate's initials. */
    .tab { position: fixed; top: 50%; right: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; width: 34px; padding: 10px 0 8px; border: 1px solid rgb(148 163 184 / .18); border-right: 0; border-radius: 14px 0 0 14px; background: linear-gradient(180deg, #131c31, #0a0f1c); box-shadow: -8px 0 24px rgb(2 6 23 / .45), inset 1px 0 0 rgb(255 255 255 / .05); font: 800 12px/1 Inter, ui-sans-serif, system-ui, sans-serif; cursor: pointer; transform: translateY(-50%); transition: transform .2s cubic-bezier(.2,.8,.2,1); }
    .tab::before { content: ""; position: absolute; top: 12px; bottom: 12px; left: -1px; width: 2px; border-radius: 2px; background: linear-gradient(180deg, #fcd34d, #e2e8f0 50%, #60a5fa); }
    .tab:hover { transform: translate(-4px, -50%); }
    .letter { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 7px; }
    .letter.q { background: rgb(252 211 77 / .12); color: #fcd34d; }
    .letter.t { background: rgb(226 232 240 / .08); color: #e2e8f0; }
    .letter.s { background: rgb(96 165 250 / .14); color: #60a5fa; }
    .initials { margin-top: 4px; padding-top: 6px; border-top: 1px solid #243047; color: #6ee7b7; font-size: 10px; letter-spacing: .02em; }
    .chev { color: #66758c; font-size: 13px; }
    .tab:hover .chev { color: #e2e8f0; }
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
  // Where the panel was scrolled, kept on every redraw; a card just opened is brought to the top.
  let scrollTop = 0;
  let bringToTop = null;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  // The extension was reloaded or updated: this panel can no longer reach it.
  const RESTARTED = 'QTS was restarted or updated. Turn Apply on again (if it is off): this page\'s panel comes back, then click Submitted.';

  function send(action, extra = {}) {
    if (!state) return Promise.resolve(null);
    let sending;
    try {
      if (!chrome.runtime?.id) return Promise.resolve({ ok: false, error: RESTARTED });
      sending = chrome.runtime.sendMessage({ type: 'QTS_APPLY_PANEL', assist: true, attemptId: state.attemptId, jobId: state.jobId, action, ...extra });
    } catch {
      return Promise.resolve({ ok: false, error: RESTARTED });
    }
    return sending.catch((error) => (/context invalidated|receiving end does not exist/i.test(String(error?.message))
      ? { ok: false, error: RESTARTED }
      : null));
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

  // shown: what the item displays when it is not the value itself (a password shows as dots).
  function item(label, value, shown = value) {
    const node = element('button', 'item');
    node.type = 'button';
    node.title = 'Click to copy';
    node.append(element('span', 'label', label), element('span', 'value', shown));
    node.addEventListener('click', async () => {
      if (!(await copyText(value))) return showToast('Could not copy');
      node.classList.add('copied');
      setTimeout(() => node.classList.remove('copied'), 1200);
    });
    return node;
  }

  function card(key, title, count, fill) {
    const node = element('div', `card${openCards.has(key) ? '' : ' closed'}`);
    node.dataset.card = key;
    const head = element('button', 'card-head');
    head.type = 'button';
    head.append(element('span', '', `${openCards.has(key) ? '▾' : '▸'}  ${title}`), element('span', 'count', count));
    head.addEventListener('click', () => {
      if (openCards.has(key)) {
        openCards.delete(key);
      } else {
        openCards.add(key);
        bringToTop = key;
      }
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

  // Deletes the job row from the Jobs table (asked first) and closes the job's tabs.
  function removeButton() {
    const node = actionButton('🗑', 'remove', 'remove');
    node.title = 'Remove this job from the Jobs table';
    node.setAttribute('aria-label', 'Remove this job from the Jobs table');
    node.addEventListener('click', (event) => {
      if (busy) return;
      if (!confirm(`Remove "${state.job.title}" at ${state.job.company} from the Jobs table?`)) event.stopImmediatePropagation();
    }, { capture: true });
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
    const previous = panel.querySelector('.scroll');
    if (previous) scrollTop = previous.scrollTop;
    panel.replaceChildren();
    if (!state) return;
    panel.hidden = hidden;
    tab.hidden = !hidden;
    const initials = String(state.candidate || '').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('');
    tab.replaceChildren(
      ...['q', 't', 's'].map((letter) => element('span', `letter ${letter}`, letter.toUpperCase())),
      ...(initials ? [element('span', 'initials', initials)] : []),
      element('span', 'chev', '‹'),
    );
    tab.title = `Show the QTS panel · ${state.candidate}`;
    tab.setAttribute('aria-label', `Show the QTS panel for ${state.candidate}`);
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
    } else {
      scroll.append(state.filled
        ? element('div', 'status', `✓ QTS filled ${state.filled} answer${state.filled === 1 ? '' : 's'} (résumé, profile, reusable answers). Check them, fill the rest, then Submit.`)
        : element('div', 'status idle', 'Nothing filled on this page yet.'));
      // Looks at this page again as if the job were new: boxes met before are filled again when
      // empty (text already written stays), and an embedded job-board form is opened again.
      const refill = element('button', 'refill', '↻ Fill again');
      refill.type = 'button';
      refill.title = 'Look at this page again and fill what QTS knows, as if the job were new';
      refill.addEventListener('click', () => send('refill'));
      scroll.append(refill);
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
      // The Manager's one password for the candidates' site accounts, for sign-in and create-account
      // forms (the Manager types those): never shown, copied with a click.
      if (state.siteAccountPassword) body.append(item('Site account password', state.siteAccountPassword, '••••••••'));
      else body.append(element('div', 'none', 'No site account password saved (QTS → My profile).'));
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
    foot.append(element('div', 'note', 'Fill the rest, click the site\'s Submit, then Submitted here.'));
    actions.append(
      actionButton('Submitted', 'submitted', 'submitted', () => ({ answers: currentAnswers() })),
      actionButton('Cancel', 'cancel', 'cancel'),
      removeButton(),
    );
    foot.append(actions);
    panel.append(brandHeader(), scroll, foot);
    scroll.scrollTop = scrollTop;
    const opened = bringToTop && scroll.querySelector(`[data-card="${bringToTop}"]`);
    bringToTop = null;
    if (opened) scroll.scrollTop += opened.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8;
    scrollTop = scroll.scrollTop;
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

  // The site's own buttons are never watched: the application ends only with Submitted or Cancel here.

  // New boxes on the page (the next step, a pop-up form, a section shown by an answer, a new
  // address in a single-page site): QTS is told half a second after the page settles, and only when
  // the boxes shown changed, so it fills them at once without reading the page for nothing.
  // A large frame counts too: a job board's form embedded after the page loaded (Ashby, Greenhouse).
  const BOX_SELECTOR = 'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="radiogroup"], [role="checkbox"], [contenteditable="true"], iframe';
  let boxesSeen = '';
  let changeTimer = null;
  // Each box by its own number (QTS's marks on the boxes change when it reads them; this does not).
  const boxNumbers = new WeakMap();
  let nextBoxNumber = 1;
  const boxNumber = (box) => {
    if (!boxNumbers.has(box)) boxNumbers.set(box, nextBoxNumber++);
    return boxNumbers.get(box);
  };
  const shownBoxes = () => [...document.querySelectorAll(BOX_SELECTOR)]
    .filter((box) => !host.contains(box) && box.getClientRects().length)
    .filter((box) => box.tagName !== 'IFRAME' || (box.offsetWidth >= 300 && box.offsetHeight >= 200))
    .map(boxNumber)
    .join(',');
  function pageChanged() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      if (!state || state.mode !== 'assist') return;
      const now = `${location.href}|${shownBoxes()}`;
      if (now === boxesSeen) return;
      boxesSeen = now;
      send('fields_changed');
    }, 500);
  }
  new MutationObserver((records) => {
    if (records.every((record) => record.target === host || host.contains(record.target))) return;
    pageChanged();
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'open', 'disabled'],
  });
  global.addEventListener('popstate', pageChanged);
  global.addEventListener('hashchange', pageChanged);
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
