# Get JD: local detection and duplicate checks

This describes the local implementation. It has not been deployed by this change.
The older Manager-keyword detection flow is superseded by this document.

## Gemini mode: the Manager checks every job before Gemini (2026-11-15)

Gemini is never called automatically. In Gemini mode the job-page detection rules (keywords, score,
"plausible", closed text, list pages, article paths, headings) are not used; Manual mode still uses them.

```
New tab / reload
  ├─ blocked URL (Manager) or Super Admin skip site ─────────► nothing
  ├─ extract the full JD, title and company once, as soon as the text shows (checked every 0.3 s, up to 12 s)
  ├─ Jobs/Bids duplicate check with the extracted title/company ─► already in QTS: "Skipped", stop
  └─ panel "Check this job": URL (fixed), Title, Company, JD (editable)
        Check          ─ duplicate check again with the checked title/company, then Gemini
                         reads the Manager's JD; matching and saving are unchanged
        Close          ─ closes the tab (only hides the panel on a pinned tab, a search page
                         showing one job, or the window's last tab); nothing sent or saved
        After Check    ─ the panel shows "Checking with Gemini…", then the result; a successful
                         answer closes the tab 5 seconds later (even with auto-close off);
                         not a job / not eligible stay open with "Edit and check again"
        ‹ QTS          ─ hides the panel; QTS / Alt+Q shows it again until the tab closes
        Re-read page   ─ reads the JD again (title/company kept if already filled)
        Never on this site ─ adds the host to the Manager's blocked URLs (needs that permission)
```

- **Skip sites:** Super Admin edits them in Settings → General → "Sites Get JD skips", stored under the
  `settings` key `get_jd_skip_sites` (no migration). Until first saved, the starting list in
  `src/server/get-jd/skip-sites-values.ts` applies. They travel with the Manager's blocked URLs
  (`GET /api/extension/job-detection-url-rules` → `skipSites`) and share its 5-minute cache. An entry is
  an exact host ("www." ignored, other subdomains are separate sites) with an optional path start.
- **Quiet reading:** reading a page for the panel adds nothing to Get JD history or toasts; a page
  whose text can't be read opens the panel with an empty JD box. Sending is reported as before.
- **Background tabs** are read in the background; the panel shows when the Manager opens the tab.
- **Automatic retries** (AI busy, quota) re-send the same checked draft.
- Code: `processGetJdPage` and `handleGetJdDraftAction` in `extension/background/service-worker.js`,
  `renderDraft` in `extension/content/get-jd-review.js`.

## Workflow

1. A tab is created after Get JD is enabled, or an existing tab is explicitly reloaded.
2. After that document loads, inspect lightweight local job-page signals. Retry only within this admitted document's bounded loading cycle.
3. Extract available identity: URL, platform identifier, title and company. Missing title/company remain empty.
4. Load the Manager's Get JD matching mode.
5. In Gemini mode, make one authenticated `POST /api/extension/get-jd/check` with `scope: "global"`. If either Jobs or Bids matches the URL/platform identity **or** normalized title plus company, stop the job. The response exposes only a boolean, without other accounts' details. If the lookup fails, stop with a retryable error; do not call Gemini.
6. In Manual mode, extract the complete available original description and make an authenticated `POST /api/extension/get-jd/check` with `scope: "manual"`. The response reports each active candidate's Jobs/Bids state: already-saved candidates start checked, applied candidates stay checked and locked, and available candidates can be selected. A duplicate for one candidate does not prevent selecting another.
7. Manual Save is disabled when no candidate is checked. Save adds selected available candidates and removes candidates who already had the job but were unchecked; it does not duplicate existing Jobs/Bids rows. After a successful manual save, the result appears at the top of the review panel, no launcher alert is shown, and the tab closes after two seconds when it is safe to close.
8. Save the original extracted JD, not Gemini's rewritten description. Complete existing result and auto-close behavior and release temporary resources.

## Launcher and admission

`extension/shared/page-activity.js` owns the launcher focus controller and document admission monitor. `extension/background/service-worker.js` wires Chrome tab/navigation/focus events to them.

The launcher mounts only in the active tab of the focused window. Deactivation disconnects launcher observers, listeners and timers. Reopening the launcher reuses the existing lifecycle. Cached local permissions and exclusions are used during passive tab activation; explicit interaction can refresh permissions.

Get JD admission is independent of launcher visibility. A newly created background tab can process without mounting the launcher. Enabling records an activation epoch without enumerating existing tabs. `tabs.onCreated` records new-tab eligibility. `webNavigation.onCommitted` admits its HTTP destination or an explicit `reload` transition. Initial redirect metadata remains associated with that opening. Top-level document identity and session state deduplicate readiness notifications; `onDOMContentLoaded`/`onCompleted` do not independently qualify an old tab.

Ordinary existing-tab navigation, SPA/hash changes, history traversal, tab/window activation, launcher activation and service-worker startup do not initiate Get JD. Previously loaded tabs require an explicit reload after activation. Separate existing Apply/source tracking remains independent.

## Detection and extraction

`extension/shared/job-page-detection.js` contains the built-in vocabulary and evaluation logic. No Manager keyword API, downloaded keyword configuration, keyword synchronization or new keyword table is used. Historical keyword endpoints/records are retained for compatibility, but the new detector and its settings panel do not consume them.

Signals include current JobPosting structured data, selected detail panes, meaningful titles, role/qualification prose, vacancy identifiers, employment metadata, Apply controls and embedded ATS structure. No single title/keyword count/Apply button/known domain is mandatory for every recognition path. Negative signals distinguish lists, articles, closed postings and challenges. Detection samples are bounded; they are not the authoritative stored JD.

