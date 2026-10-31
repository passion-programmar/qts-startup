// Real extension, local mock server, synthetic pages/accounts. No database or external AI calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');
const CHROME = [process.env.QTS_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome'].find((file) => file && fs.existsSync(file));
const until = async (label, check) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out: ${label}`);
};


const ID='11111111-1111-4111-8111-111111111111';
const ORIGINAL=['Responsibilities: Build Python services using FastAPI and PostgreSQL. Preserve deployment automation, testing, technical requirements and benefits.',
'Qualifications: Production engineering experience. Unicode locations: S\u00e3o Paulo and Wroc\u0142aw. Full-time remote work. Salary and employment conditions remain as written.',
'Technical detail repeated on purpose: preserve this complete source sentence without removal.',
'Technical detail repeated on purpose: preserve this complete source sentence without removal.'].join('\n\n');
const escapeHtml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
test('active launcher, new background tabs/reloads, one global precheck and original JD preservation', {skip:!CHROME,timeout:240000},async()=>{
  const requests=[];let mode='manual';const saved=new Set();
  const markup=(description=ORIGINAL)=>'<h1>Software Engineer</h1><span data-testid="company-name">Example</span><section data-testid="job-description">'+description.split('\n\n').map(p=>'<p>'+escapeHtml(p)+'</p>').join('')+'</section><a id="open-job" href="/jobs/ctrl-background">Open job</a>';
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{Location:'/jobs/redirect-final'});res.end();return;}
    if(!req.url.startsWith('/api/')){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      if(req.url.includes('/late'))res.end('<html><head><title>Software Engineer at Example</title></head><body><main><h1>Loading...</h1></main><script>setTimeout(()=>document.querySelector("main").innerHTML='+JSON.stringify(markup())+',1200)</script></body></html>');
      else res.end('<html><head><title>Software Engineer at Example</title><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'JobPosting',title:'Software Engineer',description:'Short metadata summary.',hiringOrganization:{name:'Example'}})+'</script></head><body><main>'+markup(req.url.includes('/oversized') ? 'Responsibilities: ' + 'x'.repeat(100001) : ORIGINAL)+'</main></body></html>');
      return;
    }
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
    requests.push({path:req.url,body});let result={success:true,managerId:'test-manager',rules:[],exclusions:[],features:{}};
    if(req.url==='/api/extension/get-jd/check'){
      if(body.scope!=='global')throw Error('Unexpected second/per-candidate precheck');
      if(body.job.jobUrl.includes('precheck-error')){res.statusCode=503;result={success:false,message:'Local precheck failure. Refresh to retry.'};}
      else result={success:true,skip:/duplicate-(jobs|bids)-(url|title)/.test(body.job.jobUrl)||saved.has(body.job.jobUrl),precheckToken:'local-fixture-ticket'};
    }else if(req.url==='/api/extension/get-jd/mode')result={success:true,mode};
    else if(req.url==='/api/extension/get-jd/profiles')result={success:true,profiles:[{id:ID,name:'Test Candidate'}]};
    else if(req.url==='/api/extension/get-jd/save')result={success:true,results:[{profileId:ID,status:'saved',jobId:'fixture-job'}],savedCount:1};
    else if(req.url==='/api/extension/get-jd'){
      saved.add(body.pageUrl);result={success:true,classification:{isJobPage:true,isRemote:true,matchingProfileIds:[ID],job:{title:'Software Engineer',company:'Example',description:body.originalDescription,jobUrl:body.pageUrl}},
      profiles:[{id:ID,name:'Test Candidate',state:'has_job',autoSaved:true,available:false}],autoSavedProfileIds:[ID],autoSavedJobs:[{profileId:ID,jobId:'fixture-job'}],autoSaveFailureCount:0,jobDescription:body.originalDescription};
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;let browser,worker;
  try{
    browser=await require('puppeteer-core').launch({executablePath:CHROME,headless:true,pipe:true,enableExtensions:[path.join(root,'extension')],args:['--no-first-run']});
    worker=await(await browser.waitForTarget(t=>t.type()==='service_worker')).worker();
    await worker.evaluate(async base=>chrome.storage.local.set({qtsServerUrl:base,authToken:'synthetic',authExpiresAt:Date.now()+3600000,qtsSessionUser:{id:'test-manager',role:'manager',displayName:'Test'},qtsGetJdOn:false,qtsGetJdAutoClose:false}),base);
    const pages=[];for(let i=0;i<5;i++){const page=await browser.newPage();await page.goto(base+'/jobs/old-'+i);pages.push(page);}
    const visible=page=>page.evaluate(()=>Boolean(document.querySelector('[data-qts-page-launcher]')));
    const tabId=page=>worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url)?.id,page.url());
    const ask=async(page,msg)=>worker.evaluate(async(id,msg)=>(await chrome.scripting.executeScript({target:{tabId:id},func:m=>chrome.runtime.sendMessage(m),args:[msg]}))[0].result,await tabId(page),msg);
    const prechecks=()=>requests.filter(r=>r.path==='/api/extension/get-jd/check');const gemini=()=>requests.filter(r=>r.path==='/api/extension/get-jd');
    const result=async id=>worker.evaluate(async id=>(await chrome.storage.local.get('qtsGetJdResults')).qtsGetJdResults?.[id],id);
    const uiRequestsBefore=requests.filter(r=>r.path!=='/api/extension/browsers/heartbeat').length;
    for(const index of [0,4,2,0]){await pages[index].bringToFront();await until('one launcher',async()=>{const states=await Promise.all(pages.map(visible));return states[index]&&states.filter(Boolean).length===1;});}
    assert.equal(requests.filter(r=>r.path!=='/api/extension/browsers/heartbeat').length,uiRequestsBefore,'launcher activation is cache-only and makes no server request');
    assert.equal((await ask(pages[0],{type:'QTS_PAGE_ACTION',action:'get_jd'})).ok,true);
    await pages[1].bringToFront();await pages[0].bringToFront();await new Promise(r=>setTimeout(r,500));assert.equal(prechecks().length,0);
    await pages[0].goto(base+'/jobs/ordinary');await pages[0].evaluate(()=>history.pushState({},'','/jobs/spa'));await new Promise(r=>setTimeout(r,800));assert.equal(prechecks().length,0,'ordinary and SPA navigations ignored');
    await pages[0].reload();await until('explicit old-tab refresh',()=>prechecks().length===1);
    await until('manual review ready',async()=>(await result(await tabId(pages[0])))?.status==='complete');
    assert.equal((await ask(pages[0],{type:'SAVE_GET_JD_SELECTION',profileIds:[ID]})).ok,true);
    assert.equal(requests.filter(r=>r.path==='/api/extension/get-jd/save').length,1,'Manual still requires explicit Save');
    mode='gemini';const before=prechecks().length;
    await pages[0].keyboard.down(process.platform==='darwin'?'Meta':'Control');await pages[0].click('#open-job');await pages[0].keyboard.up(process.platform==='darwin'?'Meta':'Control');
    await until('Ctrl-click background job evaluated',()=>gemini().length===1);
    assert.equal(prechecks().length,before+1);assert.equal(gemini()[0].body.originalDescription,ORIGINAL);
    assert.equal(gemini()[0].body.precheckToken,'local-fixture-ticket');
    const background=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),base+'/jobs/ctrl-background');
    assert.equal(background.active,false);assert.equal(await worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>Boolean(document.querySelector('[data-qts-page-launcher]'))}))[0].result,background.id),false);
    await until('background completion',async()=>(await result(background.id))?.status==='complete');
    assert.equal(await worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>typeof globalThis.__qtsInitializeGetJdReview}))[0].result,background.id),'undefined','normal Gemini background work does not initialize the candidate-review UI');
    const middleChecks=prechecks().length;await pages[0].click('#open-job',{button:'middle'});
    await until('middle-click background duplicate checked',()=>prechecks().length===middleChecks+1);assert.equal(gemini().length,1);
    for(const type of ['jobs-url','bids-url','jobs-title','bids-title','precheck-error']){
      const pathname=type==='precheck-error'?'/jobs/precheck-error':'/jobs/duplicate-'+type;const n=prechecks().length;
      const tab=await worker.evaluate(async url=>chrome.tabs.create({url,active:false}),base+pathname);
      await until('precheck '+type,()=>prechecks().length===n+1);await until('skip/error recorded',async()=>['duplicate','error'].includes((await result(tab.id))?.status));
      assert.equal(gemini().length,1,'duplicate/precheck failure must not reach Gemini');
      const loaded=await worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>typeof globalThis.__qtsReadOriginalJobDescription}))[0].result,tab.id);
      assert.equal(loaded,'undefined','full JD reader never loaded for skipped jobs');
    }
    const redirect=await worker.evaluate(async url=>chrome.tabs.create({url,active:false}),base+'/redirect');
    await until('redirect final document',()=>gemini().length===2);assert.equal(prechecks().at(-1).body.job.jobUrl,base+'/jobs/redirect-final');
    const late=await worker.evaluate(async url=>chrome.tabs.create({url,active:false}),base+'/jobs/late');
    await until('late-loaded posting',()=>gemini().length===3);assert.equal(gemini().at(-1).body.originalDescription,ORIGINAL);
    for(const bypassCache of [false,true]){const n=gemini().length,checksBefore=prechecks().length;await worker.evaluate(async(id,bypassCache)=>chrome.tabs.reload(id,{bypassCache}),await tabId(pages[1]),bypassCache);await until('old-tab normal/hard refresh precheck',()=>prechecks().length===checksBefore+1);await until('refresh done',async()=>['complete','duplicate'].includes((await result(await tabId(pages[1])))?.status));assert.ok(gemini().length<=n+1);}
    const beforeOverflow=gemini().length;
    const oversized=await worker.evaluate(async url=>chrome.tabs.create({url,active:false}),base+'/jobs/oversized');
    await until('oversized extraction error propagated from content script',async()=>/100,000-character limit/.test((await result(oversized.id))?.message || ''));
    assert.equal(gemini().length,beforeOverflow,'oversized original JD must never reach Gemini');
    const pending=prechecks().length;await worker.evaluate(async()=>chrome.storage.local.set({qtsGetJdOn:false}));
    await worker.evaluate(async url=>chrome.tabs.create({url,active:false}),base+'/jobs/off');await pages[1].reload();await new Promise(r=>setTimeout(r,800));assert.equal(prechecks().length,pending);
    // Observe current idle overhead without claiming a before/after performance improvement.
    const session=await pages[2].createCDPSession();await session.send('Performance.enable');const first=await session.send('Performance.getMetrics');const count=requests.length;
    await new Promise(r=>setTimeout(r,1000));const second=await session.send('Performance.getMetrics');const metrics=list=>Object.fromEntries(list.metrics.map(m=>[m.name,m.value]));const a=metrics(first),b=metrics(second);
    fs.mkdirSync(path.join(root,'.pdf-verification'),{recursive:true});fs.writeFileSync(path.join(root,'.pdf-verification/get-jd-resource-observation.json'),JSON.stringify({scope:'synthetic local Chrome idle background tab; no baseline comparison',sampleSeconds:1,taskDurationDeltaSeconds:b.TaskDuration-a.TaskDuration,jsHeapBefore:a.JSHeapUsedSize,jsHeapAfter:b.JSHeapUsedSize,requestDelta:requests.length-count,launcherMounted:await visible(pages[2])},null,2));
    assert.equal(requests.some(r=>r.path.includes('/generation/')||r.path.includes('/apply/')),false);
    assert.equal(await result(late.id).then(r=>r.jobDescription),ORIGINAL);
    assert.ok(await result(redirect.id),'concurrent tab results retained');
    // Strict text reader keeps duplicate lines and rejects overflow rather than truncating it.
    const reader=await browser.newPage();await reader.setContent('<main>'+markup('x'.repeat(100001))+'</main>');await reader.addScriptTag({path:path.join(root,'extension/shared/job-page-text.js')});
    assert.match(await reader.evaluate(()=>{try{return globalThis.__qtsReadOriginalJobDescription();}catch(e){return e.message;}}),/100,000-character limit/);
  }catch(error){console.error('Local Get JD request trace:',JSON.stringify(requests.map(r=>({path:r.path,url:r.body?.pageUrl||r.body?.job?.jobUrl}))));if(worker)console.error('Local results:',JSON.stringify(await worker.evaluate(async()=>chrome.storage.local.get(['qtsGetJdResults','qtsGetJdOn','qtsGetJdEnabledAt'])).catch(()=>null)));throw error;}
  finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
