// Apply PDFs folder, set up: only what works and Reset. Set up means the Apply PDFs can be read:
// the chosen QTS_Resume folder (Chrome's access), or the saved path with file URLs on. Reset forgets
// both, and the setup steps show again. Not set up: the setup steps (the other scripts) as before.
(function initializeApplyPdfFolderReady() {
  const store = globalThis.__qtsScannerDocumentStore;
  const pickerKey = globalThis.__qtsApplyLocalPdfs.SETTING_KEY;
  const fileApi = globalThis.__qtsApplyFileAccess;
  const embedded = window.top !== window;
  const ready = document.getElementById('ready-view');
  const setup = document.getElementById('setup-view');
  const pathLine = document.getElementById('ready-path');
  const lines = document.getElementById('ready-lines');
  const reset = document.getElementById('reset-folder');
  let revision = 0;

  const line = (text, on) => {
    const item = document.createElement('li');
    item.textContent = text;
    if (!on) item.className = 'off';
    return item;
  };

  async function refresh() {
    const current = ++revision;
    let chosen = null, filePath = '', fileOn = false, access = null;
    try {
      const [picked, typed] = await Promise.all([store.getSetting(pickerKey), store.getSetting(fileApi.SETTING_KEY)]);
      chosen = picked?.value || null;
      filePath = typed?.value?.rootPath || '';
      fileOn = Boolean(filePath) && await fileApi.permissionGranted().catch(() => false);
      // Inside the launcher Chrome does not tell a page in a frame; there the chosen folder counts.
      access = chosen && !embedded ? await chosen.queryPermission({ mode: 'readwrite' }).catch(() => null) : null;
    } catch {
      // Unreadable settings: the setup steps show, as before.
    }
    if (current !== revision) return;
    const folderOk = Boolean(chosen) && (embedded || access === 'granted');
    const isReady = folderOk || fileOn;
    ready.hidden = !isReady;
    setup.hidden = isReady;
    if (!isReady) return;
    pathLine.textContent = filePath || (chosen ? `Downloads › ${chosen.name}` : '');
    lines.replaceChildren(
      line('Generation saves and Apply uploads résumés here', true),
      line(folderOk ? 'Removing a job deletes its résumés here' : 'Removing a job does not delete résumés (Reset, then choose the folder and Allow)', folderOk),
      line(fileOn ? 'Keeps working after Chrome restarts' : 'Chrome may ask to allow the folder again after a restart', fileOn),
    );
  }

  // Two clicks (a page inside the launcher cannot always show Chrome's own confirm box).
  let armed = null;
  reset.addEventListener('click', async () => {
    if (!armed) {
      reset.textContent = 'Sure? Reset';
      reset.title = 'Forget the résumé folder in this Chrome: Generation and Apply wait until it is set up again.';
      armed = setTimeout(() => { armed = null; reset.textContent = 'Reset'; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    reset.disabled = true;
    try {
      await Promise.all([store.putSetting(pickerKey, null), store.putSetting(fileApi.SETTING_KEY, null)]);
      window.dispatchEvent(new Event('qts-pdf-folder-updated'));
    } finally {
      // The setup steps start fresh.
      window.location.reload();
    }
  });

  window.addEventListener('qts-pdf-folder-updated', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  refresh();
})();
