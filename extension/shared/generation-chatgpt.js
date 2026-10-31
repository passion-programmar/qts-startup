(function initQtsGenerationChatGpt(global) {
  // The server composes the contract, so a current extension must not send a legacy server's prompt.
  function generationContractIssue(result) {
    return result?.resumeJsonVersion === 2
      ? ''
      : 'The QTS server returned an outdated Generation contract. Rebuild or update the QTS server to the V2 résumé version before retrying.';
  }

  function buildTaskMarker(generationId) {
    const id = String(generationId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return '';
    return `QTS_GENERATION_ID: ${id}`;
  }

  function buildTaskPrompt(prompt, generationId) {
    const source = String(prompt || '').trim();
    const marker = buildTaskMarker(generationId);
    if (!source || !marker) return '';
    return [
      marker,
      'The identifier above is transport metadata. Do not include it in the output JSON.',
      '',
      source,
    ].join('\n');
  }

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

  global.__qtsGenerationChatGpt = {
    generationContractIssue,
    buildTaskMarker,
    buildTaskPrompt,
    extractJsonObject,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
