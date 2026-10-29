"use client";

import { useActionState } from "react";
import { Send, Undo2 } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  proposeReusableAnswerAction,
  withdrawReusableAnswerProposalAction,
  type ProposalState,
} from "@/app/profile/answer-actions";

const initialState: ProposalState = { error: null, success: null };

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

function Feedback({ state }: { state: ProposalState }) {
  return (
    <>
      {state.error && (
        <p aria-live="polite" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700" role="status">
          {state.success}
        </p>
      )}
      {state.warnings && state.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {state.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </>
  );
}

// A Manager's proposal for the shared library: a question every candidate may meet and its answer.
// Super Admin reviews it before Apply uses it.
export function ProposeAnswerForm() {
  const [state, formAction, isPending] = useActionState(proposeReusableAnswerAction, initialState);
  return (
    <form action={formAction} className="space-y-2">
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor="proposal-question">Question</label>
      <input className={`${inputClass} h-9`} id="proposal-question" maxLength={300} name="question" placeholder="How did you hear about us?" required />
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor="proposal-answer">Answer</label>
      <textarea className={`${inputClass} min-h-16 resize-y py-2`} id="proposal-answer" maxLength={4000} name="answer" placeholder="LinkedIn job post" required rows={2} />
      <label className="block text-[11px] font-semibold text-slate-600" htmlFor="proposal-note">Note for the AI (optional)</label>
      <input className={`${inputClass} h-9`} id="proposal-note" maxLength={500} name="note" placeholder="If the choices do not include it, pick the closest one." />
      <Feedback state={state} />
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Send className="size-3.5" />}
        {isPending ? "Sending..." : "Propose answer"}
      </button>
    </form>
  );
}

export type Proposal = { id: string; questionText: string; answer: string; status: "draft" | "rejected" };

/**
 * The Manager's proposals waiting or rejected. The message after Withdraw shows above the list,
 * which stays when the withdrawn proposal leaves it.
 */
export function ProposalList({ proposals }: { proposals: Proposal[] }) {
  const [state, formAction, isPending] = useActionState(withdrawReusableAnswerProposalAction, initialState);
  return (
    <div className="space-y-2">
      <Feedback state={state} />
      {proposals.length ? (
        <ul className="space-y-2">
          {proposals.map((row) => (
            <li className="rounded-lg border border-slate-200 px-3 py-2" key={row.id}>
              <p className="text-xs font-semibold text-slate-800">{row.questionText}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">{row.answer}</p>
              <form action={formAction} className="mt-1.5 flex items-center gap-2">
                <input name="answerId" type="hidden" value={row.id} />
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.status === "draft" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
                  {row.status === "draft" ? "Waiting for review" : "Rejected"}
                </span>
                {row.status === "draft" && (
                  <button
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                    disabled={isPending}
                    type="submit"
                  >
                    {isPending ? <LoadingIcon className="size-3" /> : <Undo2 className="size-3" />}
                    Withdraw
                  </button>
                )}
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">No proposals waiting or rejected.</p>
      )}
    </div>
  );
}
