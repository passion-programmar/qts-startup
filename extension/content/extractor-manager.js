// Extractor manager — picks the right extractor based on hostname

(function initExtractorManager() {
  if (window.__extractJobData) return;

function selectExtractor(hostname) {
  if (hostname.includes('linkedin.com')) return window.__linkedInExtract;
  if (hostname.includes('indeed.com')) return window.__indeedExtract;
  if (hostname.includes('glassdoor.com')) return window.__glassdoorExtract;
  if (hostname.includes('greenhouse.io') || hostname.includes('greenhouse.com')) return window.__greenhouseExtract;
  if (hostname.includes('lever.co')) return window.__leverExtract;
  if (hostname.includes('workable.com')) return window.__workableExtract;
  if (hostname.includes('smartrecruiters.com')) return window.__smartrecruitersExtract;
  if (hostname.includes('ashbyhq.com')) return window.__ashbyExtract;
  return window.__genericExtract;
}

function extractJobData() {
  try {
    const hostname = window.location.hostname.toLowerCase();
    const extractor = selectExtractor(hostname);
    if (!extractor) return window.__genericExtract();
    const data = extractor();
    if (extractor !== window.__genericExtract && window.__genericExtract) {
      try {
        const fallback = window.__genericExtract();
        for (const field of [
          'title',
          'company',
          'description',
          'location',
          'country',
          'employmentType',
          'workplaceType',
          'salary',
          'url',
        ]) {
          if (!data[field]?.trim() && fallback[field]?.trim()) data[field] = fallback[field];
        }
      } catch (e) {
        console.error('[QTS_Startup] Generic extraction fallback error:', e);
      }
    }
    if (!data.url) data.url = window.location.href;
    if (window.__normalizeJobUrl) {
      data.url = window.__normalizeJobUrl(data.url);
    }
    if (!data.source) data.source = detectSource(hostname, window.location.search);
    return data;
  } catch (e) {
    console.error('[QTS_Startup] Extraction error:', e);
    return { title: '', company: '', description: '', location: '', url: window.location.href, source: 'unknown', error: e.message };
  }
}

function detectSource(hostname, search = '') {
  const params = new URLSearchParams(search);
  if (params.get('gh_jid')?.trim()) return 'greenhouse';
  if (params.get('ashby_jid')?.trim()) return 'ashby';
  if (hostname.includes('linkedin')) return 'linkedin';
  if (hostname.includes('indeed')) return 'indeed';
  if (hostname.includes('glassdoor')) return 'glassdoor';
  if (hostname.includes('greenhouse')) return 'greenhouse';
  if (hostname.includes('lever')) return 'lever';
  if (hostname.includes('workable')) return 'workable';
  if (hostname.includes('smartrecruiters')) return 'smartrecruiters';
  if (hostname.includes('ashby')) return 'ashby';
  return hostname.replace(/^www\./, '').split('.')[0];
}

window.__extractJobData = extractJobData;
})();
