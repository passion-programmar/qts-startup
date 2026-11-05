## Reusable Answers phases 4–6 release - 4 November 2026

User approved completing phases 4–6 and deploying to Production. Implemented versioned identity metadata in existing JSON, scope-aware duplicate-create/share guards, explicit field-variation confirmation without canonical-value overwrite, Profile variation removal/duplicate notices, Normal-only metadata compatibility, rollback flags and answer-library mutation version gate (1.46.0). See docs/REUSABLE_ANSWERS_RELEASE.md. No schema migration, automatic merge, answerSafetyV1 activation, Auto Apply logic change or PDF rendering change.

Production project and origin are being freshly verified; commit/deployment and final checks will be recorded after validation. Earlier entries below are historical.
## Phase 3 update

Normal Apply typed representations are implemented; see docs/PHASE_3_TYPED_REPRESENTATIONS.md. Existing variants JSON carries optional explicitly approved source metadata; no migration. Persistent canonical identity and semantic deduplication remain Phase 4, unimplemented and requiring approval. Earlier status below is historical.

## Phase 2 update

The six-phase plan now has a shared semantic recognition layer implemented for Normal Apply. See docs/PHASE_2_SEMANTIC_RECOGNITION.md for supported definitions, validation and restrictions. The original broader meaning/representation step below is only partly delivered: general transformations and persistent identity remain later phases requiring approval. No migration or automatic record merge.

# Manager answer library

Agreed with the user on 4 November 2026. Implement and validate one step at a time.

## Decisions

- Manage answers in both the current application's Apply panel and the Manager's Profile library.
- No Super Admin/global answer overrides. Answers remain isolated by Manager.
- Explicitly saved shared answers default to all that Manager's candidates. Personal facts stay specific to their candidate; job-dependent meanings retain application context.
- One underlying fact/answer can have several recognized labels, field formats, option wordings and component structures. Matching must preserve meaning, not merely similar words. Never assume residence equals work authorization or synthesize missing name/address/phone components.
- Combine/split/format only when supported by known components; otherwise leave the question manual.
- Learning variants, adding and changing saved answers require explicit Save. Typing, discovery, Pause/Resume and submission must not silently broaden answer scope or teach new variants in the new normal Apply editor.
- Removing a saved answer prevents future reuse; it does not clear the employer's current field.
- Preserve normal autofill, Manager edits, manual Pause/Resume, original local PDF reuse and authorization. Credentials, CAPTCHA, verification codes and file bytes are excluded from answer memory.

## Sequential delivery

1. **Complete: Manager-only loading and priority.** Reuse the existing Manager table and Profile editor. Stop querying global answers for new application payloads and correction scoping. Order application, candidate, Manager-shared rows explicitly. Remove the global library from Manager Profile and clearly label Super Admin's retained records as legacy. Preserve current candidate/application protections. Existing global records are not copied or deleted. Validate server scoping, client priority, normal filling and panel regression.
2. **Complete: explicit Manager answer CRUD in the normal Apply panel.** The Reusable answers card has Manage answers/Reload answers, current-form and saved-answer selection, a new-question option, explicit Save and Delete. Mutations require manual Pause and drained work. Eligible new answers default to Manager shared; known personal/context questions retain candidate/application scope. Existing rows keep their scope and question in the panel (Profile supports question edits). A dedicated authorized `/api/extension/apply/answer-library` endpoint uses live attempt/Manager/browser/ownership checks, exact version CAS, duplicate-create refusal and atomic mapped-profile updates. Profile Save/Delete also use version preconditions. Reload and successful edits refresh applicable snapshots without poking autofill or changing employer form values. Normal Apply submission no longer sends automatic learned answers; the separate legacy review/Check behavior remains unchanged. Broader format/component interpretation is still step 3.
3. **Pending: meaning and representation support.** Separate canonical candidate facts/shared answers from aliases and representations. Audit existing profile/Manager mappings and saved variants first. Implement the supported label/format/component cases incrementally with precise ambiguity rules and tests. Do not automatically promote observations into variants. Investigate whether existing variant JSON suffices before proposing any migration; no migration is approved by this plan.
4. **Pending: integration and regression.** Verify Profile edits, current-form editing, future-job reuse, two-Manager isolation, personal facts, application-specific answers, changed dropdown choices, false checkbox values, Pause/Resume, worker restart, continuation handoff and original-byte document uploads. Test incompatible/old-client behavior before rollout. No deployment or production data writes are authorized in this implementation task.

## Step 1 boundaries

New Apply and Auto Apply payloads use the shared Manager-only loader. Already-open application snapshots are not rewritten; legacy client handling remains for old payloads. The current Profile CRUD and correction scope rules are otherwise retained. This step does not claim all fields can yet be edited from normal Apply, that every new question defaults to shared scope, or that all equivalent field representations are implemented. Existing automatic Check-learning in the separate review workflow is not changed by step 1.

Global tables, history, drafts and Super Admin's legacy management controls remain for reference. Their creation/approval no longer affects new Apply payloads. There is no automatic global-to-Manager backfill. An empty Manager library produces no global fallback; known profile facts still fill normally.
