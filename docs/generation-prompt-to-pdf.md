# Generation prompt-to-PDF flow

This describes the current implementation. ChatGPT supplies JSON through its browser UI; Generation does not call the OpenAI API directly or ask ChatGPT to create PDF files.

## End-to-end flow

```text
Extension claims saved job and maintains lease
  -> POST /api/extension/generation/start
     -> load candidate/job data, select prompt and rotate template
     -> compose prompt and save pending generation run
  -> send prompt in pinned ChatGPT tab, with QTS_GENERATION_ID marker
  -> read task-associated assistant response and extract JSON
  -> POST /api/extension/generation/complete
     -> require V2, parse, validate identity/target, clean and revalidate
     -> save completed run
  -> GET /api/extension/generation/artifacts?...&print=chrome
     -> return template print job and three file descriptors
  -> print both PDFs locally; validate actual PDF page counts
     -> technical local failure: request server printing
  -> download resume PDF, cover-letter PDF and JD.txt; await each download
  -> POST /api/extension/generation/finalize
     -> job completed, paths/text saved, generation run delivered
```

## Eligibility and prompt selection

The start route authenticates the Manager, checks ownership and the active job lease, and requires a saved description, candidate JD-matching notes, no existing resume path, and candidate name/email. The extension also checks the saved job URL, title and company. JD-matching notes control eligibility and are excluded from the prompt.

When `jobs.generationPromptId` is set, selection uses that specific active, unarchived Manager-owned OpenAI document-generation prompt. An unavailable explicit selection fails with `generation_prompt_missing`; it does not silently select another prompt. Otherwise, Manager prompt groups rotate by least-recent use (unused first), with the active Super Admin default used when no Manager prompt exists. Missing configuration stops Generation. The existing 24 PDF templates rotate separately by least-recent use. Selection history comes from saved generation runs.

The candidate reference contains name, email, phone, headline, LinkedIn URL, joined address/location, education and experience. Current/recent education and experience come first. Job data contains normalized URL, title, company, location, employment/workplace type, salary and effective saved description.

`composeGenerationPrompt()` removes legacy `{{candidate_profile}}`, `{{job_description}}` and `{{document_type}}` placeholders and standalone legacy label blocks. It preserves remaining Manager writing preferences, appends `DOCUMENT_FORMAT_RULES` and its output shape, then appends one `Candidate profile:` JSON block and one `Job data:` JSON block. It does not substitute duplicate reference data into placeholders.

The run saves the selected prompt text/version, composed prompt, PDF template and job snapshot before ChatGPT responds. The extension prepends:

```text
QTS_GENERATION_ID: <generation UUID>
The identifier above is transport metadata. Do not include it in the output JSON.
```

## Manager-controlled content and technical validation

New completions require **V2 resume JSON**, with exactly `targetCompany`, `applyJobTitle`, `name`, `title`, `contact`, `summary`, `skills`, `experience` and `education`. Projects are not added. Skills are `{ category, items }` with comma-separated skill names. Experience entries are `{ company, location, role, dates, bullets }`; education entries are `{ institution, location, degree, field, dates }`.

The existing cover-letter structure is unchanged: candidate, targetRole, targetCompany, recipient, subject, salutation, bodyParagraphs, closing and signatureName. Both the prompt and parser require **1–6 nonempty paragraphs, each at most 900 characters**. `DOCUMENT_OUTPUT_SHAPE` in `generation-format.ts` is the authoritative full shape.

The Manager prompt controls ATS optimization, JD keyword selection, summary and headline tailoring, technical skills, experience bullet wording and quantity, technology emphasis, leadership responsibilities and cover-letter writing style. The fixed instructions appended by the application describe JSON structure, identity and formatting. They do not require the saved professional headline or restrict content to exact saved-history wording. Candidate profile and job data are still inserted automatically.

The extension tolerates a JSON object, JSON code fence or package surrounded by text when extracting the response. Completion requires V2 and retains core-section, field/type, email-format and cover-letter validation. Essential identity and target checks remain:

- Candidate name/email and contact data match the saved profile, including absent optional contact fields; the cover-letter signature must match the candidate name. The professional headline is content, not an identity field.
- Target company and role must match the saved job.
- The parser continues checking consistency between resume and cover-letter candidate identity and target role/company.

There is no backend source-fact matching for skills, technologies, employment or education, and no synonym matching or technology whitelist. Additional or rewritten history entries and technical/ATS wording are not rejected solely because they do not appear in saved candidate text. The completion route no longer loads education or experience descriptions for content validation. Content accuracy is governed by the selected Manager prompt and review, not semantic backend checks.

