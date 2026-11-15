import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

type TestWindow = { deletedIds: string[][] };
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);

test("Jobs tick boxes: one, a Shift range, all on the page, and Delete selected sends exactly the ticked jobs", { skip: !chrome, timeout: 60000 }, async () => {
  const mocks: Record<string, string> = {
    "@/app/jobs/actions": "export const deleteJobsAction=async(_state,data)=>{window.deletedIds.push(data.getAll('ids'));return{error:null,success:'Deleted '+data.getAll('ids').length+' jobs.'};};",
  };
  const result = await build({
    absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"), bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
      import {JobSelectionProvider,SelectAllJobsCheckbox,SelectedJobsBar,SelectJobCheckbox} from './src/app/jobs/job-selection';
      window.deletedIds=[];
      const row=(id)=>h('div',{key:id},h(SelectJobCheckbox,{jobId:id,title:'Job '+id}));
      createRoot(document.getElementById('root')).render(h(JobSelectionProvider,{selectableIds:['a','b','c','d']},
        h('div',{id:'all'},h(SelectAllJobsCheckbox)),
        h('div',{id:'bar'},h(SelectedJobsBar)),
        ['a','b','c','d'].map(row),
        h(SelectJobCheckbox,{jobId:'x',title:'Job x',disabledReason:'Making its résumé now'}),
      ));` },
    plugins: [{ name: "fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.waitForSelector('[aria-label="Select Job a"]');
    const ticked = () => page.$$eval('input[aria-label^="Select Job "]', (boxes) =>
      boxes.filter((box) => (box as HTMLInputElement).checked).map((box) => box.getAttribute("aria-label")!.slice(-1)));
    const allBox = () => page.$eval("#all input", (box) => ({ checked: (box as HTMLInputElement).checked, some: (box as HTMLInputElement).indeterminate }));
    const barText = () => page.$eval("#bar", (bar) => bar.textContent ?? "");

    // Nothing ticked: no bar.
    assert.equal(await barText(), "");
    assert.deepEqual(await allBox(), { checked: false, some: false });

    await page.click('[aria-label="Select Job a"]');
    assert.deepEqual(await ticked(), ["a"]);
    assert.match(await barText(), /1 selected/);
    assert.deepEqual(await allBox(), { checked: false, some: true });

    // Shift+click ticks every job between the last one clicked and this one.
    await page.keyboard.down("Shift");
    await page.click('[aria-label="Select Job c"]');
    await page.keyboard.up("Shift");
    assert.deepEqual(await ticked(), ["a", "b", "c"]);
    assert.match(await barText(), /3 selected/);

    // The heading box ticks every job that can be deleted, then clears them.
    await page.click("#all input");
    assert.deepEqual(await ticked(), ["a", "b", "c", "d"]);
    assert.deepEqual(await allBox(), { checked: true, some: false });
    await page.click("#all input");
    assert.deepEqual(await ticked(), []);

    // A job still making its résumé cannot be ticked.
    assert.equal(await page.$eval('input[aria-label^="Job x"]', (box) => (box as HTMLInputElement).disabled), true);

    // Delete selected asks first, then sends exactly the ticked jobs.
    await page.click('[aria-label="Select Job b"]');
    await page.click('[aria-label="Select Job d"]');
    await page.click("#bar button:not([type='hidden'])[class*='bg-danger']");
    await page.waitForSelector("dialog[open]");
    assert.match(await page.$eval("dialog[open]", (dialog) => dialog.textContent ?? ""), /Delete 2 selected jobs\?/);
    assert.deepEqual(await page.evaluate(() => (window as unknown as TestWindow).deletedIds), [], "nothing is sent before confirming");
    await page.$$eval("dialog[open] button", (buttons) => (buttons.find((button) => button.textContent === "Delete 2 jobs") as HTMLButtonElement).click());
    await page.waitForFunction(() => (window as unknown as TestWindow).deletedIds.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as unknown as TestWindow).deletedIds), [["b", "d"]]);

    // Clear unticks everything; the result of the delete then shows.
    await page.$$eval("#bar button", (buttons) => (buttons.find((button) => button.textContent === "Clear") as HTMLButtonElement).click());
    await page.waitForFunction(() => /Deleted 2 jobs\./.test(document.querySelector("#bar")?.textContent ?? ""));
  } finally { await browser.close(); }
});
