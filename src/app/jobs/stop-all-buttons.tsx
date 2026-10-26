"use client";

import { useActionState } from "react";
import { stopAllAction } from "@/app/jobs/actions";
import { ConfirmButton } from "@/app/components/confirm-button";
import { LoadingIcon } from "@/app/components/loading-icon";
import { initialRecordState } from "@/app/record-action-state";

// "Stop all" stops Generation or Apply in every Chrome of this Manager.
function StopAllButton({ mode, label }: { mode: "generation" | "apply"; label: string }) {
  const [state, action, pending] = useActionState(stopAllAction, initialRecordState);
  const message = state.error ?? state.success;
  return (
    <form action={action} className="flex items-center gap-2">
      <input name="mode" type="hidden" value={mode} />
      <ConfirmButton
        className="inline-flex h-8 items-center rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
        confirmLabel={label}
        description={mode === "generation"
          ? "Generation stops in every Chrome of yours; jobs being generated go back to the queue."
          : "Apply stops in every Chrome of yours; applications not yet submitted go back to the list. A Submit already sent is not undone."}
        disabled={pending}
        title={`${label} in every Chrome?`}
      >
        {pending && <LoadingIcon className="mr-1 size-3.5" />}
        {label}
      </ConfirmButton>
      {message && (
        <span className={`max-w-xs text-[11px] ${state.error ? "text-rose-700" : "text-slate-500"}`} role="status">
          {message}
        </span>
      )}
    </form>
  );
}

export function StopAllButtons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StopAllButton label="Stop all Generation" mode="generation" />
      <StopAllButton label="Stop all Apply" mode="apply" />
    </div>
  );
}
