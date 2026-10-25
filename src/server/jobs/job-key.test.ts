import assert from "node:assert/strict";
import test from "node:test";
import {
  computeJobKey,
  computeTitleCompanyKey,
  isJobSpecificUrl,
  normalizeJobKeyUrl,
  platformJobKey,
} from "@/server/jobs/job-key";

const job = (url: string, canonicalUrl?: string) => computeJobKey({
  url,
  canonicalUrl,
  title: "Senior Frontend Engineer",
  company: "Acme Inc.",
});

test("platform job IDs give one key across URL variants", () => {
  assert.equal(job("https://www.linkedin.com/jobs/view/4012345678/?refId=abc&trk=x"), "linkedin:4012345678");
  assert.equal(job("https://www.linkedin.com/jobs/view/senior-frontend-engineer-at-acme-4012345678"), "linkedin:4012345678");
  assert.equal(job("https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=react"), "linkedin:4012345678");
  assert.equal(job("https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b&from=serp"), "indeed:1a2b3c4d5e6f7a8b");
  assert.equal(job("https://uk.indeed.com/jobs?q=react&vjk=1A2B3C4D5E6F7A8B"), "indeed:1a2b3c4d5e6f7a8b");
  assert.equal(job("https://boards.greenhouse.io/acme/jobs/7781234"), "greenhouse:7781234");
  assert.equal(job("https://job-boards.greenhouse.io/acme/jobs/7781234?gh_src=abc"), "greenhouse:7781234");
  assert.equal(job("https://acme.com/careers/job?gh_jid=7781234"), "greenhouse:7781234");
  assert.equal(
    job("https://jobs.lever.co/acme/5AC21346-8E0C-4494-8E7A-3EB92FF77902/apply"),
    "lever:5ac21346-8e0c-4494-8e7a-3eb92ff77902",
  );
  assert.equal(
    job("https://jobs.ashbyhq.com/acme/0f2d6c1e-5b8a-4c3d-9e7f-1a2b3c4d5e6f"),
    "ashby:0f2d6c1e-5b8a-4c3d-9e7f-1a2b3c4d5e6f",
  );
  assert.equal(job("https://jobs.smartrecruiters.com/Acme/743999812345678-frontend-engineer"), "smartrecruiters:743999812345678");
  assert.equal(
    job("https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Frontend-Engineer_R12345"),
    "workday:acme:R12345",
  );
  assert.equal(job("https://apply.workable.com/acme/j/A1B2C3D4E5/"), "workable:A1B2C3D4E5");
});

test("only tracking parameters are removed from cleaned URLs", () => {
  assert.equal(
    normalizeJobKeyUrl("http://WWW.Acme.com/careers/job/?id=123&utm_source=x&fbclid=y#apply"),
    "https://acme.com/careers/job?id=123",
  );
  assert.notEqual(job("https://acme.com/careers/job?id=123"), job("https://acme.com/careers/job?id=456"));
  assert.equal(
    job("https://acme.com/careers/job?b=2&id=123&a=1"),
    job("https://acme.com/careers/job?a=1&id=123&b=2&utm_campaign=z"),
  );
});

test("a canonical URL is used only when it points at one job", () => {
  assert.equal(job("https://acme.com/careers?x=1", "https://acme.com/careers/jobs/98765"), "https://acme.com/careers/jobs/98765");
  assert.equal(job("https://acme.com/careers/jobs/98765", "https://acme.com/careers"), "https://acme.com/careers/jobs/98765");
  assert.equal(job("https://acme.com/careers/jobs/98765", "not a url"), "https://acme.com/careers/jobs/98765");
});

test("generic careers URLs get title and company so different jobs stay apart", () => {
  const frontend = computeJobKey({ url: "https://acme.com/careers", title: "Frontend Engineer", company: "Acme" });
  const backend = computeJobKey({ url: "https://acme.com/careers", title: "Backend Engineer", company: "Acme" });
  assert.equal(frontend, "https://acme.com/careers#tc:frontend engineer|acme");
  assert.notEqual(frontend, backend);
  assert.equal(isJobSpecificUrl("https://acme.com/careers"), false);
  assert.equal(isJobSpecificUrl("https://acme.com/careers/frontend-engineer-12345"), true);
});

test("title and company keys ignore case, punctuation, legal suffixes and remote tags", () => {
  const expected = "senior frontend engineer|acme";
  assert.equal(computeTitleCompanyKey("Senior Frontend Engineer", "Acme"), expected);
  assert.equal(computeTitleCompanyKey("  senior   frontend engineer ", "ACME, Inc."), expected);
  assert.equal(computeTitleCompanyKey("Senior Frontend Engineer (Remote)", "Acme LLC"), expected);
  assert.equal(computeTitleCompanyKey("Senior Frontend Engineer - Remote, US", "Acme Co. Ltd"), expected);
  assert.equal(computeTitleCompanyKey("Remote Sales Manager", "Acme"), "remote sales manager|acme");
  assert.equal(computeTitleCompanyKey("Programista Java", "Firma Sp. z o.o."), "programista java|firma");
  assert.equal(computeTitleCompanyKey("Engineer", ""), "");
});

test("unparseable URLs have no key", () => {
  assert.equal(platformJobKey("javascript:alert(1)"), null);
  assert.equal(job("not a url"), null);
});
