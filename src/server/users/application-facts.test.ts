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

test("the static facts are parsed and normalized", () => {
  assert.deepEqual(readApplicationFacts(form({
    applicationFacts: "1",
    nationality: " Polish ",
    languages: "English C1,  Polish C2",
    githubUrl: "github.com/anna",
    portfolioUrl: "",
    gender: "woman",
    disabilityStatus: "prefer_not_to_say",
  })), {
    nationality: "Polish",
    languages: "English C1, Polish C2",
    githubUrl: "https://github.com/anna",
    portfolioUrl: null,
    gender: "woman",
    ethnicity: null,
    veteranStatus: null,
    disabilityStatus: "prefer_not_to_say",
    sexualOrientation: null,
    pronouns: null,
  });
});

test("invalid facts are refused with a reason", () => {
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", githubUrl: "not a url at all" })), "string");
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", nationality: "x".repeat(101) })), "string");
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", gender: "robot" })), "string");
});
