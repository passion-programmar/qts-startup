"use client";

import { useActionState, type FormEvent } from "react";
import {
  clearGeminiUsageHistoryAction,
  deleteGeminiUsageEventAction,
  type PromptActionState,
} from "@/app/settings/actions";

const initialState: PromptActionState = { error: null, success: null };

export function GeminiUsageEventDeleteForm({ eventId }: { eventId: string }) {
  const [state, formAction, isPending] = useActionState(
    deleteGeminiUsageEventAction,
    initialState,
  );

  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("Remove this call from the visible usage history? Its quota accounting will be retained.")) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={confirmDelete}>
      <input name="eventId" type="hidden" value={eventId} />
      <button
        className="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Removing..." : "Remove"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

export function GeminiUsageClearHistoryForm() {
  const [state, formAction, isPending] = useActionState(
    clearGeminiUsageHistoryAction,
    initialState,
  );

  function confirmClear(event: FormEvent<HTMLFormElement>) {
    if (!window.confirm("Remove all visible Gemini usage history records? Quota accounting will be retained.")) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={confirmClear}>
      <input name="confirmClearAll" type="hidden" value="true" />
      <button
        className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Clearing..." : "Remove all history"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function ActionFeedback({ state }: { state: PromptActionState }) {
  if (!state.error && !state.success) return null;
  return (
    <span
      aria-live="polite"
      className={`mt-1 block text-[10px] ${
        state.error ? "text-rose-700" : "text-emerald-700"
      }`}
      role={state.error ? "alert" : "status"}
    >
      {state.error ?? state.success}
    </span>
  );
}
