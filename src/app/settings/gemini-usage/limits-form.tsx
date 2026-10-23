"use client";

import { useActionState } from "react";
import {
  saveGeminiApiLimitsAction,
  type PromptActionState,
} from "@/app/settings/actions";

const initialState: PromptActionState = { error: null, success: null };

export function GeminiApiLimitsForm({
  requestsPerMinute,
  requestsPerDay,
  inputTokensPerMinute,
}: {
  requestsPerMinute: number;
  requestsPerDay: number;
  inputTokensPerMinute: number;
}) {
  const [state, formAction, isPending] = useActionState(
    saveGeminiApiLimitsAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <LimitInput
          id="gemini-requests-per-minute"
          label="Requests per rolling minute"
          max={1_000}
          name="requestsPerMinute"
          value={requestsPerMinute}
        />
        <LimitInput
          id="gemini-requests-per-day"
          label="Requests per Pacific day"
          max={100_000}
          name="requestsPerDay"
          value={requestsPerDay}
        />
        <LimitInput
          id="gemini-input-tokens-per-minute"
          label="Generate input tokens per rolling minute"
          max={10_000_000}
          name="inputTokensPerMinute"
          value={inputTokensPerMinute}
        />
      </div>
      <p className="text-xs text-slate-500">
        Request limits count GenerateContent and CountTokens calls per API key.
        The token limit applies to the estimated or counted input reserved for
        GenerateContent. All values must be positive whole numbers.
      </p>
      {state.error || state.success ? (
        <p
          aria-live="polite"
          className={`rounded-lg border px-3 py-2 text-xs ${
            state.error
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
          role={state.error ? "alert" : "status"}
        >
          {state.error ?? state.success}
        </p>
      ) : null}
      <button
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Saving limits..." : "Save Gemini limits"}
      </button>
    </form>
  );
}

function LimitInput({
  id,
  label,
  max,
  name,
  value,
}: {
  id: string;
  label: string;
  max: number;
  name: string;
  value: number;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold text-slate-700" htmlFor={id}>
        {label}
      </label>
      <input
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
        id={id}
        max={max}
        min={1}
        name={name}
        required
        type="number"
        defaultValue={value}
      />
    </div>
  );
}
