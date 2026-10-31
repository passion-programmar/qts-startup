// Real extension worker; mock claims are always empty. No ChatGPT, database or application submission.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
const scope={candidateId:'11111111-1111-4111-8111-111111111111',jobIds:['22222222-2222-4222-8222-222222222222']};
test('real worker passes exact account/job scope to Generation and Auto Apply claims', {skip:!CHROME,timeout:90000}, async()=>{
  const calls=[];
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;calls.push({url:req.url,body});
    let reply={success:true,features:{canUseApply:true},rules:[],exclusions:[]};
    if(req.url.startsWith('/api/extension/work-items'))reply={success:true,accounts:[{id:scope.candidateId,name:'Jordan Taylor'}]};
    if(req.url==='/api/extension/generation/claim')reply={success:true,job:null};
    if(req.url==='/api/extension/apply/claim')reply={success:true,application:null};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const wait=async check=>{const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Scoped claim was not observed');};
  try{
    for(const mode of ['generation','auto_apply']){
      const browser=await require('puppeteer-core').launch({executablePath:CHROME,headless:true,pipe:true,enableExtensions:[path.resolve('extension')],args:['--no-first-run']});
      try{
        const worker=await(await browser.waitForTarget(t=>t.type()==='service_worker')).worker();
        await worker.evaluate(async base=>chrome.storage.local.set({qtsServerUrl:base,authToken:'synthetic',authExpiresAt:Date.now()+3600000,qtsSessionUser:{id:'manager',role:'manager'},qtsGetJdOn:false}),base);
        const control=await browser.newPage();await control.goto('chrome-extension://'+new URL(worker.url()).host+'/signin/signin.html');
        const ask=message=>control.evaluate(m=>chrome.runtime.sendMessage(m),message);
        const accounts=await ask({type:'QTS_WORK_ITEMS',mode});assert.equal(accounts.ok,true,JSON.stringify(accounts));assert.equal(accounts.accounts[0].id,scope.candidateId);
        const before=calls.length;
        assert.equal((await ask({type:'QTS_PAGE_ACTION',action:mode,selection:{candidateId:scope.candidateId,jobIds:[]}})).ok,false);
        assert.equal(calls.slice(before).some(c=>c.url.endsWith('/claim')),false);
        assert.equal((await ask({type:'QTS_PAGE_ACTION',action:mode,selection:scope})).ok,true);
        const endpoint=mode==='generation'?'/api/extension/generation/claim':'/api/extension/apply/claim';
        await wait(()=>calls.slice(before).some(c=>c.url===endpoint));
        assert.deepEqual(calls.slice(before).find(c=>c.url===endpoint).body.selection,{mode,...scope});
        assert.equal(calls.some(c=>/generation\/start|apply\/start-job|apply\/submitted/.test(c.url)),false);
      }finally{await browser.close();}
    }
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
