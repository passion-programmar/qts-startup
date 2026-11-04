# QTS architecture and supported boundary

## Supported release workflow

The supported browser-extension workflow is deliberately narrow:

1. A floating QTS launcher appears directly on supported web pages, including
   before extension sign-in.
2. The launcher expands to Get JD, Generation, Apply, and a session action that
   displays Sign In or Sign Out from the stored Manager session.
3. Sign In opens an embedded login panel; successful authentication closes it.
   The browser toolbar icon forwards clicks to the in-page launcher, opening
   the sign-in form or toggling the actions panel on the current web page.
4. Text Highlight and URL Settings render directly in the same docked in-page
   panel as the candidate profile list. The panel reserves right-side page
   space, does not open a popup/iframe, and returns to profiles with Back.
5. Get JD enables persistent monitoring. When a page's HTML is ready (or a
   single-page site changes URL), a matching Manager-owned blocked URL fragment
   blocks QTS on that page silently. There is no built-in URL blocklist. Every
   other page is checked after its content settles, and again at +2 s and +5 s:
   it is a job page if two of the Manager's job-page detection keywords appear
   as whole words (plurals count), if it carries JSON-LD `JobPosting` data, or
   if job signals (job-site URL, Apply button or CV upload, posting headings,
   keywords; job lists penalized) score 3 or more. A job page showing a closed,
   expired, or not-found notice with no description (no `JobPosting` data and
   fewer than two posting headings) is rejected as closed. A rejected page is
   not extracted or sent to the server. The launcher flashes red once on an
   ordinary page; a browser check or sign-in page ("didn't load", with Try
   again) and a page one job signal short of passing ("not sure", with Send
   anyway and, for Managers who manage blocked URLs, Never on this site that
   pre-fills URL Settings) keep an orange badge and a notice instead. Lever,
   Workable, and PeopleForce apply-form pages are read from their description
   page; when that cannot be read, the notice offers Open description. Job
   text from embedded job-board frames (Greenhouse, Ashby, Lever, and others)
   is added to the page's. When Get JD needs nothing more on a tab (Gemini
   saved the job for every candidate it picked, the job is already saved, it is
   not eligible or not a job, it is closed, or the Manager saved the review),
   the tab closes after a 3-second countdown with Keep open. Pinned tabs, a
   window's last tab, and search pages showing one selected job never close,
   and the Manager can turn auto-close off on the card. Super Admin assigns Gemini matching to
   individual Managers in Settings; every other Manager uses general matching.
   General mode extracts locally and checks Jobs and Bids. Gemini mode sends the
   job's plain text to the server (shown and collapsed text alike, without the
   site's header, footer, menus, cookie banners, other listed jobs, or
   application form; a JobPosting description from the page's structured data
   is added when the page lacks it) with the default evaluation
   prompt and candidate ID/JD-note pairs, then prechecks returned candidate IDs.
   A Manager with the corresponding Super-assigned permission can add, edit,
   and delete only their own blocked URL fragments and job-page detection keywords.
   Super Admin also selects Local Count or Gemini Count (both counts recorded per
   request for comparison) and
   configures per-key request and generation-input-token limits from Gemini
   Usage. The usage page shows per-key totals and the latest 100 Google API
   responses for the Pacific day. Usage events (operation, key hash, token
   count, timestamp) back the quota accounting only and are pruned by the normal
   usage window; prompts and page content are not stored.
6. Generation claims the oldest eligible saved job whether or not a Manager
   manually queued it from the Jobs row. It requires a saved description, at
   least three candidate experience records, and no resume path. A JD-matching
   note is required only when the Manager is assigned Gemini matching for Get
   JD; the note is not included in the prompt. The signed-in extension runs
   jobs sequentially through ChatGPT, downloads résumé PDF, cover-letter PDF,
   and JD text locally, and records the expected resume path after delivery.
   Cancelling cleans up the run and partial downloads without recording a
   failure or attempt. While Generation stays on, the job is eligible for
   immediate retry. Other generation failures also retry automatically while
   Generation is on, without a saved failure count, with a brief pause between
   retries. Shared setup problems and uncertain delivery stop the queue.
   A five-minute hold expires when Chrome stops renewing it; the job then
   appears ready to retry and another Chrome may claim it. If the service
   worker restarts mid-run, the next queue tick releases the interrupted hold;
   signing out does the same before the token is cleared. Generation does not
   mark the job as applied; `applied` means the application was submitted
   successfully, and exactly then the job has a bid.
    A bid is created only after the Manager confirms successful submission, and
    only for a job whose Generation is `completed`. Assisted Apply and Auto
    Apply are implemented. Super Admin enables Apply per Manager and sets its
    answer provider, review cadence, and (for Assisted Apply) optional automatic
    Submit; the Manager still confirms the result. Auto Apply fills supported
    forms but always leaves the site's Submit action to the Manager. Deleting a
    bid returns the job to To do.
    For Auto Apply, a successful Manager confirmation records the bid and deletes
    the job row in the same database batch; an unconfirmed submission stays on
    the Jobs page and is never replayed.
    Generation file names use Japan time. The extension's Generation action
    can cancel an active run, including a queued run. The Manager selects an
    account and ready jobs in the Generation and Auto Apply pickers. Auto Apply
    requires a résumé, no bid, and at least three experience entries; assigned
    Gemini Get JD Managers also need matching notes. A live claim held by another
    Chrome is visible but disabled. Cancel or closing Chrome releases the claim
    while retaining a checkpoint for a later retry; a closed site's live form
    cannot be restored, so the retry reopens it and reuses saved answers.
