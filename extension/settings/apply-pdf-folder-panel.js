(function initializeApplyPdfFolderPanel() {
  const button = document.getElementById('choose-folder');
  const restore = document.getElementById('restore-access');
  const status = document.getElementById('folder-status');
  const store = globalThis.__qtsScannerDocumentStore;
  const key = globalThis.__qtsApplyLocalPdfs.SETTING_KEY;
  const embedded = window.top !== window;
  // Inside the launcher the page sits on its dark panel; on its own it draws its own background.
  document.documentElement.classList.toggle('embedded', embedded);
  let allowed = false;
  let busy = false;
  let savedDirectory = null;
  let revision = 0;

  function report(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }

  function setBusy(value) {
    busy = value;
    button.disabled = busy || !allowed;
    restore.disabled = busy || !allowed || restore.hidden;
  }

  async function showSavedFolder(expectedRevision) {
    const saved = await store.getSetting(key);
    const directory = saved?.value || null;
    if (expectedRevision !== revision || !allowed) return;
    savedDirectory = directory;
    const permission = !embedded && directory
      ? await directory.queryPermission({ mode: 'readwrite' })
      : null;
    restore.hidden = embedded || !directory || permission === 'granted';
    restore.disabled = busy || restore.hidden;
    // Choosing is the one step: the picker and Chrome's Allow come in the same click, so a folder
    // that lost its access is simply chosen again (or "Allow again" for the saved one).
    button.textContent = directory && !embedded && permission === 'granted'
      ? 'Choose a different folder'
      : 'Choose QTS_Resume folder';
    if (!directory) {
      report(embedded
        ? 'Not chosen yet. The button opens a small QTS window with the folder chooser.'
        : 'Not chosen yet. Choose QTS_Resume inside Downloads and allow it.', 'unconfigured');
    } else if (embedded) {
      report(`Chosen: ${directory.name}. To choose again or refresh access, use the button (it opens a small QTS window).`, 'ready');
    } else if (permission === 'granted') {
      report(`Ready: QTS reads and deletes résumés in ${directory.name}.`, 'ready');
    } else {
      report(`Chrome paused access to ${directory.name}. Click Allow again, or choose the folder again.`, 'revoked');
    }
  }

  async function refresh() {
    const current = ++revision;
    allowed = false;
    setBusy(true);
    restore.hidden = true;
    savedDirectory = null;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_MANAGER_EXTENSION_FEATURES',
        refresh: true,
      });
      if (current !== revision) return;
      // Every signed-in Manager saves this folder: Generation needs it too, not only Apply.
      if (response?.ok !== true) {
        report(response?.error || 'Sign in as a Manager to choose this folder.', 'denied');
        return;
      }
      if (!embedded && typeof window.showDirectoryPicker !== 'function') {
        report('This Chrome version does not support choosing a PDF folder. Update Chrome and retry.', 'error');
        return;
      }
      allowed = true;
      await showSavedFolder(current);
    } catch (error) {
      if (current === revision) report(error.message || 'Could not check the Apply PDF folder.', 'error');
    } finally {
      if (current === revision) setBusy(false);
    }
  }

  button.addEventListener('click', async () => {
    if (!allowed || busy) return;
    if (embedded) {
      setBusy(true);
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'QTS_OPEN_APPLY_PDF_FOLDER_PICKER',
        });
        if (response?.ok !== true) throw new Error(response?.error || 'Could not open the folder chooser.');
        report('The secure folder chooser opened in a small QTS window.', 'ready');
      } catch (error) {
        report(error.message || 'Could not open the folder chooser.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    const current = revision;
    try {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
      if (directory.name !== 'QTS_Resume') {
        throw new Error('Choose the QTS_Resume folder inside Downloads.');
      }
      let permission = await directory.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') permission = await directory.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('Read and write access was not granted. Choose the folder again and allow it.');
      const response = await chrome.runtime.sendMessage({
        type: 'GET_MANAGER_EXTENSION_FEATURES',
        refresh: true,
      });
      if (current !== revision) return;
      if (response?.ok !== true) {
        allowed = false;
        throw new Error(response?.error || 'Sign in as a Manager to save this folder.');
      }
      await store.putSetting(key, directory);
      window.dispatchEvent(new Event('qts-pdf-folder-updated'));
      await showSavedFolder(current);
    } catch (error) {
      if (current === revision && error.name !== 'AbortError') report(error.message || 'Could not save this folder.', 'error');
    } finally {
      if (current === revision) setBusy(false);
    }
  });

  restore.addEventListener('click', async () => {
    if (embedded) return;
    if (!allowed || busy || !savedDirectory) return;
    setBusy(true);
    const current = revision;
    try {
      const permission = await savedDirectory.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('Read and write access was not granted. Choose the folder again to retry.');
      await showSavedFolder(current);
      window.dispatchEvent(new Event('qts-pdf-folder-updated'));
    } catch (error) {
      if (current === revision) report(error.message || 'Could not restore folder access.', 'error');
    } finally {
      if (current === revision) setBusy(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.authExpiresAt || changes.qtsSessionUser)) refresh();
  });
  // Closing Windows' folder dialog gives this window focus back. A re-check then would start a new
  // revision and silently drop the folder just chosen, so none runs while a choice is in progress.
  window.addEventListener('focus', () => { if (!busy) refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !busy) refresh();
  });
  refresh();
})();
