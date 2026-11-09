# QTS Job Application Workspace

QTS is a job-application workspace built with Next.js and a Chrome extension.
The extension identifies likely job pages locally before extracting details
and checking the signed-in Manager's saved jobs. This preflight does not call
Gemini.

## Current status

- Next.js App Router, TypeScript, and Tailwind CSS application scaffold.
- Responsive sign-in page and role-scoped dashboard connected to Neon.
- Server-only Neon connection helper and Users/Profiles/Categories/Login History schema.
- Gmail mailbox OAuth is deferred until the candidate-consent flow is defined.
- The browser extension provides an in-page launcher before sign-in. Get JD
  first checks the page locally, then contacts the server only for likely job
  pages. Super Admins can separately assign Managers access to blocked URL
  fragments and job-page detection keywords in the extension's URL Settings panel.
- Shared text highlights are applied automatically. Only Managers explicitly
  granted access by a Super Admin can edit their shared rules in the extension.
- Assisted Apply and Auto Apply are implemented and enabled per Manager by a
  Super Admin. Assisted Apply supports step-by-step review, review before
  Submit, and optional automatic Submit; the Manager still confirms success.
  Auto Apply fills supported forms and always leaves the site's Submit action
  to the Manager. Scanner, application-session, and Gmail workflows are deferred.

The canonical ownership model, supported APIs, disabled feature boundary, and
database invariants are documented in [docs/architecture.md](docs/architecture.md).

AI responsibilities:

- OpenAI/ChatGPT: tailored resume and cover-letter generation, and Auto Apply
  answers when selected as the Manager's provider.
- Gemini: candidate fit evaluation and Auto Apply answers when assigned.
  Current job-page detection is local and deterministic.
- API keys must remain server-side and must never use a `NEXT_PUBLIC_` prefix.

Super Admin enables Apply for each Manager and chooses ChatGPT or Gemini for
application answers. The Manager selects an account and ready jobs in the
extension's Auto Apply picker. Assisted Apply follows its configured review
cadence; Auto Apply leaves the site's Submit action and success confirmation to
the Manager. Check saves corrections using candidate, application, or Manager
scope; global reusable answers remain Super Admin managed.

Super Admin can also turn on **Auto Apply with APIs** per Manager, off by
default. That Manager's Auto Apply checks who is signed in to the job site,
empties the form, asks the server's Gemini and Groq keys once per page, then
uploads and fills. The Manager still moves the form on and clicks Submit.
Managers without the switch keep ChatGPT. See
[docs/AUTO_APPLY_WITH_APIS_REPORT.md](docs/AUTO_APPLY_WITH_APIS_REPORT.md).

Super Admin can set a ChatGPT Project URL per Manager. Generation and ChatGPT-backed Apply start a fresh chat from that URL for each job and replace their pinned ChatGPT tab after ten jobs. The default is `https://chatgpt.com/`.

## Local development

Requirements: Node.js 20.9 or newer and npm.

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open <http://localhost:3000>. Sign in with the staff login name and password
configured for the initial Super Admin. Candidate Accounts cannot sign in.

## Environment variables

Set `DATABASE_URL` to a Neon PostgreSQL connection string and `AUTH_SECRET` to
a unique random value of at least 32 bytes in `.env.local`. The local
development secret is generated automatically when this project is set up.
For another environment, generate a separate secret and store it only in that
environment's secret store. Never reuse secrets between environments or commit
them.

`OPENAI_API_KEY`, Gemini keys and Groq keys are used only by their respective
server-side integrations. Set `GEMINI_API_KEYS` and `GROQ_API_KEYS` to
comma-separated lists of keys. For one Gemini key, `GEMINI_API_KEY` is still
supported; the older `JD_READ_PROMPT_GEMINI_API_KEY_1` variable is also accepted
for compatibility.

Each request tries models in the order in `src/server/gemini/ai-models.ts`: Gemini
3.6 Flash, Gemini 3.5 Flash-Lite, then Groq GPT-OSS 120B. Each model has its own
key rotation, in random order, and no key is called twice on a model until all
have been called. On an error the same key tries the next model; if that fails
too, the next key starts again from the first model. Every key + model pair has
its own limits, usage and pauses. Super Admin sets the limits per model on the
Gemini Usage page, where they count GenerateContent and CountTokens calls, and
Model test calls. Daily usage resets at midnight Pacific.
Before a Get JD
evaluation, the server estimates input tokens locally using a production-
calibrated character and word formula. It uses the larger result, counts
non-ASCII code points conservatively, includes the generation configuration and
response schema, and adds headroom targeting roughly twenty percent above
observed Google counts. This estimate protects local capacity but is not an
exact tokenizer result. In **Local Count** mode (the default) Get JD sends one
`generateContent` request and never calls `countTokens`. In **Gemini Count**
mode it also calls `countTokens` and records both counts on the request so they
can be compared; the key's token limit then uses Google's count. Super Admin
switches modes on Gemini Usage → Google responses & calibration. The Gemini Usage page shows per-key totals and the
latest 100 Google API responses for the current Pacific day (status, duration,
and the response body capped at 1 MB). It does not store prompts, page text, or
API keys. If no key has capacity, QTS does not generate the evaluation. A Gemini
5xx overload (for example 503 "high demand") is retried once on the same key
after 2 seconds and counted as another request; other errors are not retried.

