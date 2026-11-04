# QTS development handoff

## Folder picker correction - 4 November 2026

Current setup: choose **Downloads/QTS_Resume itself**, not Downloads. The previous instructions were wrong: Chromium blocks broad directory grants to the Downloads root while allowing eligible subfolders. Source: https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc (Downloads uses kDontBlockChildren, which blocks the specified directory/parents).

The picker now validates the explicitly selected QTS_Resume folder, keeps the existing applyPdfDownloadsDirectoryV1 handle store, and offers Allow saved folder access when a stored grant needs a new read prompt. No automatic permission prompt or file selection occurs. Both local PDF upload and relink readers resolve canonical QTS_Resume/... metadata relative to a direct QTS_Resume handle, without duplicating that segment. Existing parent-folder handles remain supported. All saved server paths/filenames and original bytes stay unchanged; no server/schema/production data change or rendering is needed. Folder-name validation rejects Downloads/job subfolders without replacing the old grant. Fresh Manager checks and session invalidation remain in both selection/reauthorization paths.

Validation: 37/37 folder/local-reader/relink/recovery/Assisted Apply Node tests passed; the corrected folder integration passed with a real structured-cloned QTS_Resume handle persisted through a full Chrome restart, explicit user-gesture read reauthorization, and original-byte uploads in Apply and Auto Apply. The normal Apply recovery E2E also passed with a direct QTS_Resume handle. The first folder run reached restart/byte checks but failed its obsolete permission-guidance text assertion; updated it to require the new explicit reauthorization instruction/button, then reran successfully. Changed-source lint and diff checks passed. These browser tests still substitute the OS picker with an origin-private directory; native OS selection/consent is not claimed automated. The previously untested real Downloads restriction is now documented and the UI no longer asks for that blocked scope. Backend and TypeScript sources are unchanged, so no server build/migration is required for this extension-only fix.


## Current migration request: 3 November 2026

The user requested the remaining project migration, superseding the earlier lack of migration approval below. Migration 0088 is now applied and verified on the user-identified Production branch. No commit, push or deployment was requested or performed. Older migration-readiness statements below describe historical task results; this section and the Task 7 status are current.

