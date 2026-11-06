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
      window.calls = []; window.accountResolvers = {}; window.accountListResponses = {}; window.accountFetchCounts = {}; window.clockOffset = 0;
      window.logs = []; window.failStatusRead = false; window.failDailyCounts = false;
      const originalWarn = console.warn.bind(console);
      console.warn = (...args) => { window.logs.push(args.map(String).join(' ')); originalWarn(...args); };
      window.realNow = Date.now.bind(Date); Date.now = () => window.realNow() + window.clockOffset;
      window.store = { authToken: 'synthetic', authExpiresAt: Date.now() + 3600000, qtsSessionUser: { id: 'manager', role: 'manager' } };
      window.chrome = { runtime: { id: 'local-fixture', getURL: p => 'https://extension.test/' + p, onMessage: { addListener() {}, removeListener() {} }, sendMessage: async message => {
        window.calls.push(message);
        if(message.type === 'QTS_GET_LAUNCHER_STATE') return { active: true };
        if(message.type === 'CHECK_EXTENSION_PAGE_ALLOWED') return { ok: true, excluded: false };
        if(message.type === 'GET_MANAGER_EXTENSION_FEATURES') return { ok: true, features: {} };
        if(message.type === 'QTS_DAILY_COUNTS' && window.failDailyCounts) return { ok: false, error: 'Synthetic count refresh failure.' };
        if(message.type === 'QTS_DAILY_COUNTS') return { ok: true, urls: 1, jobs: 2, applied: 3 };
        if(message.action === 'cancel_status' && window.failCancellation) return { ok: false, error: 'Local cancellation failure. Retry.' };
        if(message.action === 'cancel_status') { window.store.qtsExtensionStatus = 'cancel'; return { ok: true }; }
        if(message.type === 'QTS_WORK_ITEMS') {
          if(!message.candidateId) return new Promise(resolve => {
            window.accountFetchCounts[message.mode] = (window.accountFetchCounts[message.mode] || 0) + 1;
            window.accountResolvers[message.mode] = () => resolve({ ok: true, accounts: [
              { id: '11111111-1111-4111-8111-111111111111', categoryName: 'Engineering', name: 'Jordan Taylor', category: 'Platform', categoryColor: '#2563eb', counts: window.nextCounts || { generation: 8, apply: 2, auto_apply: 2 } },
              { id: '22222222-2222-4222-8222-222222222222', name: 'Casey Smith', category: '', counts: { generation: 3, apply: 0, auto_apply: 1 } },
              { id: '33333333-3333-4333-8333-333333333333', name: 'Morgan Lee', category: 'Design', counts: { generation: 0, apply: 0, auto_apply: 0 } },
            ] });
          });
          if(message.candidateId.startsWith('2222') && !window.allowSecondAccount) return { ok: false, error: 'Local loading failure. Retry.' };
          if(message.mode === 'auto_apply') return { ok: true, jobs: [
            {id:'33333333-3333-4333-8333-333333333333',title:'Machine Learning Engineer III',company:'Mapbox',url:'https://example.test/held',busy:true,selectable:false},
            {id:'44444444-4444-4444-8444-444444444444',title:'Senior DevOps Engineer',company:'Example',url:'https://example.test/ready',customUrl:true,busy:false,selectable:true},
          ] };
          return { ok: true, jobs: [{id:'33333333-3333-4333-8333-333333333333',title:'Machine Learning Engineer III',company:'Mapbox',url:'https://www.remoterocketship.com/publicjobs/company/mapbox/jobs/machine-learning-engineer-iii-routing-cost-poland-remote/?tracking=complete'},
            {id:'44444444-4444-4444-8444-444444444444',title:'Senior DevOps Engineer',company:'Example',url:'https://djinni.co/jobs/838846-senior-devops-engineer-contractor/',customUrl:message.mode==='apply'}] };
        }
        return { ok: true };
      } }, storage: { local: {
        get: async keys => {
          const requested = Array.isArray(keys) ? keys : [keys];
          if (window.failStatusRead && requested.includes('qtsExtensionStatus')) throw new Error('Synthetic status storage failure.');
          return Object.fromEntries(requested.map(k => [k, window.store[k]]));
        },
        set: async values => Object.assign(window.store, values),
      }, onChanged: {
        addListener: listener => { window.storageChangeListener = listener; },
        removeListener() {},
      } } };
    });
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    await page.addScriptTag({ path: path.resolve('extension/content/page-launcher.js') });
    await page.waitForFunction(() => Boolean(window.__qtsPageLauncher));
    await page.evaluate(() => window.__qtsPageLauncher.setOpen(true));
    await page.waitForFunction(() => getComputedStyle(document.body).paddingRight === '384px');
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('.menu').getBoundingClientRect().width), 384, 'launcher width is four fifths of 480px');
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('.menu').scrollWidth <= window.testRoot.querySelector('.menu').clientWidth), true, 'narrower panel has no horizontal overflow');
    assert.equal(await page.evaluate(() => window.calls.filter(m=>m.type==='QTS_WORK_ITEMS').length), 0, 'passive initialization does not fetch accounts');
    const C = '[data-work-candidate]';
    const ONE = '11111111-1111-4111-8111-111111111111';
    const readyTexts = () => page.evaluate(() => ['generation', 'apply', 'auto_apply'].map(mode => window.testRoot.querySelector(`[data-action="${mode}"] .ready`).textContent));
    const choose = (index, allow = false) => page.evaluate((C, index, allow) => { window.allowSecondAccount = allow; const s = window.testRoot.querySelector(C); s.value = s.options[index].value; s.dispatchEvent(new Event('change')); }, C, index, allow);
    const openJobs = mode => page.evaluate(mode => window.testRoot.querySelector(`[data-work-toggle="${mode}"]`).click(), mode);
    await page.evaluate(C => window.testRoot.querySelector(C).focus(), C);
    assert.equal(await page.evaluate(C => window.testRoot.querySelector(C).options[0].textContent, C), 'Loading accounts…');
    await page.evaluate(() => window.accountResolvers.all());
    await page.waitForFunction(C => window.testRoot.querySelector(C).options.length === 4, {}, C);
    assert.deepEqual(await page.evaluate(C => [...window.testRoot.querySelector(C).options].map(o => [o.textContent, o.disabled]), C), [
      ['All accounts', false],
      ['Engineering · Jordan Taylor · Platform', false],
      ['Casey Smith', false],
      ['Morgan Lee · Design — nothing ready', true],
    ], 'one list: Category · Name · Label, accounts with nothing ready are disabled');
    assert.equal(await page.evaluate(() => window.calls.filter(m => m.type === 'QTS_WORK_ITEMS').map(m => m.mode).join()), 'all', 'one account request for all three modes');
    assert.deepEqual(await readyTexts(), ['11 ready', '2 ready', '3 ready'], 'All accounts shows the totals');
    assert.match(await page.evaluate(() => window.testRoot.querySelector('.candidate-summary').textContent), /Every account: 11 to generate · 2 to apply · 3 for Auto Apply/);
    assert.equal(await page.evaluate(() => [...window.testRoot.querySelectorAll('.work-jobs-toggle')].every(n => n.hidden)), true, 'no job lists for All accounts');
    await choose(1);
    assert.deepEqual(await page.evaluate(C => {
      const select = window.testRoot.querySelector(C);
      return { selectBackground: select.style.backgroundColor, selectColor: select.style.color, accent: select.style.borderLeftColor, labelled: select.classList.contains('labelled'), stored: window.store.qtsWorkCandidate };
    }, C), { selectBackground: '', selectColor: '', accent: 'rgb(37, 99, 235)', labelled: true, stored: ONE });
    assert.deepEqual(await readyTexts(), ['8 ready', '2 ready', '2 ready']);
    assert.equal(await page.evaluate(() => window.calls.filter(m => m.type === 'QTS_WORK_ITEMS' && m.candidateId).length), 0, 'job lists load only when needed');
    await openJobs('generation');
    await page.waitForFunction(() => window.testRoot.querySelectorAll('[data-work-picker="generation"] .work-job').length === 2);
    const accountFetches = await page.evaluate(() => window.accountFetchCounts.all);
    await page.evaluate(C => {
      window.nextCounts = { generation: 6, apply: 2, auto_apply: 2 };
      window.clockOffset = 31000;
      const select = window.testRoot.querySelector(C);
      select.blur(); select.focus();
    }, C);
    await page.waitForFunction(C => window.testRoot.querySelector(C).options[0].textContent === 'Loading accounts…', {}, C);
    await page.evaluate(C => { const select = window.testRoot.querySelector(C); select.blur(); select.focus(); }, C);
    assert.equal(await page.evaluate(() => window.accountFetchCounts.all), accountFetches + 1, 'expired cache triggers one coalesced refresh');
    await page.evaluate(() => window.accountResolvers.all());
    await page.waitForFunction(() => window.testRoot.querySelector('[data-action="generation"] .ready').textContent === '6 ready');
    assert.equal(await page.evaluate(C => window.testRoot.querySelector(C).value, C), ONE, 'refresh preserves a still-eligible account');
    assert.equal(await page.evaluate(() => window.testRoot.querySelectorAll('[data-work-picker="generation"] .work-job').length), 2, 'refresh keeps the open job list');
    await page.evaluate(() => { window.clockOffset = 0; });
    const link = await page.evaluate(() => { const a=window.testRoot.querySelector('.work-link'); return {text:a.textContent,title:a.title,href:a.href,target:a.target,rel:a.rel,heading:a.querySelector('.work-title').title,domain:a.querySelector('.work-domain').title}; });
    assert.match(link.text,/remoterocketship\.com/); assert.doesNotMatch(link.text,/publicjobs|tracking=/);
    assert.equal(link.title,link.href); assert.equal(link.heading,link.href); assert.equal(link.domain,link.href);
    assert.equal(link.target,'_blank'); assert.match(link.rel,/noopener/);
    const requestsBeforeSearch = await page.evaluate(() => window.calls.length);
    for (const [query, title] of [['machine learning', 'Machine Learning Engineer III'], ['DJINNI.CO/jobs', 'Senior DevOps Engineer'], ['MAPBOX', 'Machine Learning Engineer III']]) {
      await page.evaluate(query => { const input = window.testRoot.querySelector('[data-work-picker="generation"] .work-search'); input.value = query; input.dispatchEvent(new Event('input')); }, query);
      assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-work-picker="generation"] .work-title')].map(node => node.textContent)), [title]);
      assert.match(await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="generation"]').textContent), /2 selected/);
    }
    await page.evaluate(() => { const input = window.testRoot.querySelector('[data-work-picker="generation"] .work-search'); input.value = 'no matches'; input.dispatchEvent(new Event('input')); });
    assert.match(await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="generation"]').textContent), /No jobs match/);
    await page.evaluate(() => { const input = window.testRoot.querySelector('[data-work-picker="generation"] .work-search'); input.value = ''; input.dispatchEvent(new Event('input')); });
    assert.equal(await page.evaluate(() => window.calls.length), requestsBeforeSearch, 'filtering makes no server requests');
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="generation"] .work-job input').click());
    assert.match(await page.evaluate(() => window.testRoot.querySelector('[data-work-toggle="generation"]').textContent), /Choose jobs \(1 of 2\)/);
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="generation"] .work-start').click());
    await page.waitForFunction(() => window.calls.some(m=>m.type==='QTS_PAGE_ACTION' && m.action==='generation'));
    const started = await page.evaluate(() => window.calls.find(m=>m.type==='QTS_PAGE_ACTION' && m.action==='generation'));
    assert.deepEqual(started.selection,{candidateId:ONE,jobIds:['44444444-4444-4444-8444-444444444444']});
    // Custom URL jobs start unchecked in Apply; checking one is the explicit opt-in.
    await openJobs('apply');
    await page.waitForFunction(() => window.testRoot.querySelectorAll('[data-work-picker="apply"] .work-job').length === 2);
    assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-work-picker="apply"] .work-job input')].map(input => input.checked)), [true, false]);
    assert.match(await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="apply"]').textContent), /Custom URL · off by default/);
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="apply"] .work-job input[data-job-id="44444444-4444-4444-8444-444444444444"]').click());
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="apply"] .work-start').click());
    await page.waitForFunction(() => window.calls.some(m=>m.type==='QTS_PAGE_ACTION' && m.action==='apply'));
    assert.deepEqual(await page.evaluate(() => window.calls.find(m=>m.action==='apply').selection), { candidateId: ONE, jobIds: ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'] });
    assert.equal(await page.evaluate(() => window.calls.find(m=>m.type==='QTS_WORK_ITEMS' && m.mode==='apply').candidateId), ONE);
    await openJobs('auto_apply');
    await page.waitForFunction(() => window.testRoot.querySelectorAll('[data-work-picker="auto_apply"] .work-job').length===2);
    assert.deepEqual(await page.evaluate(() => [...window.testRoot.querySelectorAll('[data-work-picker="auto_apply"] .work-job input')].map(input => ({ checked: input.checked, disabled: input.disabled }))), [
      { checked: false, disabled: true }, { checked: false, disabled: false },
    ]);
    assert.match(await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="auto_apply"]').textContent), /In progress · unavailable/);
    assert.match(await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="auto_apply"]').textContent), /Custom URL · off by default/);
    fs.mkdirSync('.pdf-verification',{recursive:true}); await page.screenshot({path:'.pdf-verification/work-picker-preview.png'});
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="auto_apply"] .work-job input[data-job-id="44444444-4444-4444-8444-444444444444"]').click());
    await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="auto_apply"] .work-start').click());
    await page.waitForFunction(() => window.calls.some(m=>m.type==='QTS_PAGE_ACTION' && m.action==='auto_apply'));
    assert.deepEqual(await page.evaluate(() => window.calls.find(m=>m.action==='auto_apply').selection.jobIds), ['44444444-4444-4444-8444-444444444444']);
    // Another candidate resets every mode's list; a failed load fails closed.
    await choose(2);
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="generation"]').hidden), true, 'changing candidate closes the old lists');
    assert.equal(await page.evaluate(() => window.testRoot.querySelector('[data-work-toggle="apply"]').hidden), true, 'nothing to apply for this candidate');
    await openJobs('auto_apply');
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
    assert.equal(await page.evaluate(C=>window.testRoot.querySelector(C).disabled,C),true,'the candidate is fixed while a run uses it');
    await page.evaluate(async()=>{window.store.qtsExtensionStatus=null;await window.__qtsPageLauncher.syncModeActions();});
    // Running modes use the existing stop action, with an expected-mode guard.
    for(const mode of ['generation','auto_apply']){
      await choose(1);
      await openJobs(mode);
      await page.evaluate(async mode=>{
        window.store.qtsExtensionStatus=mode==='generation'?'generation':'apply';window.store.qtsApplyKind=mode==='auto_apply'?'auto':null;
        window.store.qtsAutoApplyState=mode==='auto_apply'?{runs:[{phase:'needs_you',step:1}]}:null;
        await window.__qtsPageLauncher.syncModeActions();
      },mode);
      assert.equal(await page.evaluate(mode=>{
        const button=window.testRoot.querySelector(`[data-action="${mode}"]`), tag=button.querySelector('.action-tag');
        return tag.getBoundingClientRect().right <= button.getBoundingClientRect().right;
      },mode),true,'running status stays inside the action button');
      await page.waitForFunction(mode=>window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job`).length===2,{},mode);
      await page.evaluate(mode=>{
        const style=document.createElement('style');style.textContent='.work-jobs { max-height:36px !important; }';window.testRoot.append(style);
        window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-jobs`).scrollTop=20;
      },mode);
      await page.evaluate(mode=>{window.failCancellation=true;window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-cancel`).click();},mode);
      await page.waitForFunction(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .error`)?.textContent.includes('cancellation failure'),{},mode);
      assert.equal(await page.evaluate(C=>window.testRoot.querySelector(C).value,C),ONE,'failed cancellation retains the candidate');
      await page.evaluate(()=>{window.failCancellation=false;});
      const before=await page.evaluate(()=>window.calls.filter(m=>m.action==='cancel_status').length);
      const selectedBefore=await page.evaluate(mode=>[...window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job input:checked`)].map(n=>n.dataset.jobId),mode);
      const requestsBefore=await page.evaluate(()=>window.calls.filter(m=>m.type==='QTS_WORK_ITEMS').length);
      await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-cancel`).click(),mode);
      await page.waitForFunction(mode=>!window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-cancel`).disabled,{},mode);
      const calls=await page.evaluate(()=>window.calls.filter(m=>m.action==='cancel_status'));
      assert.equal(calls.length,before+1);assert.equal(calls.at(-1).expectedAction,mode);
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"]`).hidden,mode),false,'Cancel keeps the job list open');
      assert.equal(await page.evaluate(C=>window.testRoot.querySelector(C).value,C),ONE);
      assert.deepEqual(await page.evaluate(mode=>[...window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job input:checked`)].map(n=>n.dataset.jobId),mode),selectedBefore,'Cancel preserves checked jobs');
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-jobs`).scrollTop,mode),20,'Cancel preserves the list scroll position');
      assert.equal(await page.evaluate(()=>window.calls.filter(m=>m.type==='QTS_WORK_ITEMS').length),requestsBefore,'Cancel does not refetch or clear the list');
      assert.equal(await page.evaluate(C=>window.testRoot.querySelector(C).disabled,C),false,'another candidate can be chosen while cancellation finishes');
      await choose(2, true);
      await openJobs(mode);
      await page.waitForFunction(mode=>window.testRoot.querySelectorAll(`[data-work-picker="${mode}"] .work-job`).length===2,{},mode);
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-start`).disabled,mode),true,'starting waits for old run cleanup');
      await page.evaluate(async()=>{window.store.qtsExtensionStatus=null;await window.__qtsPageLauncher.syncModeActions();});
      if (mode === 'auto_apply') {
        await page.evaluate(() => window.testRoot.querySelector('[data-work-picker="auto_apply"] .work-job input[data-job-id="44444444-4444-4444-8444-444444444444"]').click());
      }
      assert.equal(await page.evaluate(mode=>window.testRoot.querySelector(`[data-work-picker="${mode}"] .work-start`).disabled,mode),false,'new selection can start after cleanup');
    }
    for (const mode of ['generation', 'apply', 'auto_apply']) {
      await page.evaluate(async mode => {
        window.store.qtsExtensionStatus = mode === 'generation' ? 'generation' : 'apply';
        window.store.qtsApplyKind = mode === 'auto_apply' ? 'auto' : null;
        await window.__qtsPageLauncher.syncModeActions();
        window.testRoot.querySelector(`[data-action="${mode}"]`).click();
      }, mode);
      await page.waitForFunction(mode => window.calls.some(message =>
        message.type === 'QTS_PAGE_ACTION' && message.action === 'cancel_status' && message.expectedAction === mode,
      ), {}, mode);
      await page.evaluate(async () => {
        window.store.qtsExtensionStatus = null;
        window.store.qtsApplyKind = null;
        await window.__qtsPageLauncher.syncModeActions();
      });
    }
    await page.evaluate(() => {
      window.failStatusRead = true;
      window.storageChangeListener({ qtsExtensionStatus: { newValue: 'generation' } }, 'local');
    });
    await page.waitForFunction(() => window.logs.some(message => message.includes('Could not refresh workflow status')));
    await page.evaluate(() => {
      window.failStatusRead = false;
      window.failDailyCounts = true;
      window.__qtsPageLauncher.setOpen(false);
      window.testRoot.querySelector('.main').click();
    });
    await page.waitForFunction(() => window.logs.some(message => message.includes('Could not refresh daily counts')));
    await page.evaluate(() => { window.failDailyCounts = false; });
    const dailyCountRequestsBefore = await page.evaluate(() => window.calls.filter(message => message.type === 'QTS_DAILY_COUNTS').length);
    await page.evaluate(() => {
      window.__qtsPageLauncher.setOpen(false);
      window.testRoot.querySelector('.main').click();
    });
    await page.waitForFunction(previous => window.calls.filter(message => message.type === 'QTS_DAILY_COUNTS').length > previous, {}, dailyCountRequestsBefore);
    const firstOpenCountRequests = await page.evaluate(() => window.calls.filter(message => message.type === 'QTS_DAILY_COUNTS').length);
    assert.equal(firstOpenCountRequests, dailyCountRequestsBefore + 1, 'opening refreshes daily counts once');
    await page.evaluate(() => {
      window.__qtsPageLauncher.setOpen(false);
      window.testRoot.querySelector('.main').click();
    });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await page.evaluate(() => window.calls.filter(message => message.type === 'QTS_DAILY_COUNTS').length), firstOpenCountRequests, 'rapid reopen stays within the five-second refresh limit');
    await page.evaluate(() => window.__qtsPageLauncher.setOpen(false));
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await page.evaluate(() => window.calls.filter(message => message.type === 'QTS_DAILY_COUNTS').length), firstOpenCountRequests, 'closing cancels a delayed count refresh');
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
