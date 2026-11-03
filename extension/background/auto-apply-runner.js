// Auto Apply (Phase 3 Stages B and C): its own switch, run state, and progress, separate from the
// assisted Apply (runAssistedApplication), which stays as it is. It takes Apply's claims (the same
// server routes, sign-in, and ownership checks) and fills with the automatic engine (runApplication
// with auto: true): the résumé and cover letter, the candidate's profile facts, and Super Admin's
// approved reusable answers first; then ChatGPT for the questions left, one batch per
// form step using the Manager's configured answer instructions, then presents the filled answers
// for the Manager's review.
// Steps go on by themselves while nothing needs the Manager; the last step always waits for the
// Manager, who clicks the site's Submit. The Manager sets the open-job concurrency, and one mode per
// Chrome: Apply and Auto Apply share the work slot ('apply' in qtsExtensionStatus), and this key says
// which of the two holds it.
const AUTO_APPLY_KIND_KEY = 'qtsApplyKind';
// For the panel: the application being worked on (its step, what it waits for) and the last one's end.
const AUTO_APPLY_STATE_KEY = 'qtsAutoApplyState';
// What a restarted worker or a retried job needs: its tab, step, answers so far, and whether the
// Manager already submitted it. Unsubmitted checkpoints are retained while paused.
const AUTO_APPLY_RUNS_KEY = 'qtsAutoApplyRuns';
// Legacy local preference retained for the debug-only no-AI test mode.
const AUTO_APPLY_AI_KEY = 'qtsAutoApplyAi';
// { budget, timeoutMs }: local, bounded overrides of the AI request limit and wait (tests only).
const AUTO_APPLY_AI_LIMITS_KEY = 'qtsAutoApplyAiLimits';
// "Focus ChatGPT while answering": false keeps ChatGPT's tab behind the application; anything else shows
// it, and keeps it shown, while it answers (when the application's tab is the one shown as it starts;
// see askChatGptForAutoApply).
const AUTO_APPLY_CHAT_FOCUS_KEY = 'qtsAutoApplyChatFocus';
// At most this many AI requests per application; a busy server is tried again after these waits.
const AUTO_APPLY_AI_BUDGET = 10;
const AUTO_APPLY_AI_RETRY_WAITS = [3000, 10000];
const autoRuns = new Map();
let lastAutoRun = null;
let runWrites = Promise.resolve();
let browserSessionRequest = null;

// Tab IDs can be reused after Chrome closes. Session storage survives worker restarts only.
function autoApplyBrowserSession() {
  if (!browserSessionRequest) browserSessionRequest = (async () => {
    const key = 'qtsWorkBrowserSession';
    const saved = (await chrome.storage.session.get(key))[key];
    if (saved) return saved;
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ [key]: id });
    return id;
  })().catch(error => { browserSessionRequest = null; throw error; });
  return browserSessionRequest;
}

async function isAutoApplyOn() {
  const stored = await chrome.storage.local.get([EXTENSION_STATUS_KEY, AUTO_APPLY_KIND_KEY]);
  return stored[EXTENSION_STATUS_KEY] === 'apply' && stored[AUTO_APPLY_KIND_KEY] === 'auto';
}

function publishAutoApplyState() {
  const runs = [...autoRuns.values()].map(({ memory, ...run }) => ({ ...run }));
  Promise.resolve(chrome.storage.local.set({ [AUTO_APPLY_STATE_KEY]: { runs, last: lastAutoRun, updatedAt: new Date().toISOString() } }))
    .catch(error => console.error('Could not save Auto Apply status.', error));
}

// Kept one change at a time, so two quick steps never overwrite each other.
function changeStoredRuns(change) {
  const write = runWrites.then(async () => {
    const stored = (await chrome.storage.local.get(AUTO_APPLY_RUNS_KEY))[AUTO_APPLY_RUNS_KEY] || {};
    change(stored);
    await chrome.storage.local.set({ [AUTO_APPLY_RUNS_KEY]: stored });
  });
  runWrites = write.catch(error => console.error('Could not save Auto Apply recovery state.', error));
  return write;
}

