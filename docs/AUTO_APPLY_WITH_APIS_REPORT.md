# Auto Apply with APIs: build report

Date: 2026-11-08. Extension version 1.50.0.

## 1. Where things stand

```
Built and tested on this PC   yes
Tested with real AI           no   (your rule: real AI only on Production)
Pushed to Production          yes, together with this report
Used by any Manager yet       no   (the switch is off for everyone until Super Admin turns it on)
```

Managers without the switch keep today's ChatGPT Auto Apply.

## 2. Candidates' personal data

Google's terms for free-tier Gemini keys say: "Do not submit sensitive, confidential, or personal
information to the Unpaid Services." The same terms say Google may use what is sent to improve its
products, and that human reviewers may read it.

This flow sends each candidate's email, phone, address and résumé to the AI. You chose to do that
on the current keys (2026-11-08, "send candidate data"). To change it later:

```
Stay on free keys   ->  as it is now, against that line in Google's terms
Use paid keys       ->  Google says it does not use paid prompts to improve its products
```

Groq is a separate company with its own terms, which I did not check. QTS does not send gender,
race, disability, veteran status or the like to the AI.

## 3. What happens for a Manager with the switch

```
Saved job URL
   |
   v
Was this site last used for another candidate in this Chrome?
   yes -> sign the site out and remove what it stored here
   |
   v
Open the job page. Who is signed in?
   nobody or this candidate  -> go on
   someone else              -> sign out, open the page again
   cannot tell               -> wait for the Manager's Continue
   |
   v
Click through to the form without the Manager:
Apply, Apply as guest, Continue, also onto other websites.
Sign in or register only when nothing else leads on.
   |
   v
On each step of the form:
   1  Empty it: typed text, choices, ticks, attached files
   2  Read every question, its type, its choices and its limits
   3  Ask the AI once (Gemini, then Groq)     <- nothing is filled before this
   4  Attach the résumé and cover letter
   5  Fill every answer, replacing what the site read from the résumé
   6  A new question appeared?  Ask about only that one
   7  Check the page against the candidate
   |
   v
STOP. The Manager reviews and edits.
The Manager clicks Next  -> QTS fills the next step and stops again.
The Manager clicks Submit. QTS never does.
```

## 4. Your rules and what QTS does now

| Your rule | What QTS does |
|---|---|
| Only assigned Managers use the APIs | A new Super Admin switch per Manager in Settings. The server also refuses the AI route to Managers who have not been given it. |
| The Manager always submits | QTS never presses Next, Continue, Save and Continue or Submit after filling. |
| Fill nothing until the AI answers | If the AI gives no answers, the page stays empty and the panel offers "Ask AI again". |
| The form must be clean first | Typed text, choices, ticks and attached files are removed once per page. |
| The AI must not change facts | Each answer is compared with the profile. A changed fact is replaced by the profile's value and shown to the Manager. |
| Missing facts are not guessed | The AI may say it has no answer. A fact the profile lacks is used only if it appears in the résumé or saved answers. |
| The prompt decides what is sent | Super Admin's "Gemini · Application-answer generation" prompt. The code adds only the JSON reply format. |
| Few AI calls | One request per page, one more for questions that appear later, one follow-up if the site refuses answers. At most 10 per application. |
| Never another candidate's data | Site check, cleaning, and a last check of the login, personal answers and documents. A failure holds the site's Submit. |
| Candidate changes during a run | Work for the old candidate stops, the AI request is cancelled, and the job goes back to the list. |
| Guest way first | Apply and guest buttons win even beside Sign in or Register. |
| Keep the Manager's edits | Boxes the Manager changed, and steps already filled, are never emptied or filled again. Only their own Fill again or Ask AI again goes back over a step, and even that keeps what they changed. |

## 5. Choices I made where you had not decided

Tell me to change any of these.

