import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { PgDialect } from "drizzle-orm/pg-core";
import puppeteer from "puppeteer-core";

type Query = { sql: string; params: unknown[] };
const fixture = { results: [] as unknown[][], queries: [] as Query[] };
(globalThis as Record<string, unknown>).__qtsUrlsFixture = fixture;
(globalThis as Record<string, unknown>).__qtsDialect = new PgDialect();

const manager = "99999999-9999-4999-8999-999999999999";
let readUrlsAddedOnDay: (managerId: string, day: string) => Promise<{ url: string; date: string }[]>;

test.before(async () => {
  // Each select records its where clause and answers with the next queued result, in call order.
  const db = `export const db={select:()=>({from:()=>({where:(w)=>{const f=globalThis.__qtsUrlsFixture;
    f.queries.push(globalThis.__qtsDialect.sqlToQuery(w));return Promise.resolve(f.results.shift()||[]);}})})};`;
  const mocks: Record<string, string> = { "server-only": "", "@/lib/db": db };
  const result = await build({
    entryPoints: [resolve("src/server/jobs/urls-added-on-day.ts")], absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as { readUrlsAddedOnDay: typeof readUrlsAddedOnDay } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  readUrlsAddedOnDay = loaded.exports.readUrlsAddedOnDay;
});
test.beforeEach(() => { fixture.results = []; fixture.queries = []; });

test("today's URLs come from the Jobs page and the Bids page together, newest first", async () => {
  fixture.results = [
    [{ url: "https://jobs.test/job-1", at: new Date("2026-11-15T08:00:00Z") }, { url: "https://jobs.test/job-3", at: new Date("2026-11-15T12:00:00Z") }],
    [{ url: "https://jobs.test/bid-2", at: new Date("2026-11-15T10:00:00Z") }],
  ];
  const urls = await readUrlsAddedOnDay(manager, "2026-11-15");
  assert.deepEqual(urls.map((entry) => entry.url), ["https://jobs.test/job-3", "https://jobs.test/bid-2", "https://jobs.test/job-1"]);
  assert.ok(urls.every((entry) => entry.date === "2026-11-15"));

  const [jobsQuery, bidsQuery] = fixture.queries;
  // Jobs: this Manager's, dated today, and still on the Jobs page (no bid).
  assert.match(jobsQuery.sql, /"jobs"\."manager_id" = \$1/);
  assert.match(jobsQuery.sql, /"jobs"\."date" = \$2/);
  assert.match(jobsQuery.sql, /not exists \(\s*select 1 from "bids"/);
  assert.deepEqual(jobsQuery.params.slice(0, 2), [manager, "2026-11-15"]);
  // Bids: this Manager's, created today in Romania time.
  assert.match(bidsQuery.sql, /"bids"\."manager_id" = \$1/);
  assert.match(bidsQuery.sql, /\("bids"\."created_at" at time zone \$2\)::date = \$3::date/);
  assert.deepEqual(bidsQuery.params, [manager, "Europe/Bucharest", "2026-11-15"]);
});

test("a malformed day reads nothing", async () => {
  assert.deepEqual(await readUrlsAddedOnDay(manager, "15/11/2026"), []);
  assert.equal(fixture.queries.length, 0);
});

const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(existsSync);

test("one click saves one .txt file of today's job and bid URLs, each once", { skip: !chrome, timeout: 60000 }, async () => {
  // The server action is replaced: it answers with window.answer, dated with the day it was asked for.
  const mocks: Record<string, string> = {
    "@/app/components/export-urls-action": "export const urlsAddedOnDayAction=async(day)=>{window.askedDay=day;return window.answer.map((url)=>({url,date:day}));};",
  };
  const result = await build({
    absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"), bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import {createElement as h} from 'react';import {createRoot} from 'react-dom/client';
      import {ExportUrlsButton} from './src/app/components/export-urls';
      window.saved=[];
      URL.createObjectURL=(blob)=>{window.lastBlob=blob;return 'blob:test';};
      URL.revokeObjectURL=()=>{};
      HTMLAnchorElement.prototype.click=function(){window.lastBlob.text().then((text)=>window.saved.push({name:this.download,text}));};
      createRoot(document.getElementById('root')).render(h(ExportUrlsButton));` },
    plugins: [{ name: "fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="root"></main>');
    await page.evaluate(() => {
      (window as unknown as { answer: string[] }).answer = [
        "https://jobs.test/a", "https://www.jobs.test/a/", "https://jobs.test/b#apply", "https://JOBS.test/b", "https://jobs.test/c?id=1",
      ];
    });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.waitForSelector("button");
    assert.match(await page.$eval("button", (button) => button.textContent ?? ""), /Export today's URLs/);

    await page.click("button");
    await page.waitForFunction(() => (window as unknown as { saved: unknown[] }).saved.length === 1);
    const [file] = await page.evaluate(() => (window as unknown as { saved: { name: string; text: string }[] }).saved);
    const day = await page.evaluate(() => (window as unknown as { askedDay: string }).askedDay);
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(file.name, `jobs-and-bids-urls_${day}.txt`);
    // One URL per line, each job once (case, www, a trailing slash and #fragment do not make a new one).
    assert.equal(file.text, "https://jobs.test/a\r\nhttps://jobs.test/b#apply\r\nhttps://jobs.test/c?id=1\r\n");
    await page.waitForFunction(() => /Saved 3 unique URLs from Jobs and Bids\./.test(document.body.textContent ?? ""));

    // A day with nothing added saves no file and says so.
    await page.evaluate(() => { (window as unknown as { answer: string[] }).answer = []; });
    await page.click("button");
    await page.waitForFunction(() => /No job or bid URLs were added today\./.test(document.body.textContent ?? ""));
    assert.equal(await page.evaluate(() => (window as unknown as { saved: unknown[] }).saved.length), 1);
  } finally { await browser.close(); }
});