/** ChatGPT, with debug-only no-AI mode and Auto Apply's limits, on one claimed application. */
async function prepareAutoApplication(application) {
  const stored = await chrome.storage.local.get([AUTO_APPLY_AI_KEY, AUTO_APPLY_AI_LIMITS_KEY, AUTO_APPLY_CHAT_FOCUS_KEY, 'qtsApplyDebug']);
  const choice = stored[AUTO_APPLY_AI_KEY];
  // Local overrides of the request limit and wait (bounded), used by the tests; normally unset.
  const limits = stored[AUTO_APPLY_AI_LIMITS_KEY] || {};
  const bounded = (value, low, high, otherwise) => (Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), low), high) : otherwise);
  application.autoAi = !(stored.qtsApplyDebug === true && choice === 'off');
  // Only an explicitly selected Custom URL job gets the Gemini exception; all others use ChatGPT.
  application.aiMode = application.autoApplyCustomUrlGemini === true ? 'gemini' : 'chatgpt';
  application.chatFocus = stored[AUTO_APPLY_CHAT_FOCUS_KEY] !== false;
  application.minimalPrompt = true;
  application.aiBudget = bounded(limits.budget, 1, 20, AUTO_APPLY_AI_BUDGET);
  application.aiTimeoutMs = bounded(limits.timeoutMs, 5000, 120000, null);
  application.aiRetryWaits = AUTO_APPLY_AI_RETRY_WAITS;
  application.factSources = self.__qtsApplyAnswers.factSources({
    candidate: application.candidate,
    resumeText: application.job.resumeText,
    coverLetterText: application.job.coverLetterText,
    savedAnswers: application.savedAnswers,
    job: application.job,
  });
  return application;
}

/**
 * One application with Auto Apply. Its state (step, phase, how many problems and unresolved
 * questions, AI requests, each step's time) is kept while it runs, published for the panel, and
 * stored for a restarted worker or a later retry of the same job. resume: that stored record.
 */
async function runAutoApplication(application, recipe, resume = null) {
  await prepareAutoApplication(application);
  // The AI requests already made count against this application's limit after a restart too.
  if (resume) application.aiCalls = resume.aiCalls || 0;
  const run = {
    attemptId: application.attemptId,
    browserSession: await autoApplyBrowserSession(),
    jobId: application.job.id,
    url: application.job.url || '',
    candidate: ([application.candidate.firstName, application.candidate.lastName].filter(Boolean).join(' ') || 'Candidate') + (application.candidate.managerCategory ? ` (${application.candidate.managerCategory})` : ''),
    title: application.job.title || '',
    company: application.job.company || '',
    ai: application.autoAi ? application.aiMode : 'off',
    step: resume?.step || 0,
    phase: resume ? 'resuming' : 'starting',
    problems: 0,
    unresolved: 0,
    aiCalls: 0,
    startedAt: resume?.startedAt || Date.now(),
    resumed: Boolean(resume),
    steps: resume?.steps || [],
  };
  autoRuns.set(run.attemptId, run);
  publishAutoApplyState();
  let stepStarted = Date.now();
  try {
    await runApplication(application, recipe, {
      auto: true,
      resume,
      onProgress: async ({ memory, quiet, ...event }) => {
        // A step starts with its own 'filling' (not the one after an AI round).
        // (quiet: the same review again, after the Manager accepted an answer; not a step's end.)
        if (event.phase === 'filling' && !event.ai) stepStarted = Date.now();
        else if (['next', 'final', 'needs_you'].includes(event.phase) && !quiet) run.steps.push({ step: event.step, ms: Date.now() - stepStarted, phase: event.phase, aiCalls: event.aiCalls || 0 });
        Object.assign(run, event, { updatedAt: Date.now() });
        diag('auto-apply', { attempt: String(run.attemptId).slice(0, 8), ...event });
        publishAutoApplyState();
        if (event.phase === 'submitted') run.submitted = true;
        if (event.phase === 'ended') run.resumePending = event.resumePending === true && !run.submitted;
        // At each step's end (and at Submit): what a restarted worker needs.
        if (memory) await changeStoredRuns((stored) => {
          stored[run.attemptId] = {
            ...run,
            ...memory,
            attemptId: run.attemptId,
            jobId: run.jobId,
            submitted: event.phase === 'submitted' || run.submitted === true,
          };
        });
      },
    });
  } finally {
    autoRuns.delete(run.attemptId);
    lastAutoRun = { ...run, endedAt: Date.now(), totalMs: Date.now() - run.startedAt };
    publishAutoApplyState();
    await changeStoredRuns((stored) => {
      const record = stored[run.attemptId];
      if (run.resumePending && record && !record.submitted && !record.pendingRelease) {
        stored[run.attemptId] = { ...record, paused: true, tabId: null };
      } else if (!record?.pendingRelease) {
        delete stored[run.attemptId];
      }
    });
  }
}

