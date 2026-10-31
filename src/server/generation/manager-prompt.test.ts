import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { composeGenerationPrompt } from "@/server/generation/generation-prompt";
import * as templates from "@/server/pdf/pdf-templates";

const candidate = {
  fullName: "Ana Popescu",
  experience: [{ companyName: "Example Labs" }],
};
const job = {
  jobUrl: "https://example.com/job",
  jobTitle: "Platform Engineer",
  company: "Example Corp",
  location: "",
  employmentType: "",
  workplaceType: "",
  salary: "",
  jobDescription: "Build reliable services.",
};

test("assembles writing instructions, protected contract, and reference data once", () => {
  const prompt = composeGenerationPrompt(
    "Emphasize concise, measurable achievements.",
    job,
    candidate,
  );
  assert.equal(prompt.split(JSON.stringify(candidate)).length - 1, 1);
  assert.equal(prompt.split(JSON.stringify(job)).length - 1, 1);
  assert.match(prompt, /Output shape:/);
  assert.match(prompt, /bodyParagraphs/);
  assert.match(prompt, /Follow the Manager prompt for résumé and cover-letter content/);
  assert.doesNotMatch(prompt, /use only skills supported|saved experience facts only|do not invent or omit experience bullets|Set title from the candidate's professional headline/);
});

// Run the real selector with tagged-SQL I/O stubbed; no database settings are needed or changed.
function selector(rows: Array<Array<Record<string, string>>>) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const testModule = { exports: {} as { getManagerGenerationSetup: (manager: string, selected?: string) => Promise<{ promptId: string; pdfTemplate: string }> } };
  const code = transformSync(readFileSync("src/server/generation/manager-prompt.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, {
    module: testModule, exports: testModule.exports,
    require: (id: string) => {
      if (id === "server-only") return {};
      if (id === "@/server/pdf/pdf-templates") return templates;
      if (id === "@/server/generation/generation-prompt") return { composeGenerationPrompt };
      if (id === "@/lib/db") return { neonSql: async (sql: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: sql.join("?"), values });
        const row = rows.shift();
        assert.ok(row, "unexpected SQL call");
        return row;
      } };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return { calls, setup: testModule.exports.getManagerGenerationSetup };
}

test("explicit Manager prompt selection keeps the selected version and rotating template", async () => {
  const { calls, setup } = selector([[{ id: "selected", prompt_template: "Use concise bullets." }], [{ template: "harvard" }]]);
  const selected = await setup("manager", "selected");
  assert.equal(selected.promptId, "selected");
  assert.equal(selected.pdfTemplate, "harvard");
  assert.deepEqual(calls[0].values, ["selected", "manager"]);
  assert.match(calls[0].sql, /owner_manager_id/);
  assert.match(calls[0].sql, /is_active/);
  assert.match(calls[0].sql, /archived_at is null/);
  assert.equal(calls.length, 2);
});

test("invalid explicit selection fails without default-prompt or template fallback", async () => {
  const { calls, setup } = selector([[]]);
  await assert.rejects(setup("manager", "missing"), { name: "MissingDocumentPromptError" });
  assert.equal(calls.length, 1);
});

test("automatic selection rotates Manager groups and uses the default only when needed", async () => {
  const own = selector([[{ id: "own", prompt_template: "Own preferences" }], [{ template: "minimal" }]]);
  assert.equal((await own.setup("manager")).promptId, "own");
  assert.match(own.calls[0].sql, /prompt_group_id/);
  assert.match(own.calls[0].sql, /asc nulls first/);
  assert.equal(own.calls.length, 2);

  const fallback = selector([[], [{ id: "default", prompt_template: "Default preferences" }], [{ template: "minimal" }]]);
  assert.equal((await fallback.setup("manager")).promptId, "default");
  assert.match(fallback.calls[1].sql, /owner_manager_id is null/);
  assert.match(fallback.calls[1].sql, /is_default/);
});

test("removes legacy context placeholders instead of duplicating injected data", () => {
  const prompt = composeGenerationPrompt(
    [
      "Use an ATS-friendly style.",
      "Candidate profile:",
      "{{candidate_profile}}",
      "Target job:",
      "{{job_description}}",
      "Document requested:",
      "{{document_type}}",
    ].join("\n"),
    job,
    candidate,
  );
  assert.doesNotMatch(prompt, /\{\{(?:candidate_profile|job_description|document_type)\}\}/);
  assert.doesNotMatch(prompt, /Target job:/);
  assert.equal(prompt.split(JSON.stringify(candidate)).length - 1, 1);
  assert.equal(prompt.split(JSON.stringify(job)).length - 1, 1);
});

test("null technical descriptions keep Manager JD-first writing and V2 categorization intact", () => {
  const instructions = "Prioritize the JD, discover complementary technologies, choose professional skill categories dynamically, and write at least eight technical implementation bullets for the latest company.";
  const sparseCandidate = {
    fullName: "Synthetic Engineer",
    email: "engineer@example.com",
    headline: "Senior Python Engineer",
    experience: [{ companyName: "Example Employer", jobTitle: "Senior Python Engineer", startDate: "2024-10", endDate: null, isCurrent: true, description: null }],
    education: [{ institution: "Example University", degree: "BSc", fieldOfStudy: "Computer Engineering", description: null }],
  };
  const prompt = composeGenerationPrompt(instructions, job, sparseCandidate);
  assert.ok(prompt.startsWith(instructions));
  assert.equal(prompt.split(JSON.stringify(sparseCandidate)).length - 1, 1);
  assert.equal(prompt.split(JSON.stringify(job)).length - 1, 1);
  const protectedRules = prompt.slice(instructions.length, prompt.indexOf("Candidate profile:"));
  assert.match(protectedRules, /"skills":/);
  assert.match(protectedRules, /"category":/);
  assert.match(protectedRules, /"items":/);
  assert.doesNotMatch(protectedRules, /resume\.candidate|resume\.sections|only source of candidate facts|flat verified|heading-free|use only skills supported/);
});
