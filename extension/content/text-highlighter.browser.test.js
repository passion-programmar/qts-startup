const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));

test('highlighter cleans up invalidated contexts and still reports real failures', {skip:!CHROME,timeout:60000}, async()=>{
  const browser=await require('puppeteer-core').launch({executablePath:CHROME,headless:true,pipe:true});
  try{
    for(const mode of ['missing-id','rejected-api','real-failure']){
      const page=await browser.newPage(), errors=[];
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
      page.on('pageerror',error=>errors.push(error.message));
      await page.setContent('<main><p>Python services and testing.</p></main>');
      await page.addScriptTag({path:path.resolve('extension/shared/text-highlighting.js')});
      await page.evaluate(()=>{
        window.reads=0;window.fail='';window.listeners={storage:new Set(),message:new Set()};
        const events=key=>({addListener:fn=>window.listeners[key].add(fn),removeListener:fn=>window.listeners[key].delete(fn)});
        window.chrome={runtime:{id:'synthetic',onMessage:events('message'),sendMessage:async message=>message.type==='QTS_IS_JOB_PAGE'?{jobPage:true}:{success:true}},storage:{onChanged:events('storage'),local:{get:async()=>{
          window.reads++;if(window.fail)throw Error(window.fail);
          return {authExpiresAt:Date.now()+3600000,[window.__qtsTextHighlighting.getGlobalStorageKey()]:[{id:'rule',text:'Python',textColor:'#112233',backgroundColor:'#ffff00'}]};
        }}}};
      });
      await page.addScriptTag({path:path.resolve('extension/content/text-highlighter.js')});
      await page.waitForSelector('mark[data-qts-text-highlight]');
      await page.evaluate(mode=>{
        document.querySelector('main').append(Object.assign(document.createElement('p'),{textContent:'Python added later.'}));
        if(mode==='missing-id')window.chrome.runtime.id=undefined;
        else window.fail=mode==='rejected-api'?'Extension context invalidated.':'Local storage unavailable';
        document.dispatchEvent(new Event('visibilitychange'));
      },mode);
      await new Promise(r=>setTimeout(r,700));
      if(mode==='real-failure'){
        assert.ok(errors.some(e=>e.includes('Local storage unavailable')),'unexpected storage errors remain visible');
      }else{
        assert.deepEqual(errors,[]);
        const state=await page.evaluate(async()=>{
          const reads=window.reads;window.dispatchEvent(new Event('popstate'));window.dispatchEvent(new Event('hashchange'));
          await window.__qtsPageTextHighlighter.refresh();
          return {reads,after:window.reads,marks:document.querySelectorAll('mark[data-qts-text-highlight]').length,
            storage:window.listeners.storage.size,message:window.listeners.message.size,text:document.querySelector('main').textContent};
        });
        assert.equal(state.after,state.reads);assert.equal(state.marks,0);
        assert.equal(state.storage,0);assert.equal(state.message,0);assert.match(state.text,/Python services/);
      }
      await page.close();
    }
  }finally{await browser.close();}
});
