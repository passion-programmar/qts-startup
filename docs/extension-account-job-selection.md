# Generation and Auto Apply account/job selectors

The floating QTS actions panel has independent account selectors beside Generation and Auto Apply. Options include the signed-in Manager's active candidate accounts with at least three experience records; a nonblank matching note (`profiles.jdMatching`) is additionally required for Generation when the Manager uses Gemini matching and for Auto Apply when Gemini Get JD is assigned. Notes and private candidate profile details are not returned by the listing endpoint. Each option shows the candidate name, category when present, and eligible-job count for that mode; counts of eight or more display as `8+`.

Selecting an account loads that mode's eligible jobs without starting any work. Each row shows the saved title and a second line containing the source domain (without `www.`) and company. The title and domain are one link opening the original job in a new tab, with `noopener noreferrer`. Hovering either line reveals the full saved URL using the browser's native tooltip. Invalid/non-HTTP addresses are never executable links.

Jobs start checked. Individual checkboxes and Select all control the batch. The footer shows the selected count and Generate selected / Apply to selected. Refresh reloads eligibility. Empty lists, loading and request failures are explicit, and cannot start a whole-queue fallback. Each response shows up to 200 jobs with an explicit notice when more exist; complete the batch and refresh to load the next eligible jobs.

Without an account selected, Generation keeps its whole-queue behavior and claims the oldest eligible job first. With an account selected, Generation is restricted to that candidate and the checked job IDs; it never falls back to another candidate or the general queue. Auto Apply normally starts the oldest eligible jobs without a profile or job selection, up to the Manager's configured concurrent-job limit (default 2; change it under Settings → Auto Apply settings, range 1–10). Choosing a profile restricts Auto Apply to its checked jobs and always processes them one at a time. Cancel saves the Auto Apply checkpoint and releases its active hold without changing the saved job or its original queue position. Time-limited holds prevent multiple Chromes from claiming the same job; different Chromes can claim different jobs concurrently. The existing action becomes Cancel while running. Account selectors are locked while a work mode is active; existing one-mode-per-Chrome and permissions checks remain.

Auto Apply fills profile and reusable answers as soon as each form opens. Unanswered questions use the Manager-assigned provider, but AI answer turns are serialized one application at a time for both ChatGPT and Gemini. ChatGPT uses one fresh conversation per job inside its pinned tab; after ten jobs the extension replaces the tab and starts from the Manager's configured Project URL again.

## Implementation

- `extension/content/page-launcher.js`: compact selectors, eligible-job counts, scrollable job lists, selection state, full-URL tooltips and explicit loading/error/empty states. Mode-specific account requests load when the Manager opens the panel or focuses a selector and are invalidated on session changes. Passive launcher activation does not load lists. Each job request has a revision guard against stale account responses.
- `extension/background/service-worker.js`: authenticated API proxy (`QTS_WORK_ITEMS`), validation of explicit batches, and per-Chrome `qtsWorkSelection` storage for restart recovery. Normal starts reset the stored scope. Generation claim requests include the scope.
- `extension/background/apply-runner.js` and `auto-apply-runner.js`: pass Auto Apply scope to claims, apply Manager-configured concurrency (or one slot for a selected profile), serialize AI turns, and restrict resumed runs to selected job IDs. Manual Apply keeps its existing behavior.
- `GET /api/extension/work-items`: authenticated account/job lists, Manager ownership, active-account and matching-note filters. Lists return only display fields, including the complete original URL. Responses are not cached.
- `src/server/work/work-selection.ts`: strict optional account/UUID batch validation. Only an absent selection means the original queue; malformed, empty or oversized selections are rejected.
- `src/server/work/work-eligibility.ts`: listing predicates for Generation and Auto Apply, reflecting current holds, document availability, bids and application eligibility.
- Generation claim route: adds candidate and job-ID filters alongside all existing eligibility/ownership checks.
- Apply claim route and `claimNextApplication`: feed exclusions outside the selection and Manager-configured parallel limit into the existing locked database claim function. Its advisory lock, ownership, leases and bid checks remain. A post-claim scope check releases a concurrent out-of-scope claim before returning or loading the application.

The `auto_apply_parallel_limit` Manager setting defaults to 2 and is bounded to 1–10. This requires the matching server, migration and extension versions; migrations are not deployed automatically. Manager prompts, generated content, PDF templates and automatic submission policy are unchanged.

## Local verification

Tests use synthetic accounts/jobs, mocked authentication/database services and local Chrome. UI tests cover compact domain/title labels, exact URL tooltips, independent selections, selected IDs and loading failures. Route tests cover nonblank-note filtering, ownership, eligibility, invalid-scope rejection and scope forwarding. Actual-worker tests use empty mock claims, so no real Generation or application submission occurs. These do not establish live hosted end-to-end success.

Local results on 2026-10-31:

- Full server suite: 196 passed, 3 skipped, 0 failed. The final whitespace-only-note adjustment also passed all 10 focused work tests.
- Full serialized extension suite: 360 passed, 0 failed on the clean rerun. The earlier run hit the existing composer timing test while other browser tests were competing; that test passed in isolation and in the clean full rerun.
- Actual-worker selected-claim test: passed for Generation and Auto Apply, including empty-selection rejection and the supported API allowlist.
- Existing Auto Apply form and worker-restart recovery regressions: 2 passed, using local synthetic forms and mocked services.
- TypeScript, targeted lint and whitespace checks: passed.

Artifacts: `.pdf-verification/work-picker-preview.png`, `work-picker-all-server-tests.txt`, `work-picker-server-tests.txt`, `work-picker-all-extension-tests-rerun.txt`, `work-picker-auto-apply-regression.txt`, `work-picker-final-focused-tests.txt`, `work-picker-composer-isolated.txt`, `work-picker-typecheck.txt` and `work-picker-lint.txt`. The combined focused extension log contains the earlier composer timing failure; its worker/UI/API checks passed and the final full-suite log supersedes that timing failure.
