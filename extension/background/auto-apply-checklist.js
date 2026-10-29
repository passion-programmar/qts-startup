// Auto Apply's checklist: every question met on every step of an application, with where it stands,
// kept from step to step and checked again against the page itself (never only against what the
// filling reported). Built from what the step's filling already knows (its report, problems,
// provisional and unresolved answers) and the page's own read-only look (__qtsApplyForm.auditForm).
// Categories:
//   verified        the page shows the answer QTS filled (or one the Manager or the site put there)
//   optional_empty  optional, left empty
//   needs_input     needs the Manager: a fact the profile lacks, or a question nothing could answer
//   provisional     an AI answer the documents do not show, to accept or edit
//   failed          the site did not take an answer, or cleared it
//   blocked         a sign-in wall or human check stands in the way
//   unknown         QTS could not read it, or it no longer finds it: not verified
const CHECKLIST_LABELS = {
  verified: 'Verified',
  optional_empty: 'Optional, left empty',
  needs_input: 'Needs your answer',
  provisional: 'Provisional AI answer: accept or edit',
  failed: 'Did not take: check it',
  blocked: 'Blocked: sign-in or human check',
  unknown: 'Not verified: check it',
};
// What stops "I submitted it" (and holds the site's Submit) until it is dealt with.
const CHECKLIST_BLOCKING = new Set(['needs_input', 'provisional', 'failed', 'blocked']);

const plainValue = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const sameValue = (intended, shown) => {
  const a = plainValue(intended).replace(/[^\p{L}\p{N}]/gu, '');
  const b = plainValue(shown).replace(/[^\p{L}\p{N}]/gu, '');
  return Boolean(a && b) && (a === b || b.includes(a) || a.includes(b));
};

