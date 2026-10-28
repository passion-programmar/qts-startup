# Apply: form discovery, structured JSON, answer planning, verified autofill

Working tree on top of 1.40.8 (`f0c74b5`), 2026-10-28. **Not committed, pushed, or deployed.** The
manifest still says 1.40.8; it gets the next version when you approve a push.

How to read the marks:

- **Runtime-verified**: seen working in real Chrome, either with the real extension and runner
  (the E2E test) or on live job sites.
- **Browser-verified**: the real `apply-form.js` was run in Chrome on a test page, without the runner.
- **Unit-verified**: tested in Node only.
- **Not verified**: the code is there, but nothing has run it end to end.

---

## 1. Short answer

- Apply now builds a structured description of the form (schema 1.0).
  - It records each question's element, answer type, and value type.
  - It records where each list's choices came from and how complete they are.
  - It records how sure it is of each label, plus the page's type and its buttons with a safety status.
- Looking inside lists never changes the form.
- Every fill is checked afterwards.
- Each step ends with a report of what was verified, what needs the Manager, and why.
- Before it starts, Apply recognises 12 page types.
  - It stops on sign-in, account creation, code-by-email, and CAPTCHA pages.
  - On an "email only, then Continue" page, it types the email and hands over to the Manager; it never continues into a login.
- The **real extension** was run against a local two-step form. It filled everything, used the AI three times, left GitHub for the Manager, and stopped before Submit.
- On **11 live sites** it gives the same results as the shipped 1.40.8, with two fixes on top (section 9).
- All tests pass: 269 extension tests, 134 server tests, typecheck, lint, and the E2E test.

---

## 2. Requirements map

