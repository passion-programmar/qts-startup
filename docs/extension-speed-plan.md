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
   3 seconds (each scan reads the whole page text). A link change on LinkedIn/Indeed restarts it.
2. On every page, the QTS-site bridge wakes the worker just to ask "is this the QTS site?".
3. On every finished job page, an old capture path (for the old account Auto Apply, which is off)
   scans the page again, injects 7 extractor files and a page watcher, and rewrites two storage maps
   that only the unreachable popup reads.
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
   - The QTS-site bridge runs only on QTS sites (no wake-up on every other page).
   - The highlighter skips the job-page check when there are no highlight rules.
   - The worker writes the Generation queue entry only when Generation needs it.
   - Remove the two unused images (2.3 MB) from the package.
2. One job-page check per page: the highlighter, Get JD and capture share one answer, and a page
   that is clearly not a job page is scanned once, not four times. Remove the unused capture path.
3. A lighter wake-up: count PDF pages without the PDF library; remove the old scanner and pipeline
   code that cannot run in this release.
4. Fewer wake-ups: the heartbeat alarm follows idle pacing instead of skipping ticks; navigation
   listeners only for top frames and only where needed; big per-job maps move to session storage so
   open tabs are not notified of every change.
5. A lighter launcher: the panel and its styles are built only when first needed; launcher state
   is asked for once; styles are not re-added on every focus change.
6. Structure: split the worker (7,900 lines) into feature files (Get JD, Generation, launcher,
   message routing) and the launcher into parts; decide what to do with the unreachable popup.
7. Measure again, record the after numbers, release one new extension version.
