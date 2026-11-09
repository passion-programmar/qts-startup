import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

type TestWindow = { saved: Record<string, string>[]; failNext: boolean };

const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);
const action = "async(_state,data)=>{window.saved.push(Object.fromEntries(data));if(window.failNext){window.failNext=false;return{error:'Could not save.',success:null};}return{error:null,success:'Saved.'};}";

test("each Manager switch sends its opposite value, and Apply-dependent ones wait for Apply", { skip: !chrome, timeout: 60000 }, async () => {
  const mocks: Record<string, string> = {
    "@/app/settings/actions": ["updateManagerApplyAction", "updateManagerChatGptUrlAction", "updateManagerGeminiMatchingAction", "updateManagerJobDetectionUrlAccessAction", "updateManagerPageExclusionAccessAction", "updateManagerTextHighlightAccessAction"]
      .map((name) => `export const ${name}=${action};`).join(""),
    "@/app/settings/prompt-forms": "import {createElement} from 'react';export const ActionFeedback=({state})=>state.error||state.success?createElement('p',{role:'alert'},state.error||state.success):null;",
  };
  const result = await build({
    absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"), bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
      import {ManagerChatGptUrlCell,ManagerSettingSwitch} from './src/app/settings/manager-settings';
      window.saved=[];window.failNext=false;
      const base={managerId:'m1',managerName:'Ann'};
      createRoot(document.getElementById('root')).render(h('div',null,
        h(ManagerSettingSwitch,{...base,setting:'apply',on:false}),
        h(ManagerSettingSwitch,{...base,setting:'aiMode',on:false}),
        h(ManagerSettingSwitch,{...base,setting:'reviewMode',on:true}),
        h(ManagerSettingSwitch,{...base,setting:'autoApplyApi',on:false,disabledReason:'Turn Apply on first'}),
        h(ManagerChatGptUrlCell,{...base,chatGptUrl:'https://chatgpt.com/'}),
      ));` },
    plugins: [{ name: "fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture", } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.waitForSelector('[role="switch"]');
    const saved = () => page.evaluate(() => (window as unknown as TestWindow).saved);
    const click = async (label: string, count: number) => {
      await page.click(`[aria-label^="${label}"]`);
      await page.waitForFunction((want) => (window as unknown as TestWindow).saved.length === want, {}, count);
    };

    await click("Apply for Ann", 1);
    assert.deepEqual((await saved())[0], { managerId: "m1", enabled: "true" });
    await click("Answer AI for Ann", 2);
    assert.deepEqual((await saved())[1], { managerId: "m1", aiMode: "gemini" });
    await click("Review for Ann", 3);
    assert.deepEqual((await saved())[2], { managerId: "m1", reviewMode: "every_step" });

    const waiting = await page.$eval('[aria-label^="Auto Apply with APIs for Ann"]', (node) => ({ disabled: (node as HTMLButtonElement).disabled, title: node.getAttribute("title") }));
    assert.deepEqual(waiting, { disabled: true, title: "Turn Apply on first" });

    // A switch stays one line unless saving failed.
    assert.equal(await page.$('[role="alert"]'), null);
    await page.evaluate(() => { (window as unknown as TestWindow).failNext = true; });
    await click("Apply for Ann", 4);
    await page.waitForSelector('[role="alert"]');
    assert.match(await page.$eval('[role="alert"]', (node) => node.textContent ?? ""), /Could not save/);

    const url = "https://chatgpt.com/g/g-p-test";
    await page.$eval('input[name="chatGptUrl"]', (node) => { (node as HTMLInputElement).value = ""; });
    await page.type('input[name="chatGptUrl"]', url);
    await page.click('[aria-label="Save ChatGPT URL for Ann"]');
    await page.waitForFunction((want) => (window as unknown as TestWindow).saved.length === want, {}, 5);
    assert.deepEqual((await saved())[4], { managerId: "m1", chatGptUrl: url });
  } finally { await browser.close(); }
});