7. Sign Out clears persisted extension authentication and Get JD status.

Get JD notifications consume the worker's individual result snapshots and
deduplicate updates by tab and `runId`. The worker keeps the latest 20 operation
records in local extension storage and persists the current two-second
aggregation batch alongside that history. It sends the live batch to the
focused, eligible page without replaying expired batches after a reload or
worker restart. The shared Shadow DOM toast stays at the page's top-left,
updates in place, and resets its five-second dismissal timer when a result
changes. Sign Out clears notification history along with the stored Get JD
results.

The extension enables the Get JD Gemini capability, but the server selects
General mode by default and uses Gemini only when Super Admin assigns Gemini
matching to that Manager. The in-page preview is local extraction; General mode
uses server duplicate/account/save APIs, while assigned Gemini mode uses the
server evaluation route and automatically saves matches.

Application-session, scanner, and Gmail code remains unfinished product work.
Assisted Apply and Auto Apply use the supported Manager-authenticated claim,
review, correction, and result routes. Auto Apply remains gated by the
Super-Admin Manager setting and the Manager's account/job selection; its
correction paths have synthetic extension and server coverage. The Jobs-table
Generation queue is supported; generated files are downloaded locally by the
extension, not stored as server files. On the normal path, the extension's
Chrome renders the résumé and cover letter from the HTML templates in
`public/resume-templates`, using the candidate's saved template and bundled
fonts. Vercel supplies the print-job data and template assets but does not spend
serverless CPU rendering those PDFs. The server-side `/api/pdf/print` Chromium
renderer is the fallback for Generation downloads from older extensions or
local-print failure, and it is the only function that bundles Chromium. Both renderers enforce a three-page
résumé and one-page cover-letter limit; technical server Chromium failures can
use the built-in `pdf-lib` renderer, which enforces the same limits. The Resume
page also prints in extension Chrome first and uses the server route as fallback.
Apply and Auto Apply require the exact résumé and cover-letter PDFs saved by
Generation. Their completed local paths are persisted with the delivered job
metadata and read from a user-authorized Downloads folder in this Chrome
profile. If either file is missing, invalid, or inaccessible, Apply stops with
an actionable error; it never invokes Chrome or server PDF rendering.
A Generation run opens one pinned ChatGPT tab at the Manager's configured ChatGPT
Project URL (default `https://chatgpt.com/`; only HTTPS ChatGPT URLs are allowed).
It starts a fresh chat from that URL for each job and replaces the tab after ten
jobs or a failed job. Apply uses the same Manager URL and ten-job tab lifecycle.
The Manager can continue working in their other ChatGPT tabs; Generation only
replaces QTS-owned Generation tabs. The configured URL is fetched for each new
ten-job batch. A tab gets 30 seconds to load and 30 more for the message box,
with up to two reloads. In ChatGPT, Generation sends with
the Send button (Enter if the prompt stays unsent), treats the answer as done
when ChatGPT stops writing, and allows three minutes for it. A ChatGPT error
refreshes the tab and resends once; an answer that cannot be used gets one
follow-up in the same chat with the reason. A failed job is retried while
Generation stays on, with a brief pause and no saved failure count. The Resume
page previews in the browser,
with no server round trip: the same template page (`?embed=1&view=pages`) lays
the document out in columns one page area tall, which Chromium splits with the
same fragmentation it prints pages with, and shows each column as a sheet
scaled to the panel width, so pages break where the PDF's do. Its Download
action prints in extension Chrome first and falls back to `/api/pdf/print`; both
paths enforce the résumé/cover-letter page limits. For previews and PDFs alike,
`render.js` widens the gaps on every
page but the last so that page ends at the bottom margin, which is smaller
than the top margin. Local
development sets `PDF_CHROME_EXECUTABLE_PATH` to an installed Chrome or Edge.
Generation run data remains in the database. A
feature must not be enabled until its API,
authorization checks, migrations, integration tests, and user-facing recovery
behavior are present.

