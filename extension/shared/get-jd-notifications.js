(function initGetJdNotifications(global) {
  const AGGREGATION_WINDOW_MS = 2000;
  const MAX_HISTORY = 20;

  function classifyResult(result) {
    if (result?.saveError || Number(result?.autoSaveFailureCount) > 0) return 'failed';
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
      message: String(result.message || '').trim(),
      pageUrl: String(result.pageUrl || ''),
      pageTitle: String(result.pageTitle || '').trim(),
      updatedAt: Number.isFinite(Number(result.updatedAt)) ? Number(result.updatedAt) : now,
    };
    const history = Array.isArray(current?.history) ? [...current.history] : [];
    const previousIndex = history.findIndex((entry) => entry?.operationId === operationId);
    const previous = previousIndex >= 0 ? history[previousIndex] : null;
    if (previous
      && previous.status === record.status
      && previous.message === record.message
      && previous.pageUrl === record.pageUrl
      && previous.pageTitle === record.pageTitle) {
      return { state: current, changed: false };
    }
    if (previousIndex >= 0) history.splice(previousIndex, 1);
    history.push(record);
    history.splice(0, Math.max(0, history.length - MAX_HISTORY));

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
    const counts = { success: 0, failed: 0, skipped: 0, processing: 0, cancelled: 0 };
    for (const item of batch?.items || []) {
      if (Object.hasOwn(counts, item?.status)) counts[item.status] += 1;
    }
    return counts;
  }

  global.__qtsGetJdNotifications = { recordResult, summarizeBatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.__qtsGetJdNotifications;
})(typeof self !== 'undefined' ? self : globalThis);
