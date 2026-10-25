"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { updateJobRecordTimeZoneAction, type PromptActionState } from "@/app/settings/actions";
import { jobRecordTimeZoneOptions } from "@/server/jobs/job-record-time-zones";

const initialState: PromptActionState = { error: null, success: null };

export function JobRecordTimeZoneForm({ timeZone }: { timeZone: string }) {
  const [state, formAction, isPending] = useActionState(updateJobRecordTimeZoneAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="block min-w-0 sm:w-80">
        <span className="mb-1.5 block text-xs font-semibold text-slate-700">Country or time zone</span>
        <select
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          defaultValue={timeZone}
          name="jobRecordTimeZone"
        >
          {jobRecordTimeZoneOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.value})
            </option>
          ))}
        </select>
      </label>
      <button
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={isPending}
        type="submit"
      >
        {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
        {isPending ? "Saving..." : "Save time zone"}
      </button>
      {(state.error || state.success) && (
        <p className={`text-xs sm:self-center ${state.error ? "text-rose-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
          {state.error || state.success}
        </p>
      )}
    </form>
  );
}