Cleanup removes placeholders, unsupported formatting, decorative/hidden characters and HTML while preserving allowed bold. It does not source-match summary emphasis, impose a bold-keyword quota, or remove bullets for being short. The cleaned package is parsed and identity/target-checked again. If cleaning invalidates it, the original already-valid package is retained with a logged warning. Existing technical limits, including section/array/string limits and 900-character cover-letter paragraphs, still apply.

An extraction/validation failure gets one corrective follow-up in the same conversation. A ChatGPT page error can trigger one fresh-tab retry with the full original task. Unusable temporary runs are removed and are not delivered.

## Rendering and page limits

`loadGenerationDocuments()` loads the saved completed run's JSON and template, using the profile template for older runs without a saved selection. `parsePdfPackage()` continues reading saved **V1 and V2** documents into the same internal `PdfPackage`; stored V1 records do not need rewriting. `toResumeTemplateData()` feeds the existing 24 HTML templates.

Local printing opens a background Chrome tab, injects `window.RESUME_DATA`, loads the selected resume and cover-letter template pages, waits for rendering/fonts, and calls `Page.printToPDF` with CSS page sizing and backgrounds. The extension's locally packaged `pdf-lib` parses the **actual generated PDF page tree** before returning printable files:

- Resume: maximum **3 A4 pages**.
- Cover letter: maximum **1 A4 page**.

The existing templates may compact spacing/bullet text. Content is never truncated to meet limits. An oversized PDF throws a clear `DocumentPageLimitError`, detaches/closes the print tab, and stops delivery before any of the three downloads start. It does not retry a different renderer for a content-length failure.

Technical local-print failures, including unreadable PDFs, return no accepted files and fall back to server printing. The artifacts route redirects to `GET /api/pdf/print?for=generation&generationId=...`, which authenticates again. Server Chromium prints the same templates and checks actual PDF page counts against the same 3/1 limits. Page-limit errors return HTTP 422 and bypass fallback. Other Chromium failures can use the existing built-in `pdf-lib` renderer, which also enforces page limits.

## Download and finalization safety

Only an accepted pair proceeds to downloading both PDFs and saved `JD.txt`. Files retain the existing `QTS_Resume/<Manager>/<Candidate>/<timestamp>_<Job>_<Company>/` folder scheme and candidate-based filenames. Folder timestamps use Japan time.

The extension waits for every Chrome download to complete before calling finalize. Print failures or interrupted downloads cannot reach successful finalization; partial downloads are cleaned up. If the finalize response is lost, the extension checks server status and keeps files when delivery committed. Uncertain delivery keeps files and stops with a message.

A run marked `completed` has saved valid JSON; it has not yet been delivered. Finalize saves the resume path, plain document text, prompt version and template on the job, marks the job `completed`, and changes the run to `delivered`. The server trusts the extension's download confirmation and cannot independently inspect the user's Downloads folder.

## Implementation references

### Deployment prerequisites

Deploy the built server and reload the updated extension together. The Generation start response advertises numeric `resumeJsonVersion: 2`; the extension stops before sending a prompt if this marker is missing or outdated. This prevents an updated extension from using a stale server's V1 prompt contract.

Explicit prompt selection requires migration `0080_generation_prompt_selection.sql`, which adds the nullable `jobs.generation_prompt_id` foreign key. Verify the intended deployment database has this schema before promotion. Rebuilding or changing a Manager prompt does not apply database migrations.

After deployment, verify the deployed commit and an actual composed prompt. Manager text is loaded separately from the compiled protected contract, so current Manager text alone does not establish that the server build is current.

- Selection/composition: `src/server/generation/manager-prompt.ts`, `generation-prompt.ts`, `generation-format.ts`
- Lifecycle: `src/app/api/extension/generation/{start,complete,artifacts,finalize}/route.ts`
- Identity/target checks and formatting cleanup: `src/server/generation/generation-output-validation.ts`, `clean-documents.ts`
- ChatGPT transport/delivery: `extension/background/service-worker.js`, `extension/shared/generation-chatgpt.js`
- Local printing/counts: `extension/shared/chrome-pdf.js`, `extension/vendor/pdf-lib/`
- V1/V2 parser/adapter: `src/app/pdf/document-data.ts`
- Document loading/filenames: `src/server/generation/generation-documents.ts`, `generation-artifacts.ts`
- Server printing: `src/app/api/pdf/print/route.ts`, `src/server/pdf/{document-pdfs,template-pdf}.ts`, `src/app/pdf/pdf-renderer.ts`
