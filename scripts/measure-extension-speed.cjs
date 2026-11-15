// Measures the QTS extension's cost in real Chrome (docs/extension-speed-plan.md).
//   node scripts/measure-extension-speed.cjs [label] [--signed-in] [--with-highlights] [--full-cycle]
// It serves a plain page and a job-like page locally and points the extension at a fake QTS server
// that refuses every call, so nothing reaches the real server. Results are medians of RUNS runs.
//   --with-highlights  the signed-in Manager has one shared highlight rule (as when the Super Admin set some)
//   --full-cycle       watch each page for 11 s, the whole job-page check (4 s covers its first 3 tries)
//   --extension=DIR    measure another copy of the extension, e.g. one exported with
//                      `git archive <commit> extension | tar -x -C DIR/..` for before/after numbers
//   --worker-only      only the background worker's numbers (answer and wake-up), not the pages
//   QTS_MEASURE_RUNS=2 fewer runs for a quick look; QTS_MEASURE_VERBOSE=1 prints each step
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer-core");

const root = path.resolve(__dirname, "..");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((file) => require("fs").existsSync(file));
const RUNS = Number(process.env.QTS_MEASURE_RUNS) || 7; // fewer for a quick look
const label = process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "now";
// Signed in as a test Manager: the fake server then answers every API call with an empty success.
const withHighlights = process.argv.includes("--with-highlights");
const signedIn = withHighlights || process.argv.includes("--signed-in");
const watchMs = process.argv.includes("--full-cycle") ? 11000 : 4000;
const extensionDir = path.resolve(process.argv.find((arg) => arg.startsWith("--extension="))?.slice("--extension=".length) || path.join(root, "extension"));
const HIGHLIGHT_RULE = { id: "rule-1", text: "Kubernetes", textColor: "#111111", backgroundColor: "#ffee58" };

const plainPage = `<!doctype html><html><head><title>News article</title></head><body><main>
${"<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore.</p>".repeat(200)}
</main></body></html>`;
const jobPage = `<!doctype html><html><head><title>Senior DevOps Engineer - Example Corp</title></head><body><main>
<h1>Senior DevOps Engineer</h1><p>Example Corp · Remote · Full-time</p><button>Apply now</button>
<h2>Job description</h2>${"<p>We are hiring a DevOps engineer with Kubernetes, Terraform and AWS experience. Responsibilities include CI/CD pipelines and on-call.</p>".repeat(60)}
<h2>Requirements</h2><ul>${"<li>5+ years of experience with cloud infrastructure</li>".repeat(20)}</ul></main></body></html>`;

