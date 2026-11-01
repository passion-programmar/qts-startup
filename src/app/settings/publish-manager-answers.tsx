"use client";
import { useActionState } from "react";
import { publishManagerAnswer } from "./publish-manager-answer-action";
export function PublishManagerAnswers({ rows }: { rows: { id: string; questionText: string; answer: string; manager: string | null }[] }) {
  const [state, action, pending] = useActionState(publishManagerAnswer, { message: "" });
  return <details className="mt-6 text-xs">
    <summary className="cursor-pointer font-semibold">Manager reusable answers · publish globally ({rows.length})</summary>
    {state.message && <p role="status" className="my-2">{state.message}</p>}
    {rows.map((row) => <form action={action} key={row.id} className="mt-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="id" value={row.id} />
      <p className="font-semibold">{row.questionText}</p><p className="my-1 whitespace-pre-wrap">{row.answer}</p><p className="text-slate-500">{row.manager}</p>
      <button disabled={pending} className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-white">Publish globally</button>
    </form>)}
  </details>;
}