Initial inspection is immediate. Subsequent attempts use bounded waits around 1, 3 and 6 seconds, plus short settling windows. No permanent Get JD observer or scan is installed on existing unrelated pages.

`extension/shared/job-page-text.js` supplies the strict original-description reader. It prioritizes specific description containers and relevant structured descriptions, preserves repeated prose and Unicode, and does not silently slice the result. Navigation/form/cookie markup is excluded; this is normalized plain text, not an HTML archive. A description over 100,000 characters fails explicitly. Extraction errors are transported back from injected scripts rather than treated as successful empty output. Apply-page description fetches and helper tabs retain the same overflow safeguard.

## Server boundaries

- `src/server/get-jd/global-precheck.ts`: one SQL statement returning a Jobs/Bids existence boolean, without Manager/candidate scoping. Tracking URL parameters are ignored while job-identifying parameters are preserved; supported platform identifiers and normalized title/company keys are considered.
- `src/app/api/extension/get-jd/check/route.ts`: authentication, identity validation, global lookup and fail-closed response. The historical request shape remains supported for compatibility.
- `src/server/get-jd/precheck-ticket.ts`: a signed, Manager- and URL-bound ten-minute receipt, using the existing authentication secret. It is required before the Gemini route proceeds.
- `src/app/api/extension/get-jd/route.ts`: verifies the receipt, keeps the saved matching instructions, sends each candidate's profile job titles and dates (newest first; a candidate with no job title is left out), and keeps remote eligibility and saving behavior, and substitutes the complete source JD for any generated description. There is no separate post-Gemini Jobs/Bids lookup in this route.
- `src/server/get-jd/page-check-key.ts`: aligns existing per-Manager Gemini in-progress/replay keys with shared URL normalization.

Existing insertion transactions, advisory locks, unique constraints, authentication and candidate ownership checks are retained. Save-time integrity checks are distinct from an explicit workflow duplicate precheck.

## Verification boundaries

Focused tests cover admission metadata, focused-tab ownership, detection fixtures, signed receipts, actual route handlers with mocked dependencies, and generated SQL executed against synthetic in-memory PostgreSQL tables. Real local Chrome tests exercise Ctrl/middle-click background tabs, redirects, delayed content, ordinary navigation/SPA exclusions, reloads, duplicate/error stopping, Manual saving and exact original-JD transport. They use mocked services, not live Gemini or production data.

Local verification on 2026-10-31:

| Check | Result |
| --- | --- |
| Full server suite, with a process-local dummy database URL | 186 passed, 3 skipped, 0 failed |
| Full extension suite, serialized | 357 passed, 0 failed |
| Focused admission/detection/boundary suite after the final activation-race test | 100 passed, 0 failed; overlaps the full suite |
| Real Chrome Get JD, existing Apply-page and local PDF regressions | 3 passed, 0 failed; Get JD overlaps the full extension suite |
| Global precheck SQL against synthetic in-memory PostgreSQL | 12 passed |
| TypeScript and targeted implementation lint | Passed |

Logs are local artifacts in `.pdf-verification/get-jd-server-tests.txt`, `get-jd-extension-tests.txt`, `get-jd-focused-tests.txt`, `get-jd-chrome-regression.txt` and `get-jd-sql-check/results.json`.

The final one-second idle background-renderer observation measured 0 additional requests, unchanged JavaScript heap (3,237,740 bytes), and approximately 0.00033 seconds of task duration, with no mounted launcher. This is a short instrumentation sample, not proof of whole-browser resource savings or a performance baseline.

Remaining limits:

- A finite synthetic detection corpus cannot establish 99% recall across real websites. A diverse manually labeled corpus is still required, with measured false positives.
- Native desktop window focus and physical context-menu/F5/Ctrl+R interactions require manual Chrome checks; reload metadata and programmatic normal/hard reloads are automated.
- The global precheck is an existence check, not an atomic cross-Manager/cross-table reservation. Concurrent runs can both pass before either inserts. Existing save-time integrity protections remain, but do not guarantee a global single Gemini call under that race.
- The signed receipt is not a one-use reservation. The in-progress cache prevents repeated Gemini work within its existing Manager scope.
- URL/legacy-row normalization is not universal entity resolution. Production-size query plans and throughput remain unmeasured; no new indexes or schema changes were introduced.
- Chrome renderer CDP task-duration/heap observations describe only the sampled local background tab, not whole-browser CPU/RAM or a before/after improvement.
- Stored review results are serialized and capped at 100 entries. Chrome storage limits can still matter for unusually many maximum-size descriptions.
- Live Gemini, production database behavior and hosted deployment have not been tested by these local fixtures.

## Manual review fields and candidate selection

When Gemini matching is not assigned, completed Get JD results automatically open the manual review panel with editable URL, Title, Company, and JD fields. This also works when the panel loads an already stored result before session initialization finishes. Cancel keeps that result closed; a new manual run opens again. Missing extracted values can be entered before Save; all four fields are required and validated by the worker and existing save endpoint. Manual review does not require a remote classification. Gemini matching, eligibility, extraction, and automatic saving remain unchanged.

Managers can assign an existing Super Admin Category when creating or editing a candidate, regardless of their Get JD mode. The manager's existing free-text category is now named Label, with its existing color used as a filled background and contrasting text. No database migration is needed. Category assignment is validated against the catalog; candidate ownership checks remain in place.

The manual review lists each candidate's Label and Super Admin Category. Category checkboxes select or clear all editable candidates in that category; individual checkboxes can refine that selection. Draft job edits survive review rerenders and are submitted with Save. Existing duplicate, ownership, current-employer, and locked-account checks still apply. Candidate activation and experience requirements remain unchanged.