- Before execution, a fresh read-only transaction found 88 ledger entries through `0087_right_wonder_man` (`1793578126366`), its matching predecessor hash, and no `jobs.cover_letter_local_path`. Only `0088_curly_payback` was pending. A historical hash mismatch was also observed for 0010; no historical ledger entries or migration files were modified.
- Migration 0088 contains only `ALTER TABLE "jobs" ADD COLUMN "cover_letter_local_path" text;`. Snapshot 0088 has the correct predecessor and adds only that nullable, default-free column. An isolated PGlite PostgreSQL check applied and rolled back the exact SQL and verified existing job values remain unchanged. LF-normalized migration hash: `a05b5c899f0a44b0d9ecd189fcebd47a0da7a91c3e23a5546428d1974d1e6e6a`.
- The installed Vercel CLI refreshed its expired login and successfully inspected linked project `prj_OtLNKMZ8N2uhgs20PBpAemg4gm6k`. Production `DATABASE_URL` is Sensitive: both the environment-list and environment-export APIs mask its value. Thus the configured connection could not be independently matched to current Production through these read-only APIs.
- The user supplied Production branch [br-raspy-fire-b43encf8](https://console.neon.tech/app/projects/shy-hill-66405905/branches/br-raspy-fire-b43encf8). Read-only Neon management API calls independently confirmed project `shy-hill-66405905`, branch name `production`, read-write endpoint `ep-icy-sunset-b42nbnef`, database `neondb`, and migration owner `neondb_owner`. The branch ID and endpoint ID identify the same database target, matching the configured connection. Target fingerprint: `588c0246059311483d17c52f3278bbdc8a228bd85baf07b0f6f6fccc858d48eb`.
- Executed `.pdf-verification/migration-0088.cjs --apply` after updating its identity check to resolve the user-supplied Neon branch. One transaction set lock/statement timeouts, locked and rechecked the predecessor ledger, applied only 0088, and inserted its normalized hash into the ledger. Execution completed at 23:21 PST on 3 November 2026 (`2026-11-04T07:21:11.934Z`). No application rows, job statuses, PDF paths, role grants, or previous migrations were updated.
- Post-execution schema verification and a separate read-only rerun both passed: `cover_letter_local_path` is nullable `text` with no default, the ledger contains 89 entries through timestamp `1793765616375` with the expected 0088 hash, and no local journal migrations remain pending. The rerun returned `already applied and verified` without writes. Evidence: `.pdf-verification/migration-0088-result.json` and `.pdf-verification/migration-0088-preflight.json`. The older `production-migration-result.json` concerns migration 0080.

Tasks 1 and 2 are accepted. Task 3 normal Apply recovery is implemented and validated (3 November 2026). Auto Apply-specific work is deferred at the user's request; no Production execution was performed in this task. The known Task 6 transition regression remains unresolved. This file and CODEX_TASKS.md were absent when Task 1 began; neither was found elsewhere in docs or the local verification directory. The starting review is `.pdf-verification/handoff-review/review.md`, against HEAD `214e171`. Git status initially contained 19 modified tracked files and six untracked files. Preserve that pre-existing local PDF and Get JD work.

## Constraints

- Work one task at a time; report completion before the next task.
- Generation persists the exact completed PDF download filenames, including Chrome suffixes. Apply and Auto Apply must read existing files and upload original bytes, with no PDF rendering fallback.
- Keep the Apply documents endpoint and all its authorization checks.
- Keep legacy `applicationAutomation` disabled.
- No commits, pushes, deployments, migrations, or production writes without approval. Production only; verify the configured Production branch before any authorized push.
- Task 3 requires an approved recovery design before changing completed-job eligibility or database records. Never guess filenames or reset unrelated job states.
- Task 7 Production identity verification and migration 0088 are complete as recorded above. Any future database change still requires its own authorized scope and target verification.

## Task 1 root cause and design

The only existing picker was in the legacy popup behind the disabled `applicationAutomation` flag and a hidden parent section. Supported Manager Apply/Auto Apply use their own `canUseApply` permission and can run independently of that flag.

The two options were compared before finalizing:

| Option | Assessment |
| --- | --- |
| Picker directly in the content-script launcher | The picker/storage would belong to the job site's origin. Content-script IndexedDB is the host page's, and handles can be transferred between the same top-level origin. It cannot directly populate the extension's existing store. An extension iframe adds cross-origin picker restrictions and more messaging. |
| Dedicated extension page opened by the launcher | Shares the extension origin and IndexedDB with its service worker. A direct click on that page supplies user activation for the picker. This is the smallest reliable option with the existing store. |

Chrome references: [extension storage and content-script origins](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies), [File System Access API, user activation, directory handles and IndexedDB](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access).

Implementation is limited to a supported launcher tool and `extension/settings/apply-pdfs.html` / `apply-pdfs.js`. The tool and setup page require current Manager `canUseApply` access. Opening the page refreshes server permissions; selection rechecks access before saving. The picker is invoked directly from its Choose button before asynchronous checks, requests `mode: read`, and reuses `__qtsScannerDocumentStore` with `applyPdfDownloadsDirectoryV1`. There are no manifest permission changes. Existing Generation and local PDF reading logic remain intact.

Reopening or focusing the page queries the stored handle's read permission without prompting. Missing/revoked grants explain that the Manager should choose Downloads again. Cancellation/denied permission preserves the previous handle. Session changes invalidate an in-flight selection. Chrome controls the lifetime of OS grants, so saving a handle does not promise a perpetual grant.

## Task 1 validation

- Targeted setup, local-reader, and Generation-delivery tests: **19/19 passed**. Covers missing grants, revoked permissions, denied read requests, cancellation, access revoked during setup, session changes, unavailable picker, and storage/access-check failures.
- Supported launcher browser visibility: **1/1 passed**, including signed-out, denied Manager access, failed permission checks, and authorized access with legacy automation disabled.
- Serial browser regressions: **3/3 passed**. These exercise the real folder setup integration, existing launcher restoration across tabs/windows, and existing account/job pickers.
- The integration test opens setup through the real launcher's tool, uses a real extension-origin directory handle and IndexedDB, restarts Chrome completely, and then verifies the handle and original bytes still read correctly. Both Assisted Apply and Auto Apply actually upload the exact original resume and cover-letter bytes using the saved Chrome-suffixed filenames. No rendering, Generation, AI-answer, or submission endpoint is used.
- The OS chooser itself is substituted with an origin-private directory in automation. Native `showDirectoryPicker` availability on the top-level extension page and trusted user activation at the call are checked. The tests use real directory handles, real files, real IndexedDB structured cloning, the real reader, and real upload code. Revoked grants are simulated; an actual OS consent dialog was not automated.
- `npm.cmd run typecheck`: passed.
- ESLint on all six Task 1 JavaScript source/test files: passed.
- `git diff --check` and a whitespace check covering all ten Task 1 files: passed. Task 1's changes to the pre-modified worker were reviewed against a saved pre-task copy; Generation and Get JD changes were preserved.

Reproduce:

```powershell
node --test extension/settings/apply-pdfs.test.js extension/shared/apply-local-pdfs.test.js extension/shared/generation-delivery.test.js
node --test extension/content/apply-pdf-folder.browser.test.js
node --test --test-concurrency=1 extension/content/work-picker.browser.test.js extension/content/launcher-restoration.browser.test.js extension/background/apply-pdf-folder.e2e.test.js
npm.cmd run typecheck
node node_modules/eslint/bin/eslint.js extension/settings/apply-pdfs.js extension/settings/apply-pdfs.test.js extension/content/apply-pdf-folder.browser.test.js extension/background/apply-pdf-folder.e2e.test.js extension/content/page-launcher.js extension/background/service-worker.js
git diff --check
```

The settings unit tests are also included in `npm run test:extension`. Local final browser logs are saved under `.pdf-verification/task1-folder-authorization/`. Chrome tests required execution outside the sandbox to launch correctly.

## Unrelated baseline checks and remaining work

Full-project lint was not rerun for Task 1. The prior review recorded 1,115 errors and 17,802 warnings from generated/verification copies and vendor files; those results are historical and distinct from the clean Task 1 source lint. The prior two stale category assertions in `release-boundary.test.js` and the remaining Apply-this-page/Assisted Apply transition failures are outside this task. Full release validation remains Task 8.

No application rendering/reader logic, completed-job eligibility, database records, migration, extension version, manifest permissions, or deployment configuration was changed by Task 1. No commit, push, deployment, or database mutation was performed.

## Task 2 root cause and implementation

`fillVisibleAssistForm` discarded `ApplyStop` messages and deleted its form signature. The panel consequently showed a generic manual-completion message, and later page events could retry the failing PDF read automatically.

Task 2 changes only the shared Apply loader's error guidance and fill cancellation guards, Assisted Apply's local pause/retry/session handling, and its panel's conditional Retry autofill button. The PDF reader and rendering routes are unchanged.

- The existing `ApplyStop` class and its skip/keepTab/dryRun/pageType options are unchanged. PDF failures still use `skip: false` and preserve their cause. Native error messages, including missing-file errors, are retained. Missing or HTTP-404 saved paths explain that the Manager should cancel and contact their QTS administrator to check existing paths/application access; no new Generation or recovery is initiated.
- Missing files/folder grants and revoked access point to QTS → Tools → Apply PDFs folder and ask the Manager to confirm both exact files remain in their Generation folder.
- An Assisted Apply document error pauses autofill, displays the reason in the existing Needs you box, and offers Retry autofill. The application tab, claim heartbeat, and manual Submitted/Cancel/Remove controls remain available. Pausing does not write a failed attempt, submit, skip, or alter a job.
- While paused, ordinary page events and pending navigation do not retry. A paused reason is saved as optional `fillError` metadata in the existing local `qtsApplySessions` record and restored after worker restart without reloading documents.
- Retry accepts only an owned, active Assisted Apply page while Apply is on, rejects concurrent/stopped/foreign requests, retains previously filled fields, clears the local pause metadata, and rechecks the existing authenticated documents endpoint. An unresolved failure pauses again after that one explicit attempt.
- Lifecycle stops (`keepTab: false`), Cancel, and lost review ownership do not become PDF retries. A PDF request finishing after cancellation cannot upload or republish the previous panel. Resume-autofill attempts are marked only after documents load, allowing a failed read to be retried correctly.

The Task 3 recovery design remains unimplemented and requires approval. No completed-job eligibility or database records were changed. The existing documents endpoint and all backend authorization checks remain in place.

## Task 2 validation and remaining issues

| Check | Result |
| --- | --- |
| Error handling, existing local reader, Generation delivery | **18/18 passed**. Includes owned-page retry, concurrent retry rejection, stopped/foreign/Auto Apply rejection, late-error suppression, original ApplyStop flags, and persisted pause recovery. |
| Existing Assisted Apply panel tests plus the new paused-error/retry case | **12/12 passed**. Existing manual controls, clipboard, panel recovery and mutation behavior are retained. |
| New PDF-error MV3 integration | **Passed**, including the final serial run. Uses real origin-private directory handles/files and the actual reader, runner, panel and API client against a local mock server. Missing paths, a missing PDF and revoked permissions each pause; page events do not retry; unsuccessful explicit retry pauses again; fixing the cause restores original-byte uploads and preserves a Manager edit. A worker restart restores the pause without another documents request. A request finishing after Cancel produces no field fill, restored panel or saved session. |
| Task 1 folder/persistence/original-byte upload regression | **Passed** in the serial run, for Assisted Apply and Auto Apply. |
| Existing application restart/resume regression | **Passed** in the serial run, including Manager-initiated saving from the job when the old attempt is unavailable. |
| Existing Assisted Apply account/step-transition regression | **Known failure reproduced**: `extension/background/apply-assist.e2e.test.js:342`, `Timed out waiting for profile and reusable values on the visible next form step`, about 81 seconds. This matches the pre-Task-2 review failure. Its initial filling/upload/account-navigation assertions passed. It remains Task 6; no fixture assertion was weakened and no transition fix was made here. |
| Final serial browser batch | **3 passed, 1 known failure** from the transition test above. |
| Typecheck, lint on all five Task 2 JS source/test files, diff/whitespace review | Passed. The ApplyStop class was compared with the pre-task copy and is unchanged. Task 2's source diff was reviewed separately from earlier uncommitted work. |

Reproduce the Task 2 checks:

```powershell
node --test extension/shared/assisted-apply-errors.test.js extension/shared/apply-local-pdfs.test.js extension/shared/generation-delivery.test.js
node --test extension/content/apply-assist.browser.test.js
node --test --test-concurrency=1 extension/background/apply-assist-pdf-errors.e2e.test.js extension/background/apply-pdf-folder.e2e.test.js extension/background/apply-resume.e2e.test.js extension/background/apply-assist.e2e.test.js
npm.cmd run typecheck
node node_modules/eslint/bin/eslint.js extension/background/apply-runner.js extension/content/apply-assist.js extension/shared/assisted-apply-errors.test.js extension/content/apply-assist.browser.test.js extension/background/apply-assist-pdf-errors.e2e.test.js
git diff --check
```

Final evidence and the isolated Task 2 source diff are saved under `.pdf-verification/task2-assisted-errors/`. Browser tests ran outside the sandbox. Permission revocation is simulated in the integration fixture; no real OS grant or production data is changed. The new shared tests are included by the existing `test:extension` glob. Full release tests and unrelated baseline lint/category assertions remain Task 8.

Missing saved paths are now explained, but linking legacy PDFs is not implemented: Task 3 still requires an approved design. At Task 2 completion, Tasks 3–8 were unstarted. Task 2 changes two production extension files, three test files, and these two handoff documents. It makes no backend route/schema, rendering, completed-job eligibility, manifest permission, extension-version, deployment, or production-data changes. No commit, push, migration, or deployment was performed.

## Task 3 planning history: approved manual relinking

The full comparison, proposed workflow/API, security and migration implications, acceptance criteria, and implementation test matrix are in [LEGACY_PDF_RECOVERY_DESIGN.md](LEGACY_PDF_RECOVERY_DESIGN.md). These paragraphs record the planning stage; implementation and current limits are recorded below.

Verified against current source and the review: nullable migration 0088 does not backfill legacy cover-letter paths; the documents loader requires both paths and a delivered run; Generation rejects completed/already-generated jobs. Normal `claimJobForBrowser` can already claim a completed legacy job with a resume anchor and no bid. Therefore the proposed workflow needs no completed-job eligibility or Generation change. Existing authorization verifies Manager Apply access and attempt Manager/browser/status, but the documents query does not explicitly check lease expiry or current job ownership; recovery writes must add these checks rather than relying on a 404.

Recommendation: extend the existing extension-origin folder settings page with an explicit job/attempt recovery mode reached from a recoverable Assisted Apply pause. Reuse the stored read-only Downloads handle, list actual PDF entries only in the existing resume's recorded parent folder, and require explicit selection and content confirmation for both roles with no default choice. Preserve actual Chrome suffixes and historical names. No native per-file picker, broader grant, recursive discovery, filename inference, regeneration, or content upload to QTS is needed. Support the old flat QTS_Resume layout too; missing anchors/folders or arbitrary relocation remain outside this limited recovery design.

Keep the existing documents authorization endpoint for context and normal Apply reads. Propose one new metadata-only relink POST, authorized against a fresh, unexpired `waiting_review` attempt owned by this Manager/browser, current job/candidate ownership/availability, completed Generation and matching delivered run, no bid/applied/submission state, and unchanged observed paths. Atomically save only the two explicitly selected relative paths and ordinary job updatedAt, with transaction/CAS protection and idempotent identical replay. A corrected resume suffix is allowed only within that confirmation and the unchanged parent folder. No attempt, job-status, Generation, candidate or bid updates are part of recovery. An already complete different pair cannot be overwritten.

Saving leaves Apply paused; explicit Retry reuses the normal authorized endpoint/reader. For Auto Apply, stop it and recover under a normal Assisted Apply claim, then continue there or cancel that review before restarting Auto Apply under existing eligibility rules. Never make Auto Apply choose files or reset excluded job states. Each Chrome profile grants its own access to the same physical Downloads tree; only the relative path pair is shared through the job. A second profile uses its own subsequent claim and does not repeat the relink/write.

Recovery adds one context GET on explicit opening and one confirmed Save POST; the existing explicit Retry documents GET remains. Selection/preview use local bytes with zero per-file requests or background writes. There is no proposed schema migration beyond pending 0088 and no automatic backfill. Production identity/ledger/dependencies and explicit migration approval remain Task 7; affected-client version gating remains Task 4. Historical PDFs have no stored fingerprints: filename/header/size checks cannot prove historical provenance, so explicit Manager content review is required. Cryptographic immutability would require a separate design.

Planning validation: reread Git status, the handoff/task plan and review, current documents/auth/attempt/claim rules, Generation finalize/path helpers, schema/0088 and the shared local reader; checked Chrome's official directory-enumeration/storage guidance. Reviewed all three documentation changes and ran whitespace/document-link checks. No new runtime tests were run for this documentation-only proposal; the matrix specifies the tests required after approval, including actual shared-folder coverage across two profiles rather than treating separate OPFS stores as a shared Downloads test. Task 1/2 test results above are historical and unchanged. No application/test source, schema, production data, eligibility, migration, commit, push or deployment was changed during Task 3 planning. Stop here pending design approval; Tasks 4–8 have not started.

## Task 3 implementation step 1: backend

Implemented the opt-in authorized recovery context and metadata-only relink endpoint, exact-path validation, and a Neon HTTP serializable transaction with authorization-row locks, current state checks, atomic two-path CAS, and idempotent replay. Existing documents authorization remains. No eligibility, renderer, schema, or configured database change. Tests passed: 36 input/in-memory PostgreSQL cases and four mocked route/driver cases. The latter required execution outside the sandbox for esbuild path resolution. Typecheck passed. Backend source/SQL and the isolated documents-route diff were reviewed; UI/integration remain pending. The PostgreSQL engine is downloaded only to ignored .pdf-verification/task3-test-tools, with no project dependency change and no configured database connection. It validates actual SQL but does not simulate separate concurrent database connections.

## Task 3 implementation step 2: normal Apply UI

User narrowed today's scope to normal Apply; Auto Apply-specific development/rollout waits. The paused normal Apply panel now opens job-specific recovery only for a server-identified recoverable error. Recovery reuses the settings page/store, lists only exact recorded-folder entries with no defaults, requires both roles and explicit original-content confirmation, previews local bytes, and locally hashes/rechecks both files before sending relative-path metadata only. Worker messaging validates the extension page, source review, current owned pause and normal Apply mode. Save does not resume autofill. Conflicts, session/folder changes, revoked grants and stopped ownership invalidate review. Targeted UI/helper/worker/folder tests passed 25/25. Changed JS lint passed; isolated pre-task diffs reviewed/saved under .pdf-verification/task3-step2. Browser integration/final checks remain. No Vercel deployment, migration or production mutation has occurred.

## Task 3 implementation step 3: validation and commit handoff

Normal Apply recovery is complete locally. A real-browser test found that opening recovery left the panel busy; the new action now resets its local busy state, and a panel regression verifies Retry remains enabled. Chrome integration startup was stabilized by enabling its CDP runtime and opening an extension page before IndexedDB-backed test authentication; assertions were preserved. Source and isolated diffs were reviewed. No completed-job eligibility, renderer, document bytes, schema, or Production records were changed by Task 3.

Final checks: relevant server tests 55/55; targeted extension tests 36/36; new actual-MV3 recovery E2E 1/1 (final run about 27 seconds); serial normal Apply PDF-error/resume/panel regressions 15/15. Typecheck and changed-source lint passed. The E2E proves exact suffixed names and original uploaded bytes, explicit conflict/reload, no default selection or per-file requests, paused state after Save, worker restart, preserved Manager edits, and no autofill resurrection after a late Save response following Cancel. The PostgreSQL tests execute the real statements in isolated PGlite, with authorization/CAS/idempotence refusals and driver tests asserting a single serializable transaction. Row locks use NOWAIT and database clock lease checks; serialization/deadlock/lock-contention failures return conflicts without automatic retry. Context/save requests have a 20-second client timeout.

Limitations: original-file provenance requires Manager review; missing anchors/runs/folders, relocation and replacement of a complete different pair are excluded. Native OS consent and shared physical Downloads across two real Chrome profiles require manual acceptance; fake shared-handle unit coverage and OPFS tests are not described as that verification. Independent simultaneous database connections were not tested. No new Auto Apply E2E was run following the user's normal-Apply-only instruction. Recovery messaging refuses Auto Apply mode; stop it and use a normal owned review. Existing Task 6 step-transition/Apply-this-page defects and Task 4 extension/API rollout compatibility remain open; this work does not establish that the hosted release is ready. Full-project lint baseline remains separate as documented above.

Migration 0088: the user confirms it was completed in another session; preserve that session's Task 7 record above/in CODEX_TASKS.md. This session did not rerun it or query/mutate Production. Local commits are now explicitly authorized, including Get JD result alerts; no push/deployment is authorized or performed.

Task 3 files (18 source/test files plus these three documents):

- `src/server/apply/apply-pdf-recovery.ts`
- `src/server/apply/apply-pdf-recovery-store.ts`
- `src/server/apply/apply-pdf-recovery.test.ts`
- `src/server/apply/apply-pdf-recovery-route.test.ts`
- `src/app/api/extension/apply/documents/route.ts`
- `src/app/api/extension/apply/documents/relink/route.ts`
- `extension/background/apply-runner.js`
- `extension/background/apply-pdf-relink.e2e.test.js`
- `extension/background/apply-assist-pdf-errors.e2e.test.js`
- `extension/content/apply-assist.js`
- `extension/content/apply-assist.browser.test.js`
- `extension/settings/apply-pdfs.html`
- `extension/settings/apply-pdfs.js`
- `extension/settings/apply-pdf-recovery.js`
- `extension/settings/apply-pdf-recovery.test.js`
- `extension/shared/apply-pdf-relink.js`
- `extension/shared/apply-pdf-relink.test.js`
- `extension/shared/assisted-apply-errors.test.js`

Reproduce:

```powershell
node --require ./scripts/node-user-shim.cjs --import tsx --test src/server/apply/apply-pdf-recovery.test.ts src/server/apply/apply-pdf-recovery-route.test.ts src/server/apply/apply-values.test.ts src/server/apply/check-answers-route.test.ts
node --test extension/settings/apply-pdfs.test.js extension/settings/apply-pdf-recovery.test.js extension/shared/apply-pdf-relink.test.js extension/shared/assisted-apply-errors.test.js extension/shared/apply-local-pdfs.test.js extension/shared/generation-delivery.test.js
node --test extension/background/apply-pdf-relink.e2e.test.js
node --test --test-concurrency=1 extension/background/apply-assist-pdf-errors.e2e.test.js extension/background/apply-resume.e2e.test.js extension/content/apply-assist.browser.test.js
npm.cmd run typecheck
git diff --check
```

PGlite setup is documented in its test source; it is installed only under ignored .pdf-verification/task3-test-tools, with no package dependency/lock changes. Browser/esbuild tests required execution outside the sandbox. Evidence includes .pdf-verification/task3-before, task3-step2 and task3-final/recovery-e2e.log. The commit also needs accepted Tasks 1/2 and earlier local-PDF protocol dependencies, since these were never committed to HEAD; keep unrelated Get JD changes in a separate commit as requested.

Subsequent user instruction authorizes checking qts-startup-deploy and fast-forward pushing to origin qts-startup for Production after committing. Verify the remote, ancestry and configured Vercel Production branch before any push. No Preview deployment or force push is authorized.

## Get JD alert commit and Production push preparation

User requested committing Get JD result alerts separately and a fast-forward Production push. Alert shared/toast tests passed 12/12 and changed-source lint passed. Verified through the Vercel project API that prj_OtLNKMZ8N2uhgs20PBpAemg4gm6k links passion-programmar/qts-startup with Production branch qts-startup-deploy. Existing Production was READY at 8209697; fetched origin/qts-startup-deploy is an ancestor of the reviewed local branch. No Preview or force push is intended. The new PDF protocol requires reloading the updated extension files in every profile; automatic version enforcement remains open in Task 4. Do not describe all remaining work as Auto Apply only: the known normal Apply transition/Apply-this-page issues and release compatibility checks also remain.
