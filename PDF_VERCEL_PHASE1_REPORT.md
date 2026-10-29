# PDF and Vercel usage report: Phase 1

**Production readiness: NOT READY.** What still blocks release:

1. **Not tested in the real signed-in QTS app or against Neon.** Everything below was tested in real Chrome with the real extension, but against a local mock QTS site with no Next server and no sign-in. Section 12 is the checklist for that.
2. **Production behaviour of the stalled connection is unknown.** The Resume page no longer hangs: a stalled print request now ends after 70 seconds with a message and Retry (section 6, risk 1). The stall itself was reproduced only against the local HTTP mock site; Vercel over HTTPS has not been tested.

Nothing is committed, pushed or deployed. The database schema is unchanged. The extension version is still **1.42.9**; bump it at release.

**Not changed:** the 24 résumé templates (`public/resume-templates/`), `extension/shared/chrome-pdf.js`, the `debugger` permission, the database schema, authentication and ownership rules, `/api/pdf/print`, and the Generation and Apply print paths.

---

## 1. What Phase 1 changes

| # | Change | Before | After |
|---|---|---|---|
| **1** | Resume-page Download prints in this Chrome | Every click: `POST /api/pdf/print`; the server launched Chromium and printed both PDFs | The page asks the QTS extension (QTS-site bridge) to print both PDFs with the same `printDocuments` path Generation and Apply use. No extension, an older one, or a failed print → `/api/pdf/print` as before |
| **2** | No reprint for an unchanged Download | A second click printed again | The last printed pair is kept in the page, keyed by template + JSON text, and saved again. Simplified fallback PDFs are not kept |
| **3** | Print requests checked before printing | The template page printed its **sample résumé** when given no data, and the **default template** for an unknown name | The extension refuses such requests with a reason and prints nothing; the page shows the reason and does not send the document to the server |
| **4** | No duplicate printing | Two simultaneous requests opened two print tabs | Identical requests made while one prints share that print (one tab). A second click while a Download runs is ignored |
| **5a** | Apply sign-in check | 2 reads of the same `users` row per Apply request | 1 read |
| **5b** | Browser heartbeat | 3 database trips; the browser row written twice | 2 trips; one write |
| **6** | Server print has a time limit | A request to `/api/pdf/print` had no limit: when it stalled, the button stayed on "Preparing PDFs..." forever | Given up after **70 seconds** with "QTS did not answer within 70 seconds. Nothing was saved. Try again." and a **Retry** button. The button always comes back; closing the page cancels the Download |

### Print request checks (3)

`extension/shared/resume-print-requests.js`, `checkPrintJob`:

- The template must be one of the 24 (a test keeps the list equal to `src/server/pdf/pdf-templates.ts`).
- The data must be an object with a candidate name, résumé sections, at least one cover-letter paragraph, and `theme.template` equal to the requested template.
- The data must be at most 1,000,000 characters (the same limit as `/api/pdf/print`).
- A refused request answers `{ ok: false, invalid: true, error }`. No tab is opened.

### Duplicate prevention (4)

`printOnce` in the same file:

- Requests are keyed by template + the exact data. Only byte-identical requests share a print, and only **while it runs**; a finished print is never given to a later request.
- The entry is removed on success, failure, error, or after 70 s (`chrome-pdf.js` gives up after 60 s), so a retry prints again.
- It works within one Chrome. Two Chromes print separately.
- The page also ignores a second Download click while one is running (`downloadingRef`).

### Server print time limit and Retry (6)

`src/app/pdf/pdf-workspace.tsx`, `printPdfPairOnServer` and `downloadPair`:

