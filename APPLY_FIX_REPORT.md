# Apply fix report: 12 verified bugs (1.40.7 → 1.40.8)

**Status:** all 12 bugs fixed and checked in a real browser. Nothing is committed or pushed. The working tree is at extension version **1.40.8**.

**Not changed:** the Apply architecture, résumé-first, profile and reusable-answer meaning, review and Submit permissions, job claiming. No real application was submitted.

---

## 1. Bugs fixed

| # | Bug | Root cause | Files and functions changed | Evidence |
|---|---|---|---|---|
| **3** | A text answer clicked another field's open list | `pickSuggestion` searched **every** visible option on the page, matched by "starts with / contains", and reported the clicked element as success | `apply-form.js`: `pickSuggestion(element, typed)`, `fillField` text path, `markShownChoices` | Typing "5" no longer clicks "5-8 years" elsewhere. Lever-style and named-list suggestions still picked. Browser test + suite. |
| **2** | An unlabeled box took the previous question's label | The nearby-text search took the **first** text in a wrapper, accepted `<label for>` of other fields, and didn't stop at other fields in between. The last fallback used the text of the whole form. | `apply-form.js`: `labelFor`, new `ownTextAround`, `FIELD_CONTROLS`; `scanForm` sets `labelUnresolved`; `apply-answers.js`: `resolveFields` | "Your city" box is "Your city", not "Resume/CV \*". A box with no reliable text is **unresolved** and never sent to the AI (required → "Needs you"). |
| **4** | Choice names cut ("Yes✕" → "Ye") | A scripted edit lost the backslash: `/s*[✕…]/` instead of `/\s*[✕…]/` | `apply-form.js`: `itemText` (`CHIP_REMOVE_MARK`) | "Yes", "Tests", "None of the above", "C++", "R&D", "2×2 grid" all intact |
| **1** | A required upload lost "required" | The upload's name has its "\*" removed **before** the required check ran on it | `apply-form.js`: `scanForm` (file branch), new `uploadLabelsAsWritten` | "Resume/CV \*", "Portfolio (required)", `required` attribute all marked required. A failed required upload now reaches "Needs you" (existing runner rule). |
| **5** | Native `<select multiple>` failed | Not marked multiple; filling set one value | `apply-form.js`: `scanForm` (`multiple`), `fillField` (multi-select branch) | English + Polish both selected |
| **6** | Partial lists treated as complete | No scrolling; silent 300 cut; no completeness flag from click-read lists | `apply-form.js`: `discoverComboboxChoices` (scrolls to the end, max 15 steps), `domChoices` returns `{options, partial}`, `MAX_CHOICES`; `apply-runner.js`: `readComboboxOptions` sets `optionsPartial` / `optionsSource` | 20-of-100 scroll list: all 100 read. A 600-choice list: 300 kept, **marked partial**. |
| **7** | Dependent dropdowns kept stale choices | All fields were discovered before any was filled, and never read again | `apply-form.js`: new `currentChoices` (reads the page, no clicks); `apply-runner.js`: new `refreshDependentChoices`, `noteFilled` / `lastFilledChoice` in `fillFormPage` | Region after Country = Cluj, Bihor; City after Region = Cluj-Napoca, Turda (page part). The runner part was not run end-to-end (see 5). |
| **8** | Read-only pickers skipped | Read-only was treated as disabled | `apply-form.js`: `scanForm` (`disabled` / `readOnlyPicker`), new `readOnlyPicker`, `DATE_FORMAT` | Read-only date pickers and read-only dropdown inputs are questions again. A locked prefilled read-only box is still left alone. |
| **9** | `type="search"` comboboxes dropped | The "skip search inputs" rule ran before the combobox check | `apply-form.js`: new `isTypedList`, `scanForm` | Scanned as a typed list |
| **10** | Autocompletes without `role="combobox"` read as plain text | The typed-list check looked only at the role | `apply-form.js`: `isTypedList` (also `aria-autocomplete=list/both`, `aria-haspopup=listbox`), used in `scanForm`, `fillField`, `boxOf` | Read as a typed list, with its choices read from the page |
| **11** | Forms in frames not read | Only the top frame was searched | `apply-form.js`: `allElements` (enters frames the browser allows), `frameDocument`, `centreOf` (adds frame position for real clicks), `focusedElement` (looks into frames), new `unreadableFrames`; `apply-runner.js`: final checks | A same-site frame question is found **and filled**. Another site's frame (`example.com`) is **reported** in "Needs you", not claimed as read. |
| **12** | Choices seen while typing used as a complete list; the recheck retried questions already handed to the Manager | Choices from a failed fill replaced the field's choices as complete; the recheck didn't look at recorded problems | `apply-runner.js`: new `choicesSeen` (used at both places), recheck skips fields with a problem | Code paths only (runner not run end-to-end) |