Gemini keys are reserved atomically in Neon while a Get JD evaluation is
running. A concurrent request skips a busy key and tries another free key.
The token-count and generation calls for one evaluation use the same reserved
key; the reservation is released when the request finishes. It expires after
two minutes if a server process stops before cleanup. When every key is busy
or at its QTS limit, QTS returns HTTP 503 (temporarily unavailable), not 429;
it does not wait in a queue. HTTP 429 is reserved for a 429 response from
Google.

Google applies its own quotas per project, not per key. Keys from one project
share Google's quota, so these QTS per-key caps do not increase the project's
Google quota. The Super Admin can see per-key QTS usage and remaining capacity
on the **Gemini usage** page; key values are never displayed. Store keys only
in the server environment, never in client-side code or source control.
Restart the QTS server after changing `.env.local`. The server-side Gemini job
evaluation endpoint requires an active default `job_description_evaluation`
prompt, although the current extension keeps that endpoint disabled.

For on-demand token-estimator calibration, set
`ENABLE_GEMINI_TOKEN_COMPARISON=true` only in the Vercel Production environment.
The Super Admin Gemini usage page then shows a comparison form that runs the
local estimate and Google's `countTokens` request on Vercel for the same prompt.
The route is unavailable on localhost and Vercel Preview. Remove the Production
environment variable after calibration and redeploy to disable the form and endpoint.

## Browser extension sign-in

The extension authenticates active Manager accounts against
`POST /api/extension/auth/login`. It receives a signed bearer token valid for
24 hours and can verify it through `GET /api/extension/auth/me`. Each
verification reloads the Manager from Neon, so blocked accounts and sessions
invalidated by an auth-version change are rejected. The extension keeps the
token in its own IndexedDB, which content scripts on web pages cannot read;
extension local storage holds only the expiry and session user. Sign Out
deletes the token, and the server-issued token expires after 24 hours. Server
URLs must use HTTPS, except for loopback development servers. The extension
source is in `extension/` and defaults to `https://qts-job-system.vercel.app`
for sign-in and API requests. The Manager sign-in form lets you choose
**Hosting** or **Local**; Local targets `http://127.0.0.1:3000`. That choice is
saved for subsequent extension API requests. Sign out before switching servers
so the next sign-in uses an account from the selected environment.

To load the unpacked extension in Chrome, open `chrome://extensions`, enable
Developer mode, select **Load unpacked**, and choose the repository's
`extension/` folder. After pulling extension changes, use **Reload** on the
extension's card.

To give Managers a minified build, run `npm run build:extension`. It writes only
`dist/qts-extension-<version>.zip` (unzip it and load that folder unpacked) and
removes older zips and build folders from `dist/`. Bump `version` in
`extension/manifest.json` before each build you share so Managers can tell
releases apart. Minification makes the code harder to read, not secret.

