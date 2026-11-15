import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultGetJdSkipSites,
  maxGetJdSkipSites,
  normalizeGetJdSkipSite,
  parseGetJdSkipSites,
  readSavedGetJdSkipSites,
} from "./skip-sites-values";

test("a site is kept as host and optional path: no scheme, www, query or capitals", () => {
  assert.equal(normalizeGetJdSkipSite("https://www.YouTube.com/watch?v=1#t"), "youtube.com/watch");
  assert.equal(normalizeGetJdSkipSite("linkedin.com/feed"), "linkedin.com/feed");
  assert.equal(normalizeGetJdSkipSite("  mail.google.com  "), "mail.google.com");
  for (const bad of ["", "youtube", "you tube.com", "/feed", "http://", "a".repeat(201) + ".com"]) {
    assert.equal(normalizeGetJdSkipSite(bad), null, bad);
  }
});

test("the Settings box is one site per line; blank lines and repeats are dropped, a bad line is named", () => {
  assert.deepEqual(parseGetJdSkipSites("youtube.com\n\n www.youtube.com \r\nlinkedin.com/feed\n"), { sites: ["youtube.com", "linkedin.com/feed"] });
  assert.deepEqual(parseGetJdSkipSites(""), { sites: [] });
  const error = parseGetJdSkipSites("youtube.com\nnot a site");
  assert.ok("error" in error && /"not a site"/.test(error.error));
  const tooMany = parseGetJdSkipSites(Array.from({ length: maxGetJdSkipSites + 1 }, (_, index) => `site${index}.com`).join("\n"));
  assert.ok("error" in tooMany);
});

test("a saved list is read back cleanly; anything else counts as not saved", () => {
  assert.deepEqual(readSavedGetJdSkipSites(["youtube.com", 5, "bad entry", "x.com"]), ["youtube.com", "x.com"]);
  assert.deepEqual(readSavedGetJdSkipSites([]), []);
  assert.equal(readSavedGetJdSkipSites(null), null);
  assert.equal(readSavedGetJdSkipSites("youtube.com"), null);
});

test("the starting list is valid and never lists a whole site that hosts its own careers pages", () => {
  for (const site of defaultGetJdSkipSites) assert.equal(normalizeGetJdSkipSite(site), site, site);
  for (const site of ["slack.com", "stripe.com", "discord.com", "figma.com", "canva.com", "quora.com", "bloomberg.com", "notion.so", "docs.google.com", "amazon.com"]) {
    assert.ok(!defaultGetJdSkipSites.includes(site), site);
  }
});