- The request to `/api/pdf/print` stops after **70 s** (the route's own limit is 60 s). Stopping it also drops the stuck connection, so a retry starts on a new one.
- **Retry** is shown only for failures that trying again may fix: no answer in time, no connection, or a server error (HTTP 5xx). A refused request — signed out, invalid JSON, a print request the extension refused — shows its message without Retry.
- No automatic retries. Retry is a click by the Manager, and clicks while a Download runs are ignored, so one request at a time.
- Retry is tied to its own message: editing the JSON or another error removes it.
- Closing or leaving the page cancels the running Download; nothing is saved afterwards.
- The page console gets short diagnostics, without résumé content: `[QTS Resume] Printing in this Chrome failed after 25.3 s; QTS prints instead.`, `[QTS Resume] The print request to QTS had no answer after 70.0 s.`, `[QTS Resume] QTS could not print (HTTP 500) after 0.0 s.`

### Security of the Chrome print path

- The bridge listens only on the QTS site and only to messages from the page itself. The service worker checks again that the sender is the QTS site (`isQtsSite(sender.url)`), as "open résumé folder" does.
- The data printed is the Manager's own JSON, already in the page. The extension loads only the QTS template URL.
- No new server endpoint.

### Detecting the extension

The page sends `ping` first (1.5 s limit). Only an extension with this change answers `print: true`; older ones answer without it and the page uses the server at once. Without an extension the page waits 1.5 s, then uses the server. The print request waits up to 75 s.

---

## 2. Files

**Changed**

| File | Change |
|---|---|
| `src/app/pdf/pdf-workspace.tsx` | `printPdfPair` (Chrome first, server fallback), `printPdfPairInChrome`, `askExtension`, `printPdfPairOnServer`, `lastPrintedRef`, `downloadingRef`, refused-request message; server time limit (`serverPrintLimitMs`), `RetryablePrintError`, Retry button (`retryableError`), cancellation (`downloadCancelRef`), console diagnostics |
| `extension/content/qts-site-bridge.js` | `ping` answers `print: true`; new `print-documents` |
| `extension/background/service-worker.js` | Loads `shared/resume-print-requests.js`; new `QTS_PRINT_DOCUMENTS` handler. **This file also holds another session's uncommitted changes**; commit only these two parts with this work |
| `src/lib/extension-auth.ts` | New `getExtensionManagerWithApplyAccess` |
| `src/server/apply/apply-route-auth.ts` | Uses it; the second `users` read removed |
| `src/server/browsers/extension-browsers.ts` | `upsertExtensionBrowser` shared; `recordBrowserHeartbeat` upserts the browser with its modes in the same batch |
| `src/app/api/extension/browsers/heartbeat/route.ts` | Uses the new `recordBrowserHeartbeat` |
| `package.json` | `test:apply-e2e` also runs `resume-print.e2e.test.js` |

**New**

| File | What |
|---|---|
| `extension/shared/resume-print-requests.js` | `checkPrintJob`, `printOnce`, `inFlightCount` |
| `extension/shared/resume-print-requests.test.js` | 8 unit tests |
| `src/server/pdf/resume-print-requests.test.ts` | 3 tests: the 24 templates match; what the page sends is accepted for every template; data for one template is refused for another |
| `extension/background/resume-print.e2e.test.js` | Real Chrome, real extension, mock QTS site |

The Resume page tests in section 3 ("the real Resume page component", "server print time limit") ran from scripts outside the repository; they are not part of the test suites.

---

## 3. Test results

### Suites (latest run, after the time limit)

| Run | Result |
|---|---|
| `npm run typecheck` | clean |
| ESLint on the changed files | clean |
| `npm run test:server` | **145 / 145** |
| `npm run test:extension` | **292 / 295**: the 3 failures are the existing ones in section 5 |
| `resume-print.e2e.test.js` (real Chrome) | pass |
| `npm run test:apply-e2e` (5 tests, real Chrome; run before the time limit, which changes no extension code) | **5 / 5** on the second run; on the first, one existing Apply test failed (section 5) |

### Real Chrome: Chrome print path (`resume-print.e2e.test.js`, passed 7 of 7 runs)

| Case | Result |
|---|---|
| Valid résumé and cover letter | Both PDFs, 1 print tab |
| Invalid payloads: data `'x'`, no data, no candidate name, no job | Refused with a reason, **0 tabs opened**, no PDF |
| Unknown template | Refused, 0 tabs |
| Two identical requests at once | **1** print tab, the same files for both |
| Two different requests at once | 2 tabs, each its own files |
| Print fails (template unreachable), then retry | `{ ok: false }`, then the retry prints |
| Request from another site | Refused by the service worker |
| Afterwards | 0 print tabs left, 0 requests held, 0 `/api` calls |

### Real Chrome: the real Resume page component

The real `PdfWorkspace` component, bundled for the browser and driven in real Chrome against the mock site. Saves are counted at the page's own save action.

| Case | With extension | Without extension |
|---|---|---|
| Three clicks at once | 1 print tab, **1 pair saved**, 0 server calls | 1 server print, **1 pair saved** |
| Same JSON and template again | Saved again, **not printed** | Saved again, no server call |
| Template changed | Printed again | Printed again |
| JSON changed | Printed again | Printed again |
| Chrome print fails at once | 1 server print, 1 pair saved | – |
| Chrome print fails slowly (25–60 s) | Before the time limit: **hung**. Now: ends with Retry (next table) | – |

**Duplicate downloads:** identical simultaneous requests did not produce extra files. The extension itself saved nothing (`chrome.downloads`: 0). The page saved exactly one pair per Download, including for three clicks at once.

### Real Chrome: server print time limit and Retry (real page component, mock site)

| Scenario | Result |
|---|---|
| Chrome prints | 1 pair saved, 0 server calls, button back after 3 s |
| Chrome fails at once → server prints | 1 pair saved, button back after 2 s |
| Chrome fails at once → server error 500 | "…Nothing was saved." with Retry; **Retry → 1 pair saved** |
| Chrome fails at once → server says signed out (401) | "Your QTS session has ended. Sign in again." without Retry |
| Server receives the request and never answers; 3 clicks | **1 server request**; after 71–72 s "QTS did not answer within 70 seconds…" with Retry; Retry → 1 pair saved |
| **Chrome fails slowly → server request stalls before reaching the server** (the case that hung) | Button **back after 97 s** with Retry, nothing saved |
| Retry after a stall | Either saved at once, or stalled again and ended with Retry again after ~130 s; **never stuck** |
| No extension → server prints; error then Retry | 3 / 3 pass |
| Older extension (1.42.9) → server prints; error then Retry | 3 / 3 pass |
| Afterwards | 0 print tabs left, 0 requests held |

### Real Chrome: templates (all 24, sample and a long résumé, 96 files)

- All 48 print jobs accepted and printed in Chrome.
- **96 / 96** files byte-identical to the server path on this machine (creation times and file ID ignored), with the same page counts.
- Page size 594.96 × 841.92 pt on both paths: A4 as Chrome rounds it.
- The preview's page count equals the PDF's for **96 / 96**, including 48 multi-page files (up to 4 pages).
- A pair printed in 0.75–2.9 s (headless, this PC).

### Legitimate résumé structures

60 legitimate variants of the sample — each optional field removed in turn at every level, current and legacy field names, 1 and 6 cover-letter paragraphs, object bullets, 50 bullets, Unicode and right-to-left text, US Letter paper, compact density, page numbers, a long résumé — each accepted by the app's own parser, then mapped for all 24 templates: **1,440 checks, 0 refused.** (5 more variants were rejected by the app's parser itself, so they are not legitimate.)

