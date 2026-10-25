# Get JD redesign: shared jobs, per-Manager Gemini, scored detection

Status: **approved**. Steps 1 (scored detection) and 2 (per-Manager Gemini) are implemented; later steps follow section 9.

## 1. Decisions

| Topic | Decision |
|---|---|
| Matching mode | Chosen **per Manager**. Super Admin assigns Gemini to specific Managers; everyone else uses general mode. The global Manual/Gemini setting is removed. |
| Job storage | **One table, `jobs`**, one row per account on a job (as today). Rows for the same posting share a `relation_id`, across all Managers. |
| Same job | Two pages are the **same job** if their `job_key` (cleaned URL or platform ID) matches **or** their `title_company_key` matches. Both rules are hard: an account can never get the same job twice by either. |
| Visibility | Everything a Manager sees is computed from **their own** rows. A posting that only other Managers saved shows as **New job**; its `relation_id` is reused silently. |
| Description | Two fields: `description` and `page_text`. If `description` exists, use it; otherwise use `page_text`. Saving a `description` clears `page_text`, so a posting never keeps both. |
| Description sources | Gemini mode: `description` = Gemini's text. General mode: `description` = text read from the page by the extractor. `page_text` (full page `innerText`, plain text) is stored only when no description is available. |
| Save order | Both modes: the first account saved creates the posting's `relation_id`; every further account reuses it, one by one. |
| Applied jobs | "Applied" locks only that account. Other available accounts can still be added in both modes. |
| Checkboxes | A checkbox means "this account has this job". Applied accounts are checked and disabled. Saved accounts are checked and can be unchecked (removed on Save). Available accounts start unchecked. |
| Editing job details | An edit updates every row with the same `relation_id`, for all Managers and accounts. |
| Jobs page | One row per account, as today. |
| Non-job page | No toast. The QTS launcher flashes red once, then returns to normal. |

## 2. Data model

`jobs` keeps all current columns. New columns:

| Column | Type | Purpose |
|---|---|---|
| `relation_id` | uuid, not null | Same value on every row of the same posting, across Managers |
| `job_key` | text, not null | Platform job ID or normalized URL (section 3) |
| `title_company_key` | text, not null | Normalized title + company; a match means the same job |
| `page_text` | text, null | Plain `innerText`, kept only while `description` is empty |

```
id | relation_id | job_key            | manager | account  | title        | status  | …
1  | R-100       | linkedin:40123     | M1      | account1 | Frontend Eng | todo    |
2  | R-100       | linkedin:40123     | M1      | account4 | Frontend Eng | applied |
3  | R-100       | linkedin:40123     | M2      | account8 | Frontend Eng | todo    |
4  | R-200       | greenhouse:7781    | M1      | account4 | Data Analyst | todo    |
```

Indexes:
- `UNIQUE (job_key, candidate_id)` and `UNIQUE (title_company_key, candidate_id)`: an account can never get the same job twice, by URL or by title + company. These replace today's two per-Manager/candidate unique indexes (same rules, now on the shared keys).
- `INDEX (relation_id)`, `INDEX (job_key)`, `INDEX (title_company_key)`; the existing date/status indexes stay.

Effective description everywhere (Generation prompt, Jobs page, exports):
`coalesce(nullif(btrim(description), ''), page_text)`.

Description rules (one helper in `src/server/jobs`, used by every save and edit):
- A save **with** a non-empty description writes it and sets `page_text = NULL`.
- A save **without** a description stores `page_text` only when the posting has no `description`.
- When a later save brings a description to a posting that only has `page_text`, every row of that `relation_id` gets the description and `page_text` is cleared.
- Saves never overwrite a non-empty `description` or other non-empty job details. Only an explicit edit on the Jobs page does, and it updates all rows of the `relation_id`.

Other tables:
- `bids`: new `job_key` and `title_company_key` columns. `source_job_id` keeps pointing at the `jobs` row id (unchanged).
- `generation_runs`: unchanged (`job_id` is still the `jobs` row id).
- `users.use_gemini_matching boolean default false` replaces the `get_jd_matching_mode` setting.

