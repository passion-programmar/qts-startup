# Reusable Answers Phase 1 safety changes

## Active write protections

- New normal Apply answers use the existing candidate/application classifier instead of promoting every shareable unknown question to Manager scope. Known source questions retain their existing Manager scope. An unchecked sharing box is not a universal application-scope override.
- Explicitly checking sharing requests Manager scope. The server independently rejects recognized personal/contextual questions. Existing rows keep their scope; no records are migrated or rewritten.
- Telephone/contact-number and selected sensitive personal labels are now candidate-scoped and cannot be shared. This is a conservative safety patch, not Phase 2 semantic identity.
- Move to shared requires the source version and updates that row atomically. The existing unique index rejects an occupied destination; neither source nor destination is overwritten. No automatic conflict resolution or retry.
- Profile Save already explicitly targets the Manager library. Existing candidate/profile edits and version checks remain intact.
- Legacy Check callers without a reuse version now receive an explicit reload error for promotion. Other Check corrections remain unchanged. No attempt to infer a missing version.

## Resolver authority and guarded rollout

`runtime-config.js` exposes `features.answerSafetyV1`, initially false. Major fill behavior therefore remains unchanged by default. Test/pilot code can set `globalThis.__qtsAnswerSafetyV1` in the extension worker context; false restores legacy behavior immediately for subsequent resolutions. The override is session-only and not a user preference or remote flag. Production activation is not part of this change.

When enabled, recognized available personal profile facts precede saved answers. Their results include policy, authority and operation provenance. Other answers retain application > candidate > Manager priority through the existing controlled resolver. No general canonical identity is introduced.

Document bytes and generated message/cover-letter handling remain authoritative in their existing paths. Existing required-consent/attestation rules remain an explicit exception; this phase does not introduce automatic consent-policy changes. Optional marketing opt-ins remain untouched. Broad legal regex interpretation remains a review risk.

The guarded transformation check rejects changed phone digits, unverifiable free-text answer conversions, unknown country conversions and non-exact generic facts. Known yes/no polarity and existing country mappings remain supported. Birthday adaptation accepts only the same ISO date. Unsupported formatting may require manual completion. These are validation guards, not a new transformation framework; provenance is not yet propagated through every AI/DOM action or persisted.

## Compatibility and rollback

No schema change, migration, data backfill, automatic merge, PDF rendering/storage change or production operation. Old clients can read existing records. Old clients saving unknown new questions receive safer local scope; promotion requires a version. Existing shared answers remain readable. Removing/deactivating the resolver flag never changes stored records. Do not roll back write-conflict protections to restore an unsafe overwrite behavior.

Explicit Save/Delete, drained manual Pause, explicit Resume and PDF-error Retry remain separate. No alias learning or new representation persistence is introduced. Scope classification is still heuristic; explicit sharing cannot guarantee that every unknown personal wording is detected. Semantic classification and context identity remain Phase 2 work requiring approval.

## Validation

83 existing resolver/editor/pause tests passed before new regressions; 84 passed after the initial safety regression. Server suite: 32 passed; final isolated SQL/editor subset: 20 passed, including actual source-version and destination-conflict checks. Full Chrome panel: 18 passed; final affected editor rerun: 2 passed including unchecked and explicit sharing transmission. Windows esbuild required an elevated read-capable test process; tests used fixtures/isolated PGlite, never the production database.

Final platform/control subset: 4/4 passed. The full form browser run passed three upload cases then stalled in the existing suggestion test and was interrupted, so it is not a full pass. Typecheck, changed-source lint and diff checks passed. No full-repository lint claim; unrelated historical generated/vendor lint findings remain outside scope.
