"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  deleteReusableAnswerAction,
  saveReusableAnswerAction,
  type PromptActionState,
} from "@/app/settings/actions";
import { ActionFeedback } from "@/app/settings/prompt-forms";
import { suggestionsFor } from "@/lib/answer-suggestions";

const initialState: PromptActionState = { error: null, success: null };

export type ReusableAnswer = {
  id: string;
  questionText: string;
  answer: string;
  note: string | null;
};

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";

// One reusable answer: its question, answer, and an optional note for ChatGPT. Without an answer
// passed in, it is the form for a new one.
export function ReusableAnswerForm({ answer }: { answer?: ReusableAnswer }) {
  const [state, formAction, isPending] = useActionState(saveReusableAnswerAction, initialState);
  const [deleteState, deleteAction, isDeleting] = useActionState(deleteReusableAnswerAction, initialState);
  const key = answer?.id ?? "new";
  // The choices real forms offered for this question; one click puts it in the answer.
  const [question, setQuestion] = useState(answer?.questionText ?? "");
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = suggestionsFor(question);

  return (
    <div className="space-y-2">
      <form action={formAction} className="space-y-2">
        {answer && <input name="answerId" type="hidden" value={answer.id} />}
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`question-${key}`}>
          Question
        </label>
        <input
          className={`${inputClass} h-9`}
          defaultValue={answer?.questionText ?? ""}
          id={`question-${key}`}
          maxLength={300}
          name="question"
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="How did you hear about us?"
          required
        />
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`answer-${key}`}>
          Answer
        </label>
        <textarea
          className={`${inputClass} min-h-16 resize-y py-2`}
          defaultValue={answer?.answer ?? ""}
          id={`answer-${key}`}
          maxLength={4000}
          name="answer"
          placeholder="LinkedIn job post"
          ref={answerRef}
          required
          rows={2}
        />
        {suggestions && (
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-500">
              Choices seen on forms ({suggestions.seenOn}). Click one to use it:
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.choices.map((choice) => (
                <button
                  className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-50"
                  key={choice}
                  onClick={() => {
                    if (answerRef.current) answerRef.current.value = choice;
                  }}
                  type="button"
                >
                  {choice}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`note-${key}`}>
          Note for ChatGPT (optional)
        </label>
        <input
          className={`${inputClass} h-9`}
          defaultValue={answer?.note ?? ""}
          id={`note-${key}`}
          maxLength={500}
          name="note"
          placeholder="If the choices do not include it, pick the closest one."
        />
        <ActionFeedback state={state} />
        <button
          className="inline-flex h-8 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? <LoadingIcon className="size-3.5" /> : answer ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
          {isPending ? "Saving..." : answer ? "Save" : "Add answer"}
        </button>
      </form>
      {answer && (
        <form action={deleteAction}>
          <input name="answerId" type="hidden" value={answer.id} />
          <ActionFeedback state={deleteState} />
          <ConfirmButton
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-700 disabled:opacity-60"
            confirmLabel="Delete answer"
            description={<>Delete the reusable answer for “{answer.questionText}”? Apply stops using it for every candidate; ChatGPT answers this question instead.</>}
            disabled={isDeleting}
            title="Delete this reusable answer?"
          >
            {isDeleting ? <LoadingIcon className="size-3.5" /> : <Trash2 className="size-3.5" />}
            {isDeleting ? "Deleting..." : "Delete"}
          </ConfirmButton>
        </form>
      )}
    </div>
  );
}
