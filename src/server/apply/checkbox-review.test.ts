import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);
test("checkbox proposal editor displays state, submits explicit false and preserves text answers", { skip: !chrome, timeout: 60000 }, async () => {
  const mocks: Record<string, string> = {
    "@/app/settings/actions": `export const saveReusableAnswerAction=async()=>({error:null,success:null});export const deleteReusableAnswerAction=saveReusableAnswerAction;export const dismissQuestionSuggestionAction=saveReusableAnswerAction;export const restoreReusableAnswerVersionAction=saveReusableAnswerAction;export const reviewReusableAnswerAction=saveReusableAnswerAction;`,
    "@/app/settings/prompt-forms": "export const ActionFeedback=()=>null;",
  };
  const result = await build({ absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    stdin: { resolveDir: process.cwd(), contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReusableAnswerForm} from './src/app/settings/reusable-answers';const root=createRoot(document.getElementById('root'));window.renderAnswer=answer=>root.render(React.createElement(ReusableAnswerForm,{key:answer,answer:{id:'test',questionText:'Include supplementary material?',answer,note:''},review:{isPending:false,action:data=>{window.saved=Object.fromEntries(data);}}}));`, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "local-form-actions", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path] }));
    } }],
  });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.evaluate(() => (window as unknown as {renderAnswer:(answer:string)=>void}).renderAnswer("Ticked"));
    await page.waitForSelector('input[type="checkbox"]');
    assert.equal(await page.$eval('input[type="checkbox"]', node => (node as HTMLInputElement).checked), true);
    assert.equal(await page.$eval('input[name="answer"]', node => (node as HTMLInputElement).value), "true");
    assert.match(await page.$eval("#root", node => node.textContent), /Checked/);
    await page.click('input[type="checkbox"]');
    assert.equal(await page.$eval('input[name="answer"]', node => (node as HTMLInputElement).value), "false");
    await page.click('button[value="approve"]');
    await page.waitForFunction(() => Boolean((window as unknown as {saved:unknown}).saved));
    assert.equal(await page.evaluate(() => (window as unknown as {saved:{answer:string}}).saved.answer), "false");
    await page.evaluate(() => (window as unknown as {renderAnswer:(answer:string)=>void}).renderAnswer("Not ticked"));
    await page.waitForFunction(() => document.querySelector('input[name="answer"]')?.getAttribute("value") === "false");
    assert.equal(await page.$eval('input[type="checkbox"]', node => (node as HTMLInputElement).checked), false);
    assert.match(await page.$eval("#root", node => node.textContent), /Unchecked/);
    await page.evaluate(() => (window as unknown as {renderAnswer:(answer:string)=>void}).renderAnswer("LinkedIn"));
    await page.waitForSelector('textarea[name="answer"]');
    assert.equal(await page.$eval('textarea[name="answer"]', node => (node as HTMLTextAreaElement).value), "LinkedIn");
    assert.equal(await page.$('input[type="checkbox"]'), null);
  } finally { await browser.close(); }
});
