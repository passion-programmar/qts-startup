# Reusable Answers phases 4–6 and Production release

## Approved scope

The user approved finishing phases 4–6 and deploying after phases 1–3. This release preserves Manager-owned data, candidate authority, explicit Save/Delete, CAS, policy-context approval, Pause/Resume and local PDF bytes. It does not activate answerSafetyV1, change Auto Apply logic or introduce AI answers into Normal Apply.

## Phase 4: persisted identity and conservative deduplication

`extension/shared/answer-identity.js` derives a versioned meaning key from the Phase 2 registry, including its existing context dimensions and exact-wording protection. Unknown questions and policy/third-party exclusions receive no canonical semantic identity. Identity is metadata, not authorization. Owner, candidate, job and scope remain separate server-authorized boundaries.

Explicit Normal Apply/Profile Save adds identity metadata to existing variants JSON. Existing rows, question keys and canonical answers are not backfilled, merged or rewritten. Semantic duplicate creates and normal Move-to-shared operations are guarded against existing equivalent records in the same owner/context. Explicit create/move operations use SERIALIZABLE transactions; attempt edits retain their live authorization locks and precise version CAS. Serialization/lock conflicts are returned for explicit reload, without automatic write retry. Known legacy aliases are compared without modifying their rows; existing duplicates remain editable/deletable and are indicated in Profile. Existing resolver conflicts stay manual.

No database migration is necessary: the existing JSON column supports optional backward-compatible metadata. No schema or migration file changed. Independent simultaneous PostgreSQL connections were not exercised; isolated PostgreSQL-compatible scenarios and transaction-option fixtures verify the implemented guards. Separate legacy/Auto correction paths intentionally retain their behavior and can still create legacy duplicate records; no claim of a global semantic unique constraint is made.

## Phase 5: explicit field-variation confirmation

In Normal Apply, pause, open Manage answers, choose the current field, then choose a compatible existing saved answer from the new selector. Enter/confirm the exact field-specific answer, check the confirmation and click Save confirmed variation. The source question, canonical answer, scope and candidate profile remain unchanged. The worker derives the actual field format and validates the live field; the backend revalidates meaning/context compatibility, allowed scope, Manager/browser/attempt ownership and exact source version. Linked-policy approvals cannot use this path.

New variations are stored inside Normal-only metadata wrappers. Legacy and Auto readers see the unchanged canonical value, not the field-specific alternative. Normal Apply unwraps only explicitly confirmed matching label/control/options; conflicting approved representations remain manual. Profile displays each saved wording and permits explicit version-protected removal of a variation. Removing a variation does not erase the canonical answer, the employer's field, candidate facts or built-in semantic recognition. The Apply panel preserves drafts on conflict and never resumes or refills after library edits.

Arbitrary unknown questions cannot be manually forced into a known meaning. They retain existing explicit scoped Save and manual handling. New built-in meanings/aliases require reviewed registry definitions and tests; the UI does not train a classifier or use AI.

## Phase 6: release safeguards and regression

Extension version: 1.46.0. The answer-library mutation endpoint rejects versions below 1.46.0 with an actionable 426 response. Reads and unrelated workflow/version eligibility remain unchanged; the existing general work minimum is not raised.

Normal Apply has separate answerSemanticV1, answerRepresentationsV1 and answerIdentityV1 flags, enabled by default. For controlled rollback, a worker-session `globalThis.__qtsAnswerRollout` object can disable those branches. Unsupported disabled representations stay manual, while no-AI, policy and candidate safeguards remain. Backend `QTS_ANSWER_IDENTITY_V1=0` disables new identity writes/deduplication and rejects new variation saves; existing records remain intact. Do not disable authorization, version CAS or policy checks for rollback. No remote/admin rollout dashboard was added. answerSafetyV1 remains false.

Read-only `scripts/verify-production-release.cjs` checks the linked Vercel project, exact origin and configured Production branch. `--deployed` additionally checks released HEAD, READY/production target, health and unauthenticated endpoint refusals. No Preview, force push, migration or production data edit is part of release.

## Validation and known baseline issues

Final targeted extension suite: 129/129 passed. Initial full server suite: 309 passed, 4 skipped, no failures; final full rerun recorded in handoff. Final focused server SQL/editor/version/removal subset: 28/28 passed before the final normal-sharing guard scenario, followed by final full rerun. Chrome editor/confirmation/conflict subset: 3/3 passed. Prior final full Chrome forms: 35/35 passed; broad extension run exercised forms/panel again.

Full extension run: 532 passed, 2 failed, 1 cancelled among 535 tests. The failures are the previously documented category source-string assertions in release-boundary.test.js (551 and 741); neither was weakened. The work-picker browser fixture timed out under combined validation load, then passed serially in 21.6 seconds with assertions unchanged. Its temporary diagnostic timeout change was removed. Final independent unmodified rerun and real MV3/Auto results are recorded in handoff. Broad test results are not described as an all-green suite.

Unfiltered npm lint: 1,149 errors / 17,815 warnings, predominantly ignored local verification artifacts and vendor code. Excluding local .pdf-verification/.codex artifacts: 12 errors / 1,114 warnings, with errors in existing minified vendor code; the existing user-form warning remains. Changed-source lint and final typecheck/build results are recorded separately; no blanket full-repository lint pass is claimed.

## Delivery and use

The backend deploys to https://qts-job-system.vercel.app through origin/qts-startup-deploy after the release gate passes. The extension is a separate artifact: dist/qts-extension-1.46.0.zip. Vercel cannot replace an unpacked Chrome installation. Update/reload the extension in every Chrome profile, then reload open QTS/application pages. Existing configured local PDF access remains per profile; original PDFs are reused without rerendering or server storage.

Production release commit, final deployment verification and remaining limitations are appended to CODEX_HANDOFF.md and CODEX_TASKS.md.

Final release validation (4 November 2026): final serial server suite 316 total / 312 passed / 4 skipped / zero failures or cancellations. Final targeted extension suite 130/130 passed, including browser-bundled identity parity and Normal-only storage compatibility. Full production build, typecheck, lint on every changed JS/TS/TSX/CJS source and Git diff checks passed. Chrome explicit confirmation/editor/conflict 3/3 passed; Normal Apply MV3 PDF/errors/Retry/restart/editor/continuation passed. The full extension run remains 532 passed, two known category-string failures and one work-picker timeout; independent work-picker and checkbox fixtures passed without assertion changes. Broad repository/vendor lint remains a documented baseline failure.

The broader Auto Apply run passed eight compatibility cases (sign-in/registration, parallel limits, selected jobs, three-step filling, tab closure and AI-batch review) before encountering three existing failures; it was stopped during later long cases and is not a full pass. All three failures reproduced against an isolated unchanged HEAD snapshot: restart submission count, mode/Apply-this-page boundary, and dynamic legal/authorization expectations. Auto code and assertions were not changed. Evidence is retained under ignored .pdf-verification/answers-*.log. Independent concurrent production PostgreSQL transactions and every live ATS are not claimed tested.

Vercel CLI refreshed expired local credentials; the read-only release gate freshly confirmed qts-job-system, origin passion-programmar/qts-startup and configured Production branch qts-startup-deploy. Release artifact is dist/qts-extension-1.46.0.zip. No database migration or production data edit is required/performed. Production push and post-release verification follow after the reviewed commit.
