# Get JD redesign: shared jobs, per-Manager Gemini, scored detection

Status: **proposed, not implemented**. Approve or correct this document before code changes.

## 1. Decisions

| Topic | Decision |
|---|---|
| Matching mode | Chosen **per Manager**. Super Admin assigns Gemini to specific Managers; everyone else uses general mode. The global Manual/Gemini setting is removed. |
| Job storage | One **shared** `jobs` row per posting for all Managers. Each candidate (account) tracking it gets a `job_accounts` row with `relation_id`, `account_id`, `manager_id`. |
| Visibility | Everything a Manager sees is computed from **their own** `job_accounts` rows. A job saved only by other Managers is shown as **New job**; its row is reused silently. |
| Description | Two fields: `description` and `page_text`. If `description` exists, use it; otherwise use `page_text`. Saving a `description` clears `page_text`, so a job never keeps both. |
| Description sources | Gemini mode: `description` = Gemini's text. General mode: `description` = text read from the page by the extractor. `page_text` (full page `innerText`) is stored only when no description is available. |
| Save order | Both modes: save the job row first, then each account one by one. |
| Applied jobs | "Applied" locks only that account. Other available accounts can still be added in both modes. |
| Checkboxes | A checkbox means "this account has this job". Applied accounts are checked and disabled. Saved accounts are checked and can be unchecked (removed on Save). Available accounts start unchecked. |
| Editing job details | Edits change the shared row for every Manager and candidate on it; the last editor is recorded. |
| Jobs page | One row per account (`job_accounts` joined with `jobs`). |
| Non-job page | No toast. The QTS launcher flashes red once, then returns to normal. |

## 2. Data model

```
jobs (shared, one per posting)            job_accounts (per Manager, per account)
──────────────────────────────            ───────────────────────────────────────
id                 uuid PK  = relation_id  id                    uuid PK
job_key            text UNIQUE             relation_id           uuid → jobs.id
title_company_key  text (indexed)          manager_id            uuid → users.id
job_url, job_title, company                account_id            uuid → profiles.user_id
description        text  (preferred)       date, status, failure_reason, job_reason
page_text          text  (fallback)        auto_saved_by_get_jd
location, country, employment_type,        resume_local_path
workplace_type, salary                     generation_status, generation_attempt_count,
is_job_page, is_remote, classified_at        generation_error, generation_lease_expires_at
first_saved_by_manager_id                  created_at, updated_at
last_edited_by_manager_id, created_at,     UNIQUE (relation_id, account_id)
updated_at                                 INDEX (manager_id, date), (account_id, date, status)
```

Effective description everywhere (Generation prompt, Jobs page, exports):
`coalesce(nullif(btrim(description), ''), page_text)`.

Description rules (one helper in `src/server/jobs`, used by every save and edit):
- A save **with** a non-empty description sets `description` and sets `page_text = NULL`.
- A save **without** a description stores `page_text` only when the row has no `description`.
- A row therefore holds either `description` or `page_text`, never both.

Filling a shared row later: a save fills **empty** fields only. For example, a later save that brings a description to a row that only has `page_text` sets the description and clears `page_text`. Saves never overwrite a non-empty `description` or other non-empty fields; only an explicit edit on the Jobs page does.

Other tables:
- `bids.source_job_id` → `job_accounts.id` (still unique, one bid per account row). Bids keep their own copy of the job details as an application snapshot.
- `generation_runs.job_id` → `job_accounts.id` (a résumé is made for one account on one job).
- `users.use_gemini_matching boolean default false` replaces the `get_jd_matching_mode` setting.

## 3. Duplicate prevention

`job_key` is computed **only on the server** by one shared function, used by the routes, the migration script, and the tests.

1. Platform job ID when found, for example `linkedin:<currentJobId or /jobs/view/id>`, `indeed:<jk>`, `greenhouse:<gh_jid or /jobs/id>`, `lever:<posting uuid>`, `workday:<tenant>:<req id>`, `ashby:<posting uuid>`, `smartrecruiters:<id>`.
2. Otherwise the normalized URL. Prefer the page's canonical URL (`<link rel="canonical">` or the JSON-LD `url`). Then lowercase the host and drop `www.`, force `https`, remove the `#fragment` and trailing `/`, and remove tracking parameters (`utm_*`, `gclid`, `fbclid`, `ref`, `refId`, `source`, `trk`, `trackingId`, `lever-source`, `gh_src`).

`title_company_key`: title and company lowercased, with punctuation and extra spaces removed, legal suffixes (`inc`, `llc`, `ltd`, `gmbh`, `corp`) dropped, and remote tags (`(remote)`, `- remote`) dropped. It is not unique: a match against the **same Manager's** rows on another `job_key` marks the account **Possible duplicate** (a warning, not a block).

Database guarantees (race-safe for double clicks and two tabs):
- `INSERT INTO jobs … ON CONFLICT (job_key) DO NOTHING`, then select by `job_key`, gives one row.
- `INSERT INTO job_accounts … ON CONFLICT (relation_id, account_id) DO NOTHING` per account. A skipped insert is reported as "already has this job", not as an error.

