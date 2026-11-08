"use client";

import { useActionState } from "react";
import { saveAiLimitsAction, type PromptActionState } from "@/app/settings/actions";
import { aiModels, type AiLimits, type AiModelLimits } from "@/server/gemini/ai-models";

const initialState: PromptActionState = { error: null, success: null };

const FIELDS: { field: keyof AiModelLimits; label: string; optional?: boolean }[] = [
  { field: "requestsPerMinute", label: "Calls per minute" },
  { field: "requestsPerDay", label: "Calls per day" },
  { field: "inputTokensPerMinute", label: "Tokens per minute" },
  { field: "inputTokensPerDay", label: "Tokens per day", optional: true },
];

export function AiLimitsForm({ limits }: { limits: AiLimits }) {
  const [state, formAction, isPending] = useActionState(saveAiLimitsAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[40rem] text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold" scope="col">Model</th>
              {FIELDS.map(({ field, label }) => (
                <th className="px-3 py-2 font-semibold" key={field} scope="col">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {aiModels.map((model) => (
              <tr key={model.id}>
                <th className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-800" scope="row">{model.label}</th>
                {FIELDS.map(({ field, label, optional }) => (
                  <td className="px-3 py-2" key={field}>
                    <input
                      aria-label={`${model.label}: ${label}`}
                      className="h-9 w-full min-w-24 rounded-lg border border-slate-200 bg-white px-3 text-sm tabular-nums outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      defaultValue={limits[model.id][field] ?? ""}
                      min={1}
                      name={`${model.id}:${field}`}
                      placeholder={optional ? "No limit" : undefined}
                      required={!optional}
                      type="number"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        These apply to each key on each model. Set them safely below the limits measured on the Model test tab. Every attempt counts, including failed ones and Model test calls. Tokens are estimated input tokens.
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
        {isPending ? "Saving limits..." : "Save limits"}
      </button>
    </form>
  );
}
