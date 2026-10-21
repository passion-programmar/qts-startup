(function initQtsGenerationChatGpt(global) {
  function extractJsonObject(text) {
    const source = String(text || '').trim();
    const candidates = [];
    for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
      candidates.push(match[1].trim());
    }
    candidates.push(source);
    for (const candidate of candidates) {
      const direct = parsePackage(candidate);
      if (direct) return direct;
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const sliced = parsePackage(candidate.slice(start, end + 1));
        if (sliced) return sliced;
      }
    }
    return null;
  }

  function parsePackage(value) {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;
      if (!parsed.resume || Array.isArray(parsed.resume) || typeof parsed.resume !== 'object') return null;
      if (!parsed.coverLetter || Array.isArray(parsed.coverLetter) || typeof parsed.coverLetter !== 'object') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  global.__qtsGenerationChatGpt = { extractJsonObject };
})(typeof globalThis !== 'undefined' ? globalThis : self);
