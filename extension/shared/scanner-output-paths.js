(function initScannerOutputPaths(global) {
  if (global.__qtsScannerOutputPaths) return;

  function safeSegment(value, fallback) {
    const segment = String(value || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 100);
    return segment || fallback;
  }

  function timestampSegment(date) {
    const value = date instanceof Date ? date : new Date(date || Date.now());
    if (Number.isNaN(value.getTime())) throw new Error('A valid Scanner output timestamp is required.');
    const pad = (number) => String(number).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}_${pad(value.getHours())}-${pad(value.getMinutes())}-${pad(value.getSeconds())}`;
  }

  function accountFolder(account) {
    return safeSegment(account?.name || account?.username, `Account_${account?.id || account?.u_id || 'unknown'}`);
  }

  function managerFolder(manager) {
    return safeSegment(manager?.name || manager?.username, `Manager_${manager?.id || 'unknown'}`);
  }

  function jobFolder(jobContext, timestamp) {
    return [
      timestampSegment(timestamp),
      safeSegment(jobContext?.title, 'Job'),
      safeSegment(jobContext?.company, 'Company'),
    ].join('_');
  }

  function artifactName(jobContext, type, account) {
    const accountName = accountFolder(account);
    if (type === 'resume') return `${accountName}.pdf`;
    if (type === 'cover_letter') return `${accountName}_Cover_Letter.pdf`;
    if (type === 'job_details') {
      return `${safeSegment(jobContext?.title, 'Job')}_${safeSegment(jobContext?.company, 'Company')}.txt`;
    }
    throw new Error(`Unsupported Scanner output type: ${type}`);
  }

  function relativePath(rootName, manager, account, jobContext, timestamp, type) {
    return [
      safeSegment(rootName, 'Selected folder'),
      ...downloadPathSegments(manager, account, jobContext, timestamp, type),
    ].join('/');
  }

  function downloadPathSegments(manager, account, jobContext, timestamp, type) {
    return [
      'QTS_Startup',
      managerFolder(manager),
      accountFolder(account),
      jobFolder(jobContext, timestamp),
      artifactName(jobContext, type, account),
    ];
  }

  function downloadPath(manager, account, jobContext, timestamp, type) {
    return downloadPathSegments(manager, account, jobContext, timestamp, type).join('/');
  }

  const api = {
    accountFolder,
    artifactName,
    downloadPath,
    jobFolder,
    managerFolder,
    relativePath,
    timestampSegment,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.__qtsScannerOutputPaths = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