---

## 4. Not tested yet

- **The real signed-in Resume page** in QTS (Next server, Manager session, the folder picker).
- **Apply sign-in and heartbeat changes against Neon.** No test runs them against a database.
- **Production Vercel over HTTPS:** whether the stalled connection (section 6) happens there at all.
- **Normal (not headless) Chrome:** the "being debugged" bar, printing while the Manager uses the window. (One visible-Chrome run reproduced the stalled connection; the full flow was not tested visibly.)
- **Comparison with Vercel's Linux Chromium 153.** Files were compared with the server path on this Windows machine only.
- **Where each page breaks**, preview against PDF: page counts match; line-by-line positions were not compared.

---

## 5. Existing intermittent and failing tests

| Test | Status |
|---|---|
| `release-boundary.test.js`: "manager job rows support safe manual edits and deletion" | Fails at HEAD too: it looks for text no longer in `src/app/jobs/page.tsx` |
| `release-boundary.test.js`: "Local Count never calls CountTokens; Gemini Count records both counts on the request" | Fails at HEAD too: it looks for text no longer in the Gemini-usage page |
| "Scanner waits asynchronously for ChatGPT to accept a send-button click" | Timing test: passes alone (3 / 3 at HEAD and now); fails sometimes in the full run |
| Apply e2e: "after the extension restarts, Apply takes an open job page up again…" | Once failed because port 47125 was held by another process; once failed in the parallel suite run and passed alone and on rerun. Not explained |

None of these touch files changed here.

---

## 6. Known risks

