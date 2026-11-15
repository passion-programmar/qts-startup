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

test("the same job text shares a key; an edited title, company or JD gets a new one", () => {
  const url = "https://jobs.lever.co/acme/123?utm_source=x";
  const sent = ["Engineer", "Acme", "Build APIs."];
  const key = pageCheckKey(url, sent);
  assert.match(key, /^https:\/\/jobs\.lever\.co\/acme\/123#[0-9a-f]{32}$/);
  assert.equal(pageCheckKey("https://jobs.lever.co/acme/123", [...sent]), key);
  assert.notEqual(pageCheckKey(url, ["Engineer", "Acme", "Build APIs. Remote in the EU."]), key);
  assert.notEqual(pageCheckKey(url, ["Senior Engineer", "Acme", "Build APIs."]), key);
  assert.notEqual(pageCheckKey(url, ["Engineer", "Acme Ltd", "Build APIs."]), key);
  // Fields can't run into each other: ("ab", "c") is not ("a", "bc").
  assert.notEqual(pageCheckKey(url, ["ab", "c", ""]), pageCheckKey(url, ["a", "bc", ""]));
});
