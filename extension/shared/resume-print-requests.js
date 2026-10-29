// The Resume page's print requests (content/qts-site-bridge.js → QTS_PRINT_DOCUMENTS): checked before
// this Chrome prints anything, and printed once while the same request is already printing. The
// template page prints its sample résumé when it gets no data, and the default template for a name
// it does not know, so a request that would do either is refused here instead of printed.
(function (global) {
  // The 24 templates of src/server/pdf/pdf-templates.ts; resume-print-requests.test.js keeps them equal.
  const TEMPLATES = Object.freeze([
    'startup', 'centered', 'corporate', 'ledger', 'bold', 'technical',
    'professional', 'executive', 'timeline', 'graphite', 'modern-serif', 'compact',
    'minimal', 'harvard', 'nordic', 'academic', 'swiss', 'slate',
    'high-contrast', 'classic', 'qts-standard', 'elegant', 'creative', 'banded',
  ]);
  // The same limit as the server's /api/pdf/print.
  const MAX_DATA_CHARACTERS = 1_000_000;
  // chrome-pdf.js gives up after 60 seconds; this frees the request even if printing never settles.
  const PRINT_LIMIT_MS = 70_000;

  const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  const filled = (value) => typeof value === 'string' && value.trim() !== '';

  /**
   * `job` is { template, data } as the Resume page sends it (toResumeTemplateData in
   * src/app/pdf/document-data.ts). Gives { key } naming exactly this request, or { error }.
   */
  function checkPrintJob(job) {
    if (!isRecord(job)) return { error: 'The print request has no document.' };
    if (!TEMPLATES.includes(job.template)) return { error: 'Choose one of the QTS templates to print.' };
    const { data } = job;
    if (!isRecord(data)) return { error: 'The print request has no résumé data.' };
    if (!isRecord(data.candidate) || !filled(data.candidate.fullName)) return { error: 'The résumé has no candidate name.' };
    if (!isRecord(data.resume) || !Array.isArray(data.resume.sections)) return { error: 'The résumé has no sections.' };
    if (!isRecord(data.coverLetter) || !Array.isArray(data.coverLetter.paragraphs) || !data.coverLetter.paragraphs.length) {
      return { error: 'The cover letter has no paragraphs.' };
    }
    if (!isRecord(data.theme) || data.theme.template !== job.template) {
      return { error: 'The résumé data was prepared for another template.' };
    }
    let text;
    try {
      text = JSON.stringify(data);
    } catch {
      return { error: 'The résumé data cannot be read.' };
    }
    if (text.length > MAX_DATA_CHARACTERS) return { error: 'The résumé data is too large to print.' };
    return { key: `${job.template}\n${text}` };
  }

  // Printing requests by key. A request is shared only while it prints, never kept after.
  const inFlight = new Map();

  /**
   * Runs print() once for identical requests made while it runs; they all get its result. The
   * entry is removed when it succeeds, fails, throws or passes `limitMs`, so a retry prints again.
   */
  function printOnce(key, print, { limitMs = PRINT_LIMIT_MS } = {}) {
    const running = inFlight.get(key);
    if (running) return running;
    let timer = null;
    const pending = Promise.race([
      Promise.resolve().then(print),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), limitMs);
      }),
    ])
      .catch(() => null)
      .finally(() => {
        clearTimeout(timer);
        if (inFlight.get(key) === pending) inFlight.delete(key);
      });
    inFlight.set(key, pending);
    return pending;
  }

  const inFlightCount = () => inFlight.size;

  const api = { TEMPLATES, MAX_DATA_CHARACTERS, checkPrintJob, printOnce, inFlightCount };
  global.__qtsResumePrints = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
