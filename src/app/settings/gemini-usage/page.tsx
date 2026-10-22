import { and, gte, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { geminiKeyBusyLeases, geminiKeyUsageEvents } from "@/db/schema";
import { db } from "@/lib/db";
import {
  geminiApiLimits,
  getGeminiApiKeyHash,
  getGeminiApiKeys,
} from "@/lib/gemini-usage";
import { requireUser } from "@/lib/session";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { TokenComparisonForm } from "./token-comparison-form";

export const instant = false;

export default async function GeminiUsagePage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "super_admin") redirect("/");

  const keys = getGeminiApiKeys();
  const keyHashes = keys.map(getGeminiApiKeyHash);
  const usageRows = keyHashes.length
    ? await db
        .select({
          keyHash: geminiKeyUsageEvents.keyHash,
          minuteRequests: sql<number>`
            (count(*) filter (
              where ${geminiKeyUsageEvents.occurredAt} > now() - interval '1 minute'
            ))::integer
          `.mapWith(Number),
          minuteInputTokens: sql<number>`
            (coalesce(sum(${geminiKeyUsageEvents.inputTokens}) filter (
              where ${geminiKeyUsageEvents.occurredAt} > now() - interval '1 minute'
            ), 0))::integer
          `.mapWith(Number),
          dayRequests: sql<number>`
            count(*)::integer
          `.mapWith(Number),
          updatedAt: sql<Date>`max(${geminiKeyUsageEvents.occurredAt})`
            .mapWith(Date),
        })
        .from(geminiKeyUsageEvents)
        .where(
          and(
            inArray(geminiKeyUsageEvents.keyHash, keyHashes),
            gte(
              geminiKeyUsageEvents.occurredAt,
              sql`date_trunc('day', now() at time zone 'America/Los_Angeles')
                at time zone 'America/Los_Angeles'`,
            ),
          ),
        )
        .groupBy(geminiKeyUsageEvents.keyHash)
    : [];
  const usageByKey = new Map(usageRows.map((row) => [row.keyHash, row]));
  const busyRows = keyHashes.length
    ? await db
        .select({ keyHash: geminiKeyBusyLeases.keyHash })
        .from(geminiKeyBusyLeases)
        .where(
          and(
            inArray(geminiKeyBusyLeases.keyHash, keyHashes),
            gte(geminiKeyBusyLeases.expiresAt, sql`now()`),
          ),
        )
    : [];
  const busyKeys = new Set(busyRows.map((row) => row.keyHash));

  return (
    <WorkspaceShell activeHref="/settings/gemini-usage" user={currentUser}>
    <main className="py-1 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            </h1>
          </div>
          <div className="flex gap-2">
            <Link className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" href="/settings/gemini-usage">
              Refresh
            </Link>
            <Link className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" href="/settings">
              Settings
            </Link>
          </div>
        </header>

        {keys.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No Gemini API keys are configured on the server.
          </section>
        ) : (
          <PaginatedTable
            columns={[
              { label: "API key", className: "w-[17%]" },
              { label: "Requests / 60 sec", className: "w-[17%]" },
              { label: "Requests today", className: "w-[16%]" },
              { label: "Estimated input / 60 sec", className: "w-[20%]" },
              { label: "Status", className: "w-[14%]" },
              { label: "Last call", className: "w-[16%]" },
            ]}
            emptyMessage="No API keys configured"
            rows={keys.map((_key, index) => {
              const hash = keyHashes[index];
              const usage = usageByKey.get(hash);
              const isBusy = busyKeys.has(hash);
              const minuteRequests = usage?.minuteRequests ?? 0;
              const minuteInputTokens = usage?.minuteInputTokens ?? 0;
              const dayRequests = usage?.dayRequests ?? 0;
              const isLimited =
                minuteRequests >= geminiApiLimits.requestsPerMinute ||
                minuteInputTokens >= geminiApiLimits.inputTokensPerMinute ||
                dayRequests >= geminiApiLimits.requestsPerDay;

              return {
                id: hash,
                cells: [
                  <div key="key">
                    <div className="font-semibold">Key {index + 1}</div>
                    <div className="mt-1 font-mono text-xs text-slate-500">
                      {hash.slice(0, 10)}
                    </div>
                  </div>,
                  <UsageMetric
                    key="minute-requests"
                    used={minuteRequests}
                    limit={geminiApiLimits.requestsPerMinute}
                  />,
                  <UsageMetric
                    key="day-requests"
                    used={dayRequests}
                    limit={geminiApiLimits.requestsPerDay}
                  />,
                  <UsageMetric
                    key="minute-tokens"
                    used={minuteInputTokens}
                    limit={geminiApiLimits.inputTokensPerMinute}
                  />,
                  <span
                    className={`inline-flex rounded px-2 py-1 text-xs font-medium ${
                      isBusy
                        ? "bg-amber-50 text-amber-700"
                        : isLimited
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                    key="status"
                  >
                    {isBusy ? "Busy" : isLimited ? "Limit reached" : "Available"}
                  </span>,
                  usage
                    ? new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(usage.updatedAt))
                    : "—",
                ],
              };
            })}
          />
        )}
        {process.env.VERCEL === "1" &&
        process.env.VERCEL_ENV === "preview" &&
        process.env.ENABLE_GEMINI_TOKEN_COMPARISON === "true" ? (
          <TokenComparisonForm />
        ) : null}
      </div>
    </main>
    </WorkspaceShell>
  );
}

function UsageMetric({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const remaining = Math.max(0, limit - used);
  const progress = Math.min(100, (used / limit) * 100);
  return (
    <div className="min-w-0">
      <div className="font-semibold tabular-nums text-slate-800">
        {used.toLocaleString()}{" "}
        <span className="text-xs font-normal text-slate-500">
          / {limit.toLocaleString()}
        </span>
      </div>
      <div
        aria-label={`${used.toLocaleString()} of ${limit.toLocaleString()}`}
        aria-valuemax={limit}
        aria-valuemin={0}
        aria-valuenow={used}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-slate-500">{remaining.toLocaleString()} left</div>
    </div>
  );
}
