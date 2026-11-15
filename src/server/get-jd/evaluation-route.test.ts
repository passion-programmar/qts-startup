import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const original = "Build Python services using FastAPI.\nPreserve PostgreSQL, requirements, benefits and Unicode: São Paulo.";
const fixture: { sent?: unknown; candidateFields?: string[]; duplicate?: boolean; afterChecks: Array<Record<string, string>>; calls: number; saves: Array<{ description: string }>; prompts: string[]; remote: boolean; jobPage: boolean; job: Record<string, string>; failure: null | (() => Error) } = { afterChecks: [], calls: 0, saves: [], prompts: [], remote: true, jobPage: true, job: {}, failure: null };
(globalThis as Record<string, unknown>).__qtsEvaluationFixture = fixture;
let POST: (request: Request) => Promise<Response>;
test.before(async () => {
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/extension-auth": `export const getExtensionManager=async()=>({id:'local-manager'});`,
    "@/lib/db": `export const db={select:(fields)=>{const rows=fields.promptTemplate?[{promptTemplate:'KEEP MANAGER MATCHING INSTRUCTIONS'}]:[{id:'candidate',firstName:'Test',lastName:'Candidate',category:null,country:'Romania',employmentTimeline:[{jobTitle:'Python Backend Engineer',companyName:'Acme',location:null,start:'2021-03',end:null,isCurrent:true,description:'Built APIs.'}],education:[{institution:'State University',degree:'BSc',fieldOfStudy:'Computer Science',start:'2015-09',end:'2019-06',isCurrent:false}],currentEmployer:'Different Employer'}].map((row)=>{globalThis.__qtsEvaluationFixture.candidateFields=Object.keys(fields);return row;});const q={};for(const key of ['from','innerJoin','leftJoin','where','orderBy'])q[key]=()=>q;q.limit=async()=>rows;return q;},execute:async()=>({rows:[{skip:globalThis.__qtsEvaluationFixture.duplicate===true}]})};`,
    "@/server/get-jd/global-precheck": `export const globalJobPrecheckQuery=(identity)=>{globalThis.__qtsEvaluationFixture.afterChecks.push(identity);return 'SQL'};`,
    "@/server/get-jd/precheck-ticket": `export const getPrecheckTickets=()=>({verify:async(token)=>token==='valid'?{jobUrl:'https://example.test/jobs/1',jobTitle:'Engineer',company:'Example'}:null});`,
    "@/server/get-jd/get-jd-page-checks": `export const withPageCheck=async(a,b,c,evaluate)=>{globalThis.__qtsEvaluationFixture.sent=c;return evaluate()};`,
    "@/server/database/database-usage": `export const scheduleDailyCleanup=()=>{};`,
    "@/server/jobs/get-jd-mode": `export const getGetJdMatchingMode=async()=> 'gemini';`,
    "@/server/gemini/ai-job": `export class AiJobError extends Error{constructor(code,message,retryAt=null){super(message);this.code=code;this.retryAt=retryAt}};export const aiRequestBudgetMs=55000;globalThis.__AiJobError=AiJobError;`,
    "@/server/gemini/ai-request": `export const runAiRequest=async({contents,parse})=>{const f=globalThis.__qtsEvaluationFixture;f.calls++;f.prompts.push(contents[0].parts[0].text);if(f.failure)throw f.failure();const job={title:'Engineer',company:'Example',description:'GEMINI REWRITE MUST NOT BE SAVED',location:'Remote',employmentType:'Full-time',workplaceType:'Remote',salary:'',reason:'Remote eligible.'};return parse(JSON.stringify({isJobPage:f.jobPage,isRemote:f.remote,matchingProfileIndexes:f.jobPage?[0]:[],job:{...job,...f.job}}));};`,
    "@/server/jobs/get-jd-jobs": `export {getJdAccountState,summarizeAccountStates} from '@/server/jobs/get-jd-account-states';export const insertGetJdJob=async(job)=>{globalThis.__qtsEvaluationFixture.saves.push(job);return {status:'saved',jobId:'local-job'}};`,
  };
  const bundled = await build({ absWorkingDir: process.cwd(), tsconfig: resolve("tsconfig.json"),
    entryPoints: [resolve("src/app/api/extension/get-jd/route.ts")], bundle: true, write: false,
    platform: "node", format: "cjs", packages: "external", plugins: [{ name: "local-evaluation-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "local-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "local-fixture" }, ({ path }) => ({ contents: mocks[path], resolveDir: process.cwd() }));
    } }],
  });
  const loaded = { exports: {} as { POST: typeof POST } };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(resolve("package.json")), loaded, loaded.exports);
  POST = loaded.exports.POST;
});
const aiError = (code: string, message: string, retryAt?: number) =>
  new (globalThis as unknown as { __AiJobError: new (code: string, message: string, retryAt?: number) => Error }).__AiJobError(code, message, retryAt);
