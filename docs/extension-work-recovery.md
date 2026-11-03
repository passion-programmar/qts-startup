# Generation and Auto Apply interruption recovery

Recovery runs automatically when Chrome reopens or its Manifest V3 worker restarts. The existing
queue alarms retry cleanup if the server is temporarily unavailable. No launcher click, database
edit, or manual release is required. Chrome must be open, the extension enabled, and authentication
valid; this does not run while Chrome is fully closed or bypass a required sign-in.

- **Cancel:** stops the work slot and any in-flight AI answer request. The selected account's visible job list, checked
  jobs, and scroll position remain available. Cleanup retries automatically, including after a
  restart. Starting another batch waits for cleanup; Cancel never restarts the cancelled batch.
- **Generation ChatGPT tab closed:** the existing recovery attempt opens a fresh tab and sends the
  full original prompt, including the Manager instructions and output contract. Recovery remains
  bounded by the existing retry limits. Persistent generation errors remain visible failures.
- **Unfinished Auto Apply tab closed:** the current attempt is released and the job can be claimed
  again automatically within the saved account/job selection. Failed release requests are saved
  before sending and retried before the queue claims more jobs.
- **Auto Apply claim lost:** QTS stops work in the tab, gives the job back, and keeps the last
  completed checkpoint for a later claim. It does not continue or submit under a claim another
  Chrome no longer owns.
- **Worker restart with the same Chrome session:** Auto Apply can resume the same application tab
  and saved step. Generation releases its interrupted hold and restarts eligible unfinished work.
- **Full Chrome restart:** saved tab IDs are not trusted across browser sessions. Unfinished Auto
  Apply attempts are released and eligible work is reclaimed; prior form edits are not guaranteed
  to survive. Generation releases interrupted holds and continues its saved queue selection.
- **Already submitted:** recovery never submits again or guesses success. If its tab is gone,
  the existing success-confirmation question stays on Jobs and does not block the extension queue.
  The Manager still answers that business confirmation; it is not a manual recovery operation.

Existing form review, Next/Submit controls, ownership/security checks, JSON validation, PDF page
limits, download completion checks, and generation finalization guards remain active. Recovery does
not bypass CAPTCHA, account credentials, verification codes, missing answers, or Manager review.

Local verification uses synthetic accounts, a mock HTTP server, mock AI, and real Chrome. The
startup regression closes and relaunches Chrome with a persistent test profile, simulates failed
cleanup requests, then verifies automatic retries through the existing alarms. It checks both
Generation and Auto Apply recovery, retained selections, and persisted Cancel intent. No production
database, live ChatGPT generation, or real job application is involved.