### Phase 3: discovery without side effects

| Rule | How | Evidence |
|---|---|---|
| Opening a list never picks a choice | Opened with a click; ArrowDown (which can highlight a choice that is then committed on blur) only if a click opens nothing | A commit-on-blur widget stays empty (it became "Junior" before) |
| Sample searches create no tags | Only typing (`input`) events, no `change` events | Tag box: 0 tags (before: [a][e][i][o][u][1]) |
| No text left behind | The box is put back to its earlier value, then checked | Box empty after every search |
| Earlier answers untouched | Value before and after compared; changed values restored | "Senior" stays "Senior" |
| A change that can't be undone is reported | `restoreAfterLooking` compares the words around the box (chips), ignoring open lists; the runner adds *"Check "…": looking at its choices changed it"* | Reported, never silent |
| Async lists | A list that opened empty is waited for (up to 1.5 s more) | A list loading after 900 ms is read by the click step |

**Extra fix found during regression testing:** an unlabeled dialing-code dropdown beside a phone box is now labelled "Phone country code", so the profile phone picks its code ("+40") instead of it becoming unresolved.

---

## 2. Tests added

| File | Tests | What they cover |
|---|---|---|
| `extension/content/apply-form.browser.test.js` (**new**) | 11 | Real Chrome, real `apply-form.js`. Covers bugs #1–#11, the side-effect rules, real-site label patterns (Workable `aria-labelledby` + icon label, Ashby label for a missing id, label before its description, Yes/No buttons between), and the phone-code dropdown. Skipped with a message when Chrome is not installed (`QTS_CHROME` sets its path). |
| `extension/shared/apply-answers.test.js` | +3 | An unresolved box is never sent to the AI (a name-hint fact still fills it); native multi-select answers; partial lists take the AI's own wording while complete ones don't |

---

## 3. Tests executed

| Run | Result |
|---|---|
| `npm run test:extension` (unit + new browser tests) | **261 tests: 260–261 pass.** Passed in 2 of 3 consecutive runs; the 3rd failed **"Scanner waits asynchronously for ChatGPT to accept a send-button click"**, a pre-existing timing test in the ChatGPT composer code, not touched here. It passes when run alone and has failed now and then all session; the new browser tests add load, so it may fail more often. |
| `npm run test:server` | **133 / 133 pass** |
| `npx tsc --noEmit` | clean |
| ESLint (`extension`, `src/server/apply`) | clean |
| Verification suite, 53 browser checks (`verify-suite.cjs`, scratchpad) | **50 PASS, 1 PARTIAL, 1 FAIL, 1 measurement.** Before the fixes: 33 PASS / 3 PARTIAL / 11 FAIL. The FAIL is the closed-component case, which this test setup can't run (needs the extension-only `chrome.dom` API), so it's **not verified**, not a code failure. The PARTIAL is "From / To" sharing one label: the second box gets its placeholder "To" rather than a guess, by design. |
| Earlier browser checks (click-first, SmartRecruiters step-2 copy, Yes/No in components, phone picker, phone in a component, discovery) | All unchanged and passing |
| Audit probes | Every audit finding fixed (multi-select, other list, partial flag, search combobox, role-less autocomplete, commit on blur, tags, frame) |
| **11 live sites**, fills only, **never submits** (harness) | See below |

### Live sites, compared with the run before these fixes

| Site | Result |
|---|---|
| Recare, BambooHR, softgarden, TalentLyft, Zoho, Ashby Cantina, Ashby Mimica, Lever | **Same** as before |
| Greenhouse | Same result; Country now chosen as "Poland +48" directly by the country rule |
| Workable (gramian) | Same answers; labels now from `aria-labelledby` ("First name" instead of "\* First name"). Required unchanged on all 14 fields. |
| Workable (zyte) | **Better:** 3 questions that used to be missed are now answered or handled. **English Level** answered; **Gender** gets "Prefer not to respond" (the diversity rule now sees "Gender:"); optional **Pronouns** left alone. Required unchanged on all 15 fields. |
| Time per site, from open to ready for review (no AI wait) | 21–47 s (pre-fix run: 20–60 s). Not claimed as faster; network varies. |