| Requirement | Status | Where | Verified |
|---|---|---|---|
| Keep existing behaviour and answer-source priority | Kept (skip → documents → consent → cover letter → diversity → personal facts → reusable → topic → profile → similar reusable → rule → AI) | `resolveFields` [apply-answers.js:934](extension/shared/apply-answers.js#L934) | Runtime (E2E, 11 sites unchanged) |
| Page classification (12 types) | **New** | `classifyPage` [apply-form.js:2364](extension/content/apply-form.js#L2364) | Browser (11 of the 12 types on test pages); runtime for `application_form` / `partial_application_form` |
| Stop before sign-in, account creation, code, CAPTCHA | **New** (before clicking "Apply", and while waiting for questions) | `reachApplicationForm` [apply-runner.js:175](extension/background/apply-runner.js#L175), `pageStop` [:243](extension/background/apply-runner.js#L243) | Browser (classification); **runner stop not run end to end** |
| Email-first page: type the email, never continue into a login | **New** | `emailFirstStep` [apply-runner.js:1541](extension/background/apply-runner.js#L1541) | Browser (classification); **runner path not run end to end** |
| Element, input and value types | **New** | `elementTypeOf` / `inputTypeOf` / `valueTypeOf` [apply-form.js:2191-2217](extension/content/apply-form.js#L2191) | Browser; runtime (E2E debug log) |
| Dropdowns P1: read from the page without opening | Existed (`domChoices`, `currentChoices`) | [apply-form.js:881](extension/content/apply-form.js#L881), [:1046](extension/content/apply-form.js#L1046) | Runtime |
| Dropdowns P2: open with a click, wait while loading, scroll to the end | Partly existed; **loading wait, scrolling, `partial`, and the "nothing changed" check are new** | `discoverComboboxChoices` [apply-form.js:987](extension/content/apply-form.js#L987); real-click fallback `readChoicesWithRealClick` [apply-runner.js:319](extension/background/apply-runner.js#L319) | Browser (loading, 300+ row scroll); runtime (Greenhouse Country 244 choices) |
| Dropdowns P3: sample searches, input events only | Existed; **now returns `partial` and `changed`** | `searchComboboxChoices` [apply-form.js:942](extension/content/apply-form.js#L942) | Browser; runtime (E2E "Python level") |
| Looking at choices has no side effects | **New check**: the box's value, the text around it, and the tags are compared before and after; a change becomes a Manager problem | `restoreAfterLooking` [apply-form.js:916](extension/content/apply-form.js#L916) | Browser (no tag, no leftover text, no highlighted choice committed) |
| Option details (label, value, disabled, selected, group, id) | **New** | `optionDetails` [apply-form.js:2264](extension/content/apply-form.js#L2264) | Browser |
| Structured form JSON: schemaVersion, page, sections, fields, actions + safetyStatus, unresolvedFields, discoveryStatus | **New** | `formSchema` [apply-form.js:2403](extension/content/apply-form.js#L2403), `checkFormSchema` [:2482](extension/content/apply-form.js#L2482) | Browser; runtime (E2E debug log, both steps) |
| Separate layers: discovery / answer plan / execution | **New** (the plan and execution are in the step report) | `formSchema`; `stepReport` [apply-runner.js:1150](extension/background/apply-runner.js#L1150); `fillAndCheck` [:661](extension/background/apply-runner.js#L661) | Runtime (E2E asserts the report) |
| AI answers: ready vs needs review, with a reason | **New** (`status: review` + `reason` in the reply) | `REPLY_FORMAT` [apply-answers.js:1019](extension/shared/apply-answers.js#L1019), `parseAnswerReply` [:1191](extension/shared/apply-answers.js#L1191), `noteForReview` [apply-runner.js:584](extension/background/apply-runner.js#L584) | Unit; runtime (E2E: GitHub → needs_review, not asked again) |
| Check each answer before filling (choice exists, keeps its meaning, fits the box) | Existed (`checkAnswer`, `keepsMeaning`); **an open "where/which" question no longer takes a yes/no fact** | `OPEN_QUESTION` [apply-answers.js:278](extension/shared/apply-answers.js#L278) | Unit; runtime (E2E "Where would you relocate to?" = Germany) |
| Deterministic fill with a check afterwards | Existed; **a combobox now counts as picked only once its box shows the choice; the Workable radio box is clicked when its input ignores the click** | `pickInCombobox` [apply-form.js:1267](extension/content/apply-form.js#L1267), `shownValue` [:1917](extension/content/apply-form.js#L1917), `fillField` [:1151](extension/content/apply-form.js#L1151) | Browser; runtime (Workable zyte radio, 11 sites) |
| Re-read when the form changes (follow-ups, dependent lists, rebuilt inputs) | Existed for follow-ups and rebuilds; **dependent lists are re-read after their parent is chosen and before the AI is asked** | `refreshDependentChoices` [apply-runner.js:756](extension/background/apply-runner.js#L756) | Runtime (E2E Country → Region) |
| Multi-step | Existed; **test mode now goes through every step and stops before Submit** | `fillFormPage` [apply-runner.js:730](extension/background/apply-runner.js#L730) | Runtime (E2E, two steps); **no live multi-page site in this run** |
| Development-only redacted diagnostics | **New** (`qtsApplyDebug`; personal facts and free text are masked) | `diag`, `redacted` [apply-runner.js:40-44](extension/background/apply-runner.js#L40) | Runtime (E2E reads them) |
| Unit, browser, and real-runner E2E tests | **New** (18 browser tests, the E2E, answer tests) | section 8 | All pass |
| Performance measurements | Done | section 10 | Measured |

---

## 3. What was reused

Nothing was rewritten. The new parts read from, or wrap, what was already there:

- **`scanForm`** stays the single source of truth for a page's questions. `formSchema` is a view over its records, so the two can never disagree.
- The **answer engine** (`resolveFields`, `checkAnswer`, `keepsMeaning`, `sameFactOption`, reusable answers, the Super Admin prompt) is unchanged in order and in sources. Only the AI reply format gained a status line.
- **Fill rounds, real clicks (`chrome.debugger`), rebuilt-field recovery, résumé autofill first, final checks, test mode, and Manager review** all keep how they worked; they now also write to the step report.
- **No server or database changes**: no new endpoint and no new rows, so the 500-bids-a-day budget is untouched.

---

## 4. What is new

| Area | What it does |
|---|---|
| Page types | `classifyPage` returns one of 12 types with a plain reason. The runner uses it to stop safely, and to handle email-first pages. |
| Actions | `formActions` lists the page's buttons as submit / next / start / sign-in / back, with a safety status: `final_submit`, `start_application`, `navigation`, `never_automatic` (sign-in), or `unverified`. |
| Labels | Read in a fixed order: aria-labelledby, `label[for]`, the wrapping label, aria-label, the component label, the legend, the heading before it, the host label, the placeholder, nearby text, else unresolved. A label that belongs to another field is never borrowed. Each label gets a confidence: `high`, `low` (placeholder), or `unresolved`. An unresolved box is left for the Manager, never guessed. |
| More kinds of question | Search-type comboboxes, autocompletes without the role, read-only date pickers, native multi-selects, `role="radiogroup"` groups, pressed-button groups, rich-text editors (cover letter) with their hidden textarea, required uploads marked only by CSS, an unlabeled dialing-code select beside a phone box, and forms in same-site frames. |
| Left alone on purpose | Language switchers (changing one reloaded PeopleForce and lost the résumé), selects in the header, nav, or footer, and editor toolbars. |
| Lists | A list that says it is loading is waited for (up to 3 s). A scrolling list is read to its end (up to 15 steps or 300 choices) and marked `partial` if more may exist. A partial list lets the AI's wording be searched for instead of refused. |
| Checks | Uploads that lost their file are found and uploaded again. Required uploads still empty, and frames from other sites that can't be read, become Manager problems. |
| AI | The AI may answer `review` with a reason ("No GitHub account in the profile or résumé"). That question goes to the Manager with the reason and is not asked again. AI requests now time out after 2 minutes instead of waiting forever. |
| Step report | Per step: counts (verified / needs review / unresolved / left), attempts and failed attempts, AI calls, timings, the plan (one line per question with source, status, and reason), and execution (one line per fill attempt). |

---

## 5. Files and functions

| File | Change |
|---|---|
| [extension/content/apply-form.js](extension/content/apply-form.js) | +549 / −~40. Labels, new question kinds, discovery with side-effect checks, `take()` checking in `pickInCombobox`, `shownValue` fix, radio-box fallback, multi-select, editors, frames, uploads, schema block (`formSchema`, `classifyPage`, `formActions`, type and option helpers, `checkFormSchema`). |
| [extension/background/apply-runner.js](extension/background/apply-runner.js) | +259. Page-type stops, email-first step, diagnostics, AI timeout and counting, `noteForReview`, `fillAndCheck` wrapper, `stepReport`, `refreshDependentChoices`, discovery changes, upload re-checks. |
| [extension/shared/apply-answers.js](extension/shared/apply-answers.js) | +31. Unresolved labels go to the Manager, `OPEN_QUESTION`, partial lists, the review status in the reply format and the parser. |
| [extension/shared/api-worker.js](extension/shared/api-worker.js) | +8. Optional `timeoutMs` per request. |
| [extension/content/apply-form.browser.test.js](extension/content/apply-form.browser.test.js) | +135, 18 Chrome tests (skipped if Chrome is missing). |
| [extension/shared/apply-answers.test.js](extension/shared/apply-answers.test.js) | +28. |
| [extension/background/apply-runner.e2e.test.js](extension/background/apply-runner.e2e.test.js) | New, 218 lines. The real extension against a local mock server. |
| [package.json](package.json) | `test:apply-e2e` script. |

`extension/content/page-launcher.js` is also changed in the tree (the sign-in subtitle is blank).
**That change is not part of this work.** It should not go into this commit unless you say so.

---

## 6. The three schemas

### 6.1 Discovery: `formSchema(step)`, version 1.0

```text
{ schemaVersion: "1.0",
  page: { url, origin, type, reason, step, title, language, platform, forms, revision },
  sections: [{ id, title }],
  fields: [{
    id, sectionId, question, label, helpText, placeholder,
    elementType   input | select | textarea | button_group | radio_group | checkbox_group | contenteditable | ...
    inputType     text | email | phone | number | date | long_text | single_select | multi_select | searchable_select | file | boolean | ...
    valueType     string | number | date | enum | array | boolean | file
    required, locatorId, labelConfidence (high | low | unresolved),
    constraints { maxLength, min, max, unit, accept, pattern, format },
    multiple,
    options [{ label, value, disabled, selected, group, optionId }],
    optionsDiscovery { method, status: complete | partial | unknown | pending_dependency | not_applicable },
    currentValue, state { visible, enabled, readOnly }, validationError?,
    dependsOn [], lifecycle (discovered | options_ready | waiting_dependency | unresolved) }],
  actions: [{ id, text, type, safetyStatus, disabled }],
  unresolvedFields: [ids],
  discoveryStatus: complete_for_current_state | partial }
```

- `revision` grows only when the questions or their choices change (browser-verified).
- `checkFormSchema` returns `[]` for a well-formed record, and otherwise a list of what's wrong.

### 6.2 Answer plan: `stepReport().plan[]`

```text
{ fieldId, question, type, options, optionsStatus, source, status: verified | needs_review | unresolved | left, reason? }
```

### 6.3 Execution: `stepReport().execution[]`

```text
{ fieldId, action: fill | upload, source, verified, gone?, error? }
```

The step report also carries `{ step, fields, verified, needsReview, unresolved, left, attempts, failedAttempts, aiCalls, timingsMs }`.

**Where the reports go:** the step report and the form JSON are written only to the developer log when `qtsApplyDebug` is on. They are **not** sent to the server, and the Manager doesn't see them. The Manager still sees the existing problem messages.

---

## 7. Behaviour in plain words

**Dropdowns.**

1. Apply first reads the choices already in the page.
2. If there are none, it opens the list with a click. It presses the arrow key only if a click opens nothing, because an arrow key can highlight a choice that some sites then commit.
3. It waits while the list says it is loading, and scrolls it to the end.
4. If that shows nothing, it tries a real mouse click (React Select).
5. Only if that also shows nothing does it type sample letters to collect some choices. It never picks one, never sends a "change" event (which tag boxes treat as a new tag), and empties the box afterwards.
6. After every look, it compares the box and the text around it. Anything different becomes "Check …: looking at its choices changed it".

**Changing forms.** After each answer, the page is scanned again.

- New follow-up questions (Yes → "Which visa type?") are answered in the next round.
- An input that React rebuilt is found again by its question.
- Lists under a filled choice (Country → Region → City) are re-read before the AI is asked, so the AI sees the right choices.

**Multi-step.** Each step is filled and checked, then Next is clicked. Submit is only ever clicked by the existing Manager-review / auto-submit rules; test mode always stops before it. Sign-in and "create account" buttons are marked `never_automatic`.

---

## 8. Tests

| Suite | Result |
|---|---|
| `npm run test:extension` (unit + 18 browser tests in real Chrome) | **269 / 269 pass** |
| `npm run test:server` | **134 / 134 pass** |
| `npm run typecheck`, `eslint extension` | clean |
| `npm run test:apply-e2e`: real extension, local mock server, two-step form | **pass** (32–33 s), 3 runs today, the last one on the final code |
| Verify-suite, 53 page-level checks on the real `apply-form.js` | 50 pass, 1 partial, 1 fail, 1 measurement; the same as before this work |
| PeopleForce live form | 9 / 9 fields, résumé attached, cover letter in the editor, 1 round |
| 11 live sites | see section 9 |

**What the E2E test checks:**

- Step 1:
  - profile facts, including the phone beside its +40 picker
  - Country → Region dependent list
  - an AI-picked list choice
  - "Where would you relocate to?" answered by the AI, not with "Yes"
  - the cover letter in the rich editor
  - the CSS-required résumé
  - the editor toolbar left alone
  - GitHub left for the Manager with a reason
- Step 2:
  - a native multi-select
  - a written answer
  - a list found only by searching
- Exactly 3 AI requests, no repeats.
- Stops before Submit, the page never reloaded, nothing submitted.

The earlier version of the test also proved that a stuck AI request now ends in Manager messages, not a hang.

**Verify-suite exceptions.**

- *Closed shadow DOM*: fails only because a plain test page can't use `chrome.dom`, which the extension uses for it. So it is **not verified**, rather than broken.
- *Two inputs under one label (From / To)*: each input gets a usable label from its placeholder, but not "Employment dates – From".

**Fixed during this pass:**

- An E2E assertion had lost a backslash (`,s*` instead of `,\s*`).
- The debug "form" summary read old property names and showed blanks; it now shows the schema 1.0 values.

---

## 9. Regression against shipped 1.40.8 (live sites, test profile, nothing submitted)

| # | Site | 1.40.8 | Now | Not filled (all expected) |
|---|---|---|---|---|
| 1 | Recare (own site) | 9/9 | 9/9 | |
| 2 | Workable (gramian) | 13/13 | 13/13 | |
| 3 | Ashby (cantina) | 7/9 | 7/9 | "Autofill from resume" (optional second uploader), city placeholder |
| 4 | BambooHR | 14/15 | 14/15 | optional website |
| 5 | softgarden | 9/12 | 9/12 | Anrede, Titel, "Wie gefunden" selects; the site rejects the test email |
| 6 | TalentLyft | 7/8 | 7/8 | optional consent; the site rejects the test email |
| 7 | Workable (zyte) | 15/17 | 15/17 | optional GitHub, pronouns |
| 8 | Zoho Recruit | 18/21 | 18/21 | second uploader, optional link, CAPTCHA |
| 9 | Ashby (mimica) | 9/10 | 9/10 | "Autofill from resume" |
| 10 | Greenhouse | 10/12 | 10/12 | optional cover-letter attach, optional consent |
| 11 | Lever | 10/13 | 10/13 | three optional links |

- The same fields are filled as in 1.40.8 on all 11 sites. The two failures from yesterday's run are both fixed.
- **Workable radio** (`* Experience Remote working`): the site resets its hidden input a moment after the click. Apply now waits 100 ms, re-checks, and clicks the drawn radio box. Verified on the live form, and on the full 11-site run.
- **Greenhouse Country** read 8 choices once yesterday. In the three runs since, it read 244 choices and picked correctly. It was not reproduced, so it is counted as intermittent (section 11).
- **Real bugs found and fixed while building this**, both present in shipped 1.40.8:
  - A combobox whose label sat next to its list looked "already chosen", so it was skipped while reported OK. Now it counts only once the box shows the choice.
  - "Where would you relocate to?" was answered "Yes".

---

## 10. Performance

| What | Measured |
|---|---|
| Scan of a 70-question page (3,237 elements) | 25–90 ms (10 runs) |
| Page type alone, with its scan | 39–90 ms |
| Form JSON (`formSchema`) for the same page | 306–524 ms, 35 KB. **Built only in debug mode**, so production doesn't pay it. |
| E2E step 1 (12 questions) | 9.3 s total: discovery 0.5 s, AI 37 ms (mock), checks 87 ms; the rest is filling and real clicks |
| E2E step 2 (3 questions) | 14.2 s total, of which **discovery 9.3 s**: the search-only list |
| AI requests per application (E2E) | 3: one per batch of open questions, none repeated |
| Live sites (including browser start and page load) | 19–53 s per site |
| Server and database | no new calls or rows |

**The one cost to note:** a list that shows nothing until you type is the slow case. The page-side search tries six sample letters, waiting up to 1.5 s for each to show results, and that comes after the click and real-click attempts. That is up to about 9 s for one such field. Most lists open on a click and never reach this step. Possible improvement, not made: stop after two searches that bring up the same choices.

---

## 11. Limitations and what is not verified

1. **Not run end to end:**
   - the runner's stops on sign-in, account, code, and CAPTCHA pages
   - the email-first hand-over
   - a live site with more than one page

   Page classification for these is browser-verified, and the runner code paths are small. But a real site that does this has not been run.
2. **Closed shadow DOM** on a real site: handled through `chrome.dom`, not verified.
3. **Frames from another site** (some embedded ATS forms) can't be read. They are reported to the Manager, not filled.
4. **The structured JSON is a view, not the driver.** Decisions are still made from `scanForm` records, the same data. `dependsOn` is always empty: dependencies are found at run time by re-reading, not written into the record.
5. **Step reports stay in the debug log.** Showing them to the Manager or saving them would need a server change and a retention rule; that is not done.
6. **Greenhouse Country** read the wrong (8-choice) list once, and was not reproduced. If it happens, the choice check stops the wrong pick and the field goes to the Manager. It does not send a wrong answer.
7. **softgarden** salutation and title selects aren't filled. It was the same in 1.40.8.
8. **Search-only lists** cost up to about 9 s each (section 10).
9. **Two inputs under one label** get "From" / "To" as labels rather than the shared question.

---

## 12. Ready for production?

**Yes, to push after your review**, with items 1 and 5 above in mind:

- Every suite passes.
- The real extension works through a two-step form and stops before Submit.
- The 11 live sites match shipped 1.40.8 plus two fixes.
- Nothing new is sent to the server.

Before the first real batch, I suggest:

1. Run one real application per Manager in test mode on a site with a second page.
2. Turn on `qtsApplyDebug` for that run to read the step report.

To ship it: approve the commit (my files only, not `page-launcher.js`) and the push with `git push startup qts-startup-deploy:main`. It will be numbered 1.40.9.
