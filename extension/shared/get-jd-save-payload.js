(function (root) {
  function createGetJdSaveJob(classification, jobDescription) {
    const job = classification && classification.job;
    if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
    // An empty description is allowed: the caller then sends the page text instead.
    const description = String(jobDescription || job.description || '').trim();
    return { ...job, description };
  }

  const api = { createGetJdSaveJob };
  root.__qtsGetJdSavePayload = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
