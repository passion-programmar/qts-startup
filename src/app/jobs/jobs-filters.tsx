"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LoadingIcon } from "@/app/components/loading-icon";
import {
  datePresets,
  jobTabs,
  jobsHref,
  type JobTab,
  type JobsQuery,
} from "@/server/jobs/jobs-list-query";

const selectClass = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100";

// Tabs by where each job stands, with their counts, then the candidate and date filters.
// Everything is kept in the page address, so a filtered view can be reloaded or shared.
export function JobsFilters({
  query,
  counts,
  candidates,
  today,
}: {
  query: JobsQuery;
  counts: Record<JobTab, number>;
  candidates: { id: string; name: string; blocked: boolean }[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (changes: Partial<JobsQuery>) =>
    startTransition(() => router.push(jobsHref(query, changes), { scroll: false }));
  const pickedDay = /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : "";
  const filtered = query.candidate !== "all" || query.date !== "all";

  return (
    <div className="mb-3 space-y-3">
      <nav aria-label="Job status" className="flex flex-wrap gap-1.5">
        {jobTabs.map((tab) => {
          const active = tab.key === query.tab;
          const urgent = (tab.key === "needs_action" || tab.key === "failed") && counts[tab.key] > 0;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                active
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
              }`}
              href={jobsHref(query, { tab: tab.key })}
              key={tab.key}
              scroll={false}
            >
              {tab.label}
              <span
                className={`min-w-5 rounded-full px-1.5 text-center text-[11px] ${
                  active ? "bg-white/20 text-white" : urgent ? (tab.key === "failed" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800") : "bg-slate-100 text-slate-500"
                }`}
              >
                {counts[tab.key]}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          Candidate
          <select
            className={selectClass}
            onChange={(event) => open({ candidate: event.target.value })}
            value={query.candidate}
          >
            <option value="all">All candidates</option>
            {/* A candidate not in the list (removed) still shows as chosen until the filter is cleared. */}
            {query.candidate !== "all" && !candidates.some((candidate) => candidate.id === query.candidate) && (
              <option value={query.candidate}>Unknown candidate</option>
            )}
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}{candidate.blocked ? " (blocked)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Date">
          <span className="text-xs font-medium text-slate-600">Date</span>
          {datePresets.map((preset) => (
            <button
              aria-pressed={query.date === preset.key}
              className={`h-8 rounded-lg border px-2.5 text-xs font-medium transition ${
                query.date === preset.key
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600"
              }`}
              key={preset.key}
              onClick={() => open({ date: preset.key })}
              type="button"
            >
              {preset.label}
            </button>
          ))}
          <label className="sr-only" htmlFor="jobs-filter-day">Pick a day</label>
          <input
            className={`${selectClass} ${pickedDay ? "border-indigo-300 bg-indigo-50 text-indigo-700" : ""}`}
            id="jobs-filter-day"
            max={today}
            onChange={(event) => open({ date: event.target.value || "all" })}
            title="Pick a day"
            type="date"
            value={pickedDay}
          />
        </div>

        {filtered && (
          <button
            className="h-8 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:text-indigo-600"
            onClick={() => open({ candidate: "all", date: "all" })}
            type="button"
          >
            Clear filters
          </button>
        )}
        {pending && <LoadingIcon className="size-4 text-indigo-500" />}
      </div>
    </div>
  );
}
