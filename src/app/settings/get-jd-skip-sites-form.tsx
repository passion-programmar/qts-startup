"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { LoadingIcon } from "@/app/components/loading-icon";
import { updateGetJdSkipSitesAction, type PromptActionState } from "@/app/settings/actions";

const initialState: PromptActionState = { error: null, success: null };

export function GetJdSkipSitesForm({ sites }: { sites: string[] }) {
  const [state, formAction, isPending] = useActionState(updateGetJdSkipSitesAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="block min-w-0">
        <span className="mb-1.5 block text-xs font-semibold text-slate-700">One site per line</span>
        <textarea
          className="block h-72 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-5 text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          defaultValue={sites.join("\n")}
          name="skipSites"
          spellCheck={false}
        />
        <span className="mt-1.5 block text-xs text-slate-500">
          A site is its exact address, such as youtube.com. Add a path to skip only part of a site, such as linkedin.com/feed.
          Other subdomains are separate sites, so careers.example.com is not skipped by example.com.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? <LoadingIcon className="size-3.5" /> : <Check className="size-3.5" />}
          {isPending ? "Saving..." : "Save sites"}
        </button>
        {(state.error || state.success) && (
          <p className={`text-xs ${state.error ? "text-rose-700" : "text-emerald-700"}`} role={state.error ? "alert" : "status"}>
            {state.error || state.success}
          </p>
        )}
      </div>
    </form>
  );
}
