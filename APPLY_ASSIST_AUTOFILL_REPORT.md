# Apply assistant: autofill on every page (extension 1.42.0)

**Date:** 2026-10-28 · **Branch:** `qts-startup-deploy` · **Database:** migration `0076_site_account_password`

This report covers what changed in Apply's assistant mode, why, how to use it, and how it was tested.
Every decision below was made step by step with the Manager before building.

---

## 1. What the Manager sees now

| | Before (1.41.1) | Now (1.42.0) |
|---|---|---|
| When QTS fills | Every 4 seconds | As soon as new boxes show (≈0.5 s after the page settles); a backup check every 15 s |
| Where QTS fills | Each question once per job | Each **box** once per **page**: a new empty box on a later step, a pop-up, a redirect, or a new tab is filled too |
| Search, newsletter, job-alert, header/footer forms | Could get the candidate's email or city | Never filled |
| Sign-in / create-account forms | Email could be filled | **Never filled**: the Manager types them. The panel has **Site account password** (shown as dots, copied with one click) |
| The site's Submit button | Watched: asked "Submitted successfully?" Yes / No | **Never watched.** Only **Submitted** on the panel saves the bid and removes the job. No Yes/No prompt |
| Closing a page while it loads | The job could keep one of the Chrome's 2 places until Apply was turned off | Released at once; the next job opens |
| Résumé / cover-letter PDFs | Prepared again on each pass that met an upload | Prepared once per job and reused on every page |

Unchanged: up to 2 job pages per Chrome; QTS fills only résumé / cover letter, profile facts, and reusable answers (never AI); it never clicks the site's buttons; text the Manager or the site typed stays; dropdowns, ticks and radios get the profile or reusable answer the first time QTS meets them on a page (once per box); Cancel or closing all of a job's tabs records nothing and the job goes back to the list; test mode works as before.

## 2. How to use the site account password