1. **Stalled connection after a slow failed print — hang fixed, cause unknown, production untested.**
   - **What happens** (reproduced every time against the local mock site, headless and once in visible Chrome): during a slow failed Chrome print, the print tab's template request uses a connection to the QTS host. The mock server (Node, HTTP/1.1) closes idle connections after 5 s. About 20 s later Chrome **reuses that closed connection** for the page's `POST /api/pdf/print` — Chrome's network log shows the socket reused after 25–27 s idle and no response ever — and the server never receives it. Every tab on the QTS site shares those connections; the extension's service worker does not, and kept working.
   - **Not the cause** (each tried alone, none stalled): keep-alive reuse in plain Chrome, a closed tab, `chrome.debugger` attached and held 25 s, the real `printDocuments` failing on its own. Only the full sequence stalls.
   - **Unknown:** why Chrome misses the close of those connections; whether it happens against Vercel over HTTPS.
   - **Fixed in the page:** the request now ends after 70 s with a message and Retry; the button always comes back; nothing is saved twice.
   - **Still possible:** a slow failure followed by a stall can need **one or more manual Retries** — once several connections are dead, each try may take one. Worst case seen: about 2.5 minutes until Retry appears (Chrome's 60 s print limit, then the 70 s request limit).
   - **Also affected while it lasts:** the print tab's own requests (one Retry's Chrome print waited its full 60 s). Generation and Apply fall back from the service worker, which was not affected.
