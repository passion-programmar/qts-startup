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
  })), {
    nationality: "Polish",
    languages: "English C1, Polish C2",
    githubUrl: "https://github.com/anna",
    portfolioUrl: null,
  });
});

test("invalid facts are refused with a reason", () => {
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", githubUrl: "not a url at all" })), "string");
  assert.equal(typeof readApplicationFacts(form({ applicationFacts: "1", nationality: "x".repeat(101) })), "string");
});
