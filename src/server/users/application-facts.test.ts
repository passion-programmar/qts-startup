import assert from "node:assert/strict";
import test from "node:test";
import { readApplicationFacts } from "./application-facts";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

test("a form without the facts section leaves the facts unchanged", () => {
  assert.equal(readApplicationFacts(form({ firstName: "Anna" })), null);
});

test("facts are parsed and normalized", () => {
  assert.deepEqual(readApplicationFacts(form({
    applicationFacts: "1",
    workAuthorization: " EU citizen ",
    needsSponsorship: "no",
    noticePeriod: "1_week",
    salaryExpectationAmount: "70000",
    salaryExpectationCurrency: "eur",
    salaryExpectationPeriod: "day",
    yearsOfExperience: "8",
    willingToRelocate: "",
    githubUrl: "github.com/anna",
    portfolioUrl: "",
    eeoPreference: "prefer_not_to_say",
  })), {
    workAuthorization: "EU citizen",
    needsSponsorship: false,
    noticePeriod: "1_week",
    salaryExpectationAmount: 70000,
    salaryExpectationCurrency: "EUR",
    salaryExpectationPeriod: "day",
    yearsOfExperience: 8,
    willingToRelocate: null,
    githubUrl: "https://github.com/anna",
    portfolioUrl: null,
    eeoPreference: "prefer_not_to_say",
  });
});

test("invalid facts are refused with a reason", () => {
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", yearsOfExperience: "eight" })), "string");
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", salaryExpectationAmount: "70000" })), "string");
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", salaryExpectationCurrency: "euro" })), "string");
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", needsSponsorship: "maybe" })), "string");
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", noticePeriod: "1 month" })), "string");
});

test("an unset notice period means immediately", () => {
  const facts = readApplicationFacts(form({ applicationFacts: "1" }));
  assert.ok(facts && typeof facts === "object");
  assert.equal(facts.noticePeriod, "immediately");
});
