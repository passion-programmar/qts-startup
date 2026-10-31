import assert from "node:assert/strict";
import test from "node:test";
import { pageCheckKey } from "./page-check-key";

test("one key per job link, whatever the tracking tags", () => {
  assert.equal(
    pageCheckKey("https://Job-Boards.greenhouse.io/exadelinc/jobs/6229346004/?gh_src=4xw8n9y04us#apply"),
    "greenhouse:6229346004",
  );
  assert.equal(
    pageCheckKey("https://jobs.lever.co/acme/123?lever-source=LinkedIn&utm_source=x"),
    "https://jobs.lever.co/acme/123",
  );
});

test("query parameters that identify the job are kept", () => {
  assert.equal(
    pageCheckKey("https://example.com/careers?gh_jid=8892971002&gh_src=abc"),
    "greenhouse:8892971002",
  );
  assert.notEqual(pageCheckKey("https://example.com/careers?id=1"), pageCheckKey("https://example.com/careers?id=2"));
  assert.equal(pageCheckKey("https://example.com/jobs/1?b=2&a=1&utm_campaign=x"), pageCheckKey("https://example.com/jobs/1?a=1&b=2"));
});
