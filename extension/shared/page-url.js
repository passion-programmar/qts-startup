function isExtractablePageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function restrictedPageMessage(url) {
  if (!url) return 'No page URL available. Open a job listing tab first.';
  try {
    const protocol = new URL(url).protocol.replace(':', '');
    if (protocol === 'chrome' || protocol === 'chrome-extension' || protocol === 'edge' || protocol === 'about') {
      return 'Auto-extract works on web pages (http/https). Open a job listing tab, then click Refresh.';
    }
  } catch {
    // fall through
  }
  return 'This page cannot be auto-scraped. Open a job listing in your browser, or enter details manually.';
}
