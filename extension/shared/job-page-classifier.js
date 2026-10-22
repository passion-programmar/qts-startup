(function initJobPageClassifier(global) {
  if (global.__qtsJobPageClassifier) return;

  const genericTitles = new Set([
    'job',
    'jobs',
    'job search',
    'search jobs',
    'search results',
    'careers',
    'career',
    'job openings',
    'open jobs',
    'all jobs',
    'find jobs',
  ]);
  const jobSignalPatterns = [
    /\bwhat you(?:'|’)ll do\b|\bwhat you will do\b|\bresponsibilities\b|\bday to day\b/i,
    /\bqualifications?\b|\brequirements?\b|\bnice to have\b|\bmust have\b|\byears of experience\b/i,
    /\bjob description\b|\babout the role\b|\babout this role\b|\brole overview\b|\boverview\b/i,
    /\bbenefits\b|\bperks\b|\bwhat we offer\b|\bcompensation\b/i,
    /\blocation\b|\bwork location\b|\bworkplace\b|\bremote\b|\bhybrid\b/i,
  ];

  function meaningfulTitle(value) {
    const title = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return title.length >= 4
      && !genericTitles.has(title)
      && !/^(jobs?|search|careers?|opportunities|openings)\b/i.test(title)
      && !/^\d[\d,]*\+?\s+jobs?\b/i.test(title);
  }

  function classifyJobPageEvidence(evidence) {
    const data = evidence && typeof evidence === 'object' ? evidence : {};
    if (data.hasJobPosting === true) {
      return { isJobPage: true, reason: 'structured_job_posting' };
    }
    const urlType = data.configuredDetailUrl === true ? 'detail' : data.urlType;
    if (urlType === 'list') {
      return { isJobPage: false, reason: 'job_listing_index' };
    }

    const title = String(data.title || '').trim();
    const headings = Array.isArray(data.headings) ? data.headings.join(' ') : '';
    const description = String(data.description || '');
    const text = `${headings}\n${description}`.slice(0, 16000);
    const signalCount = jobSignalPatterns.reduce(
      (count, pattern) => count + (pattern.test(text) ? 1 : 0),
      0,
    );
    const hasTitle = meaningfulTitle(title);
    const descriptionLength = description.trim().length;

    if (
      urlType === 'detail'
      && hasTitle
      && descriptionLength >= 80
      && signalCount >= 1
    ) {
      return { isJobPage: true, reason: 'job_detail_url_and_content' };
    }
    if (hasTitle && descriptionLength >= 250 && signalCount >= 2) {
      return { isJobPage: true, reason: 'job_content_signals' };
    }
    if (hasTitle && descriptionLength >= 100 && signalCount >= 3) {
      return { isJobPage: true, reason: 'multiple_job_content_signals' };
    }
    return { isJobPage: false, reason: 'insufficient_job_signals' };
  }

  global.__qtsJobPageClassifier = Object.freeze({ classifyJobPageEvidence });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { classifyJobPageEvidence };
  }
})(typeof self !== 'undefined' ? self : globalThis);
