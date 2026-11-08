"use client";
import { useActionState, useMemo, useState } from "react";
import { manageAnswer } from "./manager-answer-actions";
import { dismissUnansweredQuestion } from "./unanswered-actions";
import identity from "../../../extension/shared/answer-identity.js";
import meaning from "../../../extension/shared/answer-meaning.js";

type Variant = { answer: string; kind: string; questionText?: string; identity?: { key: string }; normalVariation?: { questionText?: string; kind: string; answer: string } };
type Row = { id: string; version: string; contextKey: string; questionText: string; answer: string; scope: string; canReuse: boolean; candidateId: string | null; candidateName: string | null; variants: Variant[] };

// Every reusable answer lives here (decision 2026-11-07): Apply finds them by meaning, whatever a site's
// wording. Nothing is preset: these are only the questions sites ask most, shown empty until answered.
const STARTER: [string, string][] = [
  ["salary", "Salary expectations"], ["languageLevels", "Language levels"], ["notice", "Notice period"],
  ["startDate", "When can you start?"], ["remote", "Are you willing to work remotely?"],
  ["office", "Are you willing to work hybrid or in the office?"], ["relocation", "Are you open to relocation?"],
  ["travel", "Are you willing to travel?"], ["sponsorship", "Will you now or in the future require visa sponsorship?"],
  ["workAuthorization", "Are you legally authorized to work in this country?"], ["source", "How did you hear about us?"],
  ["contractType", "Preferred contract type (B2B or employment)"], ["workload", "Full-time or part-time?"],
  ["nonCompete", "Are you subject to a non-compete agreement?"], ["relatives", "Do you have relatives working at the company?"],
  ["futureConsent", "Do you consent to us keeping your data for future job opportunities?"],
];
const LEVELS: Record<string, string> = { manager: "All my candidates", candidate: "This candidate", application: "This job" };
const LANGUAGE_LEVELS = ["Native", "C2", "C1", "B2", "B1", "A2", "A1"];
const topicOf = (question: string) => meaning.topicOf(question)?.id ?? null;

type Unanswered = { id: string; questionText: string; kind: string; options: string[]; timesSeen: number };