1. On the QTS website, open **My profile**. Managers now see a **Site account password** card.
2. Type the password (the same one for all candidates' job-site accounts) twice, then click **Save password**. **Remove** clears it.
3. While Apply is on, the panel's **Profile** card starts with **Site account password ••••••••**. Click it to copy, then paste into the site's sign-in or create-account form. The candidate's email is in the same card.

The password is:
- saved **encrypted** (AES-256-GCM, key derived from `AUTH_SECRET`), never shown again on the website;
- sent only to the Manager's own signed-in extension, with each job it claims;
- never sent to ChatGPT or Gemini, and not part of **Copy résumé + JD + profile**.

If `AUTH_SECRET` is ever changed, the saved password can no longer be read; save it again.

## 3. Changes in detail

### Server and website
| File | Change |
|---|---|
| [src/db/schema.ts](src/db/schema.ts) | `users.site_account_password` (text, nullable) |
| [drizzle/0076_site_account_password.sql](drizzle/0076_site_account_password.sql) | `ALTER TABLE "users" ADD COLUMN "site_account_password" text;` |
| [src/server/apply/site-account-password.ts](src/server/apply/site-account-password.ts) | Encrypt / decrypt; unreadable values read as "no password" |
| [src/app/profile/actions.ts](src/app/profile/actions.ts) | `saveSiteAccountPasswordAction`: Managers only, save or remove, max 128 characters, confirm must match |
| [src/app/profile/site-account-password-form.tsx](src/app/profile/site-account-password-form.tsx), [page.tsx](src/app/profile/page.tsx) | The card on My profile |
| [src/server/apply/apply-attempts.ts](src/server/apply/apply-attempts.ts) | The claim returns `siteAccountPassword` (decrypted), outside the candidate's facts |

### Extension
| File | Change |
|---|---|
| [content/apply-form.js](extension/content/apply-form.js) | `unrelatedBox` (search, newsletter, job alerts, small header/footer forms), `accountBox` (a form with a password box), `scanForAssist` (marks both) |
| [content/apply-assist.js](extension/content/apply-assist.js) | No Submit watching and no Yes/No mode; a page watcher (MutationObserver, 0.5 s debounce) sends `fields_changed` only when the shown boxes or the address changed; the masked, copyable password item |
| [background/apply-runner.js](extension/background/apply-runner.js) | See below |
| [manifest.json](extension/manifest.json) | 1.41.1 → **1.42.0** |

In `apply-runner.js`:
- **Decisions that arrive while QTS is busy are kept** (`earlyDecisions`, `answerManager`): a page closed while it loads, or a Cancel during a fill, is handled as soon as the runner waits again. An ending (closed, Cancel, Apply off) is never replaced by a click.
- `waitForTabComplete` ends at once when the tab is gone, instead of waiting up to 45 s.
- **Per page, per box tracking** (`assistKeys`, `assistSkips`): a box is met once on its page; a box the page draws again on the same page is filled at most twice (an upload once), so nothing loops.
- `assistant.poke(tabId)` fills one tab right away, on `fields_changed`, on page load, and from the 15-second backup loop over all of the job's tabs. A second poke during a fill becomes one more pass after it.
- `assistFillPass` skips unrelated and account boxes, and is limited to 60 s per pass, so a page that goes away mid-fill never holds up the other job.
- `fillFormPage` takes `options.skip` and reuses the job's documents (`application.assistDocuments`).
- `runAssistedApplication` ends only on **Submitted** (bid + job row deleted), Cancel, all tabs closed, or Apply off. The "site's Submit noticed" and Yes/No branches are gone.

## 4. Tests

| Test | Result |
|---|---|
| `npm run test:server` | **136 / 136 pass** (new: password encryption) |
| `npm run test:extension` | **277 / 278 pass**. The one failure, *manager job rows support safe manual edits and deletion*, was already failing before this work: it checks Jobs-page labels changed by an earlier commit (d71550f), in files this work does not touch |
| Panel in real Chrome (`apply-assist.browser.test.js`) | **7 / 7 pass**. New: password shows as dots and copies; not in the ChatGPT copy; the site's Submit, Enter, and Apply send nothing; new boxes (pop-up, shown section) are reported once, text/style changes are not |
| Form engine in real Chrome (`apply-form.browser.test.js`) | **All pass**. New: search, newsletter, job-alert, footer boxes marked unrelated; sign-in / create-account boxes marked the Manager's; one-time-code boxes are not passwords |
| Assistant end to end (`apply-assist.e2e.test.js`, real extension + mock server) | **Pass (42 s)**, covering the journey below |
| Test mode end to end (`apply-runner.e2e.test.js`) | **Pass**: unchanged |
| `eslint`, `tsc --noEmit` | Clean |

The end-to-end test covers this journey:
1. Two jobs open (the first in front). The second is filled with profile, reusable answer, cover letter and résumé; no AI.
2. On the job page, the header search (City) and footer newsletter (Email) stay empty.
3. "Apply now" opens a new tab, which joins the job and is filled. Closing the job page keeps the job open in that tab.
4. What the Manager types stays. The site's Submit records nothing; **Submitted** on the panel saves one bid, deletes the job row, and closes the page.
5. A slow site closed while loading is released in under 10 s, and the next job opens.
6. A job for another candidate: the sign-in and create-account forms stay empty (the Manager types them). The multi-step form fills step 1, then step 2's new Email box at the same address, keeps the Manager's prefilled phone, and fills a pop-up's City. The first job keeps its own candidate's values.
7. Three Submitted clicks make exactly three bids; the PDFs were fetched once per job that uploads; nothing asked the AI.

## 5. Release steps

1. Apply migration **0076** to the production database (`npm run db:migrate`) **before** the new server code goes live. The claim reads the new column, so the old database would break Apply claims.
2. Push `qts-startup-deploy` to `startup` → `main` (the deploy).
3. Reload the extension in each Chrome (1.42.0).
4. Each Manager saves the site account password on **My profile**.

## 6. Limits to know

- **Submitted is the only record.** QTS does not notice the site's own Submit. If the Manager submits on the site and closes the tab without clicking Submitted, nothing is recorded and the job returns to the list (as decided).
- **Unrelated forms are recognised by their names and words** ("search", "subscribe", "newsletter", "job alert", "notify me", "talent community", ...) and by small forms in the header or footer. An unusual newsletter form with none of these words could still be filled.
- **Account forms are recognised by a password box.** An email-only first step ("Enter your email to continue") without a password box is treated as part of the application and its email is filled.
- **Choices are replaced** the first time QTS meets them on a page (once per box), as decided; text boxes keep what is there.
- The password reaches the panel inside a closed shadow root; the job site's own scripts cannot read it there.
