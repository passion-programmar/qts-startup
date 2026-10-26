import assert from "node:assert/strict";
import test from "node:test";
import { pageCheckKey } from "./page-check-key";

test("one key per job link, whatever the tracking tags", () => {
  assert.equal(
    pageCheckKey("https://Job-Boards.greenhouse.io/exadelinc/jobs/6229346004/?gh_src=4xw8n9y04us#apply"),
    "https://job-boards.greenhouse.io/exadelinc/jobs/6229346004",
  );
  assert.equal(
    pageCheckKey("https://jobs.lever.co/acme/123?lever-source=LinkedIn&utm_source=x"),
    "https://jobs.lever.co/acme/123",
  );
});

test("query parameters that identify the job are kept", () => {
  assert.equal(
    pageCheckKey("https://example.com/careers?gh_jid=8892971002&gh_src=abc"),
    "https://example.com/careers?gh_jid=8892971002",
  );
});
