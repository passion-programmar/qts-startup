// Auto Apply (Phase 3 Stages B and C): its own switch, run state, and progress, separate from the
// assisted Apply (runAssistedApplication), which stays as it is. It takes Apply's claims (the same
// server routes, sign-in, and ownership checks) and fills with the automatic engine (runApplication
// with auto: true): the résumé and cover letter, the candidate's profile facts, and Super Admin's
// approved reusable answers first; then AI (Gemini by default) for the questions left, one batch per
// form step, written from the job description, résumé, and profile and filled; one the documents and
// approved facts do not show is pointed out on the review.
// Steps go on by themselves while nothing needs the Manager; the last step always waits for the
// Manager, who clicks the site's Submit. One application at a time per Chrome, and one mode per
// Chrome: Apply and Auto Apply share the work slot ('apply' in qtsExtensionStatus), and this key says
// which of the two holds it.
const AUTO_APPLY_KIND_KEY = 'qtsApplyKind';
// For the panel: the application being worked on (its step, what it waits for) and the last one's end.
const AUTO_APPLY_STATE_KEY = 'qtsAutoApplyState';
// What a restarted worker needs to go on with an application: its tab, step, answers so far, and
// whether the Manager already submitted it. Removed when the application ends.
const AUTO_APPLY_RUNS_KEY = 'qtsAutoApplyRuns';
// The AI for open questions: 'gemini' (default, through the QTS server), 'chatgpt' (this Chrome's
// ChatGPT tab), or 'off' (Stage B: nothing but documents, profile, and approved answers).
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

async function isAutoApplyOn() {
  const stored = await chrome.storage.local.get([EXTENSION_STATUS_KEY, AUTO_APPLY_KIND_KEY]);
  return stored[EXTENSION_STATUS_KEY] === 'apply' && stored[AUTO_APPLY_KIND_KEY] === 'auto';
}

function publishAutoApplyState() {
  const runs = [...autoRuns.values()].map(({ memory, ...run }) => ({ ...run }));
  Promise.resolve(chrome.storage.local.set({ [AUTO_APPLY_STATE_KEY]: { runs, last: lastAutoRun, updatedAt: new Date().toISOString() } })).catch(() => {});
}

// Kept one change at a time, so two quick steps never overwrite each other.
function changeStoredRuns(change) {
  runWrites = runWrites.then(async () => {
    const stored = (await chrome.storage.local.get(AUTO_APPLY_RUNS_KEY))[AUTO_APPLY_RUNS_KEY] || {};
    change(stored);
    await chrome.storage.local.set({ [AUTO_APPLY_RUNS_KEY]: stored });
  }).catch(() => {});
  return runWrites;
}

/** Gemini (default), ChatGPT, or no AI, and Auto Apply's limits, on one claimed application. */
async function prepareAutoApplication(application) {
  const stored = await chrome.storage.local.get([AUTO_APPLY_AI_KEY, AUTO_APPLY_AI_LIMITS_KEY, AUTO_APPLY_CHAT_FOCUS_KEY]);
  const choice = stored[AUTO_APPLY_AI_KEY];
  // Local overrides of the request limit and wait (bounded), used by the tests; normally unset.
  const limits = stored[AUTO_APPLY_AI_LIMITS_KEY] || {};
  const bounded = (value, low, high, otherwise) => (Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), low), high) : otherwise);
  application.autoAi = choice !== 'off';
  application.aiMode = choice === 'chatgpt' ? 'chatgpt' : 'gemini';
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
 * stored for a restarted worker. resume: that stored record, when the worker restarted.
 */