## 3. Duplicate prevention

`job_key` is computed **only on the server** by one shared function (`src/server/jobs/job-key.ts`), used by the routes, the migration script, and the tests.

1. Platform job ID when found, for example `linkedin:<currentJobId or /jobs/view/id>`, `indeed:<jk>`, `greenhouse:<gh_jid or /jobs/id>`, `lever:<posting uuid>`, `workday:<tenant>:<req id>`, `ashby:<posting uuid>`, `smartrecruiters:<id>`.
2. Otherwise the normalized URL. Prefer the page's canonical URL (`<link rel="canonical">` or the JSON-LD `url`). Then lowercase the host and drop `www.`, force `https`, remove the `#fragment` and trailing `/`, and remove tracking parameters (`utm_*`, `gclid`, `fbclid`, `ref`, `refId`, `source`, `trk`, `trackingId`, `lever-source`, `gh_src`).

Safeguards so two different jobs never share a `job_key`:
- Only known tracking parameters are removed; every other query parameter is kept (`?id=123` stays).
- The canonical URL is used only when it is job-specific (contains a job ID or is deeper than the site's list page); otherwise the real URL is used.
- A URL with nothing job-specific in it (for example a careers page that opens jobs in a popup) gets the title + company appended: `acme.com/careers#tc:<title_company_key>`.
- Platform IDs come only from known patterns (`currentJobId`, `/jobs/view/<id>`, `gh_jid`, ...).

`title_company_key`: title and company lowercased, with punctuation and extra spaces removed, legal suffixes (`inc`, `llc`, `ltd`, `gmbh`, `corp`) dropped, and remote tags (`(remote)`, `- remote`) dropped. A match means the same job, so the same posting on LinkedIn and on the company site is one job. Trade-off accepted: two different jobs with the same title at the same company (other team or city) count as one job.

Finding the posting for a page: look up rows by `job_key`, then by `title_company_key`. If both match different postings, the `job_key` match wins.

Saving one account, race-safe for double clicks, two tabs, and two Managers saving a new posting at once (one database transaction):
1. Take advisory locks on both keys, in sorted order so two saves can never deadlock: `pg_advisory_xact_lock(hashtextextended(key, 0))` for `job_key` and for `title_company_key`. This serializes saves of the same job.
2. `INSERT INTO jobs (…, relation_id, …) SELECT …, coalesce((SELECT relation_id FROM jobs WHERE job_key = $1 LIMIT 1), (SELECT relation_id FROM jobs WHERE title_company_key = $2 LIMIT 1), gen_random_uuid()), … ON CONFLICT DO NOTHING RETURNING id`.

So the first save of a job creates its `relation_id`, every later save reuses it, and an insert skipped by either unique index is reported as "already has this job", not as an error.

## 4. Per-account states (both modes)

A checkbox means "this account has this job".

| State | Rule (scoped to the current Manager) | Checkbox | Manager can |
|---|---|---|---|
| Applied | A bid exists for this account with the same `job_key` or `title_company_key`, or the account's row status is `applied` | Checked, disabled | Nothing |
| Generation running | The account's row Generation is `processing` | Checked, disabled | Nothing until it finishes |
| Has this job | A row exists for this account with the same `job_key` **or** `title_company_key` (also when it was saved from another site; the panel shows that site and date) | Checked | Uncheck it; Save removes that row |
| Available | None of the above | Unchecked (Gemini-recommended accounts are auto-saved, so they show as Has this job) | Check it to add |

Save applies the difference against the stored state, account by account:
- checked and not yet saved: insert a row (section 3)
- saved and now unchecked: delete that row, which the server allows only if it has no bid, its status is not `applied`, and Generation is not running
- unchanged: no write, so an account is never added twice

Summary toast and panel line, for example: **Applied by 1 candidate · 2 already have this job · 3 can be added.** If no account is available: **All candidates already have this job.**

### Jobs and Bids together

| Table | Meaning | Scope |
|---|---|---|
| `jobs` | An account is tracking a posting (details, description, status, résumé, Generation) | One row per Manager + account + posting; rows of one posting share `relation_id` |
| `bids` | The account really applied: a permanent record with its own snapshot of the job details | One Manager, one account |

Bids are written by the Apply workflow (still disabled) after a submission is confirmed.

Rules:
- `bids.job_key` and `bids.title_company_key` (backfilled from each bid's saved URL, title and company) mean "Applied" is found by (manager_id, account, either key), so it holds even if the `jobs` row was deleted. `bids.source_job_id` has no foreign key today.
- An account is **Applied** if a matching bid exists **or** its row status is `applied`. Creating a bid also sets that status, so the two stay in step.
- Only the current Manager's bids count. Another Manager's bid for the same posting does not change what this Manager sees.
- On the Jobs page, a row with a bid cannot be deleted; delete the bid on the Bids page first.
- Retrying a failed application happens from the Jobs page (status back to todo). Get JD never re-adds an account that already has the job.

| Posting in `jobs` | Manager's rows | Manager's `bids` | Shown |
|---|---|---|---|
| No | none | none | New job |
| Yes, saved only by other Managers | none | none | New job (`relation_id` reused; all accounts Available) |
| Yes | account A | none | A: Has this job; others Available |
| Yes | account A | A | A: Applied; others Available |
| Yes | none | A | A: Applied; others Available |
| any | none | only other Managers' bids | New job |

## 5. Job-page detection (extension, before any server call): implemented in step 1

Order: (1) the Manager's blocked URLs reject silently; (2) detection; (3) server.

Timing: start when the page HTML is ready (or a single-page site changes URL), wait until the content settles (about 0.7 s quiet, at most 6 s), and check again at +2 s and +5 s before rejecting. A newer navigation in the tab cancels the pending check. Detection reads plain `innerText` plus a few page-structure signals; only the plain text is ever sent to the server.

A page is a job page when any of these holds:
- two Manager keywords appear as whole words or phrases (plurals count, case-insensitive)
- JSON-LD `JobPosting` data is present
- the score reaches 3:

| Signal | Points |
|---|---|
| Job-site URL (ATS host, `/jobs/<id>`, `/careers/…`, `?gh_jid=`, `/viewjob?jk=`, `/jobs/view/`) | +2 |
| Apply button or CV upload field | +2 |
| Two or more posting headings (responsibilities, requirements, qualifications, about the role, what you'll do, benefits) | +2 |
| Each Manager keyword match, at most 3 | +1 each |
| Looks like a job list (8+ job links) with no selected job (LinkedIn `currentJobId`, Indeed `vjk`) | −3 |

Closed or expired postings ("no longer accepting applications", "this job has expired", "position has been filled") are rejected. On rejection the launcher flashes red once (about 1.2 s). URL Settings offers "Add suggested keywords".

## 6. Flows

### General mode (Manager not assigned to Gemini)
1. Page passes detection. The extension extracts title, company, description and the other fields locally, and reads `innerText` again right before sending.
2. `POST /api/extension/get-jd/check` with `{ job, pageText }`. The server computes `job_key` and returns `{ relationId | null, accounts: [{ id, state }], summary }` for this Manager.
3. The panel lists accounts by state: applied ones checked and disabled, saved ones checked, the rest unchecked. The Manager checks new accounts or unchecks saved ones, and clicks Save.
4. `POST /api/extension/get-jd/save` with `{ job, pageText, profileIds, removeProfileIds }`: `profileIds` are newly checked accounts and `removeProfileIds` are saved accounts the Manager unchecked. Removals are explicit, never inferred from what is missing, so an older extension can never delete rows by accident. The server removes, then adds, one by one (the first addition creates the `relation_id`), applying the description rules, and returns a per-account result (`saved`, `already_exists`, `removed`, `locked`, `failed`).

### Gemini mode (Manager assigned)
1. Page passes detection. The extension sends `{ pageUrl, pageTitle, pageText }` to `POST /api/extension/get-jd`.
2. The server computes `job_key` from the URL and loads the Manager's account states. Only **available** accounts are evaluated. If none remain, it returns "All candidates already have this job" **without calling Gemini**.
3. Gemini evaluates the page and the remaining accounts.
4. The server saves each recommended account one by one (the first creates the `relation_id`; description = Gemini text, `page_text` kept only if Gemini returned no description). It returns account states and the auto-saved accounts.
5. The panel shows the same checkboxes as general mode, and Save applies the difference.

## 7. Changes by area

| Area | Change |
|---|---|
| Schema / migrations | New `jobs` columns and indexes, `bids.job_key`, `users.use_gemini_matching` (section 8). |
| `src/server/jobs` | `job-key.ts` (keys plus tests), the locked account insert, the description helper, the per-Manager account-state query. |
| Get JD routes | `check`, `save`, `get-jd`, `profiles`, `mode`, `auto-saved-jobs/[id]` use `job_key`, `relation_id` and account states. `mode` returns the Manager's own mode. |
| Generation routes | Unchanged, except reading the effective description. |
| Jobs page and actions | Unchanged row model. Detail edits update all rows of the `relation_id`; delete is blocked when a bid exists. |
| Bids | New `job_key` and `title_company_key`; "Applied" checks use (manager, account, either key). |
| Settings | Super Admin "Use Gemini matching" toggle per Manager; the global mode setting is removed. |
| Extension | Step 1 done; then `pageText` in general mode, account states with checkboxes and a summary, extractor coverage additions (section 10). |

## 8. Migration

Take a Neon branch backup first.

1. **Add columns** (migration): `relation_id`, `job_key`, `title_company_key`, `page_text` as nullable on `jobs`; `bids.job_key` and `bids.title_company_key`; `users.use_gemini_matching` (set true for every Manager if the current global mode is `gemini`).
2. **Backfill** (one-off script `scripts/backfill-job-relations.ts`, using `job-key.ts`): compute `job_key` and `title_company_key` for every row, group rows that share **either** key (transitively) under one `relation_id`, and fill the bid keys. Rows of the same account that collide on either key are reported for manual review instead of being deleted.
3. **Constrain** (migration, after the report is clean): make `relation_id`, `job_key` and `title_company_key` NOT NULL, add `UNIQUE (job_key, candidate_id)`, `UNIQUE (title_company_key, candidate_id)` and the new indexes, drop the two old per-candidate unique indexes and the `get_jd_matching_mode` setting.

Nothing is renamed or dropped except those two indexes and one setting. Bids and Generation runs keep their links.

## 9. Delivery order

1. ✅ Extension: red flash, whole-word keywords, scored and settled detection, suggested keywords.
2. ✅ Per-Manager Gemini assignment (settings, `mode` route, migration flag).
3. ✅ code: `job-key.ts` and `job-relations.ts` with tests, migration 0049 (nullable columns and indexes), `npm run db:backfill:job-relations`. Still to do: run them on a Neon branch and review the report.
4. ✅ code: Get JD routes on `relation_id`, `job_key` and account states (rows not backfilled yet still match by the legacy URL or title + company); explicit removals; Gemini skipped when no account is available; Jobs page edits update the whole job and deletes are blocked by bids; Generation and the Jobs page use the effective description. Still to do: the constrain migration, after the backfill report is clean.
5. Extension: `pageText` in general mode, account checkboxes and summary, Gemini only on available accounts.
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

- `job-key.ts`: platform IDs, only tracking parameters removed, canonical URL used only when job-specific, generic URLs get title + company, and title/company normalization.
- Description helper: a description save clears `page_text` on every row of the `relation_id`; a `page_text` save never touches an existing description; the effective description prefers `description`.
- Server: concurrent first saves of one posting get one `relation_id`; the same job from two sites (title + company match) is one job; account states (applied, has job, available) scoped per Manager; "another Manager's posting is New job for me"; Gemini skipped when no account is available; delete blocked when a bid exists.
- Migration: backfill on a copy of production data, with group counts and the duplicate report.
- Extension: detection on fixture pages (posting, job list, closed posting, news article), whole-word keywords, and the red flash on rejection (step 1 tests).