**Two regressions found mid-way and fixed before this report:**
1. Ashby boxes became "Start typing…": the new label rule rejected a `<label for>` pointing to a **missing** id. It now rejects only labels for a different **existing** field.
2. Ashby Mimica "Location" took a neighbouring description. A real `<label>` now beats description text, and Yes/No button groups count as fields in between.

The final run matches the pre-fix run on both sites.

---

## 4. Changes in existing Apply behaviour

| Change | Effect |
|---|---|
| `aria-labelledby` read before `<label>` | Question names can differ slightly (Workable drops "\*" and "(Optional)"). Required detection unchanged where verified. |
| Read-only pickers are now questions | Questions skipped before (Workable's read-only dropdowns; read-only date pickers) are now answered. A plain locked read-only box is still left alone. |
| More boxes count as typed lists | `type="search"` comboboxes and autocompletes without the role get choice discovery and the dropdown fill path |
| Unlabeled boxes | Never sent to the AI; a required one goes to "Needs you" (*"QTS couldn't tell which question this box is for"*). A name hint can still match a profile fact. |
| Discovery | Click first, ArrowDown only if needed. Up to 1.5 s extra wait for lists that open empty. Long lists scrolled to their end (up to 15 steps). Sample searches send typing only. Value restored and checked. |
| Dependent lists | Before the AI is asked, lists below a choice filled in this round are read again from the page. A click-read list may be opened once more. |
| Frames | Same-site frames are read and filled. Other sites' frames are reported. |
| New "Needs you" messages | Unresolved box; *"looking at its choices changed it"*; *"Part of this page comes from … which QTS cannot read"* |
| Suggestions in plain text boxes | Only this box's own suggestions; success only when the box shows the picked one |

---

## 5. Remaining unresolved or unverified

1. **The real runner was not run end-to-end.** That needs the extension loaded plus a claimed job from the live server, which would change production data. So these runner-only paths are **checked by code, not at runtime**:
   - `refreshDependentChoices` (#7 runner part)
   - `choicesSeen` and the recheck skip (#12)
   - the "discovery changed" and "unreadable frame" messages
   - the real-mouse discovery path's before/after check

   Claiming, holds, the review panel, Submit and confirmation are unchanged and also not run.
2. **The live harness copies an older version of the runner** for real clicks (no click-first). Live results show the form engine on real pages, not every runner step.
3. **Closed page components** can't be checked outside the extension (`chrome.dom`). Open components are verified.
4. **Read-only date-picker libraries** that keep the real value in a hidden input may ignore the typed date. The site's own error would then show in "Needs you". No real date picker was available to test.
5. **Very slow lists** (over about 2.2 s to load) still rely on sample searches; very long lists past 15 scroll steps are marked partial.
6. **A box with two inputs under one label** (From / To): the second gets its placeholder ("To"), not the shared label, on purpose (no guessing).
7. **Another site's frame** can't be read (browser security). It's reported to the Manager, never filled.
8. **Flaky ChatGPT composer timing test** (pre-existing, unrelated).
9. **Not tested live:** SmartRecruiters (bot protection), Workday and other account sites (unsupported by design), real React Select (needs real clicks).

---

## 6. Ready for end-to-end verification?

**Yes, for a controlled end-to-end run.** The bugs that could put a wrong value in silently (#3, #2, #4) are fixed and covered by repository tests. Compatibility gaps (#5–#11) are closed in the form engine, with discovery side effects guarded.

**Recommended next step:** load **1.40.8** unpacked, keep review on every step, and run a few real applications (SmartRecruiters, Workable, Ashby, Greenhouse, one with Country → Region). Check in the review panel that:
- dependent dropdowns get current choices
- no "looking at its choices changed it" warnings appear unexpectedly
- labels and required marks look right

That run is what verifies the runner-only paths in section 5.

Nothing is committed or pushed. Say "push" to send 1.40.8.
