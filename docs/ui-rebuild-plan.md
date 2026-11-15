# Web app UI rebuild plan

Started 2026-11-15. Web app only; the Chrome extension is not part of this plan.

Goal: one modern look across every page, faster pages, and less code to maintain. Nothing a
Manager or Super Admin can do changes; only how it looks and how fast it loads.

## Where it stands today

- 16 pages, about 13,000 lines of page and component code.
- 40 of 66 component files run in the browser ("use client"), so a lot of code is downloaded.
- Styles are written out by hand on each element. The same button is copied 12 times and the same
  card 24 times, so pages drift apart and each change has to be made many times.
- Dark mode works by recolouring the whole Tailwind palette in globals.css, not by named colours.
- One loading screen for the whole app; no page shows its own skeleton or streams its slow parts,
  so a page shows nothing until all of its data has loaded.
- The biggest files: users/user-forms.tsx (1,724 lines), database-usage page (881),
  super-admin-tabs (672), pdf-workspace (669), model-test-panel (590), record-forms (582).

## How each step is done

1. One step at a time, one commit per step.
2. Typecheck, lint and all tests pass before the commit.
3. The page is checked on localhost; the user reviews it before the next step starts.
4. Nothing is pushed until the user says so.
5. Behaviour stays the same; tests that read page source are updated with the change.

## Progress

- Step 0 done 2026-11-15: before numbers in ui-rebuild-baseline.md (server render time still to
  be taken from a signed-in browser).
- Step 1 built 2026-11-15: named colours in globals.css, pieces in src/app/ui, preview at /ui-kit
  (signed-in staff only, not in the menu). No page uses them yet. Committed as adf511c.
- Step 2 built 2026-11-15: the sidebar and top bar are drawn once in the root layout (AppShell,
  inside Suspense) and stay on screen between pages; the active menu item follows the address;
  loading.tsx is a content skeleton; one session lookup per request (React cache). Pages still
  wrap themselves in WorkspaceShell, which now only passes them through; each page step removes it.
  Committed as 04ec1d3. Cost: the sidebar code now loads with every page, so /login grew from
  191.5 to 203.1 KB (shared code 186.7 → 200.9 KB).
- Step 3 built 2026-11-15 (People): user-forms.tsx (1,724 lines) split into candidate-form,
  row-actions, staff-forms and form-fields; the list asks for 18 columns instead of ~50; the edit
  page loads profile and history together; the page uses the shared pieces. /users 223.4 → 213.4
  KB, /users/new and edit 220.9 → 214.9 KB. The shared table (paginated-table) is unchanged.
  Committed as ed7e7ae.
- Step 4 built 2026-11-15 (Jobs): the Edit window (calendar, Apply history) moved to
  record-edit-dialog.tsx and downloads only when Edit is first clicked (11.9 KB later); the shared
  ConfirmButton uses the browser's <dialog> (all 11 users of it); the page uses the shared header.
  /jobs 228.7 → 219.3 KB, /bids 224.3 → 215.9 KB. Committed as fd4e097.
- Step 5 built 2026-11-15 (Bids): the list was every bid with all its answers; it is now one page
  at a time, searched and counted on the server (src/server/bids/bids-list.ts, tested); a bid's
  answers load when its View window opens; Export URLs asks the server for one day's URLs; the
  bids and candidates queries run together (3 waits → 2). Committed as 24d536f.
- Step 6 built 2026-11-15 (Home, Super Admin and Admin): the people, category count and sign-in
  reads run together (4 waits → 2); recent sign-ins read each staff member's last five from the
  (user, time) index instead of ranking every sign-in; the page uses the shared pieces.
  Committed as e5821e2.
- Step 7 built 2026-11-15 (Settings): the page and its tabs use the shared header, card and badge;
  the tab bar uses the named colours. Left for later: the Prompts tab still loads every version's
  full text for its version pickers (Super Admin only); loading the text on demand needs the
  pickers reworked. Committed as dc9edc5.
- Step 8 built 2026-11-15 (My AI prompts, Useful prompts, Categories): shared header, card and
  badges; the prompts guidance line is the header's description. Their data was already small.
  Committed as 4e94240.
- Step 9 built 2026-11-15 (Profile): shared header and cards, a role badge. The page reads the
  Manager's saved answers twice (once for the list, once for "Needs answer"); both run at the same
  time, so it costs a little database work, not time. Left as it is. Committed as 1529d80.
- Step 10 built 2026-11-15 (Resume): panels and buttons use the named colours and shapes; the
  page no longer wraps itself in the old shell. The PDF renderer already runs only on the server;
  the page's own browser code (resume data handling, default resume, ~37 KB) is all needed at
  start. /resume-template (the preview frame) needed nothing. Committed as cb048fe.
- Step 11 built 2026-11-15 (Gemini usage, Database usage): the responses list no longer sends
  each Google reply (up to 1 MB each, 100 per page) to the browser; View details loads one reply
  when it opens (response-actions.ts). The old-record clean-up runs after the page is sent
  (after()), and each tab's reads run together. Database usage's state read is shared within a
  request (React cache), so the page and the banner read it once. Both pages use the shared
  header, buttons and tab colours.

## Steps

### Step 0: measure first

Record, for every page: the JavaScript the browser downloads (from `next build`), how long the
server takes to render it, and how many database requests it makes. The same numbers are taken
again at the end, so the gain can be shown.

### Step 1: shared building blocks (src/app/ui/)

Named colours, radius and spacing in globals.css (primary, danger, success, warning, muted,
surface), each with its dark-mode value. Then one version of each piece:

- Button (primary, secondary, danger, ghost; small and normal; loading state) and LinkButton
- Card and Section (title, description, actions)
- Badge / status pill
- Tabs (address-based, with counts)
- Switch (the toggle)
- Form fields: text, text area, select, month and date, with label, hint and error
- Table (search, paging, group rows, empty state), replacing paginated-table
- Skeleton and EmptyState
- PageHeader with back link and actions
- Confirm dialog

They render on the server unless they must react to clicks, so they add little browser code.

### Step 2: the shell and loading

- Sidebar and top bar rebuilt on the new pieces.
- Each page gets its own loading skeleton, so navigation shows the page frame at once.
- Slow parts of a page stream in behind a skeleton instead of holding up the whole page.

### Steps 3 to 12: the pages, one per step (most used first)

3. People: list, Add New and Edit pages. The 1,724-line form file is split into one file per
   section, and heavy parts (calendars) load only when opened.
4. Jobs
5. Bids
6. Home (dashboard)
7. Settings: Super Admin tabs and the Manager's own settings
8. Prompts, Useful prompts, Categories
9. Profile
10. PDF and Resume template
11. Database usage and Gemini usage
12. Login

On each page: fewer database trips where queries can be combined, less browser code, and the new
pieces in place of hand-written styles.

### Step 13: clean-up

Remove the old palette recolouring, unused styles and components, and take the Step 0
measurements again.
