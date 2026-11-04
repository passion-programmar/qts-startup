(function initializeApplyPdfSettings() {
  const button = document.getElementById('choose-folder');
  const restore = document.getElementById('restore-access');
  const status = document.getElementById('folder-status');
  const store = globalThis.__qtsScannerDocumentStore;
  const key = globalThis.__qtsApplyLocalPdfs.SETTING_KEY;
  let allowed = false;
  let choosing = false;
  let revision = 0;
  let savedDirectory = null;

  function showStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }

  const checkAccess = () => chrome.runtime.sendMessage({ type: 'GET_MANAGER_EXTENSION_FEATURES', refresh: true });
  const hasAccess = (response) => response?.ok === true && response.canUseApply === true;

  async function showFolder(expectedRevision) {
    const saved = await store.getSetting(key);
    const directory = saved?.value;
    const permission = directory ? await directory.queryPermission({ mode: 'read' }) : null;
    if (revision !== expectedRevision || !allowed) return;
    savedDirectory = directory || null;
    restore.hidden = !directory || permission === 'granted';
    restore.disabled = choosing || restore.hidden;
    button.textContent = directory ? 'Choose QTS_Resume folder again' : 'Choose QTS_Resume folder';
    if (!directory) {
      showStatus('Choose QTS_Resume inside Downloads before running Apply. Chrome blocks selecting Downloads itself.', 'unconfigured');
    } else if (permission === 'granted') {
      showStatus(`Ready: Apply can read existing Generation PDFs from ${directory.name}.`, 'ready');
    } else {
      showStatus(`Read access to ${directory.name} needs approval. Choose Allow saved folder access, or select QTS_Resume inside Downloads again.`, 'revoked');
    }
  }

  async function refresh() {
    const current = ++revision;
    allowed = false;
    button.disabled = true;
    restore.disabled = true;
    restore.hidden = true;
    savedDirectory = null;
    try {
      const response = await checkAccess();
      if (current !== revision) return;
      if (!hasAccess(response)) {
        showStatus(response?.error || 'Sign in as a Manager with Apply access, then reopen this page.', 'denied');
        return;
      }
      allowed = true;
      if (typeof window.showDirectoryPicker !== 'function') {
        showStatus('This Chrome version does not support choosing a PDF folder. Update Chrome and retry.', 'error');
        return;
      }
      button.disabled = choosing;
      await showFolder(current);
    } catch (error) {
      if (current === revision) {
        const next = allowed ? 'Choose the QTS_Resume folder again.' : 'Reopen this page to check Manager access again.';
        showStatus(`${error.message || 'Could not check the Apply PDFs folder.'} ${next}`, 'error');
      }
    }
  }

  button.addEventListener('click', async () => {
    if (!allowed || choosing) return;
    const current = revision;
    choosing = true;
    button.disabled = restore.disabled = true;
    try {
      // Invoke the picker directly from the click, before any async work consumes user activation.
      const directory = await window.showDirectoryPicker({ mode: 'read', startIn: 'downloads' });
      if (directory.name !== 'QTS_Resume') {
        throw new Error('Select the QTS_Resume subfolder inside Downloads, not Downloads itself or a job subfolder.');
      }
      let permission = await directory.queryPermission({ mode: 'read' });
      if (permission !== 'granted') permission = await directory.requestPermission({ mode: 'read' });
      if (permission !== 'granted') throw new Error('Read access was not granted. Choose the folder again and allow read access.');
      const response = await checkAccess();
      if (current !== revision) return;
      allowed = hasAccess(response);
      if (!allowed) {
        showStatus(response?.error || 'Apply access is no longer available. Sign in as an authorized Manager.', 'denied');
        return;
      }
      await store.putSetting(key, directory);
      window.dispatchEvent?.(new Event('qts-pdf-folder-updated'));
      await showFolder(current);
    } catch (error) {
      if (current !== revision) return;
      if (error.name === 'AbortError') await refresh();
      else showStatus(`${error.message || 'Could not authorize the PDF folder.'} Choose the QTS_Resume folder again to retry.`, 'error');
    } finally {
      choosing = false;
      button.disabled = !allowed;
      restore.disabled = !allowed || restore.hidden;
    }
  });

  restore.addEventListener('click', async () => {
    if (!allowed || choosing || !savedDirectory) return;
    const current = revision;
    const directory = savedDirectory;
    choosing = true;
    button.disabled = restore.disabled = true;
    try {
      // The permission prompt also requires direct user activation; do not await a server call first.
      const permission = await directory.requestPermission({ mode: 'read' });
      if (permission !== 'granted') throw new Error('Read access was not granted. Select QTS_Resume again and allow read access.');
      const response = await checkAccess();
      if (current !== revision) return;
      allowed = hasAccess(response);
      if (!allowed) throw new Error('Apply access is no longer available. Sign in as an authorized Manager.');
      await showFolder(current);
      window.dispatchEvent?.(new Event('qts-pdf-folder-updated'));
    } catch (error) {
      if (current === revision) showStatus(`${error.message || 'Could not restore read access.'} Choose QTS_Resume folder again if needed.`, 'error');
    } finally {
      choosing = false;
      button.disabled = !allowed;
      restore.disabled = !allowed || restore.hidden;
    }
  });

  window.addEventListener('focus', () => { if (!choosing) refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.authExpiresAt || changes.qtsSessionUser)) refresh();
  });
  refresh();
})();