## 4. Per-account states (both modes)

A checkbox means "this account has this job".

| State | Rule (scoped to the current Manager) | Checkbox | Manager can |
|---|---|---|---|
| Applied | A bid exists for this account and job, or the account row's status is `applied` | Checked, disabled | Nothing |
| Generation running | The account row's Generation is `processing` | Checked, disabled | Nothing until it finishes |
| Has this job | A `job_accounts` row exists for (relation_id, account) | Checked | Uncheck it; Save removes that account row |
| Possible duplicate | Same `title_company_key` on another job for this account | Unchecked (shows source site and date) | Check it to add |
| Available | None of the above | Unchecked (Gemini-recommended accounts are auto-saved, so they show as Has this job) | Check it to add |

Save applies the difference against the stored state, account by account:
- checked and not yet saved: insert a `job_accounts` row (`ON CONFLICT DO NOTHING`)
- saved and now unchecked: delete that account row, which the server allows only if it has no bid, its status is not `applied`, and Generation is not running
- unchanged: no write, so an account is never added twice

Summary toast and panel line, for example: **Applied by 1 candidate · 2 already have this job · 3 can be added.** If no account is available: **All candidates already have this job.**

### Jobs and Bids together

| Table | Meaning | Scope |
|---|---|---|
| `jobs` | The posting exists (details, description) | Shared by all Managers |
| `job_accounts` | An account is tracking the posting (todo, pending, applied, failed; résumé; Generation) | One Manager, one account |
| `bids` | The account really applied: a permanent record with its own snapshot of the job details | One Manager, one account |

Bids are written by the Apply workflow (still disabled) after a submission is confirmed.

