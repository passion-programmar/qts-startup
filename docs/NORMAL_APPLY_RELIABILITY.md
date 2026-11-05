# Normal Apply reusable-answer reliability

## Execution and authority

Normal Apply uses the existing resolver and form handlers. Its assisted fill caller explicitly sets no-AI; the fill engine independently enforces it, and AI generation/repair entry points reject applications marked as Normal Apply. The legacy Normal Apply/dry-run entry also marks this mode. Auto Apply does not set this marker and retains its existing AI, source, cache and consent paths.

Normal Apply resolves available recognized personal facts from the candidate profile before controlled answers. Candidate/application saved facts remain eligible; Manager-shared rows cannot supply recognized personal facts or override salary/notice/sponsorship facts through the reusable-fact adapter. Application > candidate > Manager priority remains for compatible nonpersonal answers. No records are changed by resolving.

Normal Apply never fills from legacy remembered choices. Cached answers are re-resolved against current profile/library data rather than trusted as authorization. Missing answers, rejected values and oversized document text remain manual; generated documents and original PDF-byte upload paths are preserved. Missing notice data no longer supplies the legacy one-week default in this mode. Broader profile-name/address/format semantics remain unchanged.

## Explicit policy reuse

Generic consent acceptance is not enabled for Normal Apply. Policy handling occurs before the shared resolver's generic consent and optional-opt-in rules, and only returns an existing compatible saved answer.

The Apply form reader supplies an optional policyContext for an isolated visible inline policy block with supporting text. It includes exact page origin/path, label and block text. Linked documents, label-only controls, oversized text or blocks containing unrelated typed personal fields have no reusable context. A URL alone does not establish that linked terms are unchanged.

Explicit Save from the current form captures live context, kind and choices, not the UI's claimed field metadata. Optional policyContext is stored in the existing variants JSON; no schema change/migration. UI instructions explain that saving approves only this inline context. Later reuse requires matching context, normalized question, kind and choices. Explicit false/refusal is preserved. Scope/ownership still come from the authorized application loader. Different origins, paths, inline versions, wording or choices require review. No new semantic aliases, employer-wide approval rules or canonical identities are created.

Legacy saved confirmations lacking context remain stored and visible but require explicit re-saving from an eligible current form. Profile editing cannot create live page authorization. Saving a general custom question does not capture policy context. Linked employer agreements remain manual even after Save, because their content/version is unverified. This conservative limitation also means many new-job URLs cannot reuse approval from another application URL. Exact inline text avoids conflating acknowledgment, consent, optional preferences and factual attestation; no general semantic classifier is claimed.

## Feature flag and compatibility

answerSafetyV1 remains false. The dormant stricter profile/meaning branches now require Normal Apply context so they cannot globally affect Auto Apply. The targeted Normal Apply safeguards above are active without globally activating that experimental policy. Full strict transformation provenance and context-aware canonical identity remain future work requiring approval.

No production data, migration, server PDF storage, document regeneration, automatic learning, semantic merge or deployment. Existing Save/Delete CAS and drained Pause/Resume safeguards remain.

## Validation

- 108 targeted extension tests passed, including original PDF access/upload guards, explicit editor/Pause protections, actual fill-body no-AI/cached/memory checks and Auto AI boundary compatibility.
- Final server suite: 31 passed, including isolated SQL policy metadata create/update, ownership, leases, atomic profile writes and version/destination conflicts.
- Full form Chrome suite: 33 passed; full panel Chrome suite: 18 passed.
- Real MV3 local PDF/error/retry/restart/continuation/answer-editor E2E: 1 passed, preserving exact original bytes and Manager pause/edits.
- The earlier stall reproduced as a 60-second timeout in the existing application-action priority fixture. Its synthetic login anchor navigated during an assertion about which action was selected. Preventing that irrelevant navigation in the fixture preserved all assertions; isolated and full-suite reruns passed. The suggestion fixture also passed. Earlier interrupted/timed-out runs are not counted as passes.
- Typecheck, changed-source lint and diff checks passed before final documentation; any final targeted reruns are recorded in handoff.

These are local fixture results, not a claim that all live employer configurations are supported. No full repository lint claim; previously documented unrelated generated/vendor baseline findings remain separate.

Final checks: the 108-test extension suite passed again after the last resolver adjustment; the final restricted policy scanner Chrome case passed (1/1). Final typecheck, lint of all changed source/test files and Git diff checks passed. Schema/migration diff is empty. Approval checks are snapshots at resolution/Save, not continuous monitoring of externally changed policy documents or a guarantee of server acceptance; Managers still review and submit.