export function ManagerAnswers({ rows, unanswered = [] }: { rows: Row[]; unanswered?: Unanswered[] }) {
  const duplicates = new Set(identity.duplicateGroups(rows).flat().map((row) => row.id));
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [candidate, setCandidate] = useState("all");
  const [preset, setPreset] = useState({ question: "", key: 0 });
  const candidates = useMemo(() => [...new Map(rows.filter((row) => row.candidateId).map((row) => [row.candidateId as string, row.candidateName || "Candidate"])).entries()], [rows]);
  const answered = new Set(rows.filter((row) => row.scope === "manager").map((row) => topicOf(row.questionText)).filter(Boolean));
  const empty = STARTER.filter(([topic]) => !answered.has(topic));
  const shown = rows.filter((row) => (level === "all" || row.scope === level)
    && (candidate === "all" || row.candidateId === candidate || (candidate !== "all" && row.scope === "manager" && level === "all"))
    && (!search.trim() || `${row.questionText} ${row.answer} ${row.variants.map((variant) => variant.questionText || "").join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())));
  // One group per meaning; inside it, all candidates first, then each candidate's and each job's own answer.
  const groups = new Map<string, Row[]>();
  for (const row of shown) {
    const title = meaning.topicOf(row.questionText)?.title || "Other questions";
    groups.set(title, [...(groups.get(title) || []), row]);
  }
  const order = { manager: 0, candidate: 1, application: 2 } as Record<string, number>;
  const languageRow = rows.find((row) => row.scope === "manager" && topicOf(row.questionText) === "languageLevels") || null;
  const salaryRow = rows.find((row) => row.scope === "manager" && topicOf(row.questionText) === "salary") || null;

  return <div className="space-y-4">
    <p className="text-xs text-slate-500">Every reusable answer is kept here and used by Apply on any site, matched by meaning. The profile comes first (it is never changed by applying); then this job&apos;s answer, then this candidate&apos;s, then yours for all candidates. Saving from the Apply panel adds answers here too.</p>

    <div className="grid gap-3 lg:grid-cols-2">
      <LanguageLevelsForm row={languageRow} />
      <SalaryForm row={salaryRow} />
    </div>

    {unanswered.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <p className="text-xs font-semibold text-amber-900">Needs answer ({unanswered.length})</p>
      <p className="mt-1 text-xs text-amber-800">Required questions Apply met that no saved answer or profile fact answered, most frequent first. Answer one once; every later application fills it.</p>
      <ul className="mt-2 space-y-2">
        {unanswered.map((item) => <UnansweredItem key={item.id} item={item} onAnswer={(question) => setPreset({ question, key: Date.now() })} />)}
      </ul>
    </div>}

    {empty.length > 0 && <div className="rounded-xl border border-dashed border-slate-300 p-3">
      <p className="text-xs font-semibold text-slate-700">Common questions without an answer for all candidates ({empty.length})</p>
      <p className="mt-1 text-xs text-slate-500">Sites ask these most. Click one to answer it once; every later application fills it.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {empty.map(([topic, question]) => <button key={topic} type="button" onClick={() => setPreset({ question, key: Date.now() })}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">{question}</button>)}
      </div>
    </div>}

    {/* The add form first, so a new answer and its result are always in view. */}
    <AnswerForm key={`new-${preset.key}`} row={null} duplicate={false} presetQuestion={preset.question} />

    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input aria-label="Search answers" placeholder="Search questions, answers, wordings…" value={search} onChange={(event) => setSearch(event.target.value)}
        className="min-w-56 flex-1 rounded-lg border border-slate-200 p-2" />
      <select aria-label="Level" value={level} onChange={(event) => setLevel(event.target.value)} className="rounded-lg border border-slate-200 p-2">
        <option value="all">All levels</option>
        {Object.entries(LEVELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {candidates.length > 0 && <select aria-label="Candidate" value={candidate} onChange={(event) => setCandidate(event.target.value)} className="rounded-lg border border-slate-200 p-2">
        <option value="all">All candidates</option>
        {candidates.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>}
      <span className="text-slate-500">{shown.length} of {rows.length} answers</span>
    </div>

    {[...groups.entries()].sort(([a], [b]) => (a === "Other questions" ? 1 : b === "Other questions" ? -1 : a.localeCompare(b))).map(([title, list]) => <section key={title} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title} <span className="font-normal normal-case">({list.length})</span></h3>
      {[...list].sort((a, b) => (order[a.scope] ?? 3) - (order[b.scope] ?? 3)).map((row) => <AnswerForm key={row.id} row={row} duplicate={duplicates.has(row.id)} />)}
    </section>)}
    {!shown.length && rows.length > 0 && <p className="text-xs text-slate-500">No answers match these filters.</p>}
  </div>;
}

function UnansweredItem({ item, onAnswer }: { item: Unanswered; onAnswer: (question: string) => void }) {
  const [state, action, pending] = useActionState(dismissUnansweredQuestion, { message: "" });
  return <li className="rounded-lg border border-amber-100 bg-white p-2 text-xs">
    <p className="font-medium text-slate-800">{item.questionText}</p>
    <p className="text-slate-500">Seen {item.timesSeen}×{item.options.length ? ` · choices: ${item.options.slice(0, 6).join(" / ")}${item.options.length > 6 ? " …" : ""}` : ""}</p>
    <form action={action} className="mt-1 flex flex-wrap gap-2">
      <input type="hidden" name="id" value={item.id} />
      <button type="button" onClick={() => onAnswer(item.questionText)} className="rounded-lg bg-indigo-600 px-3 py-1 text-white">Answer</button>
      <button disabled={pending} className="rounded-lg border px-3 py-1 text-slate-600">Dismiss</button>
      {state.message && <span role="status" className="self-center text-slate-500">{state.message}</span>}
    </form>
  </li>;
}

function AnswerForm({ row, duplicate, presetQuestion = "" }: { row: Row | null; duplicate: boolean; presetQuestion?: string }) {
  // Each form keeps its own result, shown under its own buttons.
  const [state, action, pending] = useActionState(manageAnswer, { message: "" });
  const saved = /^(Saved|Deleted|Moved)/.test(state.message);
  const wordings = row?.variants.map((variant, index) => ({ variant: variant.normalVariation || variant, index })) || [];
  return <form action={action} className="space-y-2 rounded-xl border border-slate-200 p-3">
      {row && <input type="hidden" name="id" value={row.id} />}
      {row && <input type="hidden" name="version" value={row.version} />}
      <p className="text-xs font-semibold">{row ? row.scope === "candidate" ? `This candidate · ${row.candidateName || "Candidate"}` : row.scope === "manager" ? "All my candidates" : `This job · ${row.candidateName || "Candidate"}` : "Add an answer for all my candidates"}</p>
      {duplicate && <p className="text-xs text-amber-700">Equivalent questions exist at this level. Review their answers and edit or delete them; QTS keeps each one separate.</p>}
      <label className="block text-xs">Question<input aria-label="Question" name="question" required maxLength={300} defaultValue={row?.questionText ?? presetQuestion} autoFocus={Boolean(presetQuestion)} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="block text-xs">Answer<textarea aria-label="Answer" name="answer" required maxLength={4000} defaultValue={row?.answer} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      {wordings.length > 0 && <details className="text-xs"><summary>Wordings and box variants ({wordings.length})</summary>{wordings.map(({ variant, index }) => <div key={index} className="mt-1 flex flex-wrap items-center gap-2"><span>{variant.questionText || row?.questionText} ({variant.kind}): {variant.answer}</span><button name="action" value={`variation-delete:${index}`} disabled={pending} formNoValidate className="text-rose-600">Remove</button></div>)}</details>}
      <div className="flex flex-wrap gap-2 text-xs">
        <button disabled={pending} name="action" value="save" className="rounded-lg bg-indigo-600 px-3 py-2 text-white">Save</button>
        {row?.canReuse && <button disabled={pending} name="action" value="move" className="rounded-lg border px-3 py-2">Move to all my candidates</button>}
        {row && <button disabled={pending} name="action" value="delete" formNoValidate className="rounded-lg border px-3 py-2 text-rose-600">Delete</button>}
      </div>
      {state.message && <p role="status" className={`rounded-lg p-2 text-xs ${saved ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{state.message}</p>}
    </form>;
}

/** Language levels for all candidates, saved as one answer ("English: Native; Other languages: A1"). */
function LanguageLevelsForm({ row }: { row: Row | null }) {
  const [state, action, pending] = useActionState(manageAnswer, { message: "" });
  const current = meaning.parseLanguageLevels(row?.answer || "");
  const codeOf = (rank: number | undefined) => (rank ? ["A1", "A2", "B1", "B2", "C1", "C2", "Native"][rank - 1] : "");
  const [english, setEnglish] = useState(codeOf(current.English));
  const [others, setOthers] = useState(codeOf(current["*"]));
  const extra = Object.entries(current).filter(([name]) => !["English", "*"].includes(name)).map(([name, rank]) => `${name}: ${codeOf(rank)}`);
  const answer = [english && `English: ${english}`, ...extra, others && `Other languages: ${others}`].filter(Boolean).join("; ");
  return <form action={action} className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs">
    {row && <input type="hidden" name="id" value={row.id} />}
    {row && <input type="hidden" name="version" value={row.version} />}
    <input type="hidden" name="question" value={row?.questionText || "Language levels"} />
    <input type="hidden" name="answer" value={answer} />
    <p className="font-semibold">Language levels · All my candidates</p>
    <p className="text-slate-500">Used for every language question (level lists, &quot;Do you speak … fluently?&quot;, native speaker). Native is chosen when a site offers it, otherwise the highest level. A level on a candidate&apos;s profile wins.</p>
    <div className="flex flex-wrap gap-3">
      <label>English <select value={english} onChange={(event) => setEnglish(event.target.value)} className="ml-1 rounded-lg border border-slate-200 p-1"><option value="">—</option>{LANGUAGE_LEVELS.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Other languages <select value={others} onChange={(event) => setOthers(event.target.value)} className="ml-1 rounded-lg border border-slate-200 p-1"><option value="">—</option>{LANGUAGE_LEVELS.map((value) => <option key={value}>{value}</option>)}</select></label>
    </div>
    {extra.length > 0 && <p className="text-slate-500">Also saved: {extra.join(", ")}</p>}
    <button disabled={pending || !answer} name="action" value="save" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">Save language levels</button>
    {state.message && <p role="status" className={`rounded-lg p-2 ${/^Saved/.test(state.message) ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{state.message}</p>}
  </form>;
}

/** The salary expectation for all candidates, saved as one line ("5000 EUR monthly B2B gross"); Apply converts it. */
function SalaryForm({ row }: { row: Row | null }) {
  const [state, action, pending] = useActionState(manageAnswer, { message: "" });
  const text = row?.answer || "";
  const [amount, setAmount] = useState(text.replace(/(\d)[,\s](?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/)?.[0] || "");
  const [currency, setCurrency] = useState(text.match(/\b(EUR|USD|GBP|PLN|CHF|SEK|NOK|DKK|CZK|RON|HUF|CAD|AUD)\b/i)?.[1]?.toUpperCase() || "EUR");
  const [period, setPeriod] = useState(text.match(/\b(hourly|daily|monthly|yearly)\b/i)?.[1]?.toLowerCase() || "monthly");
  const [contract, setContract] = useState(/\bemployment\b/i.test(text) ? "employment" : "B2B");
  const [basis, setBasis] = useState(/\bnet\b/i.test(text) ? "net" : "gross");
  const answer = amount ? `${amount} ${currency} ${period} ${contract} ${basis}` : "";
  return <form action={action} className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs">
    {row && <input type="hidden" name="id" value={row.id} />}
    {row && <input type="hidden" name="version" value={row.version} />}
    <input type="hidden" name="question" value={row?.questionText || "Salary expectations"} />
    <input type="hidden" name="answer" value={answer} />
    <p className="font-semibold">Salary expectation · All my candidates</p>
    <p className="text-slate-500">One figure; Apply converts it to each site&apos;s currency and period (rate and date shown in the panel). A candidate&apos;s or job&apos;s own salary answer wins.</p>
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} className="w-24 rounded-lg border border-slate-200 p-1" placeholder="5000" />
      <select aria-label="Currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className="rounded-lg border border-slate-200 p-1">{["EUR", "USD", "GBP", "PLN", "CHF", "SEK", "NOK", "DKK", "CZK", "RON", "HUF", "CAD", "AUD"].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Period" value={period} onChange={(event) => setPeriod(event.target.value)} className="rounded-lg border border-slate-200 p-1">{["hourly", "daily", "monthly", "yearly"].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="Contract" value={contract} onChange={(event) => setContract(event.target.value)} className="rounded-lg border border-slate-200 p-1"><option>B2B</option><option value="employment">Employment</option></select>
      <select aria-label="Gross or net" value={basis} onChange={(event) => setBasis(event.target.value)} className="rounded-lg border border-slate-200 p-1"><option>gross</option><option>net</option></select>
    </div>
    <button disabled={pending || !answer} name="action" value="save" className="rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">Save salary</button>
    {state.message && <p role="status" className={`rounded-lg p-2 ${/^Saved/.test(state.message) ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{state.message}</p>}
  </form>;
}
