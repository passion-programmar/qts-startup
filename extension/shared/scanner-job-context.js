(function initScannerJobContext(global) {
  if (global.__qtsScannerJobContext) return;

  function createSnapshot({ job = {}, account = {}, managerId = null, jobDescription = '' } = {}) {
    const accountId = Number(account.id || account.u_id);
    const jobId = Number(job.id || job.j_id);
    const ownerId = Number(managerId);
    if (!Number.isSafeInteger(accountId) || accountId <= 0
      || !Number.isSafeInteger(jobId) || jobId <= 0) {
      throw new Error('Scanner job context requires a saved job and selected Account.');
    }
    return {
      jobId,
      managerId: Number.isSafeInteger(ownerId) && ownerId > 0 ? ownerId : null,
      accountId,
      title: String(job.title || job.job_title || '').trim().slice(0, 500),
      company: String(job.company || '').trim().slice(0, 500),
      url: String(job.url || job.job_url || '').trim().slice(0, 2000),
      platform: String(job.application_type || job.source || '').trim().slice(0, 100),
      description: String(jobDescription || job.description || '').trim().slice(0, 50000),
      savedAt: new Date().toISOString(),
    };
  }

  function storageKey(snapshot) {
    if (!snapshot || !Number.isSafeInteger(Number(snapshot.jobId)) || !Number.isSafeInteger(Number(snapshot.accountId))) {
      throw new Error('Cannot create a Scanner job-context key without valid job and Account IDs.');
    }
    return `qtsScannerJobContext:${Number(snapshot.managerId) || 0}:${Number(snapshot.accountId)}:${Number(snapshot.jobId)}`;
  }

  function mergeSnapshot(saved, next) {
    const source = saved || {};
    const update = next || {};
    return {
      ...source,
      ...update,
      title: String(update.title || source.title || '').trim(),
      company: String(update.company || source.company || '').trim(),
      url: String(update.url || source.url || '').trim(),
      platform: String(update.platform || source.platform || '').trim(),
      description: String(update.description || source.description || '').trim(),
    };
  }

  function formatText(snapshot) {
    const context = snapshot || {};
    return [
      'QTS Scanner — Job Details',
      '',
      `Job title: ${String(context.title || '').trim() || 'Not available'}`,
      `Company: ${String(context.company || '').trim() || 'Not available'}`,
      `Job URL: ${String(context.url || '').trim() || 'Not available'}`,
      `Platform: ${String(context.platform || '').trim() || 'Not available'}`,
      '',
      'Job description:',
      String(context.description || '').trim() || 'Not available',
      '',
    ].join('\n');
  }

  const api = { createSnapshot, storageKey, mergeSnapshot, formatText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.__qtsScannerJobContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
