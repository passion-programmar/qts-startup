import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { checkboxAnswerValue, displayReusableAnswer } from "@/lib/checkbox-answer";
import { parseReusableAnswer } from "./apply-values";
import { answerWarnings } from "./reusable-answer-values";

const extension = createRequire(import.meta.url)("../../../extension/shared/apply-answers.js");
test("legacy labels and boolean states normalize without turning ordinary prose or Yes/No into checkboxes", () => {
  for (const value of [true, "true", "Ticked", " checked ", "☑ Checked", false, "false", "Not ticked", "Unchecked", "☐ Unchecked", "Yes", "No", "Checked luggage", "Not ticked yet", "", null, 0]) {
    assert.equal(extension.checkboxAnswerValue(value), checkboxAnswerValue(value));
  }
  assert.equal(checkboxAnswerValue("Not ticked"), false);
  assert.equal(checkboxAnswerValue("Yes"), null);
  assert.equal(displayReusableAnswer("Ticked"), "☑ Checked");
  assert.equal(displayReusableAnswer("false"), "☐ Unchecked");
  assert.equal(displayReusableAnswer("Yes"), "Yes");
});
test("reusable-answer writes canonicalize both checkbox states, retaining normal text and existing validation", () => {
  for (const [input, expected] of [[true,"true"], [false,"false"], ["Ticked","true"], ["Not ticked","false"], ["☐ Unchecked","false"], ["LinkedIn","LinkedIn"], ["Yes","Yes"]]) {
    const parsed = parseReusableAnswer({ question: "Include supplementary material?", answer: input, note: "Keep the original note" });
    assert.notEqual(typeof parsed, "string");
    if (typeof parsed !== "string") { assert.equal(parsed.answer, expected); assert.equal(parsed.note, "Keep the original note"); }
  }
  assert.equal(typeof parseReusableAnswer({ question: "Question", answer: "", note: "" }), "string");
});
test("legacy and canonical reusable answers produce real boolean checkbox actions", () => {
  const field = { id: "box", kind: "checkbox", label: "Include supplementary material", options: [] };
  for (const [answer, expected] of [["Ticked",true],["Not ticked",false],["checked",true],["unchecked",false],["true",true],["false",false],["Yes",true],["No",false]]) {
    const result = extension.resolveField(field, {}, [{ questionKey: extension.normalizeQuestionKey(field.label), answer }]);
    assert.equal(result.value, expected); assert.equal(typeof result.value, "boolean"); assert.equal(result.source, "reusable");
  }
});
test("legacy and canonical states do not create false conflict warnings", () => {
  const target = { id: "new", questionKey: "include material", questionText: "Include material", answer: "false" };
  const old = { ...target, id: "old", answer: "Not ticked", status: "approved" };
  assert.equal(answerWarnings(target, [old])[0].conflict, false);
  assert.equal(answerWarnings({ ...target, answer: "true" }, [old])[0].conflict, true);
});
test("Manager unchecking a previously checked answer is detected and proposed as boolean false", async () => {
  const source = readFileSync("extension/background/apply-runner.js", "utf8");
  const functionBody = (name: string) => {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf("\n/**", start);
    return source.slice(start, end);
  };
  const requests: unknown[] = [];
  const context = vm.createContext({ self: { __qtsApplyAnswers: extension }, workerApiRequest: async (_method: string, _path: string, body: {items: unknown[]}) => {
    requests.push(body); return { success: true, results: body.items.map(() => ({ ok: true })) };
  } });
  const answerText = source.slice(source.indexOf("function answerText("), source.indexOf("// Two values compared"));
  vm.runInContext(answerText + functionBody("submittedAnswers") + "\nasync " + functionBody("proposeCorrections"), context);
  const changed = context.submittedAnswers({ "Include supplementary material": { value: true, source: "reusable" } }, [{ label: "Include supplementary material", value: "Not ticked" }]);
  assert.equal(changed[0].source, "manager"); assert.equal(changed[0].answer, "Not ticked");
  await context.proposeCorrections({ attemptId: "local-fixture" }, changed);
  assert.equal((requests[0] as {items: {answer: unknown}[]}).items[0].answer, false);
});
