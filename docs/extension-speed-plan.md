# Extension speed plan

Started 2026-11-15. Goal: the extension costs less on every web page, wakes its background worker
less often and faster, and its biggest files are split by feature. Nothing a Manager can do changes.

## Before (Step 0), measured in Chrome 157 with extension 1.54.0

Measured with a local page and a fake QTS server, median of 7 runs:
`node scripts/measure-extension-speed.cjs <label> [--signed-in]`.

                                              signed out          signed in (test Manager)
    Extension work inside a plain page        ~20 ms              ~20 ms, page scanned 4 times
    Extension work inside a job page          ~24 ms              ~28 ms, page scanned 2 times
      text-highlighter.js                      5–6 ms start + 1–2 ms later
      page-launcher.js                         4–5 ms start + 1–2 ms later
      job-page-detection, page-exclusions,     ~1–3 ms each
      extractors, job-panel-watch …
    Background worker answer, awake           ~2 ms               ~3 ms
    Background worker answer, from asleep     160–215 ms          ~240 ms
      code run on each wake-up                 115–150 ms          ~185 ms
      of which the PDF library                 18–28 ms            ~35 ms
    Popup                                     ~210 ms to load (but it cannot be opened in
                                              this build: no popup is set in the manifest)

"Page scans" counts the job-page checks that read the page's whole text after it loads.

Sizes: background worker 333 KB + 46 imported files (1.35 MB) loaded on every wake-up; the
launcher (116 KB) and five more scripts load on every page; popup.js 305 KB; two unused images
(2.3 MB) in the package.

## What costs the most (found in the code)

1. On every page while signed in, the text highlighter asks the worker "is this a job page?" even
   when there are no highlight rules. The worker answers by scanning the page up to 4 times over
   about 10 seconds (each scan reads the whole page text). A link change on LinkedIn/Indeed
   restarts it. Get JD in Manual mode runs the same 4 scans again on the same page.
2. On every page, the QTS-site bridge asks the worker "is this the QTS site?". (This alone does not
   wake the worker on every page: the launcher's own question does that, see 6.)
3. On every finished page, an old capture path (for the old account Auto Apply, which is off)
   scans the page again; on a job page it also injects 6 extractor files and a page watcher, and
   rewrites two storage maps that only the unreachable popup reads.
4. Each worker wake-up runs ~1.7 MB of code: the PDF library (only needed to count PDF pages), the
   Apply code (only needed while applying), and old scanner code that cannot run in this release.
   On every wake-up it also writes and removes a Generation entry, which notifies every open tab.
5. While a mode is on, a 30-second alarm wakes the worker even when idle pacing then skips the
   request; navigation listeners wake it for every frame of every page.
6. The launcher builds its whole hidden panel (27 KB of styles, a 78 KB logo) on every page, asks
   for its state twice, and removes and re-adds its styles on every tab switch and window focus.
7. Large storage maps (Get JD results with job text) are rewritten several times per job, and every
   rewrite is sent to every open tab.

## How each step is done

1. One step at a time, one commit per step, same as the website rebuild.
2. Extension tests and the Apply end-to-end tests pass before each commit.
3. The speed is measured again after each step.
4. Behaviour stays the same. Each extension change needs a new version and Managers reinstall it,
   so the steps go out together in one or two releases, not one by one.

## Steps

1. Quick, safe wins
   - Done (450dea5): the QTS-site bridge asks the worker only on the QTS site. One question less
     per page; the worker still wakes for the launcher (step 5).
   - Dropped: the highlighter skipping the job-page check when there are no highlight rules. It
     fetches new shared rules only from job pages, so skipping the check would stop new rules from
     arriving; after step 2 a page is read once anyway.
   - Done (part 2): every worker wake-up wrote and removed qtsGenerationQueueRun even with
     Generation off, two storage changes sent to every open tab's listeners. The run is now saved
     just before Generation's first claim; a wake-up with nothing running writes nothing
     (extension/background/worker-wake-writes.e2e.test.js).
   - Done: both unused images are gone, logo.png (450dea5) and wys-launcher.png (1.1 MB, part 2,
     no longer listed in the manifest): 2.3 MB off the package.
2. Done: one job-page reading per page.
   - After a check the page watches itself until its first change (15 s at most). A retry asks the
     page "changed since?" and reuses the answer when not, so the result is the same as reading it
     again. Changes made by QTS's own panels do not count; text inside shadow roots is not read.
   - The highlighter, Get JD (Manual mode and the Gemini draft) share one reading; two of their
     tries that start together (within 100 ms) share one too.
   - The old capture path no longer runs: it needs the old account sign-in, which the server no
     longer gives (extension login accepts Managers only).
   - Measured, Chrome 157, median of 7, each page watched for the whole check (11 s), test pages on
     another site than the QTS server, one Chrome per page (`--full-cycle --with-highlights`):

         signed in, one highlight rule     before                after
         plain page                        16.9 ms, 4 readings   15.3 ms, 1 reading
         job page                          17.7 ms, 1 reading    15.5 ms, 1 reading
         signed out (no readings either way): 15.1 → 14.7 ms plain, 18.0 → 14.3 ms job page

     From the end-to-end test (extension/background/job-page-check.e2e.test.js): Get JD in Manual
     mode plus the highlighter on a plain page 9 readings → 1; a page where only QTS panels open
     4 → 1. In a Chrome already in use (Step 0 numbers) a job page was read twice and also got the
     capture path's extractor files and page watcher; now once, and nothing else is injected.
   - Measuring: a fresh Chrome may not run the old capture path at once, so "before" job-page
     numbers in fresh Chromes undercount it. Under headless Puppeteer a second new tab in a Chrome
     with this extension sometimes never starts loading (also before these steps), so each run has
     its own Chrome; options `--with-highlights`, `--full-cycle`, `--extension=DIR` and
     `QTS_MEASURE_RUNS` were added to scripts/measure-extension-speed.cjs.
3. A lighter wake-up.
   - Done: the PDF library (pdf-lib, 525 KB) no longer loads in the worker on every wake-up. The
     same library counts the printed PDF's pages inside the printing tab, only while printing, so
     the check and its results are unchanged (a cover letter over one page still stops delivery;
     any other failure still makes QTS print on the server).
   - Measured (signed in, worker only, three rounds before/after; this PC varies a lot run to run):
     answer from asleep 185/162/194 ms → 146/130/187 ms (about 26 ms faster on average); code run
     on each wake-up 124/119/130 ms → 86/115/122 ms; pdf-lib's own 16-24 ms is gone.
   - Moved to step 6: removing the old scanner and pipeline code. Its files cost only 1-2 ms each
     on a wake-up (about 5 ms together) while removing them touches many old code paths. A bigger
     remaining cost is the worker loading ~45 separate files on every wake-up, which belongs with
     splitting the worker into feature files.
4. Fewer wake-ups and fewer storage broadcasts.
   - Done: the heartbeat, Generation queue and Apply queue alarms tick as often as their check is
     due (30 s while active or busy, 1 minute after 2 idle minutes, 2 minutes after 5) instead of
     every 30 s to skip the check: up to 4 times fewer worker wake-ups while a mode is on with
     nothing to do. Activity (a mode on, the launcher, a page Get JD reads, work) brings them back
     to 30 s at once; a running job or review keeps 30 s.
   - Done: Get JD's results (with each page's JD text, for up to 100 tabs) and the idle pacing
     moved from local to session storage. Only the worker reads them; every local write was sent,
     whole map included, to every open tab's page scripts (several times per job, and the pacing on
     every check and every Get JD page). The old local copies are removed after the update.
   - Done: the five navigation listeners that use only http and https pages ask Chrome for just
     those, so blank, data: and blob: frames no longer wake the worker. Chrome cannot filter by
     frame, so https iframes still do (each listener ignores them).
   - Tests: worker-wake-writes.e2e (no local writes of these keys on a Get JD page; the old code
     wrote qtsGetJdResults and qtsIdleActivityAt), idle-pacing (the alarm periods), release-boundary
     (the wiring).
