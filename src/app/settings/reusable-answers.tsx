"use client";

import { useActionState, useRef, useState } from "react";
import { AlertTriangle, Check, EyeOff, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  deleteReusableAnswerAction,
  dismissQuestionSuggestionAction,
  restoreReusableAnswerVersionAction,
  reviewReusableAnswerAction,
  saveReusableAnswerAction,
  type PromptActionState,
} from "@/app/settings/actions";
import { ActionFeedback } from "@/app/settings/prompt-forms";
import { SettingsCard } from "@/app/settings/settings-card";
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

// A suggestion from applications, filled in to add as a new answer.
export type AnswerDraft = { key: string; questionText: string; answer: string; choices: string[] };

// The review of a list of drafts, shared by all their forms: it stays on the page when a reviewed
// draft leaves the list, so its message does too.
type DraftReview = { action: (formData: FormData) => void; isPending: boolean };

// One reusable answer: its question, answer, and an optional note for ChatGPT. Without an answer
// passed in, it is the form for a new one (filled from a draft when one is passed). With review,
// the answer is a draft waiting for Super Admin: Approve (as edited) or Reject.
export function ReusableAnswerForm({ answer, draft, review }: { answer?: ReusableAnswer; draft?: AnswerDraft; review?: DraftReview }) {
  const [ownState, ownAction, ownPending] = useActionState(saveReusableAnswerAction, initialState);
  const formAction = review?.action ?? ownAction;
  const isPending = review?.isPending ?? ownPending;
  const key = answer?.id ?? draft?.key ?? "new";
  // The choices real forms offered for this question; one click puts it in the answer.
  const [question, setQuestion] = useState(answer?.questionText ?? draft?.questionText ?? "");
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const suggestions = draft?.choices.length
    ? { choices: draft.choices, seenOn: "in applications" }
    : suggestionsFor(question);

  return (
    <div className="space-y-2">
      <form action={formAction} className="space-y-2">
        {answer && <input name="answerId" type="hidden" value={answer.id} />}
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor={`question-${key}`}>
          Question
        </label>
        <input
          className={`${inputClass} h-9`}
          defaultValue={answer?.questionText ?? draft?.questionText ?? ""}
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
          defaultValue={answer?.answer ?? draft?.answer ?? ""}
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
        {!review && <ActionFeedback state={ownState} />}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            disabled={isPending}
            name={review ? "intent" : undefined}
            type="submit"
            value={review ? "approve" : undefined}
          >
            {isPending ? <LoadingIcon className="size-3.5" /> : answer ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
            {isPending ? "Saving..." : review ? "Approve" : answer ? "Save" : "Add answer"}
          </button>
          {review && (
            <button
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-700 disabled:opacity-60"
              disabled={isPending}
              formNoValidate
              name="intent"
              type="submit"
              value="reject"
            >
              <X className="size-3.5" />
              Reject
            </button>
          )}
        </div>
      </form>
      {answer && !review && <DeleteReusableAnswerButton answer={answer} />}
    </div>
  );
}

export type DraftItem = { answer: ReusableAnswer; summary: string; warnings: string[] };

/** Drafts waiting for review; the message after Approve or Reject shows above the list. */
export function DraftReviewList({ drafts }: { drafts: DraftItem[] }) {
  const [state, action, isPending] = useActionState(reviewReusableAnswerAction, initialState);
  return (
    <div className="space-y-3">
      <ActionFeedback state={state} />
      {drafts.length ? (
        drafts.map((draft) => (
          <SettingsCard item key={draft.answer.id} summary={draft.summary} title={draft.answer.questionText}>
            <WarningList warnings={draft.warnings} />
            <ReusableAnswerForm answer={draft.answer} review={{ action, isPending }} />
          </SettingsCard>
        ))
      ) : (
        <p className="text-xs text-slate-400">No drafts waiting.</p>
      )}
    </div>
  );
}

export type VersionItem = { id: string; questionText: string; answer: string; note: string | null; label: string };

/**
 * Earlier approved versions with Restore; the message after Restore shows above them (a restored
 * deleted answer leaves this list for its own card).
 */
export function VersionList({ versions, empty }: { versions: VersionItem[]; empty?: string }) {
  const [state, action, isPending] = useActionState(restoreReusableAnswerVersionAction, initialState);
  return (
    <div className="space-y-2">
      <ActionFeedback state={state} />
      {!versions.length && empty && <p className="text-xs text-slate-400">{empty}</p>}
      {versions.map((version) => (
        <form action={action} className="rounded-lg bg-slate-50 px-3 py-2" key={version.id}>
          <input name="versionId" type="hidden" value={version.id} />
          <p className="text-[11px] text-slate-500">{version.label}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-800">{version.questionText}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-700">{version.answer}</p>
          {version.note && <p className="mt-0.5 text-[11px] text-slate-500">Note: {version.note}</p>}
          <button
            className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-60"
            disabled={isPending}
            type="submit"
          >
            {isPending ? <LoadingIcon className="size-3" /> : <RotateCcw className="size-3" />}
            Restore this version
          </button>
        </form>
      ))}
    </div>
  );
}

export function DeleteReusableAnswerButton({ answer }: { answer: ReusableAnswer }) {
  const [state, formAction, isPending] = useActionState(deleteReusableAnswerAction, initialState);
  return (
    <form action={formAction}>
      <input name="answerId" type="hidden" value={answer.id} />
      <ActionFeedback state={state} />
      <ConfirmButton
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-700 disabled:opacity-60"
        confirmLabel="Delete answer"
        description={<>Delete the reusable answer for “{answer.questionText}”? Apply stops using it for every candidate; ChatGPT answers this question instead.</>}
        disabled={isPending}
        title="Delete this reusable answer?"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Trash2 className="size-3.5" />}
        {isPending ? "Deleting..." : "Delete"}
      </ConfirmButton>
    </form>
  );
}

// What an answer repeats or contradicts: the same or a similar question elsewhere in the library.
export function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="mb-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
      {warnings.map((warning) => (
        <li className="flex gap-1.5" key={warning}>
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{warning}</span>
        </li>
      ))}
    </ul>
  );
}

// "Dismiss": a personal or one-off question stops being suggested.
export function DismissSuggestionButton({ suggestionId }: { suggestionId: string }) {
  const [state, formAction, isPending] = useActionState(dismissQuestionSuggestionAction, initialState);
  return (
    <form action={formAction}>
      <input name="suggestionId" type="hidden" value={suggestionId} />
      <ActionFeedback state={state} />
      <button
        className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <EyeOff className="size-3.5" />}
        {isPending ? "Dismissing..." : "Dismiss"}
      </button>
    </form>
  );
}