2. **A wrongly refused résumé.** If the extension's checks refused a real résumé, that Manager could not download it from the Resume page while the extension is on. 1,440 checks of legitimate variants were all accepted.
3. **Duplicate prevention covers one Chrome.** Two Chromes, or two different requests, print separately (correct, but not shared).
4. **The 70 s limit frees an in-flight print request while its print may, rarely, still be running.**
5. **Data in the page.** Résumé JSON and PDFs pass through `window.postMessage` on the QTS page (other extensions' scripts there can already read the JSON), and one printed pair stays in page memory until the tab is closed. The extension stores nothing and saves nothing. The console diagnostics contain no résumé content.
6. **1.5 s extra wait** for Managers without the extension.

---

## 7. Rollback

| Change | Rollback |
|---|---|
| Resume page (1–4, 6) | Revert `src/app/pdf/pdf-workspace.tsx`: the page prints on the server again, without the time limit |
| Only the time limit and Retry (6) | Revert this file's `printPdfPairOnServer`, `RetryablePrintError`, `serverPrintLimitMs`, `retryableError` and `downloadCancelRef` parts; the rest of Phase 1 stays |
| Extension (1, 3, 4) | Reinstall the 1.42.9 build: the page gets no `print: true` and uses the server |
| Apply sign-in, heartbeat (5a, 5b) | Revert the four server files and redeploy, or use Vercel Instant Rollback. Responses are unchanged, so extensions need nothing |
| Tests only | Delete the three new test files; revert `package.json` |

---

## 8. Before release

1. Run the Phase 1.2 checklist (section 12) in a **Preview** deployment, signed in as a Manager, with Neon.
2. Check Vercel logs (no `/api/pdf/print` while the extension works) and Neon Monitoring (queries per heartbeat).
3. Bump the extension version. Commit only this work's parts of `service-worker.js`. Fix or note the two out-of-date `release-boundary` checks.
4. Optionally, move the Resume page time-limit tests (section 3) into the repository's e2e suite.

---

## 9. Pending: Chromium in one function

`/api/pdf/print`, `/api/extension/generation/artifacts` and `/api/extension/apply/documents` each trace about **80.5 MB**, of which about **70.1 MB** is Chromium (local build, 2026-10-27; `next.config.ts`, `outputFileTracingIncludes`). Other functions trace about 2.6–2.7 MB.

Planned, not built:

1. `/api/pdf/print` also accepts the extension's token with a `generationId` or `attemptId`, looks the data up itself with today's ownership checks, and stays the only route that prints.
2. The extension's Generation and Apply fallbacks call it instead of the other two routes.
3. Raise `MIN_WORK_EXTENSION_VERSION`, then remove printing and the Chromium tracing from the other two routes.

Expected: one function of about 80.5 MB instead of three — to be measured after a build. Each stage can be rolled back on its own. Deleting old Vercel deployments (dashboard only) may also lower Functions Storage, if it counts retained deployments; to be checked in Vercel.

---

## 10. Future investigation: PDFs without `chrome.debugger`

Today the extension prints with `chrome.debugger` (`Page.printToPDF`): silent, and identical to the server. It shows Chrome's "being debugged" bar while printing. Options to investigate, none tested:

- **`window.print()` from a hidden frame:** no debugger, but it opens Chrome's print dialog and its settings depend on the Manager's choices, so output may differ.
- **Other Chrome extension APIs:** check whether any can save a page as PDF silently on Windows (for example, whether `chrome.printing` is available outside ChromeOS).
- **A PDF library in the browser:** silent, but it would need the templates' layout rebuilt, so identical output is unlikely.
- **Server printing only:** no debugger, but it is the CPU cost Phase 1 removes.

The requirement to keep in mind: the same files as the server prints today, without a dialog.

---

## 11. History

| Step | What |
|---|---|
| Audit | Read-only audit of PDF printing and Vercel use: preview in the browser, Generation and Apply printing in Chrome, the Resume-page Download always on the server, Chromium in three functions |
| Phase 1 | Changes 1, 2, 5a, 5b |
| Pre-release validation | Real Chrome against a mock site; found: the sample résumé printed for invalid data, an unknown template printed as the default, two print tabs for two identical requests |
| Blocker fixes | Changes 3 and 4, with unit, server and real-Chrome tests |
| Final checks | Duplicate downloads and legitimate résumé structures verified; found: the Resume page hung after a slow failed print |
| Hang fix | Change 6; the stalled-connection mechanism traced with Chrome's network log and server socket logs |

---

## 12. Phase 1.2 checklist: signed-in QTS and Neon

**Setup:** a Preview deployment of this work; a Manager account; Chrome with this extension build (version bumped) and its server URL set to the Preview; DevTools → Network open on the Resume page; Vercel function logs and Neon Monitoring open. Neon is only read (SQL editor `SELECT`s), never changed by hand.

### Resume page

- [ ] **Download with the extension:** a hidden tab and the "being debugged" bar appear briefly; two files saved under `QTS_Resume/…`; **no** `/api/pdf/print` in Network or in Vercel logs.
- [ ] **Same Download again:** saved again, no hidden tab, no request.
- [ ] **Edit the JSON**, then **change the template:** each prints again.
- [ ] **Double-click Download:** one pair saved.
- [ ] **Compare the PDFs with the preview** for 3–4 templates, including a two-page résumé: fonts, margins, colours, page breaks, A4.
- [ ] **Extension off** (chrome://extensions): Download prints on the server; one `/api/pdf/print` in Vercel logs; files look the same as the Chrome-printed ones.
- [ ] **Older extension (1.42.9):** Download prints on the server.
- [ ] **Stalled connection on HTTPS:** Download with the extension, wait 30–60 s, turn the extension off, Download again: the request reaches Vercel within seconds (Network timing, Vercel log). Repeat 3 times.
- [ ] **Offline** (DevTools → Network → Offline, extension off): "QTS could not be reached…" with Retry; back online → Retry saves one pair.
- [ ] **Signed out in another tab**, extension off: "Your QTS session has ended. Sign in again." without Retry.
- [ ] **Close the tab during "Preparing PDFs..."**: nothing saved; no print tab left open.

### Generation and Apply

- [ ] **One Generation:** three files downloaded; résumé and cover letter look as before.
- [ ] **One Apply** (review mode, no real submission): résumé and cover letter uploaded.
- [ ] **"Stop all"** on the Jobs page stops Generation and Apply in this Chrome within one heartbeat (≤ 2 minutes when idle).
- [ ] **Jobs page Chrome list:** this Chrome, its version and modes; "last seen" keeps updating.

### Neon (Apply sign-in and heartbeat changes)

- [ ] **Apply turned off** for the Manager (Super Admin): Apply refuses with "Apply is not turned on for your account."; turned on again: Apply works.
- [ ] **Password changed or Manager blocked:** the extension's next request is refused (signed out).
- [ ] **Heartbeat:** `SELECT get_jd_on, work_mode, last_seen_at FROM extension_browsers WHERE manager_id = …` changes when Get JD or a work mode is switched.
- [ ] **A new Chrome** (new profile with the extension): a new `extension_browsers` row on its first heartbeat, with its default name.
- [ ] **Neon Monitoring:** queries per heartbeat lower than before the deployment (compare the same idle period).

### Vercel

- [ ] No `Template PDF printing failed` and no `Could not print Resume page PDFs` in the logs during the tests.
- [ ] `/api/pdf/print` invocations only in the extension-off and older-extension steps.

**Result:** all items pass → Phase 1 can be released with the steps in section 8. Any failure → stop, note it here, and use section 7 to roll back.