## Ownership and identity

- Staff roles form `Super Admin -> Admin -> Manager`.
- Candidate Accounts belong directly to a Manager and cannot sign in.
- The extension authenticates only active Managers.
- All user, candidate, job, and prompt identifiers are UUIDs.
- Every extension candidate operation must verify that the candidate is an
  active direct child of the authenticated Manager.

The numeric Account identifiers used by unfinished extension modules are not a
supported server contract.

## Server domains

- `src/lib`: shared infrastructure such as sessions, password hashing, database
  access, and Gemini accounting.
- `src/server/auth`: server-only authentication policy and login throttling.
- `src/server/jobs`: canonical job values, duplicate detection, and idempotent
  job creation.
- `src/app`: pages, Server Actions, and thin HTTP Route Handlers.

Route Handlers authenticate at the boundary. Domain functions enforce data
rules and database operations so multiple callers use the same behavior.

## Extension API inventory

| Endpoint | Authentication | Status |
| --- | --- | --- |
| `GET /api/extension/auth/health` | None | Supported |
| `POST /api/extension/auth/login` | Manager credentials | Supported |
| `GET /api/extension/auth/me` | Manager bearer token | Supported |
| `GET /api/extension/features/me` | Manager bearer token | Supported per-Manager feature settings |
| `GET /api/extension/work-items` | Manager bearer token | Supported Generation/Auto Apply picker |
| `/api/extension/generation/*` | Manager bearer token | Supported queue and delivery lifecycle |
| `/api/extension/apply/*` | Manager bearer token + registered Chrome | Supported Assisted Apply and Auto Apply |
| `GET /api/extension/get-jd/mode` | Manager bearer token | Supported per-Manager matching mode |
| `POST /api/extension/get-jd/check` | Manager bearer token | Supported Jobs/Bids precheck |
| `POST /api/extension/get-jd` | Manager bearer token | Gemini evaluation for assigned Managers; see gate warning above |
| `POST /api/extension/get-jd/save` | Manager bearer token | Supported job save and account selection |
| `/api/candidates/*` | Undefined legacy contract | Disabled |
| `/api/jobs/*` and `/api/v2/jobs/*` | Undefined legacy contract | Disabled |
| `/api/application-*` | Server implementation absent | Disabled |
| `/api/v2/gpt-application-tasks/*` | Server implementation absent | Disabled |
| `/api/v2/extension-features/*` | Server implementation absent | Disabled |
| `/api/v2/account-mailboxes/*` | Server implementation absent | Disabled |

The popup and service worker resolve the server through
`extension/shared/runtime-config.js`. Production is the default. Local testing
may set `qtsServerUrl` in extension local storage; popup and background requests
then use the same normalized value.

After a Manager signs in, shared text highlights are applied on all supported
web pages independently of Manager-configured URL rules. Manager-owned blocked
URL rules suppress the launcher and other extension workflows.

## Database invariants

- A Manager and candidate can have only one Job for a normalized URL.
- A Manager and candidate can have only one Job for a normalized title/company
  pair.
- Inserts use `ON CONFLICT DO NOTHING`, making concurrent Get JD saves
  idempotent.
- Job dates use the time zone Super Admin chooses in Settings (Japan, Romania,
  and others; `America/Los_Angeles` until one is chosen). Only new jobs use it.
- A job keeps one `location`, including the country; there is no separate
  country field. Bids copy it.
- A bid is the same job as a jobs row by `source_job_id`, the cleaned URL, or
  `title_company_key`; bids keep no `job_key`.
- Gemini rolling request and token windows span Pacific midnight. Only the daily
  counter resets at midnight.
- Login throttling is stored in PostgreSQL so it applies across serverless
  instances. Successful authentication clears the account-specific bucket and
  retains the broader network counter.

## Required verification

Run these before merging:

```bash
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
```

Apply migrations to a disposable database before production. Migration `0012`
intentionally fails if existing Job rows violate the new uniqueness rules;
review and resolve such data explicitly instead of deleting it automatically.
