"use client";
import { useActionState } from "react";
import { manageAnswer } from "./manager-answer-actions";

type Row = { id: string; questionText: string; answer: string; scope: string; canReuse: boolean; candidateId: string | null; candidateName: string | null; variants: { answer: string; kind: string }[] };
export function ManagerAnswers({ rows }: { rows: Row[] }) {
  const [state, action, pending] = useActionState(manageAnswer, { message: "" });
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">Check saves corrections automatically. Candidate facts stay personal; uncertain answers stay with their application until you move them. Global answers take priority over your shared answers.</p>
    {state.message && <p role="status" className="rounded-lg bg-slate-50 p-3 text-xs">{state.message}</p>}
    {[...rows, null].map((row) => <form action={action} key={row?.id ?? "new"} className="space-y-2 rounded-xl border border-slate-200 p-3">
      {row && <input type="hidden" name="id" value={row.id} />}
      <p className="text-xs font-semibold">{row ? row.scope === "candidate" ? `This candidate · ${row.candidateName || "Candidate"}` : row.scope === "manager" ? "My reusable answers" : `Context uncertain · this application · ${row.candidateName || "Candidate"}` : "Add a reusable answer"}</p>
      <label className="block text-xs">Question<input aria-label="Question" name="question" required maxLength={300} defaultValue={row?.questionText} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      <label className="block text-xs">Answer<textarea aria-label="Answer" name="answer" required maxLength={4000} defaultValue={row?.answer} className="mt-1 w-full rounded-lg border border-slate-200 p-2" /></label>
      {!!row?.variants.length && <details className="text-xs"><summary>Saved wording variants ({row.variants.length})</summary>{row.variants.map((variant, index) => <p key={index}>{variant.kind}: {variant.answer}</p>)}</details>}
      <div className="flex flex-wrap gap-2 text-xs">
        <button disabled={pending} name="action" value="save" className="rounded-lg bg-indigo-600 px-3 py-2 text-white">Save</button>
        {row?.canReuse && <button disabled={pending} name="action" value="move" className="rounded-lg border px-3 py-2">Move to my reusable answers</button>}
        {row && <button disabled={pending} name="action" value="delete" formNoValidate className="rounded-lg border px-3 py-2 text-rose-600">Delete</button>}
      </div>
    </form>)}
  </div>;
}