function createChecklist(saved = []) {
  // Keyed by step and question (a redrawn box gets a new id; its question stays).
  const entries = new Map(saved.map((entry) => [`${entry.step}|${entry.label}`, entry]));
  const keyOf = (step, label) => `${step}|${String(label || '').trim()}`;
  const put = (step, label, values) => {
    const key = keyOf(step, label);
    const entry = { ...(entries.get(key) || { step, label: String(label || '').trim() || 'A question QTS could not name' }), ...values };
    entries.set(key, entry);
    return entry;
  };

  /**
   * A step's filling, as the filling saw it. filled: fillFormPage's result; used: the answers by
   * question (with fieldId, value, source); provisional: the application's provisional answers.
   */
  function addStep(step, filled, used, provisional) {
    const byId = new Map(Object.values(used || {}).filter((answer) => answer.fieldId && answer.step === step).map((answer) => [answer.fieldId, answer]));
    const flagged = new Map((filled.problems || []).filter((entry) => entry.fieldId).map((entry) => [entry.fieldId, entry]));
    const pending = new Map([...provisional.values()].filter((entry) => entry.step === step).map((entry) => [entry.id, entry]));
    for (const field of filled.report?.plan || []) {
      const answer = byId.get(field.fieldId);
      const problem = flagged.get(field.fieldId);
      const base = { fieldId: field.fieldId, kind: field.type, required: Boolean(field.required), intended: answer ? String(answer.file ? answer.file : answer.value ?? '') : '', source: answer?.source || null };
      if (pending.has(field.fieldId) && !pending.get(field.fieldId).accepted) {
        put(step, field.question, { ...base, category: 'provisional', issue: pending.get(field.fieldId).reason });
      } else if (field.status === 'verified') {
        put(step, field.question, { ...base, category: 'verified', issue: '' });
      } else if (problem) {
        const message = String(problem.message || '');
        put(step, field.question, { ...base, category: /did not take|did not accept|rejected|refused|not one of|could not be|was cleared|invalid/i.test(message) ? 'failed' : 'needs_input', issue: message });
      } else if (field.status === 'unresolved') {
        put(step, field.question, { ...base, category: 'unknown', issue: 'QTS could not tell what this box asks.' });
      } else {
        put(step, field.question, { ...base, category: field.required ? 'needs_input' : 'optional_empty', issue: field.required ? 'Required and still empty.' : '' });
      }
    }
    // What the page shows as a whole (no single question): an unreadable part, an error, a closed form.
    for (const entry of (filled.problems || []).filter((item) => !item.fieldId)) {
      put(step, entry.message, { fieldId: null, kind: 'page', required: true, category: /cannot read|couldn't read/i.test(entry.message) ? 'unknown' : 'failed', issue: entry.message });
    }
  }

  /** The Manager accepted a provisional answer as it is. */
  function accept(step, label) {
    const entry = entries.get(keyOf(step, label));
    if (entry?.category === 'provisional') Object.assign(entry, { category: 'verified', issue: 'Accepted by you.' });
  }

  /**
   * The current step checked again on the page itself (look: auditForm()). An answer the page no
   * longer shows is failed; one the Manager has given meanwhile is verified; a question that appeared
   * since is added; one QTS no longer finds is not verified. Earlier steps keep their last state.
   */
  function recheck(step, look, provisional) {
    if (!look) {
      for (const entry of entries.values()) if (entry.step === step && entry.category === 'verified') Object.assign(entry, { category: 'unknown', issue: 'QTS could not read the page again to check it.' });
      return;
    }
    const shown = new Map(look.fields.map((field) => [field.id, field]));
    // By question too (a redrawn box gets a new id), on the words the step report keeps (80 characters).
    const short = (label) => String(label || '').trim().slice(0, 80);
    const byLabel = new Map(look.fields.map((field) => [short(field.label), field]));
    const pending = new Map([...provisional.values()].filter((entry) => entry.step === step).map((entry) => [entry.label, entry]));
    const seen = new Set();
    for (const entry of [...entries.values()].filter((item) => item.step === step && item.kind !== 'page' && item.category !== 'blocked')) {
      const field = (entry.fieldId && shown.get(entry.fieldId)) || byLabel.get(short(entry.label));
      // An upload whose box the site removed after taking the file: attached when the page shows
      // a file of that kind (a CV or résumé, a cover letter).
      if (!field && entry.kind === 'file' && entry.category === 'verified') {
        const wanted = /cover|letter|motivation/i.test(`${entry.label} ${entry.intended}`) ? /cover|letter|motivation/i : /cv|resume|résumé|lebenslauf/i;
        const named = (look.fileNames || []).find((name) => wanted.test(name));
        Object.assign(entry, named ? { category: 'verified', issue: `The site shows "${named}" attached.` } : { category: 'unknown', issue: 'QTS no longer finds this upload on the page: check that the file is attached.' });
        continue;
      }
      if (!field) {
        if (entry.category !== 'optional_empty') Object.assign(entry, { category: 'unknown', issue: 'QTS no longer finds this question on the page.' });
        continue;
      }
      seen.add(field.id);
      Object.assign(entry, { fieldId: field.id, shown: field.value, required: entry.required || field.required });
      const waiting = pending.get(entry.label);
      if (waiting && !waiting.accepted) {
        // Edited on the page: the Manager's answer now.
        if (field.answered && !sameValue(waiting.value, field.value)) Object.assign(entry, { category: 'verified', issue: 'Edited by you.' });
        else Object.assign(entry, { category: 'provisional', issue: waiting.reason });
        continue;
      }
      if (field.issue) {
        Object.assign(entry, { category: 'failed', issue: `The site shows: ${field.issue}` });
      } else if (!field.answered) {
        Object.assign(entry, entry.category === 'verified'
          ? { category: 'failed', issue: 'The page no longer shows the answer QTS filled.' }
          : field.required ? { category: 'needs_input', issue: entry.issue || 'Required and still empty.' } : { category: 'optional_empty', issue: '' });
      } else if (entry.category === 'verified' && entry.intended && field.kind !== 'file' && field.value && !sameValue(entry.intended, field.value)) {
        // (Answered, but its value cannot be read: it stays verified.)
        Object.assign(entry, { category: 'unknown', issue: `The page shows "${String(field.value).slice(0, 60)}", not what QTS filled: check it.` });
      } else if (entry.category !== 'verified') {
        // Answered now (by the Manager or the site).
        Object.assign(entry, { category: 'verified', issue: 'Answered on the page.' });
      }
    }
    // Questions that appeared since the filling (a dependent one), or were never met.
    const known = new Set([...entries.values()].filter((entry) => entry.step === step).map((entry) => short(entry.label)));
    for (const field of look.fields.filter((item) => item.shown !== false && !seen.has(item.id) && !known.has(short(item.label)))) {
      if (field.labelUnresolved && !field.required) continue;
      put(step, field.label, {
        fieldId: field.id, kind: field.kind, required: field.required, intended: '', source: null, shown: field.value,
        category: field.issue ? 'failed' : field.answered ? 'verified' : field.labelUnresolved ? 'unknown' : field.required ? 'needs_input' : 'optional_empty',
        issue: field.issue ? `The site shows: ${field.issue}` : field.answered ? 'Answered on the page.' : field.required ? 'A question that appeared after filling: required and still empty.' : '',
      });
    }
    // The page as a whole: a required question QTS could not read, an unreadable part, an error, a gate.
    for (const unread of look.unread || []) put(step, unread.label, { fieldId: unread.id || null, kind: 'page', required: true, category: 'unknown', issue: unread.kind === 'unread' ? 'QTS could not read this required question.' : 'Required and still empty.' });
    for (const host of [...new Set(look.frames || [])]) put(step, `Part of the page from ${host}`, { fieldId: null, kind: 'page', required: false, category: 'unknown', issue: `QTS cannot read this part of the page (${host}): check it for questions.` });
    for (const text of look.errors || []) put(step, `The form shows: ${text}`, { fieldId: null, kind: 'page', required: true, category: 'failed', issue: text });
    if (look.gate) put(step, look.gate.kind === 'login' ? 'Sign-in wall' : 'Human check', { fieldId: null, kind: 'page', required: true, category: 'blocked', issue: `${look.gate.kind === 'login' ? 'The site asks to sign in' : 'The site asks for a human check'} ("${look.gate.text}").` });
    if (look.blockers?.includes('captcha')) put(step, 'Security check (CAPTCHA)', { fieldId: null, kind: 'page', required: true, category: 'blocked', issue: 'The page shows a CAPTCHA: solve it yourself before Submit.' });
    // Page-level entries from before that are gone now (the error was fixed).
    for (const [key, entry] of entries) {
      if (entry.step !== step || entry.kind !== 'page') continue;
      const still = (look.errors || []).some((text) => entry.label === `The form shows: ${text}`)
        || (look.unread || []).some((unread) => unread.label === entry.label)
        || [...new Set(look.frames || [])].some((host) => entry.label === `Part of the page from ${host}`)
        || (look.gate && entry.category === 'blocked' && !/CAPTCHA/.test(entry.label))
        || (look.blockers?.includes('captcha') && /CAPTCHA/.test(entry.label))
        || /no longer shown on this page/.test(entry.issue);
      if (!still) entries.delete(key);
    }
  }

  /** The checklist for the panel: open items first, by step; totals; what blocks "I submitted it". */
  function summary(currentStep) {
    const all = [...entries.values()];
    const order = ['blocked', 'failed', 'needs_input', 'provisional', 'unknown', 'optional_empty', 'verified'];
    const items = all
      .map((entry) => ({
        step: entry.step, label: entry.label, category: entry.category, title: CHECKLIST_LABELS[entry.category], issue: entry.issue || '', required: Boolean(entry.required), kind: entry.kind || null,
        fieldId: entry.step === currentStep ? entry.fieldId || null : null,
        // An earlier step is not on this page: its state is as it was when QTS left it.
        where: entry.step === currentStep ? `step ${entry.step}` : `step ${entry.step} (earlier: use the site's Back to see it)`,
      }))
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.step - b.step);
    const needsYou = items.filter((item) => CHECKLIST_BLOCKING.has(item.category) || (item.category === 'unknown' && item.required));
    const blocking = items.filter((item) => CHECKLIST_BLOCKING.has(item.category) && (item.required || item.category !== 'failed'));
    const totals = Object.fromEntries(order.map((category) => [category, items.filter((item) => item.category === category).length]));
    return { items, totals, needsYou: needsYou.length, blocking: blocking.length };
  }

  return { addStep, accept, recheck, summary, save: () => [...entries.values()] };
}

self.__qtsAutoApplyChecklist = { create: createChecklist, LABELS: CHECKLIST_LABELS };
