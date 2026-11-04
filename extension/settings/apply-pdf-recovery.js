(function initializePdfRecovery() {
  const attemptId = new URL(location.href).searchParams.get('attemptId');
  if (!attemptId) return;
  const get = (id) => document.getElementById(id);
  const section = get('recovery'), fields = get('recovery-fields'), status = get('recovery-status');
  const resume = get('resume-file'), cover = get('cover-file'), confirm = get('confirm-originals'), save = get('save-links');
  const api = globalThis.__qtsApplyPdfRelink;
  let context = null, reviewed = null, revision = 0, busy = false, root = null, saved = false;
  const previews = [];
  const message = (action, input) => chrome.runtime.sendMessage({ type: 'QTS_APPLY_PDF_RECOVERY', action, attemptId, ...(input ? { input } : {}) });
  const report = (text) => { status.textContent = text; };
  section.hidden = false;

  function clearReview() {
    reviewed = null;
    confirm.checked = false;
    confirm.disabled = true;
    save.disabled = true;
    get('selected-files').textContent = '';
    for (const url of previews.splice(0)) URL.revokeObjectURL(url);
    for (const id of ['preview-resume', 'preview-cover']) { get(id).hidden = true; get(id).removeAttribute('href'); }
  }
  function invalidate(text) {
    ++revision;
    clearReview();
    fields.disabled = true;
    report(text);
  }
  async function requireOwner() {
    const reply = await message('check');
    if (!reply?.ok) throw new Error(reply?.error || 'This Chrome no longer owns the application. Reopen normal Apply.');
  }
  async function requireRoot() {
    const stored = await globalThis.__qtsScannerDocumentStore.getSetting(globalThis.__qtsApplyLocalPdfs.SETTING_KEY);
    const directory = stored?.value;
    if (!directory || await directory.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('Read access is unavailable. Choose Downloads folder again, then Reload recovery.');
    return directory;
  }
  async function reload() {
    if (busy) return;
    const current = ++revision;
    clearReview(); fields.disabled = true; saved = false; context = null;
    get('reload-recovery').disabled = true;
    try {
      const reply = await message('context');
      if (!reply?.ok || !reply.recovery) throw new Error(reply?.error || 'This job is not available for relinking.');
      const next = reply.recovery;
      const parent = api.parent(next.resumePath);
      if (next.attemptId !== attemptId || next.coverLetterPath) throw new Error('The saved paths changed. Reopen recovery from normal Apply.');
      root = await requireRoot();
      const names = await api.list(root, next);
      if (current !== revision) return;
      context = next;
      get('recovery-details').textContent = `Job: ${next.jobId}\nCandidate: ${next.candidateName}\n${next.title} — ${next.company}\nGeneration: ${next.generationId}\nFolder: ${parent}\nSaved résumé: ${next.resumePath}\nSaved cover letter: ${next.coverLetterPath || '(missing)'}`;
      for (const [select, label] of [[resume, 'Select the original résumé PDF'], [cover, 'Select the original cover-letter PDF']]) {
        select.replaceChildren(new Option(label, ''), ...names.map((name) => new Option(name, name)));
        select.value = '';
      }
      fields.disabled = false;
      report(names.length ? 'Choose both original PDFs. Nothing is selected automatically.' : 'No PDFs were found in the recorded folder. Restore the originals; QTS will not search another folder or generate replacements.');
    } catch (error) { if (current === revision) invalidate(error.message); }
    finally { get('reload-recovery').disabled = false; }
  }
  async function selectFiles() {
    const current = ++revision;
    clearReview();
    if (!context || !resume.value || !cover.value || busy || saved) return;
    const names = [resume.value, cover.value];
    try {
      await requireOwner();
      const files = await api.read(root, context, ...names);
      if (current !== revision) return;
      reviewed = files;
      for (const [i, id] of ['preview-resume', 'preview-cover'].entries()) {
        const url = URL.createObjectURL(new Blob([files[i].file], { type: 'application/pdf' }));
        previews.push(url); get(id).href = url; get(id).hidden = false;
      }
      get('selected-files').textContent = files.map((file) => `${api.parent(context.resumePath)}/${file.name} (${file.size} bytes)`).join('\n');
      confirm.disabled = false;
      report('Review both original PDFs and confirm their candidate and job before saving.');
    } catch (error) { if (current === revision) invalidate(`${error.message} Reload recovery after fixing the cause.`); }
  }
  resume.addEventListener('change', selectFiles);
  cover.addEventListener('change', selectFiles);
  confirm.addEventListener('change', () => { save.disabled = !confirm.checked || !reviewed || busy || saved; });
  get('reload-recovery').addEventListener('click', reload);
  save.addEventListener('click', async () => {
    if (busy || saved || !confirm.checked || !reviewed || !context) return;
    busy = true; fields.disabled = true; save.disabled = true;
    const current = revision, selected = reviewed;
    try {
      await requireOwner();
      const directory = await requireRoot();
      if (!(await directory.isSameEntry(root))) throw new Error('The Downloads folder changed. Reload recovery and review again.');
      const fresh = await api.read(directory, context, resume.value, cover.value);
      if (current !== revision) return;
      if (fresh.some((file, i) => file.digest !== selected[i].digest || file.size !== selected[i].size || file.name !== selected[i].name)) {
        throw new Error('A selected PDF changed after review. Reload recovery and review both originals again.');
      }
      const reply = await message('save', {
        attemptId, generationId: context.generationId, expectedResumePath: context.resumePath,
        expectedCoverLetterPath: context.coverLetterPath,
        resumePath: `${api.parent(context.resumePath)}/${fresh[0].name}`,
        coverLetterPath: `${api.parent(context.resumePath)}/${fresh[1].name}`,
      });
      if (current !== revision) return;
      if (!reply?.ok) {
        if (reply?.status === 409) invalidate(reply.error);
        else report(reply?.error || 'Save was not confirmed. Keep Apply paused. Retry the identical selection or reload recovery.');
        return;
      }
      saved = true;
      report('PDF links saved. Apply is still paused. Return to the application and choose Retry autofill when ready.');
    } catch (error) { if (current === revision) invalidate(error.message); }
    finally {
      busy = false;
      fields.disabled = saved || !reviewed;
      save.disabled = saved || !reviewed || !confirm.checked;
    }
  });
  window.addEventListener('qts-pdf-folder-updated', () => invalidate('Folder authorization changed. Reload recovery and review both original PDFs again.'));
  window.addEventListener('focus', async () => {
    if (busy || saved) return;
    try { await requireOwner(); await requireRoot(); } catch (error) { invalidate(error.message); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.authExpiresAt || changes.qtsSessionUser)) invalidate('The QTS session changed. Reopen recovery from your application panel.');
  });
  reload();
})();
