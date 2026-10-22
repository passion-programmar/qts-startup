(function (root) {
  function createGetJdSaveJob(classification, jobDescription) {
    const job = classification && classification.job;
    if (!job || typeof job !== 'object' || Array.isArray(job)) return null;
    const description = String(jobDescription || job.description || '').trim();
    if (!description) return null;
    return { ...job, description };
  }

  const api = { createGetJdSaveJob };
  root.__qtsGetJdSavePayload = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
