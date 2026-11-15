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
4. Fewer wake-ups: the heartbeat alarm follows idle pacing instead of skipping ticks; navigation
   listeners only for top frames and only where needed; big per-job maps move to session storage so
   open tabs are not notified of every change.
5. A lighter launcher: the panel and its styles are built only when first needed; launcher state
   is asked for once; styles are not re-added on every focus change.
6. Structure: split the worker (7,900 lines) into feature files (Get JD, Generation, launcher,
   message routing) and the launcher into parts; decide what to do with the unreachable popup.
7. Measure again, record the after numbers, release one new extension version.
