(function initGetJdNotifications(global) {
  const AGGREGATION_WINDOW_MS = 2000;
  const MAX_HISTORY = 20;

  function resultDetails(result) {
    const savedCount = result?.saveResponse ? Number(result.saveResponse.savedCount) || 0 : result?.autoSavedProfileIds?.length || 0;
    const failedCount = Number(result?.saveResponse ? result.saveResponse.failedCount : result?.autoSaveFailureCount) || 0;
    const job = result?.classification?.job || {};
    let outcome, label;
    if (failedCount || result?.saveError) {
      outcome = savedCount ? 'partial' : 'failed';
      label = savedCount ? `${savedCount} saved · ${failedCount || 'Some'} failed` : 'Failed';
      if (!failedCount && Number(result?.saveResponse?.lockedCount) > 0) { outcome = 'review'; label = 'Review needed'; }
    } else if (result?.status === 'processing') { outcome = 'processing'; label = 'Checking'; }
    else if (result?.status === 'error') { outcome = 'failed'; label = 'Failed'; }
    else if (result?.status === 'duplicate') { outcome = 'skipped'; label = 'Skipped'; }
    else if (result?.status === 'cancelled') { outcome = 'cancelled'; label = 'Cancelled'; }
    else if (savedCount > 0) { outcome = 'saved'; label = `Saved for ${savedCount} account${savedCount === 1 ? '' : 's'}`; }
    else if (result?.status === 'saved') {
      outcome = 'updated';
      label = Number(result?.saveResponse?.removedCount) > 0 ? 'Selection updated' : result?.saveResponse ? 'No new saves' : 'Saved';
    } else if (result?.evaluationMode === 'gemini') { outcome = 'skipped'; label = 'No new saves'; }
    else { outcome = 'review'; label = 'Review needed'; }
    return { outcome, label, savedCount, failedCount, title: String(job.title || result?.pageTitle || ''), company: String(job.company || '') };
  }

  const sessionKey = (auth) => auth?.qtsSessionUser?.id && auth?.authExpiresAt
    ? `${auth.qtsSessionUser.id}:${auth.authExpiresAt}` : '';

  function recentResults(state, auth) {
    if (auth && state?.ownerKey && state.ownerKey !== sessionKey(auth)) return [];
    return (Array.isArray(state?.history) ? state.history : [])
      .filter((entry) => entry?.operationId && entry.status !== 'processing')
      .slice(-3).reverse();
  }

  function classifyResult(result) {
    if (result?.saveError || Number(result?.saveResponse ? result.saveResponse.failedCount : result?.autoSaveFailureCount) > 0) return 'failed';
    switch (result?.status) {
      case 'processing': return 'processing';
      case 'complete':
      case 'saved': return 'success';
      case 'error': return 'failed';
      case 'duplicate': return 'skipped';
      case 'cancelled': return 'cancelled';
      default: return null;
    }
  }

  function recordResult(current, result, tabId, now = Date.now()) {
    const status = classifyResult(result);
    if (!status || !result?.runId) return { state: current, changed: false };

    const operationId = `${tabId}:${result.runId}`;
    const record = {
      operationId,
      runId: String(result.runId),
      tabId,
      status,
      message: String(result.saveError || result.message || '').trim(),
      pageUrl: String(result.pageUrl || ''),
      pageTitle: String(result.pageTitle || '').trim(),
      updatedAt: Number.isFinite(Number(result.updatedAt)) ? Number(result.updatedAt) : now,
      ...resultDetails(result),
    };
    const history = Array.isArray(current?.history) ? [...current.history] : [];
    const previousIndex = history.findIndex((entry) => entry?.operationId === operationId);
    const previous = previousIndex >= 0 ? history[previousIndex] : null;
    if (previous
      && previous.status === record.status
      && previous.message === record.message
      && previous.pageUrl === record.pageUrl
      && previous.pageTitle === record.pageTitle
      && ['outcome', 'label', 'title', 'company', 'savedCount', 'failedCount'].every((key) => previous[key] === record[key])) {
      return { state: current, changed: false };
    }
    if (previousIndex >= 0) history.splice(previousIndex, 1);
    history.push(record);
    // Processing bursts must not evict the three completed results visible in the launcher.
    const visible = new Set(recentResults({ history }).map((entry) => entry.operationId));
    while (history.length > MAX_HISTORY) history.splice(history.findIndex((entry) => !visible.has(entry.operationId)), 1);

    const previousBatch = current?.batch;
    const inWindow = Number.isFinite(previousBatch?.startedAt)
      && now >= previousBatch.startedAt
      && now - previousBatch.startedAt < AGGREGATION_WINDOW_MS;
    const batch = inWindow
      ? { ...previousBatch, items: Array.isArray(previousBatch.items) ? [...previousBatch.items] : [] }
      : {
        id: `${now}:${operationId}`,
        startedAt: now,
        expiresAt: now + AGGREGATION_WINDOW_MS,
        items: [],
      };
    const itemIndex = batch.items.findIndex((entry) => entry?.operationId === operationId);
    if (itemIndex >= 0) batch.items[itemIndex] = record;
    else batch.items.push(record);
    batch.updatedAt = now;
    batch.dismissAt = now + 5000;

    return {
      state: { history, batch },
      changed: true,
    };
  }

  function summarizeBatch(batch) {
    const counts = { success: 0, failed: 0, skipped: 0, processing: 0, cancelled: 0, review: 0, partial: 0 };
    for (const item of batch?.items || []) {
      const status = item?.outcome === 'review' || item?.outcome === 'partial' ? item.outcome
        : item?.outcome === 'skipped' ? 'skipped' : item?.status;
      if (Object.hasOwn(counts, status)) counts[status] += 1;
    }
    return counts;
  }

  global.__qtsGetJdNotifications = { recordResult, summarizeBatch, recentResults, resultDetails, sessionKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.__qtsGetJdNotifications;
})(typeof self !== 'undefined' ? self : globalThis);
