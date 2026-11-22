import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);

// The details window of the Remote companies page, in a real browser, with the server action faked.
test("any cell opens the company's details with who applied; Escape and the backdrop close it", { skip: !chrome, timeout: 60000 }, async () => {
  const mocks: Record<string, string> = {
    "@/app/remote-companies/actions": `
      export async function readCompanyApplicationsAction(companyKey) {
        window.asked.push(companyKey);
        await new Promise((done) => setTimeout(done, 50));
        return { ok: true, applications: [
          { titleKey: 'senior devops engineer', candidate: 'Jane Doe', manager: null, own: true, appliedAt: '2026-11-20T10:00:00.000Z', place: 'Poland (Remote)' },
          { titleKey: 'senior devops engineer', candidate: null, manager: null, own: false, appliedAt: '2026-11-19T10:00:00.000Z', place: null },
        ] };
      }`,
  };
  const result = await build({
    absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"), bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
      import {CompanyDetails,OpenCompany} from './src/app/remote-companies/company-details';
      window.asked=[];
      const role=(titleKey,title,places,bids)=>({titleKey,title,places,jobs:1,bids,firstSeen:'2026-11-01T10:00:00.000Z',lastSeen:'2026-11-20T10:00:00.000Z'});
      const companies=[
        {companyKey:'n ix',company:'N-iX',roles:2,jobs:2,bids:3,lastSeen:'2026-11-20T10:00:00.000Z',items:[role('senior devops engineer','Senior DevOps Engineer',['Slovakia (Remote)','Poland (Remote)'],2),role('platform engineer','Platform Engineer',['Remote'],0)]},
        {companyKey:'acme',company:'Acme',roles:1,jobs:0,bids:1,lastSeen:'2026-11-10T10:00:00.000Z',items:[role('sre','SRE',['Remote'],1)]},
      ];
      createRoot(document.getElementById('root')).render(h(CompanyDetails,{companies,searching:false},
        h('table',null,h('tbody',null,companies.map((c,i)=>h('tr',{key:c.companyKey},
          h('td',null,h(OpenCompany,{index:i,label:'Open '+c.company},c.company)),
          h('td',null,h(OpenCompany,{index:i,label:'Open roles of '+c.company},String(c.roles))),
        )))),
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
    await page.waitForSelector('[aria-label="Open N-iX"]');
    const dialogText = () => page.$eval('[role="dialog"]', (node) => node.textContent ?? "");

    // The count cell opens the same details as the name.
    await page.click('[aria-label="Open roles of N-iX"]');
    await page.waitForSelector('[role="dialog"]');
    assert.match(await dialogText(), /N-iX/);
    assert.match(await dialogText(), /Loading who applied/);
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.textContent?.includes("Jane Doe"));
    const text = await dialogText();
    for (const part of ["Senior DevOps Engineer", "Slovakia (Remote)", "Poland (Remote)", "Applied by", "Jane Doe", "Another Manager's candidate", "Platform Engineer", "No application on record (saved only)."]) {
      assert.ok(text.includes(part), part);
    }
    assert.deepEqual(await page.evaluate(() => (window as unknown as { asked: string[] }).asked), ["n ix"]);

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));

    // Another company: its own details; a click on the dark backdrop closes it, a click inside does not.
    await page.click('[aria-label="Open Acme"]');
    await page.waitForFunction(() => document.querySelector('[role="dialog"] h2')?.textContent === "Acme");
    await page.click('[role="dialog"] h2');
    assert.ok(await page.$('[role="dialog"]'), "a click inside keeps it open");
    // (No app styles here, so the backdrop is not laid out full-screen: click the backdrop element itself.)
    await page.$eval('[role="dialog"]', (node) => (node as HTMLElement).click());
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  } finally { await browser.close(); }
});
