# Check: Manager corrections and reusable answers

Auto Apply's review button is **Check**. It audits the form and automatically saves changed or newly answered fields. There is no proposal or Super Admin approval step. Automatic navigation/checklist refreshes do not save answers.

The extension takes a baseline after filling each step and compares Check's snapshot with it. Unchanged AI/site/profile answers are not learned again. Explicit checkbox deselections are changes; blank clears never erase a saved answer. Passwords, verification codes, CAPTCHA and files are excluded. Successful fields advance the persisted baseline; failures remain retryable on the next Check. Fill again resets the baseline after filling so QTS's own changes are not mistaken for Manager corrections.

## Ownership and scope

`manager_apply_answers` is separate from the global `reusable_answers` library. Every extension save requires the authenticated Manager, identified Chrome, a live held attempt, an unblocked candidate owned by that Manager, and a valid lease. Candidate/job IDs come from the attempt, never from the request body.

* Candidate facts are reusable only for that candidate. Unambiguous city, first/last name, email, phone and LinkedIn corrections also update the profile in the same database batch. Current profile values remain authoritative after later profile edits.
* Recognized shared questions, including application source, save directly to the Manager's library.
* Unknown or country/company/job-dependent questions save automatically for this candidate/job. They are displayed as contextual/uncertain. Shareable uncertain entries can be moved immediately to the Manager's reusable library from Saved changes or My profile. Personal facts cannot be broadened across candidates.
* Global shared answers take priority over Manager-wide answers. A Manager's edit to a global question saves an application exception; it never changes the global answer or the Manager's existing fallback. Publishing does not rewrite already filled forms.

My profile lists saved scopes, candidate names, wording variants, edit/delete controls and direct additions. Deleting a saved contact correction does not erase the candidate's profile fact. Super Admin can publish shared Manager answers globally from Settings. The original Manager answer is retained and becomes the fallback when that global answer is removed. Historical draft review remains for earlier drafts/learning suggestions; Check never creates a draft.

## Wording variants

Store the question, selected answer, field kind and offered choices. Exact questions and recognized source-question aliases share an identity. A text answer `LinkedIn` and choice `LinkedIn Job Post` may coexist as equivalent variants. `LinkedIn Recruiter` is a different meaning: choosing it replaces the old meaning's variants. A dropdown uses a real offered option. Unknown or ambiguous choices stay with the Manager instead of being forced or sent to AI for a guess.

Matching is conservative, not a general semantic-equivalence guarantee. Contextual answers are currently restricted to their original job rather than inferred across countries or employers. A Manager can deliberately broaden a shareable answer. Unchanged prefilled answers are not automatically added to the library.

## Release and verification

Apply migration `0081_manager_apply_answers.sql` with the normal migration process **before** deploying this server release. Deploy the matching server and reload the rebuilt extension. Database configuration is unchanged. No production migration is performed by the tests.

The same migration adds `profiles.manager_category`: an optional Manager-written label, initially empty for all candidates. The Manager's create/edit forms accept free text (80 characters maximum), without selecting from the Super Admin category catalog. Editing this label does not change the existing global `category_id`. Candidate selectors show `Name (Label)` when a label is present, and only the name when empty.

Generation and Auto Apply job pickers filter locally by title, full URL or company, ignoring case. Filtering preserves checked jobs and explicitly reports selected jobs hidden by the filter. Select all acts on the visible results. Searching does not fetch again or modify jobs.

Auto Apply runs at most two applications per Chrome; a third waits until a slot is free. Each has its own checklist, correction baseline, fill-attempt report and review tab. Cancel releases both unfinished claims. ChatGPT is the default provider; Auto Apply now honors the existing Super Admin assignment (`users.apply_ai_mode`) instead of a stale Chrome-local Gemini preference. Debug-only no-AI mode remains available for synthetic tests. Gemini requests may proceed independently. The shared ChatGPT conversation is protected by a queue: whole answer rounds, including corrections, run one at a time so two application tabs cannot overwrite one another's prompt or response. A later correction round starts with that application's complete context.

Server tests cover parsing, scope, variants, save failures, query ownership constraints and service writes using fixtures. Real Chrome tests exercise the actual extension against a localhost mock server and synthetic forms. They do not submit real applications, call live AI or access production records. Database integration still requires a separate non-production Postgres environment; mocked tests do not establish production migration success.
