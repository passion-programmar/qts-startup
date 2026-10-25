"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { updateGeminiTokenCountModeAction, type PromptActionState } from "@/app/settings/actions";

const initialState: PromptActionState = { error: null, success: null };

const MODES = [
  {
    value: "local",
    label: "Local Count",
    description: "QTS estimates input tokens locally. No CountTokens call; the Gemini tokens column stays empty.",
  },
  {
    value: "gemini",
    label: "Gemini Count",
    description: "Every request is also counted with Google's CountTokens. Both counts are recorded to compare.",
  },
] as const;

export function TokenCountModeForm({ mode }: { mode: "local" | "gemini" }) {
  const [state, formAction, isPending] = useActionState(updateGeminiTokenCountModeAction, initialState);
  return (
    <form action={formAction} className="space-y-3">
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-slate-700">Token counting mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((option) => (
            <label
              className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 bg-white p-3 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/60 has-[:checked]:ring-2 has-[:checked]:ring-indigo-100"
              key={option.value}
            >
              <input
                className="mt-0.5 accent-indigo-600"
                defaultChecked={mode === option.value}
                name="geminiTokenCountMode"
                type="radio"
                value={option.value}
              />
              <span>
                <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {(state.error || state.success) && (
        <p className={`text-xs ${state.error ? "text-rose-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
          {state.error || state.success}
        </p>
      )}
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : "Save mode"}
      </button>
    </form>
  );
}