async function resumeForClaimedJob(application) {
  const stored = (await chrome.storage.local.get(AUTO_APPLY_RUNS_KEY))[AUTO_APPLY_RUNS_KEY] || {};
  const entry = Object.entries(stored).find(([, record]) =>
    record.jobId === application.job.id && !record.submitted && !record.pendingRelease);
  if (!entry) return null;
  const [previousId, record] = entry;
  const attemptId = application.attemptId;
  const resumed = {
    ...record,
    attemptId,
    browserSession: await autoApplyBrowserSession(),
    tabId: null,
    paused: false,
    resumePending: false,
  };
  await changeStoredRuns((all) => {
    delete all[previousId];
    all[attemptId] = resumed;
  });
  return resumed;
}

/**
 * The applications a restarted worker left open, taken up again: one already submitted only waits
 * for the Manager's Yes/No; any other goes on at its step in its own tab. If its tab is gone, its
 * checkpoint is retained and the claim is released so a later claim can replay saved answers.
 * Returns the runs started.
 */
async function resumeAutoApplyRuns(selection, limit = 2) {
  // A ChatGPT tab the worker selected before it restarted: the application's tab is shown again.
  await giveBackChatTab().catch(() => {});
  const stored = (await chrome.storage.local.get(AUTO_APPLY_RUNS_KEY))[AUTO_APPLY_RUNS_KEY] || {};
  const browserSession = await autoApplyBrowserSession();
  const runs = [];
  for (const record of Object.values(stored)) {
    if (record.pendingRelease) {
      if (!(await releaseInterruptedAutoRun(record))) throw new Error('QTS is retrying cleanup of an interrupted application.');
      continue;
    }
    if (record.paused) continue;
    if (selection && !selection.jobIds.includes(record.jobId)) continue;
    if (autoRuns.has(record.attemptId)) continue;
    if (runs.length >= limit) continue;
    const tab = record.browserSession === browserSession && record.tabId != null ? await chrome.tabs.get(record.tabId).catch(() => null) : null;
    if (record.submitted) {
      if (!tab) {
        await notifyApply(`${record.company || 'An application'}: check "Submitted successfully?" on the Jobs page. QTS will not submit it again.`);
        await changeStoredRuns((all) => { delete all[record.attemptId]; });
        continue;
      }
      runs.push(resumeSubmittedApplication(record).finally(() => changeStoredRuns((all) => { delete all[record.attemptId]; })));
      continue;
    }
    // The application again from the server (held for this Chrome), with the approved answers as they are now.
    const reply = tab ? await workerApiRequest('POST', '/api/extension/apply/resume', { attemptId: record.attemptId, jobId: record.jobId }) : null;
    const application = reply?.success === true ? reply.application : null;
    if (!application) {
      if (!tab) {
        if (!(await releaseInterruptedAutoRun(record, 'Its tab was closed while QTS restarted.'))) throw new Error('QTS is retrying cleanup of a closed application tab.');
        continue;
      }
      if (![404, 409].includes(reply?._httpStatus)) throw new Error('QTS could not resume the application yet. It will retry automatically.');
      await changeStoredRuns((all) => { delete all[record.attemptId]; });
      continue;
    }
    // A hold that ran out meanwhile comes back as a new attempt on the same job: the record follows it.
    if (application.attemptId !== record.attemptId) await changeStoredRuns((all) => { delete all[record.attemptId]; });
    diag('auto-apply-resume', { attempt: String(application.attemptId).slice(0, 8), step: record.step, phase: record.phase });
    runs.push(runAutoApplication(application, self.__qtsApplyRecipes.recipeFor(application.job.url), record));
  }
  return runs;
}