const started = Date.now();
const progress = (message) => { if (process.env.QTS_MEASURE_VERBOSE) console.error(`${String(Date.now() - started).padStart(7)} ms  ${message}`); };
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const ms = (value) => `${value.toFixed(1)} ms`;
const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const shortName = (url) => url.replace(/^chrome-extension:\/\/[^/]+\//, "");

async function serve() {
  const server = http.createServer((req, res) => {
    const page = req.url.startsWith("/plain") ? plainPage : req.url.startsWith("/job") ? jobPage : null;
    if (page) { res.setHeader("Content-Type", "text/html"); return res.end(page); }
    res.setHeader("Content-Type", "application/json");
    if (!signedIn) { res.statusCode = 401; return res.end('{"success":false}'); }
    if (req.url.startsWith("/api/extension/highlights")) return res.end(JSON.stringify({ success: true, rules: withHighlights ? [HIGHLIGHT_RULE] : [] }));
    res.end(JSON.stringify({ success: true, managerId: "manager", rules: [], features: {}, mode: "gemini" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** A new Chrome with the extension, set up for this measurement: server address, sign-in, highlight rule. */
async function launchPrepared(base) {
  // Puppeteer stays off the background worker: attached, it would pause the worker each time it restarts.
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, pipe: true, protocolTimeout: 60000,
    enableExtensions: [extensionDir],
    targetFilter: (target) => target.type() !== "service_worker",
    args: ["--no-first-run"],
  });
  try {
    const browserSession = await browser.target().createCDPSession();
    let extensionId = null;
    for (let i = 0; i < 100 && !extensionId; i += 1) {
      const { targetInfos } = await browserSession.send("Target.getTargets");
      const worker = targetInfos.find((target) => target.type === "service_worker" && target.url.includes("/background/service-worker.js"));
      if (worker) extensionId = new URL(worker.url).host;
      else await wait(100);
    }
    if (!extensionId) throw new Error(`The extension did not load from ${extensionDir}`);
    const extensionPage = await browser.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/settings/apply-pdf-folder-panel.html`);
    await extensionPage.evaluate((serverUrl) => chrome.storage.local.set({ qtsServerUrl: serverUrl }), base);
    if (signedIn) {
      await extensionPage.evaluate(async () => {
        for (const file of ["shared/auth-token-store.js", "shared/account-auth-storage.js"]) {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL(file);
            script.onload = resolve;
            script.onerror = reject;
            document.head.append(script);
          });
        }
        await window.__qtsAccountAuth.storeAuth("fixture-token", { id: "manager", role: "manager", displayName: "Test Manager", loginName: "test" }, Date.now() + 3600000);
      });
    }
    if (withHighlights) {
      await extensionPage.evaluate((rule) => chrome.storage.local.set({
        qtsGlobalTextHighlightsCache: [rule],
        qtsGlobalTextHighlightsFetchedAt: Date.now(),
      }), HIGHLIGHT_RULE);
    }
    return { browser, extensionPage };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** The extension's main-thread time inside a page: its scripts starting, and the work they schedule. */
async function pageCost(base, url) {
  const totals = [];
  const scans = [];
  const perFile = {};
  for (let run = 0; run < RUNS; run += 1) {
    // Each run gets its own Chrome with one page. Under headless Puppeteer, a second new tab in a
    // Chrome with this extension sometimes never starts loading (seen before these speed steps too).
    const { browser } = await launchPrepared(base);
    let trace;
    try {
      const page = await browser.newPage();
      progress(`${url} run ${run + 1}: new page`);
      await page.tracing.start({ categories: ["devtools.timeline", "v8", "disabled-by-default-devtools.timeline"] });
      await page.goto(url, { waitUntil: "load" });
      progress("loaded");
      await wait(watchMs); // start-up timers and the job-page check's tries
      trace = JSON.parse(Buffer.from(await page.tracing.stop()).toString("utf8"));
      progress(`tracing stopped (${trace.traceEvents.length} events)`);
    } finally {
      await browser.close();
    }
    // The trace covers the whole browser; only the page's own process counts here (the worker
    // waking up is measured separately).
    const commit = trace.traceEvents.find((event) => event.name === "FrameCommittedInBrowser" && String(event.args?.data?.url || "").startsWith(url));
    const started = trace.traceEvents.find((event) => event.name === "TracingStartedInBrowser");
    const pagePid = commit?.args?.data?.processId
      ?? started?.args?.data?.frames?.find((frame) => String(frame.url || "").startsWith(url))?.processId;
    let total = 0;
    let pageScans = 0;
    for (const event of trace.traceEvents) {
      if (pagePid !== undefined && event.pid !== pagePid) continue;
      // Each job-page check injects the detection file again, so its runs count the page scans.
      if (event.name === "EvaluateScript" && String(event.args?.data?.url || "").endsWith("shared/job-page-detection.js")) pageScans += 1;
      const source = event.args?.data?.url || "";
      if (!source.startsWith("chrome-extension://") || !event.dur) continue;
      if (event.name !== "EvaluateScript" && event.name !== "FunctionCall") continue;
      const key = shortName(source) + (event.name === "FunctionCall" ? " (later)" : "");
      perFile[key] = (perFile[key] || 0) + event.dur / 1000 / RUNS;
      total += event.dur / 1000;
    }
    totals.push(total);
    scans.push(pageScans);
  }
  return { total: median(totals), scans: median(scans), files: Object.entries(perFile).sort((a, b) => b[1] - a[1]) };
}

/** How long the background worker takes to answer: awake, and woken from sleep. */
async function workerAnswer(browser, extensionPage, cdp) {
  const ping = () => extensionPage.evaluate(async () => {
    const started = performance.now();
    await chrome.runtime.sendMessage({ type: "GET_QTS_RUNTIME_CONFIG" });
    return performance.now() - started;
  });
  const awake = [];
  const asleep = [];
  for (let run = 0; run < RUNS; run += 1) {
    await ping();
    awake.push(await ping());
    await cdp.send("ServiceWorker.stopAllWorkers");
    await wait(300);
    asleep.push(await ping());
  }
  return { awake: median(awake), asleep: median(asleep) };
}

/** The code the worker runs on each wake-up, per file (Chrome trace of the worker thread). */
async function wakeUpCode(browser, extensionPage, cdp) {
  const session = await browser.target().createCDPSession();
  const perFile = {};
  const totals = [];
  for (let run = 0; run < 5; run += 1) {
    await cdp.send("ServiceWorker.stopAllWorkers");
    await wait(300);
    const events = [];
    const collect = ({ value }) => events.push(...value);
    session.on("Tracing.dataCollected", collect);
    const complete = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));
    await session.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "v8"] }, transferMode: "ReportEvents" });
    await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: "GET_QTS_RUNTIME_CONFIG" }));
    await wait(1000);
    await session.send("Tracing.end");
    await complete;
    session.off("Tracing.dataCollected", collect);
    let total = 0;
    for (const event of events) {
      const source = event.args?.data?.url || "";
      if (event.name !== "EvaluateScript" || !source.startsWith("chrome-extension://") || !event.dur) continue;
      perFile[shortName(source)] = (perFile[shortName(source)] || 0) + event.dur / 1000 / 5;
      // The worker's own file includes the files it imports, so it is the total.
      if (shortName(source) === "background/service-worker.js") total += event.dur / 1000;
    }
    totals.push(total);
  }
  return { total: median(totals), files: Object.entries(perFile).sort((a, b) => b[1] - a[1]) };
}

(async () => {
  if (!CHROME) throw new Error("Chrome was not found.");
  const { server, base } = await serve();
  // The pages are on another site than the fake QTS server, as real job sites are.
  const pages = base.replace("127.0.0.1", "localhost");
  let browser = null;
  try {
    const workerOnly = process.argv.includes("--worker-only");
    const plain = workerOnly ? null : await pageCost(base, `${pages}/plain`);
    const job = workerOnly ? null : await pageCost(base, `${pages}/job`);
    const prepared = await launchPrepared(base);
    browser = prepared.browser;
    const { extensionPage } = prepared;
    const cdp = await extensionPage.createCDPSession();
    await cdp.send("ServiceWorker.enable");
    const worker = await workerAnswer(browser, extensionPage, cdp);
    const wakeUp = await wakeUpCode(browser, extensionPage, cdp);

    const who = withHighlights ? "signed in as a test Manager with a highlight rule" : signedIn ? "signed in as a test Manager" : "signed out";
    console.log(`== ${label}, ${who}, each page watched ${watchMs / 1000} s (median of ${RUNS} runs)`);
    for (const [name, result] of [["plain page", plain], ["job page", job]].filter(([, result]) => result)) {
      console.log(`Extension work inside a ${name}: ${ms(result.total)}, page scans: ${result.scans}`);
      for (const [file, value] of result.files.slice(0, 8)) console.log(`   ${ms(value).padStart(9)}  ${file}`);
    }
    console.log(`Background worker answer: ${ms(worker.awake)} awake, ${ms(worker.asleep)} from asleep`);
    console.log(`Code run on each wake-up: ${ms(wakeUp.total)}`);
    for (const [file, value] of wakeUp.files.slice(0, 6)) console.log(`   ${ms(value).padStart(9)}  ${file}`);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => { console.error("FAILED", error.message); process.exit(1); });
