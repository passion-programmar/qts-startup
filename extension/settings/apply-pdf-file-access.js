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
  const showPicker = (config) => {
    // A picker warning is irrelevant to direct reads, but legacy relinking still needs a handle.
    folderPicker.hidden = Boolean(config) && !/(?:^|[?&])attemptId=/.test(globalThis.location?.search || '');
  };
  const manager = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_MANAGER_EXTENSION_FEATURES', refresh: true });
    if (!response?.ok || response.canUseApply !== true) throw new Error(response?.error || 'Sign in as a Manager with Apply access, then reopen this page.');
  };

  async function refresh() {
    const current = ++revision;
    allowed = false; controls();
    try {
      await manager();
      if (current !== revision) return;
      allowed = true;
      const stored = await store.getSetting(api.SETTING_KEY);
      const granted = await api.permissionGranted();
      if (current !== revision) return;
      input.value = stored?.value?.rootPath || '';
      showPicker(stored?.value);
      if (stored?.value) {
        api.configuration(stored.value.rootPath);
        report(granted ? `Configured: ${stored.value.rootPath}. You can close settings and use Apply or Auto Apply.` : 'Local PDF access needs permission. Open chrome://extensions → QTS → Details and enable Allow access to file URLs. Your folder path is saved.', granted ? 'ready' : 'revoked');
      } else report('Folder-picker mode is active. To use PDFs with settings closed, enable Allow access to file URLs, enter the full QTS_Resume path above, and Save local PDF access.', 'unconfigured');
    } catch (error) { if (current === revision) report(error.message || 'Could not check local PDF access.', allowed ? 'error' : 'denied'); }
    finally { if (current === revision) controls(); }
  }

  async function write(useFileAccess) {
    if (!allowed || busy) return;
    const current = revision;
    busy = true; controls();
    try {
      const config = useFileAccess ? api.configuration(input.value) : null;
      if (useFileAccess && !await api.permissionGranted()) throw new Error('Enable Allow access to file URLs in chrome://extensions → QTS → Details, then save again.');
      await manager();
      if (current !== revision) return;
      await store.putSetting(api.SETTING_KEY, config);
      if (current !== revision) return;
      showPicker(config);
      window.dispatchEvent(new Event('qts-pdf-folder-updated'));
      report(config ? `Configured: ${config.rootPath}. You can close settings. If Apply is paused, return to the job and choose Retry autofill.` : 'Folder-picker mode is active. Your saved folder handle is unchanged. Check the folder permission below before Apply.', config ? 'ready' : 'unconfigured');
    } catch (error) { if (current === revision) report(error.message || 'Could not save local PDF access.', 'error'); }
    finally { busy = false; controls(); }
  }

  save.addEventListener('click', () => write(true));
  picker.addEventListener('click', () => write(false));
  window.addEventListener('focus', () => { if (!busy) refresh(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.authExpiresAt || changes.qtsSessionUser)) refresh();
  });
  refresh();
})();
