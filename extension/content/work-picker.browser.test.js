// Real Chrome UI, synthetic accounts/jobs, mocked extension messages. Never starts a real workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
test('account job pickers show compact links, full URL tooltips, independent selections and fail closed', { skip: !chromePath, timeout: 60000 }, async () => {
  const browser = await require('puppeteer-core').launch({ executablePath: chromePath, headless: true, pipe: true });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1100, height: 900 });
    await page.setContent('<h1>Synthetic job page</h1>');
    await page.evaluate(() => {
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); if(this.hasAttribute('data-qts-page-launcher')) window.testRoot = root; return root; };
      window.calls = []; window.store = { authToken: 'synthetic', authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'manager', role: 'manager' } };
      window.chrome = { runtime: { id: 'local-fixture', getURL: p => 'https://extension.test/' + p, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async message => {
        window.calls.push(message);
        if(message.type === 'QTS_GET_LAUNCHER_STATE') return { active: true };
        if(message.type === 'CHECK_EXTENSION_PAGE_ALLOWED') return { ok: true, excluded: false };
        if(message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, features: {} };
        if(message.action === 'cancel_status' && window.failCancellation) return { ok: false, error: 'Local cancellation failure. Retry.' };
        if(message.action === 'cancel_status') { window.store.qtsExtensionStatus = 'cancel'; return { ok: true }; }
        if(message.type === 'QTS_WORK_ITEMS') {
          if(!message.candidateId) return { ok: true, accounts: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Jordan Taylor' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Casey Smith' }] };
          if(message.candidateId.startsWith('2222') && !window.allowSecondAccount) return { ok: false, error: 'Local loading failure. Retry.' };
          return { ok: true, jobs: [{id:'33333333-3333-4333-8333-333333333333',title:'Machine Learning Engineer III',company:'Mapbox',url:'https://www.remoterocketship.com/publicjobs/company/mapbox/jobs/machine-learning-engineer-iii-routing-cost-poland-remote/?tracking=complete'},
            {id:'44444444-4444-4444-8444-444444444444',title:'Senior DevOps Engineer',company:'Example',url:'https://djinni.co/jobs/838846-senior-devops-engineer-contractor/'}] };
        }
        return { ok: true };
      } }, storage: { local: { get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, window.store[k]])), set: async values => Object.assign(window.store, values) }, onChanged: { addListener() {}, removeListener() {} } } };
    });
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    await page.addScriptTag({ path: path.resolve('extension/content/page-launcher.js') });
    await page.waitForFunction(() => Boolean(window.__qtsPageLauncher));
    await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
    await page.waitForFunction(() => getComputedStyle(document.body).paddingRight === '384px');
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('.menu').getBoundingClientRect().width), 384, 'launcher width is four fifths of 480px');
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('.menu').scrollWidth <= window.testRoot.querySelector('.menu').clientWidth), true, 'narrower panel has no horizontal overflow');
    assert.equal(await page.evaluate(() => window.calls.filter(m=>m.type==='QTS_WORK_ITEMS').length), 0, 'passive initialization does not fetch accounts');
    await page.evaluate(() => window.testRoot.querySelector('[data-work-account="generation"]').focus());
    await page.waitForFunction(() => window.testRoot.querySelector('[data-work-account="generation"]').options.length === 3);
    await page.evaluate(() => { const s=window.testRoot.querySelector('[data-work-account="generation"]'); s.value=s.options[1].value; s.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.testRoot.querySelectorAll('[data-work-picker="generation"] .work-job').length===2);
    const link = await page.evaluate(() => { const a=window.testRoot.querySelector('.work-link'); return {text:a.textContent,title:a.title,href:a.href,target:a.target,rel:a.rel,heading:a.querySelector('.work-title').title,domain:a.querySelector('.work-domain').title}; });
    assert.match(link.text,/remoterocketship\.com/); assert.doesNotMatch(link.text,/publicjobs|tracking=/);
    assert.equal(link.title,link.href); assert.equal(link.heading,link.href); assert.equal(link.domain,link.href);
    assert.equal(link.target,'_blank'); assert.match(link.rel,/noopener/);
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="generation"] .work-job input').click());
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="generation"] .work-start').click());
    await page.waitForFunction(() => window.calls.some(m=>m.type==='QTS_PAGE_ACTION' && m.action==='generation'));
    const started = await page.evaluate(() => window.calls.find(m=>m.type==='QTS_PAGE_ACTION' && m.action==='generation'));
    assert.deepEqual(started.selection,{candidateId:'11111111-1111-4111-8111-111111111111',jobIds:['44444444-4444-4444-8444-444444444444']});
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-work-account="auto_apply"]').value),'');
    await page.evaluate(() => { const s=window.testRoot.querySelector('[data-work-account="auto_apply"]');s.value=s.options[1].value;s.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.testRoot.querySelectorAll('[data-work-picker="auto_apply"] .work-job').length===2);
    fs.mkdirSync('.pdf-verification',{recursive:true}); await page.screenshot({path:'.pdf-verification/work-picker-preview.png'});
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="auto_apply"] .work-start').click());
    await page.waitForFunction(() => window.calls.some(m=>m.type==='QTS_PAGE_ACTION' && m.action==='auto_apply'));
    assert.equal(await page.evaluate(() => window.calls.find(m=>m.action==='auto_apply').selection.jobIds.length),2);
    await page.evaluate(() => { const s=window.testRoot.querySelector('[data-work-account="auto_apply"]');s.value=s.options[2].value;s.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.testRoot.querySelector('[data-work-picker="auto_apply"] .error'));
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="auto_apply"] .work-start').disabled),true);
    assert.equal(await page.evaluate(() => window.testRoot.querySelectorAll('[data-work-picker="auto_apply"] .work-job').length),0);
    // An idle picker stays open without cancelling another mode.
    const cancelsBefore=await page.evaluate(()=>window.calls.filter(m=>m.action==='cancel_status').length);
    await page.evaluate(()=>{window.store.qtsExtensionStatus='generation';window.store.qtsApplyKind=null;});
    await page.evaluate(()=>window.testRoot.querySelector('[data-work-picker="auto_apply"] .work-cancel').click());
    await page.waitForFunction(()=>!window.testRoot.querySelector('[data-work-picker="auto_apply"] .work-cancel').disabled);
    assert.equal(await page.evaluate(()=>window.testRoot.querySelector('[data-work-picker="auto_apply"]').hidden),false);
    assert.equal(await page.evaluate(()=>window.calls.filter(m=>m.action==='cancel_status').length),cancelsBefore);
    // Both running modes use the existing stop action, with an expected-mode guard.
    for(const mode of ['generation','auto_apply']){
      await page.evaluate(async mode=>{
        const s=window.testRoot.querySelector(`[data-work-account="${mode}"]`);s.value=s.options[1].value;s.dispatchEvent(new Event('change'));
        window.store.qtsExtensionStatus=mode==='generation'?'generation':'apply';window.store.qtsApplyKind=mode==='auto_apply'?'auto':null;
        window.store.qtsAutoApplyState=mode==='auto_apply'?{runs:[{phase:'needs_you',step:1}]}:null;
        await window.__qtsPageLauncher.syncModeActions();
      },mode);
      assert.equal(await page.evaluate(mode=>{
        const button=window.testRoot.querySelector(`[data-action="${mode}"]`), tag=button.querySelector('.action-tag');
        return tag.getBoundingClientRect().right <= button.getBoundingClientRect().right;
      },mode),true,'running status stays inside the narrower action button');
      await page.waitForFunction(mode=>window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job`).length===2,{},mode);
      await page.evaluate(mode=>{
        const style=document.createElement('style');style.textContent='.work-jobs { max-height:36px !important; }';window.testRoot.append(style);
        window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-jobs`).scrollTop=20;
      },mode);
      await page.evaluate(mode=>{window.failCancellation=true;window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-cancel`).click();},mode);
      await page.waitForFunction(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .error`)?.textContent.includes('cancellation failure'),{},mode);
      assert.notEqual(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-account="${mode}"]`).value,mode),'','failed cancellation retains selection');
      await page.evaluate(()=>{window.failCancellation=false;});
      const before=await page.evaluate(()=>window.calls.filter(m=>m.action==='cancel_status').length);
      const selectedBefore=await page.evaluate(mode=>[...window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job input:checked`)].map(n=>n.dataset.jobId),mode);
      const requestsBefore=await page.evaluate(()=>window.calls.filter(m=>m.type==='QTS_WORK_ITEMS').length);
      await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-cancel`).click(),mode);
      await page.waitForFunction(mode=>!window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-cancel`).disabled,{},mode);
      const calls=await page.evaluate(()=>window.calls.filter(m=>m.action==='cancel_status'));
      assert.equal(calls.length,before+1);assert.equal(calls.at(-1).expectedAction,mode);
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"]`).hidden,mode),false,'Cancel keeps the job list open');
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-account="${mode}"]`).value,mode),'11111111-1111-4111-8111-111111111111');
      assert.deepEqual(await page.evaluate(mode=>[...window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job input:checked`)].map(n=>n.dataset.jobId),mode),selectedBefore,'Cancel preserves checked jobs');
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-jobs`).scrollTop,mode),20,'Cancel preserves the list scroll position');
      assert.equal(await page.evaluate(()=>window.calls.filter(m=>m.type==='QTS_WORK_ITEMS').length),requestsBefore,'Cancel does not refetch or clear the list');
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-account="${mode}"]`).disabled,mode),false,'another account can be chosen while cancellation finishes');
      await page.evaluate(mode=>{
        window.allowSecondAccount=true;
        const s=window.testRoot.querySelector(`[data-work-account="${mode}"]`);s.value=s.options[2].value;s.dispatchEvent(new Event('change'));
      },mode);
      await page.waitForFunction(mode=>window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job`).length===2,{},mode);
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-start`).disabled,mode),true,'starting waits for old run cleanup');
      await page.evaluate(async()=>{window.store.qtsExtensionStatus=null;await window.__qtsPageLauncher.syncModeActions();});
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-start`).disabled,mode),false,'new selection can start after cleanup');
    }
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
