# Apply PDF upload correctness

## Implementation plan

1. Classify each destination as a resume attachment, cover-letter attachment, resume parser, or an upload requiring manual review. Do not infer resume from `required`. Only a single unambiguous general attachment may receive the resume when no named resume attachment exists.
2. Keep a document-scoped ledger across script reinjection, worker retries, and DOM replacement. Scope records by application attempt, step, frame/shadow root, form, upload question, and occurrence. Distinct parser and attachment destinations must remain independent.
3. Record the expected document and whether it is pending, confirmed, rejected, or uncertain. Compare native attachment bytes when available and exact displayed filenames within an isolated widget. Never treat a sibling widget's file as this widget's attachment.
4. Send one upload operation. Prefer the widget's own file input; otherwise use drag-and-drop once. Do not retry through arbitrary hidden inputs or assume a timeout means nothing was sent.
5. Reconcile expected attachments at the end of both Apply modes. Pending, wrong, rejected, or unverifiable uploads require review. Check required uploads even in normal Apply.
6. Verify classification, concurrent/repeated fills, DOM redraws, separate parser and attachment controls, slow/rejected uploads, neighboring groups, and both Apply runner paths. Use distinct synthetic resume and cover-letter bytes. Do not submit live applications.

## Verification limits

A native file selected for submission is not proof of a remote server upload. Sites that upload asynchronously must expose filename/status evidence in their own widget. Unknown status is reported for review rather than retried automatically. Navigation creates a new document: inspect its attachments afresh, because native file inputs may legitimately be empty on a new step or reload. The ledger is not a global “upload each PDF once” rule.

## Implementation and validation

Steps 1–6 are implemented in `extension/shared/apply-answers.js`, `extension/content/apply-form.js`, and `extension/background/apply-runner.js`.

- Shared tests: 404 passed across the full shared run and the sandbox-blocked identity test rerun. Upload classification, worker reconciliation, and pause behavior are covered.
- All 11 browser regressions passed. They use different synthetic PDF contents and exercise wrong documents, duplicate selections, redraws, script reinjection, concurrent requests, separate parser/attachment controls, delayed acknowledgements and rejection, shadow roots, removed controls, and switching candidates.
- The two-step Apply runner integration and the three-step Auto Apply integration passed against local mock servers.
- Normal Apply passed its profile/document filling assertions after updating the obsolete shared notice-period fixture to a candidate-owned answer. The full integration still failed later because `/form/1` was missing during the account-navigation portion. This is an outstanding integration failure; the complete normal Apply test is not green.

For local verification, reload the unpacked extension at `chrome://extensions`, refresh the application page, and start a fresh Apply attempt. Check the filename beside each upload, especially when the site shows a review message. Starting the Next.js dev server alone does not reload extension scripts.

A logical destination is inferred from its document, form, question and position. A site that completely changes those identifiers may require site-specific handling. Visible filenames cannot prove remote file contents; native file selections are compared byte-for-byte. No live applications were submitted during this validation.