| Situation | What I chose |
|---|---|
| AI busy | Wait 5, 20 and 40 seconds and try again, then hand over to the Manager. If every key has used up its day, no waiting. |
| AI changes a profile fact | Use the profile's value and tell the Manager. |
| Gender, race, disability, veteran questions | Filled by QTS from the profile after the AI answers, never sent to the AI. Required with no answer in the profile: the Manager. |
| Criminal record, drug test, security clearance and similar | Never answered by QTS or the AI. Required ones wait for the Manager. |
| Privacy and terms boxes | Required ones are ticked by QTS. Marketing and job-alert boxes are never ticked. |
| Referral and tracking codes already on the form | Left as they are. |
| Sites nobody is signed out of | Google, Gmail, YouTube, LinkedIn, Indeed, Glassdoor, Facebook, Microsoft, Outlook, Apple, GitHub, OpenAI, ChatGPT, Yahoo, vercel.app. If one of these shows another account, the Manager deals with it. |
| Two candidates on one site in one Chrome | The later one waits until the first application ends. |
| Custom URL jobs of normal Managers | Unchanged. |

## 6. What was tested

Everything below ran on this PC with a fake QTS server and fixed AI answers. No Gemini or Groq key was
called.

```
Server tests                       436 passed, 4 skipped
Extension tests                    660 of 661 passed
New tests in real Chrome           13 of 13 passed
Older Apply tests in real Chrome   20 passed, 3 optional ChatGPT tests skipped
Type check and production build    passed
```

The one extension failure is a launcher test that already failed now and then before this work. Run
alone twice, it failed once and passed once.

The new Chrome tests show that:

- The form is empty while the AI is answering, and the upload happens before the answers go in.
- A wrong email from the AI is replaced by the profile's.
- When the AI has no answers nothing is filled, and Ask AI again finishes the page.
- A question that appears later is asked alone.
- QTS does not press Next. The Manager's edit survives Next and Back, with no extra AI request.
- The guest way wins beside Sign in, and signing in happens only when nothing else leads on.
- A site last used for another candidate opens with no cookie and no stored draft.
- The same candidate keeps their session.
- A page signed in as someone else is signed out before filling.
- An account QTS cannot name waits for the Manager, with no AI request before.
- Another account appearing at the end holds the site's Submit.
- A job reopened in a new tab fills again without a new AI request.
- Choosing another candidate stops the work and gives the job back.

Not tested:

- Real Gemini or Groq replies, and how well your prompt works.
- Real job sites. All forms in these tests are small test pages.
- The Super Admin switch clicked in a browser.
- The database update, and the AI route's permission check against a real database.

## 7. Known limits

- QTS can tell who is signed in only from what the page shows. On a site that shows no sign of a
  login, QTS treats it as signed out, unless this Chrome remembers another candidate using that site.
- Signing a site out removes its cookies for the whole domain. All companies on `myworkdayjobs.com`
  count as one site, so the next candidate signs in again.
- A site with no way to remove an old file or value holds Submit until the Manager clears it.
- CAPTCHAs and emailed codes stay with the Manager.
- A form embedded from another website cannot be read unless it is a known job platform. The panel says so.
- These AI calls share the same daily limits as Get JD.
- Speed has not been measured on real sites.

## 8. What to do next

```
You:  install extension 1.50.0
      -> check the prompt "Gemini · Application-answer generation" in Settings
      -> Super Admin turns on "Auto Apply with APIs" for ONE Manager
      -> run one real job on Production -> send me what happened
```

Chrome may ask you to accept one new extension permission, for clearing site data.

On the first real job, check that:

1. The form empties, and answers appear only after the AI replies.
2. Résumé and cover letter are attached and are this candidate's.
3. QTS stops after filling and does not press Next.
4. After you press Next, the next step fills and QTS stops again.
5. Your edits are still there when you go Back.

## 9. Main files

| File | What it is |
|---|---|
| `extension/background/auto-apply-api.js` | The new flow: login check, clean, ask, upload, fill, last check |
| `extension/shared/site-sessions.js` | Which candidate used which site, and who is signed in |
| `extension/shared/apply-answers.js` | What goes to the AI, and the check of each answer |
| `extension/content/apply-form.js` | Removing uploads, reading the account shown on a page |
| `extension/background/apply-runner.js` | Small hooks, active only with the switch on |
| `src/app/api/extension/apply/answers/route.ts` | The AI route, now for assigned Managers only |
| `src/app/settings/prompt-forms.tsx` | The new switch for Super Admin |
| `drizzle/0090_youthful_killmonger.sql` | The new column on the users table |
