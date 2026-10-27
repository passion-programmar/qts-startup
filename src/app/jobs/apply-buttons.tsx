"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { startTransition, useActionState } from "react";
import { answerApplicationAction, applyAgainAction } from "@/app/jobs/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import { initialRecordState } from "@/app/record-action-state";

// "Submitted successfully?" for an application whose Chrome is gone or that was answered later:
// Yes makes the bid and the job Applied, No marks it Failed.
export function AnswerApplicationButtons({ attemptId, title }: { attemptId: string; title: string }) {
  const [state, action, pending] = useActionState(answerApplicationAction, initialRecordState);
  return (
    <form action={action} className="mt-1">
      <input name="attemptId" type="hidden" value={attemptId} />
      <span className="block text-[10px] font-semibold text-amber-800">Submitted successfully?</span>
      <span className="mt-1 flex gap-1">
        <ConfirmButton
          className="inline-flex h-6 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          confirmLabel="Yes, it was submitted"
          description={<>Create the bid for “{title}” and mark the job Applied?</>}
          disabled={pending}
          onConfirm={() => submitAnswer(action, attemptId, "yes")}
          title="Submitted successfully?"
        >
          {pending ? <LoadingIcon className="size-3" /> : <Check className="size-3" />}
          Yes
        </ConfirmButton>
        <ConfirmButton
          className="inline-flex h-6 items-center gap-1 rounded-md border border-rose-200 px-2 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          confirmLabel="No, mark it Failed"
          description={<>Mark “{title}” as not submitted? You can use Apply again later.</>}
          disabled={pending}
          onConfirm={() => submitAnswer(action, attemptId, "no")}
          title="Not submitted?"
        >
          <X className="size-3" />
          No
        </ConfirmButton>
      </span>
      {(state.error || state.success) && (
        <span className={`mt-1 block text-[10px] ${state.error ? "text-rose-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
          {state.error || state.success}
        </span>
      )}
    </form>
  );
}

function submitAnswer(action: (formData: FormData) => void, attemptId: string, submitted: "yes" | "no") {
  const formData = new FormData();
  formData.set("attemptId", attemptId);
  formData.set("submitted", submitted);
  // Dispatched from the confirmation dialog, outside a form submit, so inside a transition.
  startTransition(() => action(formData));
}

// Offers a Failed, skipped, or twice-returned job to Apply once more, filled from the start.
export function ApplyAgainButton({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(applyAgainAction, initialRecordState);
  return (
    <form action={action} className="mt-1">
      <input name="jobId" type="hidden" value={jobId} />
      <button
        className="inline-flex h-6 items-center gap-1 rounded-md border border-blue-200 px-2 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? <LoadingIcon className="size-3" /> : <RotateCcw className="size-3" />}
        Apply again
      </button>
      {(state.error || state.success) && (
        <span className={`mt-1 block text-[10px] ${state.error ? "text-rose-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
          {state.error || state.success}
        </span>
      )}
    </form>
  );
}