// Persist before releasing: Chrome may close, or the server may be offline during cleanup.
// This queue only gives unfinished jobs back; it never submits or confirms an application.
async function releaseInterruptedAutoRun(record, reason = record.releaseReason, answers = record.releaseAnswers || []) {
  if (record.submitted) return true;
  const pending = {
    ...record,
    attemptId: record.attemptId,
    jobId: record.jobId,
    pendingRelease: true,
    paused: false,
    releaseReason: reason || 'Interrupted Auto Apply application.',
    releaseAnswers: answers,
  };
  await changeStoredRuns((all) => { all[record.attemptId] = { ...(all[record.attemptId] || {}), ...pending }; });
  const reply = await workerApiRequest('POST', '/api/extension/apply/release', {
    attemptId: pending.attemptId, mode: 'later', reason: pending.releaseReason, appliedAnswers: answers,
  }).catch(() => null);
  // A lost response may mean release already succeeded. 409 cannot release or resubmit a live
  // confirmation; the server retains its existing ownership and post-Submit protections.
  if (reply?.success === true || reply?._httpStatus === 409 || reply?._httpStatus === 404) {
    await changeStoredRuns((all) => {
      const saved = all[record.attemptId];
      if (saved && !saved.submitted) {
        all[record.attemptId] = { ...saved, pendingRelease: false, paused: true, tabId: null };
      }
    });
    return true;
  }
  return false;
}

async function recoverStoppedAutoRuns() {
  const stored = (await chrome.storage.local.get(AUTO_APPLY_RUNS_KEY))[AUTO_APPLY_RUNS_KEY] || {};
  let complete = true;
  for (const record of Object.values(stored)) {
    if (record.submitted || record.paused || autoRuns.has(record.attemptId)) continue;
    if (!(await releaseInterruptedAutoRun(record, record.releaseReason || 'Auto Apply was cancelled before Chrome restarted.'))) complete = false;
  }
  return complete;
}

async function retryPendingAutoReleases() {
  const stored = (await chrome.storage.local.get(AUTO_APPLY_RUNS_KEY))[AUTO_APPLY_RUNS_KEY] || {};
  for (const record of Object.values(stored)) {
    if (record.pendingRelease && !(await releaseInterruptedAutoRun(record))) return false;
  }
  return true;
}

// The work slot left Apply (Cancel, Stop all, signed out, idle): the kind goes with it, so the next
// Apply starts as the assistant unless Auto Apply is chosen again. Failed cleanup stays queued.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[EXTENSION_STATUS_KEY] || changes[EXTENSION_STATUS_KEY].newValue === 'apply') return;
  chrome.storage.local.remove(AUTO_APPLY_KIND_KEY).catch(() => {});
});

self.__qtsAutoApply = {
  isOn: isAutoApplyOn,
  run: (application, recipe, resume = null) => runAutoApplication(application, recipe, resume),
  resumeForClaimedJob: resumeForClaimedJob,
  resumeRuns: resumeAutoApplyRuns,
  releaseRun: releaseInterruptedAutoRun,
  recoverStoppedRuns: recoverStoppedAutoRuns,
  retryPendingReleases: retryPendingAutoReleases,
  browserSession: autoApplyBrowserSession,
  isRunning: () => autoRuns.size > 0,
  KIND_KEY: AUTO_APPLY_KIND_KEY,
  STATE_KEY: AUTO_APPLY_STATE_KEY,
  RUNS_KEY: AUTO_APPLY_RUNS_KEY,
  AI_KEY: AUTO_APPLY_AI_KEY,
  CHAT_FOCUS_KEY: AUTO_APPLY_CHAT_FOCUS_KEY,
};
