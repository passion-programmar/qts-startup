# QTS Phase 3: Auto Apply gap analysis

| | |
|---|---|
| Date | 2026-10-28 |
| Type | Read-only audit. No code, schema, data, branches, settings or deployments were changed. |
| Code version | Branch `qts-startup-deploy` at `a6a9012` (the same as `startup/main`). Extension manifest 1.43.1. |
| Evidence | Server code, Drizzle schema and migrations, extension code, and the web UI. |
| Status labels | **IMPLEMENTED**: connected to a path that actually runs. **PARTIAL**: works, with significant limits. **MISSING**: not built. **UNUSED**: the code exists but nothing reaches it. **UNKNOWN**: not enough evidence. |

**How this was checked:**
- Each feature was traced through its callers, not judged by its name.
- No real application was submitted, and nothing was benchmarked.
- Performance points are labelled either "observed in code" (a timeout or extra database call is visibly there) or "suspected" (not measured).

## 1. Executive summary

1. **Two Apply engines exist, and only one is live.**
   - **Live:** "assisted Apply". It fills only what it knows (the résumé and cover letter, profile facts, and Super Admin's reusable answers). It never calls AI and never clicks Next or Submit. You finish the form, click the site's Submit, then the panel's **Submitted**.
   - **Not reachable:** a second, automatic engine, `runApplication` in [apply-runner.js](extension/background/apply-runner.js). It fills, asks AI (ChatGPT or Gemini) one round per form step, clicks Next, has review and confirm panels, and supports automatic Submit. Nothing reaches it except a developer dry-run flag (`qtsApplyDryRun`), which no UI sets. In dry-run it always stops before Submit.
   - **This is the most important finding.** About 60% of the requested Auto Apply engine already exists as tested-but-unused code. **Recommendation: build Auto Apply as a separate controller that reuses this engine's building blocks. Do not write a third engine, and do not change assisted Apply.**
2. **The reusable-answer library is already global, which is your target.**
   - `reusable_answers` has no column for a candidate, a Manager or an organization. Every candidate gets every answer, and it goes into every AI prompt.
   - What is missing is **governance**: answers have no draft/approved/rejected status, and only Super Admin can edit them.
   - Question memory **promotes answers to global automatically, with no approval step**: a choice question seen 5 times or more, always given the same answer, by 3 or more candidates. Answers that came from AI count towards this.
3. **Gemini answer generation exists on the server and is safe.**
   - It goes through `POST /api/extension/apply/answers`, sends one request per form step, and rotates keys with limits per key.
   - Keys never reach the extension.
   - **Weak points:**
     - nothing caches AI answers;
     - the default limits are **200 requests per day and 2 per minute per key** ([gemini-api-limits.ts](src/server/gemini/gemini-api-limits.ts)), far below 500 bids per day at 1–3 calls each unless there are several keys or a cache;
     - every Gemini response body, which contains candidate answers, is stored in `gemini_api_call_logs`.
4. **Most of Auto Apply needs no migration.** One small migration is recommended, and it needs your approval:
   - a `status` column on `reusable_answers`;
   - a `mode` column on `apply_attempts`, so the two engines' claims can't be confused.
5. **Smallest safe first step (Stage A):** make the global library governable.
   - Automatically learned answers become drafts instead of going live.
   - Super Admin can approve or reject them.
   - Approved answers keep working exactly as they do today.
   - The live extension needs no change, so assisted Apply is untouched.

## 2. Existing Apply architecture

### 2.1 How it starts and claims a job (observed)

- **Starting.** The in-page QTS panel ([page-launcher.js](extension/content/page-launcher.js)) sends `QTS_PAGE_ACTION {action:'apply'}`. The service worker then:
  1. checks the token;
  2. refuses if Generation is running;
  3. calls `GET /api/extension/features/me` and requires `canUseApply`;
  4. sets `qtsExtensionStatus='apply'`;
  5. runs `processApplyQueue` ([apply-runner.js:2394](extension/background/apply-runner.js#L2394)).
- **The queue:**
  - It first resumes the saved tabs (`POST /apply/resume`).
  - It then claims up to **2 jobs per Chrome** (`APPLY_TABS_PER_CHROME`, and on the server `APPLY_PARALLEL_LIMIT = 2` in [apply-values.ts:5](src/server/apply/apply-values.ts#L5)).
  - When there is nothing to claim it waits up to 60 s. An alarm re-enters it every 30 s.
  - The old "limit 3 per Manager" no longer applies: since migration 0074 the limit is per Chrome, and since 0078 a candidate may have several pages open.
- **Choosing the run.** [apply-runner.js:2444](extension/background/apply-runner.js#L2444): `track(testMode ? runApplication(...) : runAssistedApplication(...))`. `testMode` is true only when `qtsApplyDryRun === true` is in storage.
- **The server claim:**
  - `claimNextApplication` runs the plpgsql function `claim_apply_attempt` (latest version in `drizzle/0075_apply_nothing_recorded.sql`). It is serialized per Manager with an advisory lock.
  - It picks the oldest job that:
    - has a delivered Generation;
    - is not applied and has no bid;
    - has no live or finished attempt;
    - has been released fewer than 2 times.
  - `loadApplication` ([apply-attempts.ts:169](src/server/apply/apply-attempts.ts#L169)) then returns:
    - the job, including its description and the résumé and cover-letter text;
    - the candidate's profile and details;
    - **all** reusable answers;
    - exchange rates;
    - up to 2,000 remembered choices;
    - the default answer prompt;
    - `aiMode`, `reviewMode` and `autoSubmit`;
    - the decrypted site-account password.
- **"Apply this page":** `POST /apply/page` lists the accounts ready for that URL, and `POST /apply/start-job` claims the chosen job directly as `waiting_review`.

### 2.2 The server routes (`src/app/api/extension/apply/*`)

All routes use `authorizeApplyRequest` ([apply-route-auth.ts:22](src/server/apply/apply-route-auth.ts#L22)), which checks:
- the bearer JWT (24-hour token, `role=manager`, `authVersion` matches, Manager not blocked, `canUseApply`);
- the Chrome's identity headers (one upsert of `extension_browsers` on every request);
- the version gate (`MIN_WORK_EXTENSION_VERSION = 1.36.0`).

The exception is `documents` without `print=chrome`, which redirects to `/api/pdf/print`, and that route checks again. Every attempt change is filtered by `ownedBy(attemptId, managerId, browserId)` ([apply-attempts.ts:295](src/server/apply/apply-attempts.ts#L295)).

| Route | What it does | Database trips (sign-in included) |
|---|---|---|
| `claim` | Claims a job and returns the application | 3 with nothing to claim, **8** with a job |
| `start-job`, `resume` | Takes a specific job, or the tab's earlier job | 8–9 |
| `page` | Lists accounts for this URL | 3 |
| `heartbeat` | Renews the hold (120 s while filling, 600 s while waiting for the Manager); returns `reviewMode` and `autoSubmit` | 4 |
| `answers` | Gemini answers for one step (`askGeminiForApplyAnswers`) | 3, plus the Gemini key and limit trips |
| `review`, `back-to-review`, `submitted` | State changes; `submitted` stores `evidence={answers, learned}` | 3 each |
| `result` | Yes/No: settles the attempt, creates the bid, applies or removes the job, records the run and learned answers | Yes about 7–8, No 5 |
| `release` | skip / error / later / test / drop / remove | 3–4 |
| `save-bid` | Fallback when the attempt is gone | 4 |
| `documents` | A Chrome print job (`print=chrome`), or a 307 to the server printer | 3 |

### 2.3 The `apply_attempts` state machine (observed)

- **Statuses** ([schema.ts:637-683](src/db/schema.ts#L637)): `claimed`, `waiting_review`, `waiting_confirmation`, `submitting`, `confirmed`, `not_confirmed`, `failed`, `released`, `skipped`, `cleared`.
- **Constraints:**
  - one live attempt per job (unique index `apply_attempts_one_live_per_job_unique`);
  - `submit_granted_at` is required for the submitted statuses.
- **Expired holds** are cleared only inside `claim_apply_attempt` and only for that Manager. Stop All deletes the Manager's `claimed` and `waiting_review` rows.

### 2.4 How assisted Apply fills a form (live; observed)

- **Field discovery.** `scanForm` in [apply-form.js:608](extension/content/apply-form.js#L608) covers:
  - text, email, tel, url, number, date and file inputs;
  - textareas and rich editors;
  - native selects;
  - React Select, comboboxes, listboxes, menus and Selectize;
  - radios and checkbox groups;
  - drop zones.

  It reads open and closed shadow DOM and same-origin iframes. **Cross-origin iframes can't be read.** For known ATS hosts, assisted mode instead opens the frame's address in the tab.
- **Filling** (`fillField`, [apply-form.js:1232](extension/content/apply-form.js#L1232)):
  - React-safe native value setter with `input`/`change` events;
  - typed search for comboboxes;
  - real (trusted) clicks and `Input.insertText` through `chrome.debugger` when synthetic events fail;
  - phone numbers fitted to country-code pickers;
  - dependent lists (country, then region) re-read.
- **Answer order** (`resolveField`, [apply-answers.js:472](extension/shared/apply-answers.js#L472)):
  1. documents;
  2. consent;
  3. EEO;
  4. profile facts;
  5. exact reusable answer;
  6. reusable answer by topic;
  7. profile rules (salary conversion, notice, sponsorship);
  8. fuzzy reusable match;
  9. otherwise AI.

  Assisted mode keeps only answers from `documents`, `profile` or `reusable` (`ASSIST_SOURCES`, [apply-runner.js:1961](extension/background/apply-runner.js#L1961)), and skips AI (`if (toAsk.length && !assist)`, [apply-runner.js:1088](extension/background/apply-runner.js#L1088)).
- **Re-scanning:**
  - a MutationObserver with a 500 ms debounce ([apply-assist.js:620](extension/content/apply-assist.js#L620));
  - a backup poke every 15 s;
  - a re-check when a tab finishes loading;
  - the panel's "Still empty (N required)" list, re-scanned every 2 s.
- **Uploads:**
  - PDFs come from `GET /apply/documents?print=chrome` and are printed in this Chrome with `chrome.debugger` (`Page.printToPDF`). The server printer is the fallback (3 tries, 5 s apart).
  - Files are attached with a `DataTransfer` on `input.files`, or as a synthetic drop.
  - The check only confirms `files.length===1`, or a filename shown on a drop zone. Assisted mode's "Still empty" list leaves uploads out.
- **Ending:**
  - **Submitted:** sends `submitted`, then `result {submitted:true, removeJob:true}`, falling back to `save-bid`.
  - **Cancel:** `release drop`.
  - **Remove:** `release remove`.

  Nothing detects the final submit or reads the site's confirmation (`pageOutcome` and `CONFIRMED_TEXT` in apply-form.js are UNUSED).

### 2.5 The automatic engine (UNUSED; only reachable in dry-run)

`runApplication` ([apply-runner.js:1648](extension/background/apply-runner.js#L1648)) does the following:
- reaches the form by clicking start buttons (`reachApplicationForm`); stops at sign-in, registration and verification pages;
- fills each step: profile and reusable answers, then remembered choices, then **AI for every open question in one request**, then one fix-up request for invalid answers;
- checks every field: reads the value back, reads the site's error next to the field, retries with real clicks;
- checks each step: empty required fields, required uploads, unreadable frames, error messages;
- clicks Next (up to 5 pages);
- pauses for review (`content/apply-review.js`), with `reviewMode` set to `every_step` or `before_submit`;
- submits automatically or waits for the Manager's confirmation.

The `autoSubmit` and review-mode settings that Super Admin can change are read only here, so **they have no effect today.**

### 2.6 Stop All and cancellation (observed)

- **Stop All** comes from the Jobs page. `stopAllAction` ([src/app/jobs/actions.ts:325](src/app/jobs/actions.ts#L325)) runs one batch that:
  - increases `users.applyStopVersion`;
  - deletes the `claimed` and `waiting_review` attempts.
- **How the extension finds out:** the browser heartbeat (`POST /api/extension/browsers/heartbeat`, every 30 s) returns the version, and the extension stops only if its current `workMode` is `apply`. So a stop can take up to about 30 s to arrive.
- **Mid-step:** a fill already in progress, including a long AI wait, is not interrupted. There is no `AbortController` in the Apply path.
- **Dead code:** `requestStopAll` ([extension-browsers.ts:89](src/server/browsers/extension-browsers.ts#L89)) has no callers.

## 3. Existing reusable-answer architecture

### 3.1 Tables (observed)

| Table | Scope | Used? |
|---|---|---|
| `reusable_answers` ([schema.ts:713](src/db/schema.ts#L713), migration 0065, `auto_added` added in 0073) | **Global.** One row per `question_key` (unique). Columns: question, answer, note, `auto_added`, `created_by_user_id`. | **IMPLEMENTED.** Read by every claim; editable in Settings. |
| `apply_question_memory` ([schema.ts:743](src/db/schema.ts#L743), 0073) | Global, one row per `question_key`. Counts, option lists, up to 5 short choice answers (with up to 10 candidate IDs each), up to 10 remembered choices, `dismissed`. | **IMPLEMENTED.** Written on every Yes; read for remembered choices and suggestions. |
| `candidate_saved_answers` ([schema.ts:686](src/db/schema.ts#L686), 0062) | Per candidate | **UNUSED.** Nothing in `src/` or `extension/` reads or writes it. Its rows were deleted on 2026-10-27; the table remains. |
| `prompts` (`application_answer` purpose) | Global, Super Admin | **IMPLEMENTED.** Supplies the default answer prompt per AI mode. |

### 3.2 Answers to your 14 questions

1. **Is the library shared between candidates?** Yes. `loadApplication` reads every row with no filter and marks it `scope: "everyone"` ([apply-attempts.ts:233-243](src/server/apply/apply-attempts.ts#L233)).
2. **Which tables and fields?** See the table above: `reusable_answers` (question, `question_key`, answer, note, `auto_added`, `created_by_user_id`), plus `apply_question_memory` for learning.
3. **How is matching done?** In the extension ([apply-answers.js](extension/shared/apply-answers.js)), in this order:
   1. an exact normalized `question_key` (lower-case, "(required)/(optional)" and punctuation removed, cut to 300 characters);
   2. a topic match against a regex list (`REUSABLE_TOPICS`, around L322);
   3. a fuzzy word overlap of 0.75 or more after filler words are removed (`matchSavedAnswer`, around L810);
   4. remembered choices, matched on question, the option set and the intended value (`findRememberedChoice`, around L1289).
4. **What technique?** Exact text, regex topics and word overlap. **No embeddings and no AI similarity.**
5. **Which answers can be reused without Gemini?**
   - Short, stable answers that are the same for everyone: salary (converted per period and currency in code), notice and start date, sponsorship, relocation, work mode and contract type, "how did you hear", consent, and the EEO choices.
   - Choice answers whose text matches one of the form's options, or that map onto Yes/No.
   - Free-text answers only when the stored text passes the field's check (length, options).
6. **Can Gemini adapt approved answers without changing the facts?**
   - **Partly.** Every reusable answer goes into the prompt (`{{saved_answers}}`), and the prompt forbids inventing employers, degrees, dates, numbers or skills.
   - The code checks options, maximum length, number ranges, date and email formats (`checkAnswer`), and that a converted profile fact keeps its meaning (`keepsMeaning`: country, phone, birthday, email, yes/no).
   - **Free-text facts are not checked against the résumé or the approved answer.** That depends on the prompt alone.
7. **What happens when nothing matches?**
   - In assisted mode (live), the field is left for the Manager.
   - In the automatic engine, it goes to AI. If AI can't answer, it is listed for the Manager.
8. **Are generated answers saved automatically?**
   - Free-text AI answers are **never stored**.
   - **Choice answers, including AI answers, are counted in question memory after a Yes. When the promotion rule is met, they become live global reusable answers with no approval** (`safeAutoAnswer`, [question-memory-values.ts:128](src/server/apply/question-memory-values.ts#L128), inserted at [question-memory.ts:108](src/server/apply/question-memory.ts#L108)).
9. **Can you edit, approve, reject or update answers?**
   - **Super Admin only**, in Settings → Reusable answers:
     - `saveReusableAnswerAction` and `deleteReusableAnswerAction` ([src/app/settings/actions.ts:509-570](src/app/settings/actions.ts#L509));
     - a suggestions list with Dismiss ([reusable-answers.tsx](src/app/settings/reusable-answers.tsx)).
   - Managers and the extension can't change the library.
   - There is no approve/reject step. Deleting is permanent.
10. **Can the library tell verified facts, approved answers and AI drafts apart?**
    - **No.** The only marker is `auto_added` (true or false).
    - Profile facts are separate (in `profiles`), but four "fact topics" (salary, notice, sponsorship, relocation) in reusable answers **override** the profile's values (`withReusableFacts`, [apply-answers.js:441](extension/shared/apply-answers.js#L441)). That is intentional under your 2026-10-26 decision.
11. **Are duplicates or conflicts detected?**
    - Exact duplicates are, by the unique `question_key`.
    - Near-duplicates ("Why X?" vs "Why do you want X?") are not.
    - Conflicts are not flagged: promotion just requires one consistent answer, and nothing warns when a learned answer contradicts an approved one.
12. **Could one candidate's answer be applied to another?**
    - Under your rule that all profiles are the same person, sharing is intended. The code, however, was written for different people.
    - The real risks are wrong matches, not wrong people:
      - the topic fallback takes the first answer in a topic (`topicAnswer` uses `rows[0]`);
      - the 0.75 word-overlap match can attach an answer to a similar but different question;
      - automatic promotion relies only on regex filters for personal questions.
    - Profile facts stay per candidate. Between Managers, everything is protected by the server's ownership checks.
13. **Does global reuse need a migration?** No: it works today. A migration is needed only for governance (status, provenance). See section 8.
14. **How should existing answers be kept?** Add columns with defaults (`status default 'approved'`) so every current row stays live. Never rewrite or re-key existing rows. Back up with a Neon branch before migrating, and keep `question_key` stable.

## 4. Existing Gemini answer architecture (observed)

- **Prompt.**
  - Built in the extension by `buildAnswerPrompt` ([apply-answers.js:1130](extension/shared/apply-answers.js#L1130)) from Super Admin's default `application_answer` prompt for the Manager's AI mode, or a built-in default, plus a fixed reply format.
  - Placeholders: job title, company, location, description (12,000 characters max), today, candidate profile, résumé, cover letter, `saved_answers` (all of them), questions.
- **Data sent to Gemini:**
  - the profile facts, including contact details, address, work authorization, salary and the EEO answers;
  - the full résumé and cover letter;
  - the job description.

  **Suspected excess:** the contact details and EEO answers are rarely needed for open questions.
- **The call.**
  - Extension → `POST /api/extension/apply/answers {attemptId, turns}`, with a 120 s client limit.
  - The server checks ownership (the attempt must be claimed or waiting for review), then calls `askGeminiForApplyAnswers` ([apply-gemini.ts:41](src/server/apply/apply-gemini.ts#L41)):
    - model `gemini-3.5-flash-lite`, JSON output, temperature 0.2;
    - 1–3 turns of up to 150,000 characters each;
    - a 60 s timeout.
- **Keys, limits and retries:**
  - `withAvailableGeminiKey` ([gemini-keys.ts:149](src/server/gemini/gemini-keys.ts#L149)) shuffles the keys and leases one in the database.
  - It counts tokens and reserves against the limits per key. Defaults: 2 requests per minute, 200 per day, 25,000 input tokens per minute. Super Admin can change them.
  - `withGeminiKeyFailover` ([gemini-retry.ts:28](src/server/gemini/gemini-retry.ts#L28)): on a 5xx it pauses that key for 5 minutes and tries the next, up to 3 keys. A 429 or other 4xx is not retried. When no key is free, the client gets a 429.
- **Batching:** one request per form step, covering all open questions, plus one fix-up request. **There is no cache** across steps, jobs or candidates.
- **Logging:** `gemini_api_call_logs.response_body` stores the full response (up to 1 MB, with the key removed), which **includes the generated candidate answers**. Old rows are cleared only when a Super Admin opens the Gemini Usage page.
- **Key safety:** keys are read only in `server-only` modules (`getGeminiApiKeys`), error text has the key removed, and nothing in `extension/` mentions the Gemini endpoint or keys. **No exposure found.**
- **ChatGPT mode:** a pinned ChatGPT tab in the Manager's Chrome (no API key). It is reachable only from the automatic engine, so it is unused today.

## 5. Current vs target gap analysis

| # | Feature | Current implementation | Status | Missing or weak | Recommended change | Source files |
|---|---|---|---|---|---|---|
| 1 | Separate Auto Apply mode | Assisted Apply is live. The automatic engine is reachable only through the dry-run flag. | PARTIAL (engine UNUSED) | No mode, controller or switch; Submit always blocked in dry-run | New `auto-apply-runner.js` controller reusing the engine's functions; its own launcher row and work mode | apply-runner.js:1648, 2394, 2444; page-launcher.js |
| 2 | Detect application forms | `reachApplicationForm` + `scanForm`; recipes say skip vs run | IMPLEMENTED (engine) / PARTIAL | Cross-origin iframes unreadable; sign-in and verification pages stop the run | Reuse; add a "needs you" hand-off instead of stopping | apply-runner.js:178; apply-form.js:608; shared/apply-recipes.js |
| 3 | Use verified candidate facts | Profile facts first; `keepsMeaning` protects conversions | IMPLEMENTED | Four fact topics come from the global library rather than the profile (by design) | Keep; show the source on the review panel | apply-answers.js:441, 472, 755 |
| 4 | One global answer library | `reusable_answers` global | IMPLEMENTED | — | Keep the table | schema.ts:713; apply-attempts.ts:233 |
| 5 | Approve / edit / reject answers | Super Admin create, edit, delete; suggestions with Dismiss | PARTIAL | No draft or rejected status; automatic additions go live; no Manager path | `status` column; drafts instead of automatic live answers; approve/reject UI | settings/actions.ts:509-592; question-memory.ts:108 |
| 6 | Prefer approved answers over AI | Exact, topic and fuzzy matches before AI | IMPLEMENTED | Fuzzy and topic fallbacks can mis-match | Show the match type and score on review; tighten the topic fallback | apply-answers.js:422, 810 |
| 7 | Gemini for new questions | `/apply/answers`, one request per step | IMPLEMENTED (server) / UNUSED (no live caller) | Low default per-key limits | Reuse the route under Auto Apply's own permission | apply-gemini.ts; answers/route.ts |
| 8 | Adapt answers to wording and limits | Prompt includes approved answers; `checkAnswer` enforces options and maximum length; fix-up turn | PARTIAL | No fact check of free text against approved answers or the résumé | Stage C: send the approved answer as a "must keep" constraint; post-check numbers, dates and named entities | apply-answers.js:1130, 1166 |
| 9 | Never invent facts | Prompt rule; `status:"review"` for unknowns | PARTIAL | Relies on the prompt for free text | Stage C validator, plus review for any answer containing facts not found in sources | apply-answers.js:1001, 1211 |
| 10 | Text inputs, textareas, rich editors | Native setter plus events; `execCommand` for editors | IMPLEMENTED | 700 ms fixed wait per text field | Shorter wait when no suggestion list appears | apply-form.js:1186, 1328, 1483 |
| 11 | Dropdowns, comboboxes, React Select | Simulated, then typed search, then debugger real clicks | IMPLEMENTED | Option discovery is slow (up to about 9 s per combobox) | Cache the options per form; read before typing | apply-form.js:1023, 1068, 1349; apply-runner.js:337, 424 |
| 12 | Radios and checkboxes | `.click()`, then real click on the label | IMPLEMENTED | — | Reuse | apply-form.js:1262; apply-runner.js:400 |
| 13 | Date pickers | Native `type=date` set as text | PARTIAL | No calendar interaction; read-only pickers likely fail (suspected) | Stage D: picker handling, or a hand-off | apply-form.js |
| 14 | File uploads | Chrome-printed PDFs; DataTransfer or drop | IMPLEMENTED | `DOM.setFileInputFiles` not used; check is `files.length===1` only | Stage D: check the site shows the file; use the debugger for stubborn inputs | apply-runner.js:625; apply-form.js:1255, 1540 |
| 15 | Multi-step navigation | Engine clicks Next (5 pages max, 2.5 s waits); assisted follows pages the Manager opens | IMPLEMENTED (engine) / UNUSED | Exact-text button regexes; stops when several buttons match | Reuse; wait for page changes instead of fixed sleeps | apply-runner.js:1781-1853, 2092 |
| 16 | Keep answers when navigating | Per-step answers in `assistant.used` / `answersUsed`; re-resolved per page | PARTIAL | No per-question cache across steps; AI is asked again for a repeated question | Per-application answer cache keyed by question | apply-runner.js:1667+ |
| 17 | Verify filled fields persist | Read-back plus site error per field; step-level empty-required check | IMPLEMENTED (engine) / PARTIAL (assisted) | No final re-read of all fields before Submit; uploads excluded in assisted mode | Pre-submit sweep: re-read every answered field and upload | apply-runner.js:688, 1945, 2020 |
| 18 | Review, edit and approve before saving | Review panel `apply-review.js` (engine only); Manager edits sent as `learned` source `manager` | UNUSED / PARTIAL | No "save this answer globally" button | Stage E: per-answer "Save to library" creating a **draft** (or approved, if allowed) | content/apply-review.js; apply-runner.js:1308 |
| 19 | Track progress, failures, unanswered | `stepReport` only logged in debug; `appliedAnswers` sent | PARTIAL | Unanswered questions and failures not stored | Small `evidence.unanswered` list in the existing `evidence` jsonb (no migration) | apply-runner.js:1191; apply-attempts.ts:528 |
| 20 | Authorization before final Submit | Assisted: the Manager clicks Submit. Engine: `before_submit` review and `autoSubmit` flag | IMPLEMENTED (assisted) / UNUSED (engine) | — | Auto Apply always stops at a "Submit?" panel; no automatic submit unless you decide otherwise | apply-runner.js:1812-1834 |
| 21 | Fast and economical with Gemini | One request per step, local token counting, limits per key | PARTIAL | No cache; every reusable answer in every prompt; full résumé each time; 200 per day per key | Stage C: answer cache by `question_key` + job; trimmed context | gemini-api-limits.ts; apply-answers.js:1130 |
| 22 | Stop All | Version counter via the browser heartbeat; attempts deleted | IMPLEMENTED (Apply) | Up to about 30 s delay; fills in progress not interruptible; extension checks only `workMode==='apply'` | Auto Apply checks the same counter; `AbortController` per run | actions.ts:325; service-worker.js:6655-6705 |
| 23 | Manager permission | `canUseApply`, set by Super Admin | IMPLEMENTED | No separate Auto Apply switch | New `canUseAutoApply` flag, or reuse `canUseApply` (decision) | schema.ts:105-120; extension-auth.ts |
| 24 | Duplicate and conflict detection in the library | Unique `question_key` only | PARTIAL | Near-duplicates and contradictions not detected | Stage A: "similar existing answer" warning when saving (word overlap; no AI) | apply-values.ts:66, 178 |
| 25 | Legacy learning recorder and popup | `learning-recorder.js`, `learning-review-panel.js`, `/api/application-sessions/*` | UNUSED (server routes don't exist; recorder still injected on justjoin.it) | Wasted listeners | Leave alone now; remove in a separate clean-up | content/learning-recorder.js; popup/api-client.js:238 |
| 26 | Legacy Custom-GPT auto-apply pipeline | `auto-application-pipeline.js`, flags `scanner` and `applicationAutomation` hard-coded false | UNUSED | Name collision with the new feature | **Avoid**; don't revive it | shared/auto-application-pipeline.js; shared/runtime-config.js:9 |
| 27 | Claim renewal (heartbeat) | Fixed in `a6a9012` (`::timestamptz`) | IMPLEMENTED (server, tested on the test DB) | Not yet seen renewing in production (section 9.3) | Verify again | apply-attempts.ts:400 |

## 6. Exact safe reuse opportunities (Part 4)

**KEEP UNCHANGED**
- Assisted Apply: `runAssistedApplication`, `apply-assist.js`, the panel, Submitted/Cancel/Remove, "Apply this page".
- Get JD.
- Generation, the PDF templates and `chrome-pdf.js` / `chrome.debugger` printing, and `/api/pdf/print`.
- The `claim_apply_attempt` job selection, and Stop All's server action.

**REUSE AS-IS**
- **Server:**
  - `authorizeApplyRequest`, browser identity and the version gate;
  - `loadApplyDocumentSource` and the Chrome print job;
  - `askGeminiForApplyAnswers` with the key pool, limits and failover;
  - `bidOf`, `saveBidForJob`, `recordApplyRun`, `parseReusableAnswer`, `normalizeQuestionKey`.
- **Extension:**
  - `scanForm`, `fillField`, `pickInCombobox`, `pickMenuChoice`, `dropFile`, `fieldIssue`, `emptyRequired`;
  - `resolveField`, `checkAnswer`, `keepsMeaning`, `buildAnswerPrompt`, `parseAnswerReply`;
  - `fetchApplyDocuments`, `readComboboxOptions`, `pickWithRealClick` / `checkWithRealClick`;
  - `reachApplicationForm`, `findButton`.
- **Contracts:**
  - `ClaimedApplication` (claim response);
  - `/apply/answers` (`{attemptId, turns}` → `{reply}`);
  - `/apply/submitted` and `/apply/result`.

**EXTEND SAFELY (backward-compatible)**
- **`reusable_answers`:** add `status` (default `approved`) and `source`. `loadApplication` sends only approved rows; today all rows are approved.
- **`recordLearnedAnswers` / `safeAutoAnswer`:** insert as `draft` instead of live, and leave out AI-sourced answers when counting towards promotion.
- **Settings → Reusable answers:** approve/reject drafts and show a similar-answer warning.
- **`apply_attempts`:** add `mode text default 'assist'`. Existing routes keep working, and Auto Apply routes filter on `mode='auto'`.
- **Heartbeat route:** one more Stop All counter (or reuse `applyStopVersion`).
- **Work modes:** an `auto_apply` work mode needs the `extension_browsers_work_mode_check` constraint widened and the heartbeat route's validation updated. The alternative is to run Auto Apply under work mode `apply` with a local sub-mode; see section 13.

**BUILD NEW**
- `extension/background/auto-apply-runner.js`: its own controller, queue, state and abort handling. It **calls** the shared functions and doesn't change `runAssistedApplication`.
- A "Submit?" authorization panel for Auto Apply, based on `apply-review.js` but in a new file.
- A per-application answer cache and an unanswered/failure list.
- A pre-submit verification sweep.
- A Gemini answer cache and a fact validator (Stage C).
- A "Save to library" action (draft or approved) and its server action.
- An Auto Apply row in the launcher and its permission flag.

**AVOID**
- Reviving the legacy pipeline (`auto-application-pipeline.js`, popup, `learning-recorder.js`).
- Changing `runApplication` in place or flipping `qtsApplyDryRun` in production. Copy what's needed into the new controller, or move shared functions into a module without changing their behaviour.
- Mixing both engines' rows in `apply_attempts` with no `mode` column.
- Embeddings or a vector database. They aren't needed at this library size, would add cost, and Neon Free storage is small.
- Sending all candidate facts to every AI request.

## 7. Missing functionality (summary)

1. An Auto Apply mode, controller, switch and permission.
2. Answer governance: draft, approved and rejected; provenance; usage counts; near-duplicate warnings.
3. Managers able to propose or save answers to the global library (if you want that).
4. A Gemini answer cache and trimmed AI context.
5. Fact validation of AI free text against approved answers and the résumé.
6. Calendar date pickers.
7. Checking that the site actually holds an uploaded file.
8. A pre-submit re-read of every field.
9. Stored unanswered questions and failures per application.
10. `AbortController`-based cancellation of a running step, and a faster Stop All for Auto Apply.
11. Final-submit confirmation reading (the code exists but is unused).

## 8. Database and schema implications (Part 6)

| Need | Required? | Proposal |
|---|---|---|
| New tables | **No.** | Reuse `reusable_answers`, `apply_question_memory`, `apply_attempts`, `jobs.apply_answers` and `bids.answers`. |
| `reusable_answers.status` | **Yes, for governance.** | `text not null default 'approved' check (status in ('draft','approved','rejected'))`. Existing rows stay approved. |
| `reusable_answers.source` | Recommended | `text not null default 'manual' check (source in ('manual','learned','ai_draft'))`. `auto_added` stays readable. |
| `reusable_answers.approved_by_user_id`, `approved_at` | Optional | Audit trail. |
| One answer per question | Decision | The unique `question_key` allows one row per question. A draft for a question that already has an approved answer needs either a partial unique index (approved only) or drafts kept in `apply_question_memory`. **Recommendation:** keep the index; a draft can only exist for a question with no approved answer; proposed changes to an approved answer go to an edit form instead. |
| `apply_attempts.mode` | **Yes, if Auto Apply shares this table.** | `text not null default 'assist' check (mode in ('assist','auto'))`. Without it, the Jobs page, the claim function's limits and every route mix both engines. |
| `extension_browsers.work_mode` | Only if Auto Apply gets its own work mode | Widen the check to add `auto_apply`. |
| `users.can_use_auto_apply` | Decision | Or reuse `can_use_apply`. |
| Indexes | No new ones needed | Libraries of this size are read in full. |
| New endpoints | Few | Auto Apply can reuse claim, documents, answers, heartbeat and result if the attempt has a mode. New: "save answer to library" (server action or route) and possibly `/apply/auto-claim` if the job choice differs. |
| Extension permissions | **None new** | `debugger`, `scripting`, `tabs`, `alarms`, `storage` and `<all_urls>` are already granted. |
| Retention | Needed for 500/day | `apply_attempts` rows in failed, skipped, released or cleared stay forever (the daily clean-up leaves `apply_attempts` alone). `gemini_api_call_logs` keeps full bodies. Add rules to the daily clean-up. |

**Security:**
- Global reuse stays behind QTS sign-in: claims go only to the owning Manager's Chrome (`ownedBy`, `parent_user_id`), and library edits are Super Admin only.
- Gemini keys stay on the server.

**Recommended without a migration:**
- send Gemini only the facts the open questions need;
- stop storing full Gemini response bodies, or trim them.

**Noted:**
- the site-account password is sent decrypted with every claim, start-job and resume, not only when a sign-in page needs it;
- `claimJobForBrowser` doesn't check that the candidate is not blocked (suspected minor gap; the claim function does).

## 9. Performance and reliability findings (Part 5)

### 9.1 Observed in code (not measured)

| Area | Finding | Where |
|---|---|---|
| Database trips | 2 sequential sign-in trips per Apply request, one a write (the `extension_browsers` upsert) | apply-route-auth.ts:22; extension-browsers.ts:19 |
| Database trips | The Apply heartbeat reads `users` again (`applySubmitSettings`) after sign-in already read it, so 4 trips | heartbeat/route.ts; apply-attempts.ts:286 |
| Database trips | A claim makes 8 sequential trips; reusable answers, 2,000 remembered choices, the prompt and exchange rates are the same for every claim (cacheable or batchable) | apply-attempts.ts:169-280 |
| Payload / tokens | Every reusable answer goes to every claim and into every AI prompt | apply-attempts.ts:233; apply-answers.js:1130 |
| Gemini | No cache; limits per key of 200 per day and 2 per minute by default | gemini-api-limits.ts:1-8 |
| Fixed waits | 700 ms + 100 ms per text field; 2.5 s after Next; 1 s between up to 6 fill rounds; up to about 9 s per combobox search | apply-form.js:1328, 1023; apply-runner.js:1144, 1799 |
| Re-scans | Each `inForm` call re-injects about 2,700 lines of `apply-form.js` and walks the whole DOM; `findField` walks the DOM on every lookup; the assisted panel re-scans every 2 s | apply-runner.js:144; apply-form.js:603; apply-assist.js:576 |
| Duplicated work | `resolveFields` runs twice per assisted pass; two storage listeners for the same status change; two separate debugger-attach implementations | apply-runner.js:946, 955, 1600, 2077 |
| Verification | Uploads count as "verified" when `files.length===1`; assisted mode skips required uploads in "Still empty" | apply-form.js:1255; apply-runner.js:1880 |
| Cancellation | No `AbortController`; Stop All arrives by 30 s polling | apply-runner.js:1759; service-worker.js:6703 |
| Unnecessary PDFs | None found: PDFs are printed once per application and cached (`assistDocuments`) | apply-runner.js:625 |
| Lost answers | The automatic engine re-resolves per step; a repeated question goes back to AI (suspected cost, not data loss) | apply-runner.js |

### 9.2 Suspected (needs measurement)
- Large forms (Workday-like) may feel slow because of the 2 s full re-scans plus DOM walks per field.
- `fieldErrors` matches any class containing "error", so false alarms are possible.
- A service worker suspended in the middle of a step loses its in-memory run state. Tabs are recovered through `qtsApplySessions`, but step progress isn't.

### 9.3 Heartbeat fix (`a6a9012`): production verification still open

- **Logs:** no errors at all since the fix, and no 42804.
- **Your test (claims #3 and #4, both waiting for review):**
  - neither hold was renewed after about 04:44:50 UTC;
  - the browser heartbeats from the extension also stopped after 21:47:54 PDT;
  - no `/api/extension/apply/heartbeat` request reached the server in that window.
- **What this means:** the extension stopped sending all its regular requests (the Chrome or service worker was likely closed, asleep or reloaded). It doesn't show a server failure. But the lease moving forward is **not yet verified in production**.
- **Next:** one more Apply with Chrome left open for 3 or more minutes.

### 9.4 Benchmark plan (no real applications)
1. **Synthetic setup:**
   - the Neon test project `qts-phase12-test`;
   - 2 synthetic candidates;
   - 10 locally served job forms: plain HTML, React Select, Greenhouse-like, Lever-like, Ashby-like, a 3-step wizard, a shadow-DOM form, a cross-origin iframe form, a date-picker form, and a drop-zone upload.
2. **Measure per form:**
   - time to fill;
   - number of `inForm` calls;
   - database trips (route counters);
   - Gemini requests and tokens;
   - fields verified after a reload;
   - uploads the site actually holds;
   - unanswered count.
3. **Run with** assisted Apply (baseline) and the Auto Apply prototype, with Submit buttons pointing at a local stub that only records the request.

## 10. Proposed Auto Apply architecture

```
Launcher row "Auto Apply" ──► auto-apply-runner.js (NEW controller, own queue/state/AbortController)
                                │ uses (no changes): scanForm/fillField/pick*/dropFile/fieldIssue   ← apply-form.js
                                │                    resolveField/checkAnswer/buildAnswerPrompt     ← apply-answers.js
                                │                    fetchApplyDocuments + chrome-pdf.js printing    ← existing
                                │ new: answer cache, pre-submit sweep, unanswered list, Submit? panel
                                ▼
Server (shared auth: authorizeApplyRequest + canUseAutoApply)
  claim (mode='auto') → loadApplication (approved answers only)
  /apply/answers → askGeminiForApplyAnswers (+ cache, trimmed context, fact validator)
  heartbeat / result / release / save-bid (filtered by mode)
  saveAnswerToLibrary → reusable_answers (draft | approved)
```

**Rules:**
1. Profile facts first, then approved reusable answers (exact, topic, fuzzy, each with its match type), then remembered choices, then cached AI answers, then Gemini (one request per step, only the open questions).
2. Nothing is ever submitted without your click on the Auto Apply "Submit?" panel.
3. Stop All and Cancel abort the current step immediately (`AbortController`) and release the claim.
4. AI answers are never added to the library automatically; "Save to library" is your action.

## 11. Implementation roadmap

The order is adjusted to fit the evidence. Stage A goes first: it is server-only, makes the shared library safe before Auto Apply leans on it, and doesn't touch the extension.

### Stage A: govern the global library
- **Files:** `src/db/schema.ts`, a new `drizzle/0079_*.sql`, `src/server/apply/question-memory.ts`, `question-memory-values.ts`, `apply-attempts.ts` (`loadApplication` filter), `src/app/settings/actions.ts`, `reusable-answers.tsx`, `apply-values.ts`.
- **Reuse:** the table, the actions, the suggestions UI.
- **Build:**
  - `status` and `source` columns;
  - learned answers become drafts;
  - AI-sourced answers no longer count towards promotion;
  - approve/reject actions;
  - a similar-answer warning.
- **Dependencies:** none.
- **Risk:** low. Defaults keep every current answer live.
- **Benefit:** no unreviewed answer reaches forms; you control the library.
- **Tests:**
  - unit tests for `safeAutoAnswer` and the parsers;
  - a DB test (like `apply-attempts.db.test.ts`) that drafts are never returned by `loadApplication`;
  - a migration rehearsal on the test project.
- **Migration:** **yes** (small, additive; needs approval).

### Stage B: Auto Apply engine, independent of Apply
- **Files:**
  - new `extension/background/auto-apply-runner.js`;
  - `service-worker.js` (importScripts and one message handler);
  - `page-launcher.js` (new row);
  - `apply_attempts.mode` in the schema and migration;
  - `claim_apply_attempt` (mode parameter);
  - the apply routes (mode filter);
  - `users.can_use_auto_apply` (optional).
- **Reuse:** every form function in section 6, the claim and document flow, `ClaimedApplication`.
- **Build:**
  - the controller, its queue and state;
  - `AbortController`;
  - the "Submit?" panel;
  - Stop All checks;
  - an unanswered list stored in `evidence`.

  At first it answers from profile and approved answers only, with no AI.
- **Dependencies:** Stage A (approved-only feed).
- **Risk:** medium (new extension code); assisted Apply is untouched.
- **Benefit:** hands-off filling with your Submit authorization.
- **Tests:**
  - e2e on the local synthetic forms (like `apply-runner.e2e.test.js`);
  - the existing assisted e2e tests must still pass unchanged;
  - a mode-isolation DB test.
- **Migration:** **yes** (`mode` column; can ship in the same migration as Stage A).

### Stage C: matching and Gemini answers
- **Files:** `apply-gemini.ts`, `answers/route.ts`, `apply-answers.js` (prompt trimming, validator), the auto runner.
- **Reuse:** the key pool, limits, failover, `checkAnswer`, `keepsMeaning`, the fix-up turn.
- **Build:**
  - an answer cache per application (and optionally per job and question, in memory or `evidence`);
  - context trimmed to what each question needs;
  - an approved-answer "must keep" constraint;
  - a fact validator (numbers, dates, employers against the résumé);
  - a per-day Gemini budget check before starting.
- **Dependencies:** Stage B.
- **Risk:** medium (AI quality).
- **Benefit:** answers to open questions with fewer AI requests.
- **Tests:**
  - unit tests for the validator and cache;
  - a Gemini test with a mocked fetch;
  - a token-count regression.
- **Migration:** no.

### Stage D: dynamic forms, uploads, verification, recovery
- **Files:** `apply-form.js` (new functions only), the auto runner.
- **Build:**
  - calendar pickers;
  - upload check on the site (filename shown, or the site's own success marker), with `DOM.setFileInputFiles` as a fallback;
  - a pre-submit sweep re-reading every field;
  - waits on page changes instead of fixed sleeps;
  - the step state kept in session storage for service-worker restarts.
- **Risk:** medium. Shared file: only add functions; don't change existing signatures.
- **Tests:** the browser tests in `apply-form.browser.test.js` plus new synthetic forms.
- **Migration:** no.

### Stage E: UI, review controls, cancellation, diagnostics
- **Files:** the new review panel file, `page-launcher.js`, the Jobs page (show mode, unanswered list), Settings (draft queue).
- **Build:**
  - "Save to library" per answer;
  - progress, unanswered and failure display;
  - a timing and diagnostics view (requests, trips, Gemini calls per application).
- **Risk:** low to medium.
- **Tests:** UI tests, and e2e on synthetic forms.
- **Migration:** no.

## 12. Risks and backward-compatibility requirements

1. **Assisted Apply must behave the same:** same routes, same responses, same statuses.
   - Every new column gets a default matching today's behaviour (`status='approved'`, `mode='assist'`).
   - Add a test that compares assisted e2e results before and after each stage.
2. **Shared files** (`apply-form.js`, `apply-answers.js`): add new exports only; existing signatures and behaviour stay as they are.
3. **One live attempt per job** across both engines. With the `mode` column, the claim function must still keep a job from being run by both engines at once.
4. **Stop All:** Auto Apply must stop on the same counter, and must not leave claims behind.
5. **Gemini quota:** with the default limits, Auto Apply can exhaust keys quickly. Budget checks are needed before scaling.
6. **Privacy:** trim the context sent to Gemini; stop storing full response bodies.
7. **Retention:** add clean-up rules for `apply_attempts` and Gemini logs (500/day target).
8. **The legacy code** with similar names ("auto-apply", "learning") must not be revived by accident; it should be removed in a separate change.
9. **Migrations:** rehearse on `qts-phase12-test` first. Run as `neondb_owner` so default privileges cover `qts_runtime`. Recover by Redeploy, not by Instant Rollback to builds older than the rotation.

## 13. Recommendation: smallest safe first implementation

**Stage A only**, in one release:
1. A migration adding `reusable_answers.status` (default `approved`) and `source` (default `manual`).
2. Question memory inserts **drafts** instead of live answers, and leaves AI-sourced answers out of the promotion count.
3. `loadApplication` returns approved answers only. Every current row is approved, so the extension sees the same list.
4. Settings: a "Drafts" list with Approve / Edit / Reject, plus a "similar answer exists" warning.
5. Tests:
   - unit tests;
   - a DB test on the test project;
   - the full server suite;
   - the assisted e2e tests;
   - a migration rehearsal on the test project.

This needs no extension release, doesn't touch assisted Apply, and makes the global library safe to build Auto Apply on.

---

## Final summary

**ALREADY WORKING**
- Assisted Apply (fill from documents, profile and reusable answers; Manager submits).
- The global reusable-answer library, already shared by all candidates, with Super Admin CRUD.
- Field discovery and filling for text, selects, React Select and comboboxes, radios, checkboxes and drop zones, including real clicks through `chrome.debugger`.
- Chrome PDF printing and upload.
- Server Gemini answers (key pool, limits, failover; keys never in the extension).
- Claims, leases, Stop All, bids.

**PARTIALLY IMPLEMENTED**
- The automatic engine: AI answers, Next, review, auto-submit (built but UNUSED; dry-run only).
- Answer approval (no status; automatic additions go live).
- Fact protection for AI free text (prompt only).
- Upload verification (`files.length` only).
- Date pickers.
- Progress and unanswered tracking (debug log only).
- Gemini economy (batching per step, no cache, low default limits).
- Cancellation (30 s polling, no abort mid-step).
- Heartbeat renewal (fixed and tested on the test DB; production renewal not yet observed).

**NOT IMPLEMENTED**
- An Auto Apply mode, controller, switch and permission.
- Draft, approved and rejected statuses; provenance.
- "Save to library" from a review.
- A Gemini answer cache and trimmed context.
- A free-text fact validator.
- A pre-submit re-read of all fields.
- Retention for `apply_attempts` and Gemini log bodies.

**SHOULD BE REUSED**
- `apply-form.js` fill and scan functions.
- `apply-answers.js` resolve, check and prompt functions.
- Documents and Chrome printing.
- `authorizeApplyRequest`, claims, heartbeat, result, release, save-bid.
- `askGeminiForApplyAnswers` and the key pool.
- The `reusable_answers` table and the Settings UI.

**SHOULD BE BUILT NEW**
- The `auto-apply-runner.js` controller.
- The Auto Apply "Submit?" panel.
- The answer cache.
- The validator.
- The pre-submit sweep.
- Draft approval UI and "Save to library".
- The launcher row.

**NEEDS APPROVAL**
1. A migration: `reusable_answers.status/source` (Stage A) and `apply_attempts.mode` (Stage B).
2. Who may approve or save global answers: Super Admin only, or Managers too?
3. A separate `canUseAutoApply` permission, or reuse `canUseApply`.
4. Auto Apply as its own work mode (constraint change), or a sub-mode of `apply`.
5. Whether Auto Apply may ever submit without your click (recommended: never, at first).
6. Gemini budget and key count for the target volume; trimming or stopping the stored Gemini response bodies.
7. Whether to retire `candidate_saved_answers` and the legacy pipeline in a later clean-up.
