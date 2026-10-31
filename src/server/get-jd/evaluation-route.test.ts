import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const original = "Build Python services using FastAPI.\nPreserve PostgreSQL, requirements, benefits and Unicode: São Paulo.";
const fixture = { calls: 0, saves: [] as Array<{ description: string }>, prompts: [] as string[], remote: true };
(globalThis as Record<string, unknown>).__qtsEvaluationFixture = fixture;
let POST: (request: Request) => Promise<Response>;
test.before(async () => {
  const mocks: Record<string, string> = {
    "server-only": "",
    "@/lib/extension-auth": `export const getExtensionManager=async()=>({id:'local-manager'});`,
    "@/lib/db": `export const db={select:(fields)=>{const rows=fields.promptTemplate?[{promptTemplate:'KEEP MANAGER MATCHING INSTRUCTIONS'}]:[{id:'candidate',firstName:'Test',lastName:'Candidate',category:null,jdMatching:'Python backend engineering',currentEmployer:'Different Employer'}];const q={};for(const key of ['from','innerJoin','leftJoin','where','orderBy'])q[key]=()=>q;q.limit=async()=>rows;return q;},execute:()=>{throw Error('No duplicate lookup allowed after precheck')}};`,
    "@/server/get-jd/precheck-ticket": `export const getPrecheckTickets=()=>({verify:async(token)=>token==='valid'?{jobUrl:'https://example.test/jobs/1',jobTitle:'Engineer',company:'Example'}:null});`,
    "@/server/get-jd/get-jd-page-checks": `export const withPageCheck=async(a,b,c,evaluate)=>evaluate();`,
    "@/server/database/database-usage": `export const scheduleDailyCleanup=()=>{};`,
    "@/server/jobs/get-jd-mode": `export const getGetJdMatchingMode=async()=> 'gemini';`,
    "@/server/gemini/token-count-mode": `export const getGeminiTokenCountMode=async()=> 'local';`,
    "@/lib/gemini-usage": `export const geminiModel='local';export const getGeminiApiKeys=()=>['synthetic'];export const getGeminiApiLimits=async()=>({});export const requestGeminiApi=async(key,kind,url,options)=>{const f=globalThis.__qtsEvaluationFixture;f.calls++;f.prompts.push(JSON.parse(options.body).contents[0].parts[0].text);return {ok:true,body:JSON.stringify({text:JSON.stringify({isJobPage:true,isRemote:f.remote,matchingProfileIndexes:[0],job:{title:'Engineer',company:'Example',description:'GEMINI REWRITE MUST NOT BE SAVED',location:'Remote',employmentType:'Full-time',workplaceType:'Remote',salary:'',jobUrl:'https://example.test/jobs/1',reason:'Remote eligible.'}})})}};`,
    "@/server/gemini/gemini-keys": `export const withAvailableGeminiKey=async(keys,contents,config,mode,limits,request)=>request({apiKey:'synthetic',tokenCounts:{}});export const readGeminiText=data=>data.text;export const readGeminiErrorMessage=()=>'';`,
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
const request = (extra = {}) => new Request("http://localhost/api/extension/get-jd", { method: "POST", body: JSON.stringify({
  pageUrl: "https://example.test/jobs/1", pageTitle: "Engineer", precheckToken: "valid", originalDescription: original, ...extra,
}) });
test("Gemini matching preserves its prompt/notes and saves the complete original JD without a final lookup", async () => {
  fixture.saves = []; fixture.calls = 0;
  const response = await POST(request()); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.autoSavedProfileIds.length, 1);
  assert.equal(fixture.calls, 1); assert.equal(fixture.saves[0].description, original);
  assert.equal(body.classification.job.description, original);
  assert.match(fixture.prompts.at(-1) || "", /KEEP MANAGER MATCHING INSTRUCTIONS/);
  assert.match(fixture.prompts.at(-1) || "", /Python backend engineering/);
  assert.match(fixture.prompts.at(-1) || "", /São Paulo/);
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
