# QTS Job Application Workspace

QTS is a job-application platform built with Next.js. The initial milestone
establishes the application shell and dashboard preview; the workflows and
integrations will be implemented in later phases.

## Current status

- Next.js App Router, TypeScript, and Tailwind CSS application scaffold.
- Responsive sign-in page and role-scoped dashboard connected to Neon.
- Server-only Neon connection helper and Users/Profiles/Categories/Login History schema.
- Gmail mailbox OAuth is deferred until the candidate-consent flow is defined.
- Manager-only browser-extension sign-in and a Get JD workflow are available
  for local development. Gemini classifies pages and recommends matching
  Manager Accounts; Managers can review the suggestions and save Job List rows.

Planned AI responsibilities:

- OpenAI/ChatGPT: tailored resumes and cover letters only.
- Gemini: job-page classification and candidate fit evaluation; application
  answer generation is planned for a later workflow.
- API keys must remain server-side and must never use a `NEXT_PUBLIC_` prefix.

Manual application mode will leave Next/Submit to the Manager after review.
Auto mode is planned to generate documents, discover and fill supported form
fields, advance through the application, submit only under the agreed safety
checks, and save an application only after submission success is confirmed.
Email verification links will be shown to the Manager to review and open.

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

`OPENAI_API_KEY` and `GEMINI_API_KEY` are used only by their respective
server-side integrations. For local Get JD, put your Gemini API key value in
the `GEMINI_API_KEY` entry in `.env.local` (the variable name is not the name
you gave the key in Google AI Studio). The previous
`JD_READ_PROMPT_GEMINI_API_KEY_1` variable name is also accepted for
compatibility. Restart the QTS server after changing `.env.local`. Get JD also
requires an active default Gemini `job_description_evaluation` prompt.

## Browser extension sign-in

The extension authenticates active Manager accounts against
`POST /api/extension/auth/login`. It receives a signed bearer token valid for
24 hours and can verify it through `GET /api/extension/auth/me`. Each
verification reloads the Manager from Neon, so blocked accounts and sessions
invalidated by an auth-version change are rejected. The extension stores the
token in extension local storage and clears its local copy on logout; the
server-issued token expires after 24 hours. Use HTTPS for
deployed environments; the extension currently defaults to
`http://localhost:3000` for local development.

The authenticated extension popup has a persistent **Get JD** mode. While
enabled, it extracts job-page details from web pages opened in the browser and
posts them to `POST /api/extension/get-jd`. The endpoint resolves the Manager
and active candidate profiles from the bearer token, checks for a matching
Manager Job or Bid, and otherwise asks Gemini to classify the posting and
recommend candidate profiles. The Manager can adjust the recommended
selection and save one Job row per chosen Account through
`POST /api/extension/get-jd/save`. The extension does not create Bids, fill
application forms, or submit applications. Starting Get JD opens and pins a
ChatGPT tab if one is not already open; opening the extension popup while the
mode is active shows the Get JD status and a **Back Home** control. Back Home
clears the extension status and stops further Get JD page processing.

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
  `todo`, `pending`, `applied`, and `failed` statuses.
- `bids`: durable successful-application snapshots containing job, candidate,
  Manager, resume-path, and application timestamp details. A unique source job
  ID prevents duplicate archive rows when applying a job is retried.

Job title and URL each have independent PostgreSQL trigram indexes on both
Jobs and Bids to support partial text search. The `pg_trgm` extension is enabled
by the database migration. The application workflow that transitions a Job to
`applied` and inserts its Bid atomically still needs to be implemented.
Prompt selection mode is stored in the global `settings` row with key
`prompt_mode` and defaults to `global`. After applying migrations, seed editable
global starter prompts and this default with `npm run db:seed:prompts`. Super
Admin manages prompt versions, mode, and Manager assignments from `/settings`.
Managers can edit their private ChatGPT prompt at `/prompts` when private mode
is enabled; that page never reads Gemini prompts.

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
Staff passwords must contain at least four characters; longer passwords are
recommended for better security.

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
npm run lint
npm run build
```

The attached `plan.md` is a product template, not a complete implementation
contract. Decisions that affect privacy, OAuth consent, schema, or submission
behavior must be finalized before implementing those features.