The extension content script starts at `document_start`; the floating launcher
is mounted after DOM readiness on the active, supported web page and restored
when tab or window focus changes. It is available before sign-in. Opening it
shows a docked panel with **Get JD**, **Generation**, **Apply**, and **Sign In**
or **Sign Out**. The browser toolbar icon forwards clicks to this in-page
launcher; it does not open a separate popup. Sign In opens the Manager login
form in an extension-origin frame on the current page, so the page cannot
observe the credentials, and the frame closes after a successful login.
The floating Get JD action enables persistent `get_jd` monitoring, which starts
when a page's HTML is ready. A matching Manager-owned blocked URL fragment
blocks QTS on that page.
There is no built-in URL blocklist. Once content settles, local detection
accepts a page with two Manager keywords, `JobPosting` structured data, or
enough job signals (see `extension/shared/job-page-detection.js`). Managers
with Super-Admin permission can maintain their own blocked URL fragments and
detection keywords; a block fragment matches the current URL. General Get JD
extracts locally, checks Jobs/Bids and candidate account states through the
server, then lets the Manager select and save accounts. Gemini matching is
assigned per Manager; it sends visible job text and candidate matching notes
to the server and automatically saves matches. The extension enables this
capability, but the server uses Gemini only when Super Admin has assigned it to
that Manager; otherwise it stays in General mode. Super Admin can choose Local
Count or Gemini Count; Gemini Usage records per-request counts next to Google
responses.
Exclusion updates also apply to already-open pages. Text Highlight and URL
Settings render as native controls inside the same docked in-page panel as the
candidate profile list, rather than opening a popup, iframe, or page-covering
overlay. The panel reserves space at the right side of the page and returns to
the profile list with its Back control.
After a Manager signs in, text highlights from the shared rule set render
automatically on all supported web pages, including pages excluded from the
launcher and other extension workflows. The launcher editor is available only
to Managers granted `canManageTextHighlights` by a Super Admin.
Managers start document generation from the extension. The worker claims the
oldest eligible saved Jobs row (`createdAt`), even if it was not manually
queued. Eligibility requires a saved job description, at least three candidate
experience records, and no existing resume path. A JD-matching note is also
required when the Manager is assigned Gemini matching for Get JD; notes are
never sent in the Generation prompt. Generation does not use or change the
job's application status. The server builds each prompt from the saved job and
structured candidate profile, using the Manager's active prompt assignment or
the active global default. A Jobs-row selection can save a prompt for that job,
but a job does not need to be manually queued before the worker can claim it.
The extension sends the prompt through a pinned ChatGPT tab, then downloads
the résumé PDF, cover-letter PDF, and JD text file to local Downloads. PDF and JD files are assembled for
delivery rather than stored as server files; the Generation run retains the
prompt and validated response. The Jobs row records the expected resume path
after successful delivery.

Cancelling cleans up the current run and any partial downloads without saving a
failure count. If Generation remains on, the job is eligible to be picked up
again immediately. Other generation errors are also retried automatically while
Generation is on, without a saved failure count; a brief pause separates retries.
Shared setup problems and uncertain delivery stop the queue so they can be
resolved safely. A job whose Chrome stops renewing its five-minute hold is
ready to be claimed again, and the Jobs page no longer shows it as processing.
Super Admin enables Apply per Manager. Assisted Apply reviews form steps with
the Manager; Auto Apply fills supported steps and leaves the site's Submit
action to the Manager.
Sign Out clears the stored extension session and Get JD mode. The legacy popup
Gemini mode is hard-disabled by the shared runtime feature configuration so an
old stored mode cannot start background classification.

## Users and candidate profiles

The initial database schema contains:

- `users`: staff and candidate Account identities, role, immediate parent,
  staff display/login credentials, blocking metadata, and timestamps. Candidate
  names live only in their `profiles` row.
- `profiles`: one-to-one candidate details for Account users, with an optional
  category assignment and optional resume PDF template reference. Candidate
  fields are nullable so Managers can save drafts.
- `categories`: category names selectable on candidate profiles.
- `educations` and `experiences`: repeatable education and work-history records
  owned by candidate profiles. Dates are optional month-precision dates stored
  on the first day of the month; current records cannot have an end date, and
  end dates cannot precede start dates.
- `settings`: global JSON settings, with an optional reference to the staff
  member who last updated each value. Settings-management actions must enforce
  Super Admin-only access.
- `prompts`: versioned global prompts. OpenAI has one shared document-generation
  prompt for resumes and cover letters; Gemini has separate job-description
  evaluation and application-answer prompts. Only Super Admin can manage
  global prompts.
- `manager_prompt_overrides`: one private OpenAI prompt per Manager. In private
  prompt mode, it is used when no Super Admin assignment overrides it; if no
  private prompt exists, the active global OpenAI prompt is the fallback.
- `manager_prompt_assignments`: one stable Super Admin-selected prompt per
  Manager. Assignments take precedence in either mode. Removing an assignment
  restores the normal global/private selection without deleting the Manager's
  private prompt. Managers must not be allowed to read or change Gemini prompts.
- `jobs`: Manager-owned, candidate-specific daily application tasks with
  `todo`, `pending`, `applied`, and `failed` application statuses, plus a
  separate Generation queue status, processing lease, and nullable local resume
  path. Generation completion does not change the application status to
  `applied`.
- `generation_runs`: Generation prompts, job descriptions, and response data
  associated with the Manager and (for queued work) the exact Jobs row. PDF
  and JD download files are assembled transiently and are not persisted.
- `bids`: durable successful-application snapshots containing job, candidate,
  Manager, resume-path, and application timestamp details. A unique source job
  ID prevents duplicate archive rows when applying a job is retried.

