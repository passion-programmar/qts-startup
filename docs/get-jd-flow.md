# Get JD: local detection and one global precheck

This describes the local implementation. It has not been deployed by this change.
The older Manager-keyword detection flow is superseded by this document.

## Workflow

1. A tab is created after Get JD is enabled, or an existing tab is explicitly reloaded.
2. After that document loads, inspect lightweight local job-page signals. Retry only within this admitted document's bounded loading cycle.
3. Extract available identity: URL, platform identifier, title and company. Missing title/company remain empty.
4. Make one authenticated `POST /api/extension/get-jd/check` with `scope: "global"`.
5. If either Jobs or Bids matches the URL/platform identity **or** normalized title plus company, stop the entire job for all candidates and Managers. The response exposes only a boolean, without other accounts' details.
6. If the lookup fails, stop with a retryable error. Do not call Gemini.
7. If new, extract the complete available original description, then run the existing Gemini matching/automatic saving flow or Manual selection/Save flow.
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
- `src/app/api/extension/get-jd/route.ts`: verifies the receipt, keeps existing Manager matching instructions, candidate notes, remote eligibility and saving behavior, and substitutes the complete source JD for any generated description. There is no separate post-Gemini Jobs/Bids lookup in this route.
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
