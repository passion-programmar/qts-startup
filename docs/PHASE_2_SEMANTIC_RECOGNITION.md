# Phase 2: shared semantic field recognition

## Delivered contract

`extension/shared/semantic-fields.js` is the single runtime definition source. The classic MV3 worker loads it before the existing resolver; server validation imports that same CommonJS-compatible file. A TypeScript declaration describes the contract without duplicating definitions. No generated registry, network lookup or AI is involved.

Each definition has a versioned meaning ID, value type, authority, allowed/default scopes, supported control representations and relevant context dimensions. Representation descriptors point to existing profile/option validators; they are not a new transformation engine. Recognition accepts the label and optional help/section subject hints. Backend Normal Apply edits consume the same classifier; the worker supplies live help text to prevent ambiguous referee/employer fields from updating candidate facts.

## Supported recognition

- Given/family/full names; distinct legal and preferred-name meanings. Existing first/last values may still form the existing full-name representation. No inference of legal/preferred values from a generic name.
- Email/contact email, phone/mobile/telephone/contact number, city, residence country, nationality, citizenship, address line 1, postal code, province and LinkedIn labels. Selected existing French/German/Polish/Spanish contact/name aliases are shared with backend validation. This is not comprehensive multilingual interpretation.
- Full phone, calling-code and national-number meanings remain separate. Offered calling-code options reuse the existing exact phone-option mapper; no new splitting or national-number extraction.
- Notice duration and start date are separate meanings. Preferred interview format/channel/method can reuse compatible candidate/application answers.
- Selected source-question variants can reuse Manager-owned source answers. Referrer identity and recruiter-source distinctions are not generalized.
- Closed authorization templates match only when country and current-time context agree. Closed sponsorship templates separate current and future needs and countries. Unknown wording retains exact-wording protection.
- Closed salary templates match annual/yearly wording only with identical currency, period and gross/net basis. No unit, currency or basis conversion is introduced by this layer. Profile data without a gross/net basis cannot establish one.

Unknown labels retain legacy resolution. Recognized combined, third-party, specific-identity or contextual ambiguity is left manual rather than falling through a broad profile regex. Explicit application-only third-party answers retain exact matching. A generic field with help text identifying another subject cannot be mapped to a candidate profile on Save; the Manager must create a clearly named question instead. Context inference is conservative and not exhaustive.

## Authority and compatibility

For Normal Apply only, recognized available profile facts remain authoritative. Saved matching records follow application > candidate > Manager priority within permitted scopes; personal meanings exclude Manager-shared records. Equal-priority conflicting alias answers stop for review. Existing controlled-answer/option validation decides whether the value fits. Unsupported choices stay manual.

Semantic matches are ephemeral copies with provenance (meaning, registry version, source record/scope). No meaning IDs, aliases, canonical values or inferred transformations are written to database records. Existing question keys and variants remain intact. An explicit Save still uses the existing authorized/CAS-protected path; approved contact aliases map to the existing six editable profile fields. Other profile facts remain authoritative in their existing candidate profile and may require editing there rather than treating a saved answer as a profile update.

Existing duplicate aliases are not merged. Explicitly adding a separately worded record can still create another record; persistent identity/deduplication remains Phase 4. Same-scope conflicts are visible rather than silently selecting the newest record.

Profile Manager actions use shared validation, while legacy/Auto Apply correction parsing keeps its previous default path. Normal payload filtering uses semantic profile mappings; initial legacy payloads remain readable and Normal Apply performs its own authority checks. Manager/candidate/job ownership still comes from existing backend authorization/loading, not from the meaning ID or client-supplied IDs.

## Preserved boundaries

Policy handling runs before semantic reuse and retains exact inline-context approval, including refusal. Policy meanings are excluded from semantic aliases. No broad consent acceptance, AI generation/repair, legacy-memory bypass, automatic learning, PDF rendering or server PDF storage. Auto Apply does not invoke the new matching branch. `answerSafetyV1` remains disabled.

No schema migration, data backfill, automatic merge, commit, push or deployment. The prior Phase 1 and Normal Apply changes were already uncommitted and remain preserved in the working tree.

## Validation and next phase

Tests cover classic-script/CommonJS and backend parity, equivalent wording, sensitive-context differences, missing/ambiguous facts, same-scope conflicts, profile authority, legacy exact matching, Auto compatibility, explicit SQL alias updates and foreign-Manager isolation. Real-control fixtures exercise email and select filling without writes. Final counts and static checks are recorded in CODEX_HANDOFF.md.

Phase 3 may build typed transformations on these meaning/value/context contracts after approval. It must declare source components, validation and provenance; this phase does not implement a general split/combine/format engine. Persistent canonical-answer identities remain Phase 4 work.

Final Phase 2 validation: final semantic/no-AI edge subset 7/7 passed after identity, multilingual and contextual guards; typecheck, Phase 2 changed-source lint and Git diff checks passed. The schema/migration diff is empty. Later transformations and persistent canonical identities remain unimplemented.
