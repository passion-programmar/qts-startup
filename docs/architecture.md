# QTS architecture and supported boundary

## Supported release workflow

The supported browser-extension workflow is deliberately narrow:

1. A floating QTS launcher appears directly on supported web pages, including
   before extension sign-in.
2. The launcher expands to Get JD, Generation, Apply, and a session action that
   displays Sign In or Sign Out from the stored Manager session.
3. Sign In opens an embedded login panel; successful authentication closes it.
   The browser toolbar icon intentionally has no click behavior.
4. Get JD enables persistent monitoring. Each loaded page is extracted locally,
   checked against the Manager's Jobs and Bids, and reported in a page toast.
   It does not invoke Gemini.
5. Managers can queue Generation from a Jobs row. The signed-in extension
   processes queued jobs sequentially through the job page and ChatGPT, then
   downloads résumé PDF, cover-letter PDF, and JD text files locally, and
   records the expected local resume path on the Jobs row.
   Generation cancellation resets the application status to `todo` and
   clears the resume path, and attempts to remove files already downloaded by
   that run. Generation does not mark the job as applied; `applied` means the
   application was submitted successfully. The extension's Generation action
   can cancel an active run, including a queued run; Apply remains a release
   placeholder.
6. Sign Out clears persisted extension authentication and Get JD status.

Gemini evaluation is disabled by the `geminiEvaluation` runtime feature flag.
The server classification and idempotent save endpoints remain implemented for
a later release, but the current extension calls only the non-Gemini duplicate
check while Get JD monitoring is active.

Application-session, text-highlight, Gmail, and automatic-application code
remains in the repository as unfinished product work. The Jobs-table
Generation queue is supported; its generated files are rendered in memory and
downloaded by the extension rather than persisted as server files. Generation
run data remains in the database. A feature must not be enabled until its API,
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
| `POST /api/extension/get-jd/check` | Manager bearer token | Current duplicate check |
| `POST /api/extension/get-jd` | Manager bearer token | Reserved Gemini classification |
| `POST /api/extension/get-jd/save` | Manager bearer token | Reserved idempotent save |
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

## Database invariants

- A Manager and candidate can have only one Job for a normalized URL.
- A Manager and candidate can have only one Job for a normalized title/company
  pair.
- Inserts use `ON CONFLICT DO NOTHING`, making concurrent Get JD saves
  idempotent.
- Job business dates use `America/Los_Angeles`.
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
