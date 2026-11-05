const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));

test('highlights an already-open job page after sign-in and fetches rules when the local cache is empty', {skip:!CHROME,timeout:60000}, async()=>{
  const browser=await require('puppeteer-core').launch({executablePath:CHROME,headless:true,pipe:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<main><p>Python engineering experience.</p></main>');
    await page.evaluate(()=>{
      window.authExpiresAt=0;
      window.rules=[];
      window.globalRuleRequests=0;
      window.listeners={storage:new Set(),message:new Set()};
      const events=key=>({addListener:fn=>window.listeners[key].add(fn),removeListener:fn=>window.listeners[key].delete(fn)});
      window.chrome={runtime:{id:'synthetic',onMessage:events('message'),sendMessage:async message=>{
        if(message.type==='QTS_IS_JOB_PAGE')return {jobPage:true};
        if(message.type==='GET_GLOBAL_TEXT_HIGHLIGHTS'){
          window.globalRuleRequests++;
          window.rules=[{id:'python',text:'Python',textColor:'#112233',backgroundColor:'#ffff00'}];
          for(const listener of window.listeners.storage)listener({qtsGlobalTextHighlightsCache:{newValue:window.rules}},'local');
          return {success:true,rules:window.rules};
        }
        return {success:true};
      }},storage:{
        onChanged:events('storage'),
        local:{get:async()=>({authExpiresAt:window.authExpiresAt,qtsGlobalTextHighlightsCache:window.rules})},
      }};
    });
    await page.addScriptTag({path:path.resolve('extension/shared/text-highlighting.js')});
    await page.addScriptTag({path:path.resolve('extension/content/text-highlighter.js')});
    await page.waitForFunction(()=>Boolean(window.__qtsPageTextHighlighter));
    assert.equal(await page.evaluate(()=>window.globalRuleRequests),0,'signed-out page does not load shared rules');
    await page.evaluate(()=>{
      window.authExpiresAt=Date.now()+3600000;
      for(const listener of window.listeners.storage)listener({authExpiresAt:{newValue:window.authExpiresAt}},'local');
    });
    await page.waitForFunction(()=>document.querySelector('mark[data-qts-text-highlight="python"]'));
    assert.equal(await page.evaluate(()=>window.globalRuleRequests),1);
    assert.equal(await page.evaluate(()=>document.querySelector('mark[data-qts-text-highlight="python"]').style.backgroundColor),'rgb(255, 255, 0)');
  }finally{await browser.close();}
});

test('highlighter marks job-page text, skips editable content, watches additions and applies rule updates', {skip:!CHROME,timeout:60000}, async()=>{
  const browser=await require('puppeteer-core').launch({executablePath:CHROME,headless:true,pipe:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<main><p>Python services and testing.</p><input value="Python"><div contenteditable="true">Python</div></main>');
    await page.evaluate(()=>{
      window.listeners={storage:new Set(),message:new Set()};
      window.rules=[
        {id:'python',text:'Python',textColor:'#112233',backgroundColor:'#ffff00'},
        {id:'test',text:'testing',textColor:'#ffffff',backgroundColor:'#008800'},
      ];
      const events=key=>({addListener:fn=>window.listeners[key].add(fn),removeListener:fn=>window.listeners[key].delete(fn)});
      window.chrome={runtime:{id:'synthetic',onMessage:events('message'),sendMessage:async message=>message.type==='QTS_IS_JOB_PAGE'?{jobPage:true}:{success:true}},storage:{
        onChanged:events('storage'),
        local:{get:async()=>({authExpiresAt:Date.now()+3600000,qtsGlobalTextHighlightsCache:window.rules})},
      }};
    });
    await page.addScriptTag({path:path.resolve('extension/shared/text-highlighting.js')});
    await page.addScriptTag({path:path.resolve('extension/content/text-highlighter.js')});
    await page.waitForFunction(()=>document.querySelectorAll('mark[data-qts-text-highlight]').length===2);
    const initial=await page.evaluate(()=>({
      marks:[...document.querySelectorAll('mark[data-qts-text-highlight]')].map(mark=>({
        id:mark.dataset.qtsTextHighlight,text:mark.textContent,color:mark.style.color,background:mark.style.backgroundColor,
      })),
      input:document.querySelector('input').value,
      editable:document.querySelector('[contenteditable]').textContent,
      text:document.querySelector('main').textContent,
    }));
    assert.deepEqual(initial.marks,[
      {id:'python',text:'Python',color:'rgb(17, 34, 51)',background:'rgb(255, 255, 0)'},
      {id:'test',text:'testing',color:'rgb(255, 255, 255)',background:'rgb(0, 136, 0)'},
    ]);
    assert.equal(initial.input,'Python');
    assert.equal(initial.editable,'Python');
    assert.match(initial.text,/Python services and testing\./);

    await page.evaluate(()=>{
      const paragraph=document.createElement('p');
      paragraph.textContent='Python added dynamically.';
      document.querySelector('main').append(paragraph);
    });
    await page.waitForFunction(()=>document.querySelectorAll('mark[data-qts-text-highlight="python"]').length===2);
    await page.evaluate(()=>{
      const key=window.__qtsTextHighlighting.getGlobalStorageKey();
      window.rules=[
        {id:'dynamic',text:'dynamically',textColor:'#000000',backgroundColor:'#00ffff'},
      ];
      for(const listener of window.listeners.storage)listener({[key]:{newValue:window.rules}},'local');
    });
    await page.waitForFunction(()=>document.querySelector('mark[data-qts-text-highlight="dynamic"]')?.textContent==='dynamically');
    assert.equal(await page.evaluate(()=>document.querySelectorAll('mark[data-qts-text-highlight="python"],mark[data-qts-text-highlight="test"]').length),0);
    assert.equal(await page.evaluate(()=>document.querySelector('main').textContent.includes('Python added dynamically.')),true);
    await browser.close();
  }finally{await browser.close();}
});

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
