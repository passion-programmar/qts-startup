# Phase 3: Typed representations for Normal Apply

Implemented 4 November 2026. Phase 4 remains unimplemented and requires approval.

## Architecture and authority

The pure shared answer-representations module declares operations with source/target types, required context, validation and manual failure. The Phase 2 registry identifies meaning and context; the Normal Apply resolver adapts authoritative profile facts or compatible scoped saved answers to a target representation. Results include transformation provenance (operation, stages, meaning, source authority, formats/units and conversion evidence). Existing control validators and fill acceptance checks remain in use. Resolution performs no writes or AI calls.

Candidate facts retain authority; Manager, candidate and application isolation and conflicting-answer handling remain intact. Policy approvals retain exact approved inline context and cannot use generic transformations. Missing and empty values never become invented answers or clears; false, zero and refusal remain usable.

## Supported operations

- Compose full names from known first/last components; explicit Last, First representation; split only explicitly declared comma boundaries. Arbitrary full-name splitting is unsupported.
- Compose full addresses only with known street, postal code, city and country; optional province. No geographic inference or arbitrary address parsing.
- Associate international phone digits with a known matching calling code, extract national digits/code, and preserve original digits. National-to-international composition requires explicitly confirmed significant digits proven against the candidate international number; trunk prefixes are not guessed.
- Strict booleans and unique compatible offered choices; complete sets for supported multiselect/checkbox controls. No partial subset selection or arbitrary prose flattening.
- Dates: ISO and explicit DD/MM/YYYY, MM/DD/YYYY and corresponding dot/hyphen formats. Validate calendar dates, target bounds, step and pattern. Ambiguous undeclared dates remain manual.
- Numbers: declared decimal-dot/comma conventions, range, step, pattern and length checks. No guessed grouping separators.
- Notice/availability: known calendar days/weeks and known base dates; same-unit month/year quantities. No month-to-days, business-day or offer-dependent assumptions.
- Salary: known amount, currency, period and compatible gross/net basis. Currency conversion requires supplied positive rates. Cross-period conversion requires explicit positive payment/work-time factors; the current application payload does not supply these factors, so those conversions generally remain manual. No assumed working hours or payment schedule.

Normal Apply now prevents a neighbouring numeric field's data-unit from leaking into another question. The Auto scanner remains unchanged. Unsupported conversions are left for Manager completion rather than using earlier fixed month/hour assumptions.

## Explicit persistence and compatibility

The existing Save request derives representation metadata from the live scanned field, replacing supplied UI metadata. A Save confirms the current declared format. Backend validation whitelists optional date/number formats, calling code, significant-national proof, unit and name order. Known invalid metadata is rejected. Existing version checks, ownership, browser identity and valid-attempt authorization protect the atomic update.

Metadata is stored in existing variants JSON only after explicit Save. Old variants/keys remain supported; no automatic learning, merging, canonical identity or authoritative-value rewrite occurs. Profile library edits without source-format metadata may require manual format confirmation later. There is no new schema or migration.

## Components

New answer-representations.js/.d.ts/.test.js; semantic-fields.js/.d.ts; apply-answers.js; worker import; Normal Apply scanForAssist in apply-form.js; explicit Save snapshot in apply-runner.js; Save guidance in apply-assist.js; manager-answer-values.ts and manager-answer-editor.ts; representation, editor, server and Chrome fixtures. Previous phase changes already present in the working tree are retained.

## Validation

124 targeted extension tests passed, including scope/authority, old resolver behavior, no-AI boundaries, policy safeguards, explicit Save/Delete, conflicts, Pause/Resume, local PDF reads and upload deduplication. 35 isolated server tests passed, including authorization, candidate/Manager isolation, PostgreSQL-compatible atomic CRUD and representation metadata conflicts. Real MV3 PDF/error/Retry/restart/editor/continuation E2E passed. Two Chrome panel editor/conflict tests passed. Typecheck and changed-source lint passed. Final full Chrome form rerun and final static checks are recorded in the handoff.

## Limitations and next phase

Supported fixtures are not proof of universal ATS compatibility. Unknown component boundaries, dates, units, ambiguous dropdowns and incomplete candidate facts remain manual. No new general UI for arbitrary transformation definitions is included. Provenance is attached to resolver results, not a new persistent audit database or explanation screen. Auto Apply AI, resolver and execution behavior are unchanged; answerSafetyV1 remains false. Phase 4 persistent canonical identities/deduplication have not started. No production data, commit, push or deployment.

Final Phase 3 validation: full Chrome form suite 35/35 passed after fixing neighbouring numeric-unit leakage in Normal Apply only. The final typed subset 10/10 and panel editor/conflict subset 2/2 passed. Changed-source lint and Git diff --check passed (Git reported only existing LF/CRLF notices). Typecheck passed. A failed final browser rerun exposed the unit leak; assertions were preserved and the full suite passed after the fix. No schema/migration changes. Existing unrelated broad-repository lint baseline was not rerun or claimed clean.
