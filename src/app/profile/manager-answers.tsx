"use client";
import { useActionState } from "react";
import { manageAnswer } from "./manager-answer-actions";
import identity from "../../../extension/shared/answer-identity.js";

type Row = { id: string; version: string; contextKey: string; questionText: string; answer: string; scope: string; canReuse: boolean; candidateId: string | null; candidateName: string | null; variants: { answer: string; kind: string; questionText?: string; identity?: {key: string}; normalVariation?: {questionText?: string; kind: string; answer: string} }[] };
export function ManagerAnswers({ rows }: { rows: Row[] }) {
  const [state, action, pending] = useActionState(manageAnswer, { message: "" });
  const duplicates = new Set(identity.duplicateGroups(rows).flat().map((row) => row.id));
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">Save changes explicitly. Application-specific answers take priority over candidate answers, then your shared answers. Personal facts stay with the candidate. Shared answers apply only to your candidates; no global answers override them.</p>
    {state.message && <p role="status" className="rounded-lg bg-slate-50 p-3 text-xs">{state.message}</p>}
    {[...rows, null].map((row) => <form action={action} key={row?.id ?? "new"} className="space-y-2 rounded-xl border border-slate-200 p-3">
      {row && <input type="hidden" name="id" value={row.id} />}
      {row && <input type="hidden" name="version" value={row.version} />}
      <p className="text-xs font-semibold">{row ? row.scope === "candidate" ? `This candidate · ${row.candidateName || "Candidate"}` : row.scope === "manager" ? "My reusable answers" : `Context uncertain · this application · ${row.candidateName || "Candidate"}` : "Add a reusable answer"}</p>
      {row && duplicates.has(row.id) && <p className="text-xs text-amber-700">Equivalent questions exist in this scope. Review their answers and explicitly edit or delete them. QTS has kept every record separate.</p>}
      <label className="block text-xs">Question<input aria-label="Question" name="question" required maxLength={300} defaultValue={row?.questionText} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="block text-xs">Answer<textarea aria-label="Answer" name="answer" required maxLength={4000} defaultValue={row?.answer} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      {!!row?.variants.length && <details className="text-xs"><summary>Saved wording variants ({row.variants.length})</summary>{row.variants.map((variant, index) => <div key={index}><p>{(variant.normalVariation || variant).questionText || row.questionText} ({(variant.normalVariation || variant).kind}): {(variant.normalVariation || variant).answer}</p><button name="action" value={`variation-delete:${index}`} disabled={pending} formNoValidate className="text-rose-600">Remove this variation</button></div>)}</details>}
      <div className="flex flex-wrap gap-2 text-xs">
        <button disabled={pending} name="action" value="save" className="rounded-lg bg-indigo-600 px-3 py-2 text-white">Save</button>
        {row?.canReuse && <button disabled={pending} name="action" value="move" className="rounded-lg border px-3 py-2">Move to my reusable answers</button>}
        {row && <button disabled={pending} name="action" value="delete" formNoValidate className="rounded-lg border px-3 py-2 text-rose-600">Delete</button>}
      </div>
    </form>)}
  </div>;
}