async function runAutoApplication(application, recipe, resume = null) {
  await prepareAutoApplication(application);
  // The AI requests already made count against this application's limit after a restart too.
  if (resume) application.aiCalls = resume.aiCalls || 0;
  const run = {
    attemptId: application.attemptId,
    jobId: application.job.id,
    url: application.job.url || '',
    candidate: [application.candidate.firstName, application.candidate.lastName].filter(Boolean).join(' ') || 'Candidate',
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
      onProgress: ({ memory, quiet, ...event }) => {
        // A step starts with its own 'filling' (not the one after an AI round).
        // (quiet: the same review again, after the Manager accepted an answer; not a step's end.)
        if (event.phase === 'filling' && !event.ai) stepStarted = Date.now();
        else if (['next', 'final', 'needs_you'].includes(event.phase) && !quiet) run.steps.push({ step: event.step, ms: Date.now() - stepStarted, phase: event.phase, aiCalls: event.aiCalls || 0 });
        Object.assign(run, event, { updatedAt: Date.now() });
        diag('auto-apply', { attempt: String(run.attemptId).slice(0, 8), ...event });
        publishAutoApplyState();
        if (event.phase === 'ended') return;
        // At each step's end (and at Submit): what a restarted worker needs.
        if (memory) changeStoredRuns((stored) => { stored[run.attemptId] = { ...run, ...memory, submitted: event.phase === 'submitted' }; });
      },
    });
  } finally {
    autoRuns.delete(run.attemptId);
    lastAutoRun = { ...run, endedAt: Date.now(), totalMs: Date.now() - run.startedAt };
    publishAutoApplyState();
    await changeStoredRuns((stored) => { delete stored[run.attemptId]; });
  }
}

/**
 * The applications a restarted worker left open, taken up again: one already submitted only waits
 * for the Manager's Yes/No; any other goes on at its step in its own tab, its answers kept (no AI is
 * asked again for a question already answered). A record whose tab or claim is gone is dropped (its
 * job is given back, nothing recorded against it). Returns the runs started.
 */
async function resumeAutoApplyRuns() {
  // A ChatGPT tab the worker selected before it restarted: the application's tab is shown again.
  await giveBackChatTab().catch(() => {});
  const stored = (await chrome.storage.local.get(AUTO_APPLY_RUNS_KEY))[AUTO_APPLY_RUNS_KEY] || {};
  const runs = [];
  for (const record of Object.values(stored)) {
    if (autoRuns.has(record.attemptId)) continue;
    const tab = record.tabId != null ? await chrome.tabs.get(record.tabId).catch(() => null) : null;
    if (record.submitted) {
      runs.push(resumeSubmittedApplication(record).finally(() => changeStoredRuns((all) => { delete all[record.attemptId]; })));
      continue;
    }
    // The application again from the server (held for this Chrome), with the approved answers as they are now.
    const reply = tab ? await workerApiRequest('POST', '/api/extension/apply/resume', { attemptId: record.attemptId, jobId: record.jobId }) : null;
    const application = reply?.success === true ? reply.application : null;
    if (!application) {
      if (!tab) await workerApiRequest('POST', '/api/extension/apply/release', { attemptId: record.attemptId, mode: 'later', reason: 'Its tab was closed while QTS restarted.' }).catch(() => {});
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

// The work slot left Apply (Cancel, Stop all, signed out, idle): the kind goes with it, so the next
// Apply starts as the assistant unless Auto Apply is chosen again; nothing is left to resume.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[EXTENSION_STATUS_KEY] || changes[EXTENSION_STATUS_KEY].newValue === 'apply') return;
  chrome.storage.local.remove(AUTO_APPLY_KIND_KEY).catch(() => {});
});

self.__qtsAutoApply = {
  isOn: isAutoApplyOn,
  run: (application, recipe) => runAutoApplication(application, recipe),
  resumeRuns: resumeAutoApplyRuns,
  isRunning: () => autoRuns.size > 0,
  KIND_KEY: AUTO_APPLY_KIND_KEY,
  STATE_KEY: AUTO_APPLY_STATE_KEY,
  RUNS_KEY: AUTO_APPLY_RUNS_KEY,
  AI_KEY: AUTO_APPLY_AI_KEY,
  CHAT_FOCUS_KEY: AUTO_APPLY_CHAT_FOCUS_KEY,
};