Job title and URL each have independent PostgreSQL trigram indexes on both
Jobs and Bids to support partial text search. The `pg_trgm` extension is enabled
by the database migration. The application workflow that transitions a Job to
`applied` and inserts its Bid atomically still needs to be implemented.
After applying migrations, seed editable global starter prompts with
`npm run db:seed:prompts`. Super Admin manages the prompt library from
`/settings`; the ChatGPT prompt marked Global default is the fallback for
document generation.

- Each Manager writes their own ChatGPT document prompts at `/prompts`
  (`prompts.owner_manager_id`): add, edit and delete. Saving adds a version and
  earlier versions can be put back in use; deleting archives every version
  (`prompts.archived_at`), so nothing is erased. Super Admin sees them
  read-only in `/settings`.
- Each Generation takes the Manager's own prompt they used longest ago (a new
  one first), or the default prompt when they have none, and rotates through
  all PDF templates the same way. Both are read from the Manager's past
  `generation_runs`, which record the prompt version (`prompt_id`) and template
  (`pdf_template`) each run used; delivery copies them onto the job, and
  marking it Applied copies them onto the bid, so Jobs and Bids show what was
  used.
- Categories only group candidates. Every candidate has one; the default
  category (`categories.is_default`, seeded as Global) is where new candidates
  start and where a deleted category's candidates move. `/prompts` never reads
  Gemini prompts.

`resume_pdf_id` is nullable and intentionally has no foreign key yet. The
resume-template table and its ownership/storage model are deferred, so no
candidate can be assigned a nonexistent template until that model is decided.

The database enforces the role hierarchy (Super Admin → Admin → Manager →
Account), makes staff login names and normalized candidate email addresses
unique, prevents changing a user's role, and only permits profiles for Account
users. Candidate Accounts have no login credentials. User records are retained;
blocking does not delete them.

Staff sign-in uses a signed, HTTP-only, seven-day session cookie and verifies
the user's active status against Neon on each request. Login errors do not
reveal whether a login name exists. Successful login history is retained for
the latest five sign-ins per staff user and is visible only to Super Admin.
Role-scoped dashboard queries show each staff member only their own branch of
the user hierarchy.

The Users page follows the same hierarchy: Super Admin creates Admins, Admins
create Managers, and Managers create candidate Accounts with draft profiles.
New Admin and Manager display names are assigned from their role, so their
creation form only asks for a username and password. The dashboard shows the
full display name and username rather than using an initial as the identity.
Candidate creation captures name, email, phone, headline, LinkedIn URL, country
name, city, province/state, one address line, postal code, and optional category
in one full-width form for Managers. Managers can add multiple Education and
Experience records in that same form; each entry supports month/year dates,
optional details, and a current-status selection. Candidate and history records
are saved atomically, and incomplete history rows are rejected rather than
silently discarded.
Only Super Admin manages the shared candidate category list at `/categories`;
Managers can assign an existing category to a candidate but cannot add, rename,
or delete categories. Deleting a category clears that assignment on profiles.
Get JD displays each candidate's name and assigned category in the review list.
Staff can update their own display name and login name from Profile after
confirming their current password; they can optionally replace their password.
Only Super Admin can update another staff member's login name or password.
Super Admin can permanently delete Admin and Manager accounts. If an account
has direct reports, the reports must first be reassigned to another active
Admin or Manager peer at the same hierarchy level; the reassignment and
deletion happen atomically. Deletion is refused while blocking-audit references
remain and also removes that staff user's login history; it cannot be undone.
Password fields have a show/hide control while entering a password, but saved
passwords cannot be viewed because the database stores only one-way hashes.
Changing a password invalidates the user's existing sessions.
New and replacement staff passwords must contain at least 4 characters.
Existing password hashes remain valid until the password is changed. Login
attempts are throttled in PostgreSQL and successful authentication clears the
account-specific attempt bucket while retaining the network abuse counter.

After adding `DATABASE_URL` to `.env.local`, apply the migration with
`npm run db:migrate`. This modifies the selected Neon database.

To create the one-time Super Admin, add these values to `.env.local` and run
`npm run db:seed:super-admin`:

```env
SUPER_ADMIN_DISPLAY_NAME="Super Admin"
SUPER_ADMIN_LOGIN_NAME="superadmin"
SUPER_ADMIN_PASSWORD="choose-a-unique-password"
```

The seed command hashes the password with scrypt, refuses to create a second
Super Admin, and never prints the password or hash. Sign in at
<http://localhost:3000/login> using that login name and password. Remove the
seed password from `.env.local` after the command succeeds. Do not commit real
environment values.

## Validation

```bash
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
```

The attached `plan.md` is a product template, not a complete implementation
contract. Decisions that affect privacy, OAuth consent, schema, or submission
behavior must be finalized before implementing those features.
