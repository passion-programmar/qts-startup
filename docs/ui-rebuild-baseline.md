# UI rebuild: before numbers (Step 0)

Measured 2026-11-15 on commit 57cd840, before any rebuild work. See ui-rebuild-plan.md.

## Browser download per page (first load, gzip)

From `next analyze --output --snapshot before` (production build, no deploy).

Shared by every page: 186.7 KB (538.7 KB unzipped). Mostly the Next.js and React runtime
(about 205 KB unzipped of it), icons (lucide-react, 31.6 KB), and global CSS (16.9 KB).

    /jobs                     228.7 KB   (page's own code 41.9 KB)
    /bids                     224.3 KB   (37.6 KB)
    /pdf                      224.0 KB   (37.3 KB)
    /users                    223.4 KB   (36.7 KB)
    /settings                 223.0 KB   (36.3 KB)
    /profile                  221.5 KB   (34.8 KB)
    /users/[id]/edit          220.9 KB   (34.1 KB)
    /users/new                220.9 KB   (34.1 KB)
    /settings/gemini-usage    218.4 KB   (31.7 KB)
    /settings/database-usage  211.6 KB   (24.8 KB)
    /useful-prompts           208.5 KB   (21.7 KB)
    /prompts                  208.1 KB   (21.4 KB)
    /categories               206.9 KB   (20.1 KB)
    /                         204.7 KB   (18.0 KB)
    /login                    191.5 KB   (4.8 KB)

Nothing is loaded later on demand (no lazy loading anywhere).

Biggest pieces of our own code in the browser: paginated-table 19.1 KB, pdf/document-data 11.0 KB,
date-picker 9.9 KB, users/user-forms 8.8 KB, settings/prompt-forms 8.1 KB, extension
answer-meaning 7.9 KB (pulled into the Profile page), confirm-button 6.3 KB.

Fonts: Inter, one file per alphabet; the browser only downloads the alphabets a page uses.

## Database trips per page (signed in, typical role)

Each query is one HTTP trip to Neon. "Steps" = trips that wait for the one before.

    /  (Manager)              1 trip,  1 step   (redirects to /jobs)
    /  (Super Admin)          4 trips, 4 steps  count and logins could run together
    /jobs                     5 trips, 2 steps  good
    /bids                     3 trips, 3 steps  bids and candidates could run together; all bids, no limit
    /users                    2 trips, 2 steps  every candidate with ~50 fields, no limit
    /users/new                2 trips, 2 steps
    /users/[id]/edit          5 trips, 3 steps  history could load with the profile
    /profile                  5 trips, 2 steps  manager answers read twice
    /pdf                      2 trips, 2 steps
    /prompts                  3 trips, 2 steps  every version with full text, no limit
    /useful-prompts           2 trips, 2 steps  every version with full text, no limit
    /categories               2 trips, 2 steps
    /settings (Manager)       2 trips, 2 steps
    /settings managers tab    2 trips, 2 steps
    /settings prompts tab     5 trips, 2 steps  all versions with full text, no limit
    /settings general tab     2 trips, 2 steps
    /settings old tab         6 trips, 2 steps
    /settings/database-usage  2-3 trips         same settings row read twice when cold
    /settings/gemini-usage    3-6 trips, 3-5 steps  clean-up check runs first on every visit
    /login                    0-1 trips

Super Admin pages add 1 step when the 10-minute quota cache is cold.
No query-in-a-loop (N+1) problems were found.

## Loading

One loading screen for the whole app (src/app/loading.tsx); no page has its own skeleton and
nothing streams, so each page waits for all of its queries before showing anything.

## Server render time

Not measured yet: it needs a signed-in browser. To be taken from the `next dev` terminal lines
("GET /jobs 200 in ...") while the user opens each page.

# After the rebuild (Step 13)

Measured 2026-11-15 after steps 1-12, the same way as above.

## Browser download per page (first load, gzip): before → after

    /jobs                     228.7 → 219.2 KB   (+12.2 KB only when Edit is clicked)
    /bids                     224.3 → 215.8 KB   (+12.2 KB only when Edit/View is clicked)
    /pdf                      224.0 → 223.4 KB
    /users                    223.4 → 213.7 KB
    /settings                 223.0 → 223.1 KB
    /profile                  221.5 → 220.9 KB
    /users/[id]/edit          220.9 → 215.1 KB
    /users/new                220.9 → 215.1 KB
    /settings/gemini-usage    218.4 → 218.2 KB
    /settings/database-usage  211.6 → 210.8 KB
    /useful-prompts           208.5 → 207.7 KB
    /prompts                  208.1 → 207.3 KB
    /categories               206.9 → 206.1 KB
    /                         204.7 → 204.0 KB
    /login                    191.5 → 205.1 KB   (the sidebar now loads with every page)

Shared by every page: 186.7 → 201.2 KB. The sidebar moved into the root layout so it stays on
screen between pages; its code is now part of the shared download.

## Data and waits: before → after

    /bids                     every bid + every answer → 25 bids a page, no answers; 3 → 2 waits
    /settings/gemini-usage    up to 100 replies × 1 MB → one line each; up to 5 → 2 waits
    /users                    ~50 columns a candidate → 18
    /users/[id]/edit          3 → 2 waits (profile and history together)
    /  (Super Admin)          4 → 2 waits; sign-ins from the index instead of ranking them all
    /settings/database-usage  the saved state is read once, not twice
    Every page                one session lookup shared by the layout and the page

## Loading

Before: a click blanked the whole screen until the page's data arrived. After: the sidebar and top
bar stay, and the content area shows a skeleton at once.

## Not changed

- The dark-mode palette recolouring in globals.css stays: many forms inside pages still use the
  plain palette colours that depend on it.
- The Prompts tab in AI settings still loads every version's full text for its pickers.
- Server render times were not measured (they need a signed-in browser).