Rules:
- `bids` gets a `job_key` column (backfilled from each bid's saved URL). "Applied" is found by (manager_id, account, job_key), so it holds even if the `job_accounts` row was deleted. `bids.source_job_id` has no foreign key today.
- An account is **Applied** if a matching bid exists **or** its `job_accounts.status` is `applied`. Creating a bid also sets that status, so the two stay in step.
- Only the current Manager's bids count. Another Manager's bid for the same posting does not change what this Manager sees.
- On the Jobs page, a `job_accounts` row with a bid cannot be deleted; delete the bid on the Bids page first.
- A `jobs` row is deleted only when no `job_accounts` row uses it. Bids do not block this because they keep their own snapshot.
- Retrying a failed application happens from the Jobs page (status back to todo). Get JD never re-adds an account that already has the job.

| In `jobs` | Manager's `job_accounts` | Manager's `bids` | Shown |
|---|---|---|---|
| No | none | none | New job |
| Yes, saved only by other Managers | none | none | New job (shared row reused; all accounts Available) |
| Yes | account A | none | A: Has this job; others Available |
| Yes | account A | A | A: Applied; others Available |
| Yes | none | A | A: Applied; others Available |
| any | none | only other Managers' bids | New job |

## 5. Job-page detection (extension, before any server call)

The order is unchanged: (1) the Manager's blocked URLs reject silently; (2) detection; (3) server.

Detection becomes a score:

| Signal | Effect |
|---|---|
| JSON-LD `JobPosting` present | pass immediately |
| Closed phrases ("no longer accepting applications", "this job has expired", "position has been filled") | reject |
| Job-site URL pattern (ATS host or `/jobs/<id>`, `/careers/…`, `?gh_jid=`, `/viewjob?jk=`, `/jobs/view/`) | +2 |
| Apply button ("apply", "apply now", "easy apply") or CV upload field | +2 |
| Two or more posting headings (responsibilities, requirements, qualifications, about the role, what you'll do, benefits) | +2 |
| Each Manager job-page keyword, **whole word or phrase** match, at most 3 | +1 each |
| Looks like a job list (many repeated job cards or links) | −3 |
| **Pass at score ≥ 4** | |

On failure: no toast; the launcher flashes red once (about 1.2 s) and returns to normal. A Manager with fewer than two keywords still gets detection from the other signals.

## 6. Flows

### General mode (Manager not assigned to Gemini)
1. Page passes detection. The extension extracts title, company, description and the other fields locally, and reads `innerText`.
2. `POST /api/extension/get-jd/check` with `{ job, pageText }`. The server computes `job_key`, finds the shared row if any, and returns `{ relationId | null, accounts: [{ id, state }], summary }`.
3. The panel lists accounts by state: applied ones checked and disabled, saved ones checked, the rest unchecked. The Manager checks new accounts or unchecks saved ones, and clicks Save.
4. `POST /api/extension/get-jd/save` with `{ job, pageText, accountIds }`, where `accountIds` is the full checked set. The server upserts the job: the extractor's description when found (with `page_text` cleared), otherwise `page_text` from `innerText`. Only empty fields are filled. It then adds newly checked accounts and removes unchecked saved ones, one by one, and returns a per-account result.

### Gemini mode (Manager assigned)
1. Page passes detection. The extension sends `{ pageUrl, pageTitle, pageText }` to `POST /api/extension/get-jd`.
2. The server computes `job_key` from the URL and loads the Manager's account states. Only **available** and **possible duplicate** accounts are evaluated. If none remain, it returns "All candidates already have this job" **without calling Gemini**.
3. If the shared row already has `is_job_page` and `is_remote`, the server reuses them and asks Gemini only for candidate matching. Otherwise it runs the full evaluation.
4. The server upserts the job row first (description = Gemini text, `page_text` cleared; `page_text` is kept only if Gemini returned no description), then saves each recommended account one by one. It returns account states and the auto-saved accounts.
5. The panel shows the same checkboxes as general mode: auto-saved and earlier saved accounts are checked and can be unchecked, applied ones are checked and disabled, and Save applies the difference.

## 7. Changes by area

| Area | Change |
|---|---|
| Schema / migrations | New `jobs` and `job_accounts`, `users.use_gemini_matching`, re-pointed `bids` and `generation_runs` (see section 8). |
| `src/server/jobs` | `job-key.ts` (key functions plus tests), shared-job upsert, per-Manager account-state query. |
| Get JD routes | `check`, `save`, `get-jd`, `profiles`, `mode`, `auto-saved-jobs/[id]` rewritten for the new model. `mode` returns the Manager's own mode. |
| Generation routes | `claim`, `start`, `heartbeat`, `complete`, `finalize`, `fail`, `release`, `cancel`, `cancel-all`, `status`, `artifacts` work on `job_accounts` joined with `jobs`. |
| Jobs page and actions | List `job_accounts` for the Manager. Status and Generation edits change the account row; detail edits change the shared row and set `last_edited_by`. Delete removes the account row, then the job row if nothing else uses it. |
| Bids | `source_job_id` refers to `job_accounts.id`; new `job_key` column; the Bids page and presence checks use (manager, account, job_key). |
| Settings | Super Admin "Use Gemini matching" toggle per Manager; the global mode setting is removed. |
| Extension | Scored detection module, whole-word keywords, red launcher flash, `pageText` sent in general mode, four account states with a summary, extractor coverage additions (section 10). |

## 8. Migration (expand → backfill → contract)

Take a Neon branch backup first.

1. **Expand** (migration): rename the current `jobs` table to `job_accounts`. Every existing row is already "one job for one candidate", and keeping its `id` keeps `bids.source_job_id` and `generation_runs.job_id` valid. Create the new `jobs` table, add a nullable `job_accounts.relation_id`, and add `users.use_gemini_matching` (set true for every Manager if the current global mode is `gemini`).
2. **Backfill** (one-off script `scripts/migrate-shared-jobs.ts`, using the same `job-key.ts`): compute `job_key` for each account row, create one `jobs` row per key (description = most recent non-empty description; `page_text` stays empty because old rows only have descriptions), set `relation_id`, fill `bids.job_key` from each bid's `job_url`, and report merged groups. Rows with the same Manager, account and key are reported for manual review instead of being deleted.
3. **Contract** (migration): make `relation_id` NOT NULL, add the foreign key and `UNIQUE (relation_id, account_id)`, drop the job-detail columns from `job_accounts`, and drop the old per-candidate unique indexes and the `get_jd_matching_mode` setting.

Server code for steps 2–3 ships together with the new routes. The extension update ships after the server.

## 9. Delivery order

1. Extension-only: red flash, whole-word keywords, scored detection.
2. Per-Manager Gemini assignment (settings, `mode` route, migration flag).
3. `job-key.ts` with tests, plus expand migration and backfill script, run on a Neon branch first.
4. Server switch: Get JD, Generation, Jobs and Bids on the new model, then the contract migration.
5. Extension flow: `pageText` in general mode, account states, Gemini only on available accounts.
6. Extractor coverage additions.

Each step is its own commit with tests; steps 3–4 are deployed together.

## 10. Extractor coverage additions

- New platforms: Lever, Workday (`*.myworkdayjobs.com`), iCIMS, Jobvite, Teamtailor, Recruitee, BambooHR, Breezy, JazzHR, Personio, Rippling, Wellfound, Oracle/Taleo, SuccessFactors.
- Fallbacks:
  - company from the ATS URL (`jobs.lever.co/<company>`, `<company>.greenhouse.io`, `<company>.myworkdayjobs.com`)
  - `itemprop="hiringOrganization"` microdata
  - `og:site_name`
  - more title patterns ("Title at Company", "Title – Company | Careers", "Company – Title")
- Embedded boards: run extraction in the frame that hosts a Greenhouse or Lever board on company career pages. Content scripts do not run in frames today.

## 11. Testing

- `job-key.ts`: platform IDs, tracking-parameter removal, canonical preference, and title/company normalization.
- Description helper: a description save clears `page_text`; a `page_text` save never touches an existing description; the effective description prefers `description`.
- Server: shared upsert under concurrent saves; account states (applied, has job, possible duplicate, available) scoped per Manager; "another Manager's job is New job for me"; Gemini skipped when no account is available.
- Migration: backfill on a copy of production data with merge counts and no orphaned bids or Generation runs.
- Extension: the detection score on fixture pages (posting, job list, closed posting, news article), whole-word keywords, and the red flash on rejection.
