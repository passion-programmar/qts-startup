# Generation and Auto Apply account/job selectors

The floating QTS actions panel has independent account selectors beside Generation and Auto Apply. Options include only the signed-in Manager's active candidate accounts with a nonblank matching note (`profiles.jdMatching`). Notes and private candidate profile details are not returned by the listing endpoint.

Selecting an account loads that mode's eligible jobs without starting any work. Each row shows the saved title and a second line containing the source domain (without `www.`) and company. The title and domain are one link opening the original job in a new tab, with `noopener noreferrer`. Hovering either line reveals the full saved URL using the browser's native tooltip. Invalid/non-HTTP addresses are never executable links.

Jobs start checked. Individual checkboxes and Select all control the batch. The footer shows the selected count and Generate selected / Apply to selected. Refresh reloads eligibility. Empty lists, loading and request failures are explicit, and cannot start a whole-queue fallback. Each response shows up to 200 jobs with an explicit notice when more exist; complete the batch and refresh to load the next eligible jobs.

Without an account selected, the original action button keeps its existing whole-queue behavior. With an account selected, both that action button and the selected-jobs button use its selected batch. The existing action becomes Cancel while running. Account selectors are locked while a work mode is active; existing one-mode-per-Chrome and permissions checks remain.

## Implementation

- `extension/content/page-launcher.js`: compact selectors, scrollable job lists, selection state, full-URL tooltips and explicit loading/error/empty states. Account requests load when the Manager opens the panel or focuses a selector, are shared between selectors and are invalidated on session changes. Passive launcher activation does not load lists. Each job request has a revision guard against stale account responses.
- `extension/background/service-worker.js`: authenticated API proxy (`QTS_WORK_ITEMS`), validation of explicit batches, and per-Chrome `qtsWorkSelection` storage for restart recovery. Normal starts reset the stored scope. Generation claim requests include the scope.
- `extension/background/apply-runner.js` and `auto-apply-runner.js`: pass Auto Apply scope to claims and restrict resumed runs to selected job IDs. Manual Apply keeps its existing behavior.
- `GET /api/extension/work-items`: authenticated account/job lists, Manager ownership, active-account and matching-note filters. Lists return only display fields, including the complete original URL. Responses are not cached.
- `src/server/work/work-selection.ts`: strict optional account/UUID batch validation. Only an absent selection means the original queue; malformed, empty or oversized selections are rejected.
- `src/server/work/work-eligibility.ts`: listing predicates for Generation and Auto Apply, reflecting current holds, document availability, bids and application eligibility.
- Generation claim route: adds candidate and job-ID filters alongside all existing eligibility/ownership checks.
- Apply claim route and `claimNextApplication`: feed exclusions outside the selection into the existing locked database claim function. Its advisory lock, parallel limits, ownership, leases and bid checks remain. A post-claim scope check releases a concurrent out-of-scope claim before returning or loading the application.

No database schema/configuration, Manager prompts, generated content, PDF templates or automatic submission policy is changed. This feature requires the matching server and extension versions; it has not been deployed automatically.

## Local verification

Tests use synthetic accounts/jobs, mocked authentication/database services and local Chrome. UI tests cover compact domain/title labels, exact URL tooltips, independent selections, selected IDs and loading failures. Route tests cover nonblank-note filtering, ownership, eligibility, invalid-scope rejection and scope forwarding. Actual-worker tests use empty mock claims, so no real Generation or application submission occurs. These do not establish live hosted end-to-end success.

Local results on 2026-10-31:

- Full server suite: 196 passed, 3 skipped, 0 failed. The final whitespace-only-note adjustment also passed all 10 focused work tests.
- Full serialized extension suite: 360 passed, 0 failed on the clean rerun. The earlier run hit the existing composer timing test while other browser tests were competing; that test passed in isolation and in the clean full rerun.
- Actual-worker selected-claim test: passed for Generation and Auto Apply, including empty-selection rejection and the supported API allowlist.
- Existing Auto Apply form and worker-restart recovery regressions: 2 passed, using local synthetic forms and mocked services.
- TypeScript, targeted lint and whitespace checks: passed.

Artifacts: `.pdf-verification/work-picker-preview.png`, `work-picker-all-server-tests.txt`, `work-picker-server-tests.txt`, `work-picker-all-extension-tests-rerun.txt`, `work-picker-auto-apply-regression.txt`, `work-picker-final-focused-tests.txt`, `work-picker-composer-isolated.txt`, `work-picker-typecheck.txt` and `work-picker-lint.txt`. The combined focused extension log contains the earlier composer timing failure; its worker/UI/API checks passed and the final full-suite log supersedes that timing failure.