5. A lighter launcher.
   - Measured first (interleaved medians, a plain page, signed in): the launcher was the biggest
     extension cost on a page, about 26-39 ms of main-thread work, more than all other extension
     scripts together. Filling its hidden panel (rows, lists, pickers, the Tools check) was about
     half of that, on every page and on every switch back to a tab.
   - Done: the panel is filled only while it shows. Closed, a page keeps just the tab up to date
     (signed in, and its dot for running / needs you / failed) and asks the worker nothing for the
     panel; opening (the tab, the toolbar icon) fills it first, so a click never acts on an old
     row. A session change empties the panel's lists at once, open or not.
   - Measured after (9 interleaved runs each, this PC was busy): a plain page's main-thread time
     151.8 → 144.8 ms median (112.6 ms with no launcher at all), so about 7 ms less per page.
   - Not done: asking for the launcher state once (the second ask covers starts from the toolbar,
     shortcuts and restores; one worker round trip, no page time). Building the panel and loading
     its code only when first opened was moved to step 6, then dropped there after measuring.
   - Tests: launcher-lazy-panel.browser (closed: no panel fill, no Tools request, the dot still
     shows the run; opened: up to date when it shows); two launcher tests now open the panel before
     reading it.
6. Structure.
   - Measured first (traces of a plain page, interleaved runs): what the launcher still costs a
     page (about 13 ms of style, layout and paint) comes from showing its small tab. Its code
     compiles in about 0.5 ms and the hidden panel costs nothing, so building the panel or loading
     its code only when first opened would save nothing: dropped. Also tried, no change: no
     docking style in the page, layout containment, a serif tab, only the tab's styles.
   - Done: the release zip's background worker holds its 45 importScripts files, in the same
     order (scripts/build-extension.cjs), so a wake-up loads one file instead of 46. In a quick
     test it answered from asleep in about 72 ms instead of about 139 ms (median of 3 rounds;
     this PC was busy). The source keeps the separate files, and this PC loads extension/ itself,
     so only the zip has it. The files share one global scope either way: none checks or
     redeclares another's names (checked), and the build stops on anything but one importScripts
     of plain file names. Test: extension/shared/release-build.test.js.
   - Skipped (the user's choice, 2026-11-15): splitting the worker into feature files and removing
     the old scanner and pipeline code (no speed a Manager would notice, and other sessions edit
     the worker every day), and the unreachable popup (it never loads, so it costs nothing).
7. Release.
   - The final round of measuring was skipped (the user stopped it); each step's numbers are above.
   - First release done: 1.56.0 (2026-11-15) has steps 1-3 and the résumé-folder check; the built
     zip (dist/qts-extension-1.56.0.zip, 759 KB) passed the job-page, wake-up, folder and printing
     end-to-end tests itself. Steps 4-6 go out in the next release.
