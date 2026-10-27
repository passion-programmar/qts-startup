import assert from "node:assert/strict";
import test from "node:test";
import { mainSiteUrl, sourceSiteUrl, sourceTagSite } from "@/server/jobs/source-site";

test("a page becomes its site's main address, never a posting", () => {
  assert.equal(mainSiteUrl("https://www.linkedin.com/jobs/search?keywords=devops&geoId=1"), "https://www.linkedin.com/jobs");
  assert.equal(mainSiteUrl("https://ro.indeed.com/viewjob?jk=123"), "https://www.indeed.com");
  assert.equal(mainSiteUrl("https://justjoin.it/job-offers/acme-devops"), "https://justjoin.it");
  assert.equal(mainSiteUrl("https://job-boards.greenhouse.io/exadel/jobs/6229346004"), "https://job-boards.greenhouse.io/exadel");
  assert.equal(mainSiteUrl("https://job-boards.eu.greenhouse.io/embed/job_app?for=nix&token=4982963101"), "https://job-boards.eu.greenhouse.io/nix");
  assert.equal(mainSiteUrl("https://jobs.lever.co/xtb/adf8faf4/apply"), "https://jobs.lever.co/xtb");
  assert.equal(mainSiteUrl("https://apply.workable.com/sedona-digital/j/BDC9C8E581/"), "https://apply.workable.com/sedona-digital");
  assert.equal(mainSiteUrl("https://careers.arden.ac.uk/jobs/8574532-lecturer"), "https://careers.arden.ac.uk");
  assert.equal(mainSiteUrl("chrome://newtab"), null);
  assert.equal(mainSiteUrl(""), null);
});

test("a job link's source tag names the board it came from", () => {
  assert.equal(sourceTagSite("https://apply.workable.com/acme/j/1/?utm_source=linkedin.com"), "https://www.linkedin.com/jobs");
  assert.equal(sourceTagSite("https://jobs.lever.co/acme/1?lever-source=JustJoin"), "https://justjoin.it");
  assert.equal(sourceTagSite("https://acme.com/jobs/1?source=company_site"), null);
  assert.equal(sourceTagSite("https://acme.com/jobs/1"), null);
});

test("the source is the page it was opened from, else the link's tag, else the job's own site", () => {
  assert.equal(sourceSiteUrl({ openerUrl: "https://www.linkedin.com/jobs/view/4012", jobUrl: "https://apply.workable.com/acme/j/1/" }), "https://www.linkedin.com/jobs");
  assert.equal(sourceSiteUrl({ openerUrl: null, jobUrl: "https://apply.workable.com/acme/j/1/?utm_source=Indeed" }), "https://www.indeed.com");
  assert.equal(sourceSiteUrl({ jobUrl: "https://jobs.ashbyhq.com/supabase/5d09daeb" }), "https://jobs.ashbyhq.com/supabase");
});

test("only real job board domains count as boards", () => {
  assert.equal(mainSiteUrl("https://www.bottaro.com/careers/1"), "https://www.bottaro.com");
  assert.equal(mainSiteUrl("https://careers.hipodrom.com/jobs/1"), "https://careers.hipodrom.com");
  assert.equal(mainSiteUrl("https://uk.indeed.com/viewjob?jk=1"), "https://www.indeed.com");
  // A dot must be a real dot: "linkedinxcom" is not LinkedIn.
  assert.equal(mainSiteUrl("https://linkedinxcom.example/jobs/1"), "https://linkedinxcom.example");
});