const request = (extra = {}) => new Request("http://localhost/api/extension/get-jd", { method: "POST", body: JSON.stringify({
  pageUrl: "https://example.test/jobs/1", pageTitle: "Engineer", precheckToken: "valid", originalDescription: original, ...extra,
}) });
test("Gemini matching keeps the saved prompt, sends the career timeline, and saves the complete original JD without a final lookup", async () => {
  fixture.saves = []; fixture.calls = 0;
  const response = await POST(request()); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.autoSavedProfileIds.length, 1);
  assert.equal(fixture.calls, 1); assert.equal(fixture.saves[0].description, original);
  assert.equal(body.classification.job.description, original);
  assert.match(fixture.prompts.at(-1) || "", /KEEP MANAGER MATCHING INSTRUCTIONS/);
  assert.match(fixture.prompts.at(-1) || "", /"employmentTimeline":\[\{"jobTitle":"Python Backend Engineer","companyName":"Acme","location":null,"start":"2021-03","end":null,"isCurrent":true,"description":"Built APIs\."\}\]\}\]/);
  // Education is not sent.
  assert.doesNotMatch(fixture.prompts.at(-1) || "", /education|State University/);
  assert.equal(fixture.candidateFields?.includes("education"), false);
  assert.equal(fixture.candidateFields?.includes("employmentTimeline"), true);
  assert.doesNotMatch(fixture.prompts.at(-1) || "", /"jdMatching"/);
  // Candidates are sent by index, country and experience, never by name.
  assert.match(fixture.prompts.at(-1) || "", /"candidates":\[\{"candidateIndex":0,"country":"Romania","employmentTimeline"/);
  assert.equal(fixture.candidateFields?.includes("country"), true);
  assert.doesNotMatch(fixture.prompts.at(-1) || "", /candidateName|Test Candidate/);
  assert.match(fixture.prompts.at(-1) || "", /São Paulo/);
  // Gemini named the job as the extension did, so Jobs/Bids are not asked again.
  assert.equal(fixture.afterChecks.length, 0);
});
test("Gemini gets only the JD and the candidates: no page URL or page title", async () => {
  fixture.prompts = [];
  const response = await POST(request({ pageTitle: undefined }));
  assert.equal(response.status, 200);
  const prompt = fixture.prompts.at(-1) || "";
  assert.match(prompt, /Input data \(JSON\):\n\{"visiblePageText":"Build Python services/);
  assert.doesNotMatch(prompt, /pageUrl|pageTitle|example\.test/);
});
test("the job is saved under Gemini's title and company, after Jobs/Bids are checked with them", async () => {
  fixture.saves = []; fixture.afterChecks = []; fixture.job = { title: "Staff Engineer", company: "Gemini Read Co" };
  const response = await POST(request()); const body = await response.json();
  fixture.job = {};
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.afterChecks, [{ jobUrl: "https://example.test/jobs/1", jobTitle: "Staff Engineer", company: "Gemini Read Co" }]);
  const saved = fixture.saves[0] as unknown as { jobTitle: string; company: string; jobUrl: string };
  assert.equal(saved.jobTitle, "Staff Engineer");
  assert.equal(saved.company, "Gemini Read Co");
  assert.equal(saved.jobUrl, "https://example.test/jobs/1");
  assert.equal(body.classification.job.title, "Staff Engineer");
});
test("a job Jobs/Bids already have under Gemini's title and company is skipped, and nothing is saved", async () => {
  fixture.saves = []; fixture.duplicate = true; fixture.job = { title: "Staff Engineer", company: "Gemini Read Co" };
  const response = await POST(request()); const body = await response.json();
  fixture.duplicate = false; fixture.job = {};
  assert.equal(response.status, 200);
  assert.equal(body.alreadyInQts, true);
  assert.equal(body.expiredApplication, true);
  assert.equal(body.message, "This job already exists in QTS Jobs or Bids. Skipped.");
  assert.equal(fixture.saves.length, 0);
});
test("when Gemini leaves the title or company empty, the extension's value is used and only the URL counts", async () => {
  fixture.saves = []; fixture.afterChecks = []; fixture.job = { title: "", company: "  " };
  const response = await POST(request()); await response.json();
  fixture.job = {};
  const saved = fixture.saves[0] as unknown as { jobTitle: string; company: string };
  assert.equal(saved.jobTitle, "Engineer");
  assert.equal(saved.company, "Example");
  assert.equal(fixture.afterChecks.length, 0);
});
test("the page check is keyed on the checked title, company and JD, so an edited job is checked again", async () => {
  fixture.sent = undefined;
  await POST(request());
  assert.deepEqual(fixture.sent, ["Engineer", "Example", original]);
});
test("an answer without a job description is accepted and the original JD is saved", async () => {
  fixture.saves = []; fixture.job = { description: undefined as unknown as string };
  const response = await POST(request()); const body = await response.json();
  fixture.job = {};
  assert.equal(response.status, 200);
  assert.equal(body.autoSavedProfileIds.length, 1);
  assert.equal(fixture.saves[0].description, original);
});
test("an answer without jobUrl is accepted and the result keeps the real page URL", async () => {
  fixture.saves = [];
  const response = await POST(request()); const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.classification.job.jobUrl, "https://example.test/jobs/1");
  assert.equal((fixture.saves[0] as unknown as { jobUrl: string }).jobUrl, "https://example.test/jobs/1");
});
test("an invalid page with an empty reason is reported as not a job, and nothing is saved", async () => {
  fixture.jobPage = false; fixture.remote = false; fixture.job = { reason: "" }; fixture.saves = [];
  const response = await POST(request()); const body = await response.json();
  fixture.jobPage = true; fixture.remote = true; fixture.job = {};
  assert.equal(response.status, 200);
  assert.match(body.message, /^Not a valid job page: The page does not show one clear, active job posting\.$/);
  assert.equal(fixture.saves.length, 0);
});
test("a real job with an empty reason is still an unusable answer", async () => {
  fixture.job = { reason: "  " }; fixture.saves = [];
  const response = await POST(request()); const body = await response.json();
  fixture.job = {};
  assert.equal(response.status, 502);
  assert.equal(body.diagnosticCode, "gemini_invalid_job_field");
  assert.equal(fixture.saves.length, 0);
});
test("missing/invalid precheck or missing/oversized original JD never reaches Gemini", async () => {
  for (const extra of [{ precheckToken: "" }, { precheckToken: "invalid" }, { originalDescription: "" }, { originalDescription: "x".repeat(100001) }]) {
    fixture.calls = 0; fixture.saves = []; const response = await POST(request(extra));
    assert.ok([400,409].includes(response.status)); assert.equal(fixture.calls, 0); assert.equal(fixture.saves.length, 0);
  }
});
test("existing remote eligibility rejection still prevents saving", async () => {
  fixture.remote = false; fixture.saves = [];
  const response = await POST(request()); const body = await response.json(); fixture.remote = true;
  assert.equal(body.classification.isRemote, false); assert.equal(fixture.saves.length, 0);
});
test("when the AI providers are busy, the extension is told to retry by itself and nothing is saved", async () => {
  fixture.saves = [];
  fixture.failure = () => aiError("ai_busy", "Busy.");
  const response = await POST(request()); const body = await response.json();
  fixture.failure = null;
  assert.equal(response.status, 503);
  assert.deepEqual(body.autoRetry, { kind: "soon" });
  assert.equal(body.diagnosticCode, "ai_busy");
  assert.equal(fixture.saves.length, 0);
});
test("a used-up quota tells the extension when to retry", async () => {
  fixture.failure = () => aiError("ai_quota_used_up", "Used up.", 123456);
  const response = await POST(request()); const body = await response.json();
  fixture.failure = null;
  assert.equal(response.status, 429);
  assert.deepEqual(body.autoRetry, { kind: "at", at: 123456 });
});
test("a page too long or a refused request gets a reason and no automatic retry", async () => {
  for (const [code, status] of [["ai_too_large", 413], ["ai_bad_request", 422]] as const) {
    fixture.failure = () => aiError(code, "Reason.");
    const response = await POST(request()); const body = await response.json();
    fixture.failure = null;
    assert.equal(response.status, status);
    assert.equal(body.autoRetry, undefined);
    assert.equal(body.message, "Reason.");
  }
});
