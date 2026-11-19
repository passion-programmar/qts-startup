(function initializeFileAccessSettings() {
  const input = document.getElementById('file-folder-path');
  const save = document.getElementById('save-file-access');
  const picker = document.getElementById('use-picker-access');
  const status = document.getElementById('file-access-status');
  const folderPicker = document.getElementById('folder-picker-settings');
  const api = globalThis.__qtsApplyFileAccess;
  const store = globalThis.__qtsScannerDocumentStore;
  let revision = 0, allowed = false, busy = false;
  const report = (text, state) => { status.textContent = text; status.dataset.state = state; };
  const controls = () => { input.disabled = save.disabled = picker.disabled = !allowed || busy; };
  // Step 1 (the chosen folder) always shows: removing a job deletes its PDFs only through it.
  const showPicker = () => { if (folderPicker) folderPicker.hidden = false; };
  // Every signed-in Manager saves the QTS_Resume path: Generation needs it too, not only Apply.
  const manager = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_MANAGER_EXTENSION_FEATURES', refresh: true });
    if (!response?.ok) throw new Error(response?.error || 'Sign in as a Manager, then reopen this page.');
  };

  // File URLs on and no path saved yet: QTS finds QTS_Resume from this Chrome's QTS downloads and
  // saves it, so the Manager never types or saves it. Nothing found: the path box opens to type it.
  async function autoConfigure(current) {
    const root = await globalThis.__qtsApplyPdfPathDetect?.detectRoot?.().catch(() => null);
    if (current !== revision) return false;
    if (!root) return false;
    input.value = root;
    await store.putSetting(api.SETTING_KEY, api.configuration(root));
    window.dispatchEvent(new Event('qts-pdf-folder-updated'));
    return true;
  }

  async function refresh() {
    const current = ++revision;
    allowed = false; controls();
    try {
      await manager();
      if (current !== revision) return;
      allowed = true;
      let stored = await store.getSetting(api.SETTING_KEY);
      const granted = await api.permissionGranted();
      if (current !== revision) return;
      if (!stored?.value && granted && await autoConfigure(current)) stored = await store.getSetting(api.SETTING_KEY);
      if (current !== revision) return;
      input.value = stored?.value?.rootPath || input.value || '';
      showPicker();
      if (stored?.value) {
        api.configuration(stored.value.rootPath);
        report(granted
          ? `On: uploads keep working after restarts, from ${stored.value.rootPath}.`
          : 'Off: turn on Allow access to file URLs in Chrome\'s QTS settings. The folder path is saved.', granted ? 'ready' : 'revoked');
      } else if (granted) {
        report('File URLs are on, but QTS found no résumé downloaded in this Chrome yet. Open Folder path and type the full QTS_Resume path.', 'unconfigured');
      } else {
        report('Off. Step 1 is enough to work; turn this on so uploads also work after Chrome restarts.', 'unconfigured');
      }
    } catch (error) { if (current === revision) report(error.message || 'Could not check local PDF access.', allowed ? 'error' : 'denied'); }
    finally { if (current === revision) controls(); }
  }

  async function write(useFileAccess) {
    if (!allowed || busy) return;
    const current = revision;
    busy = true; controls();
    try {
      const config = useFileAccess ? api.configuration(input.value) : null;
      if (useFileAccess && !await api.permissionGranted()) throw new Error('Turn on Allow access to file URLs in Chrome\'s QTS settings, then save again.');
      await manager();
      if (current !== revision) return;
      await store.putSetting(api.SETTING_KEY, config);
      if (current !== revision) return;
      showPicker();
      window.dispatchEvent(new Event('qts-pdf-folder-updated'));
      report(config
        ? `On: uploads keep working after restarts, from ${config.rootPath}. If Apply is paused, return to the job and choose Retry autofill.`
        : 'Off: QTS uses only the folder chosen in step 1.', config ? 'ready' : 'unconfigured');
    } catch (error) { if (current === revision) report(error.message || 'Could not save local PDF access.', 'error'); }
    finally { busy = false; controls(); }
  }

  save.addEventListener('click', () => write(true));
  picker.addEventListener('click', () => write(false));
  // Coming back from Chrome's settings (or the folder chooser) re-checks, and saves the path by itself.
  window.addEventListener('focus', () => { if (!busy) refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.authExpiresAt || changes.qtsSessionUser)) refresh();
  });
  refresh();
})();
