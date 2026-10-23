import { and, desc, gte, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { geminiKeyBusyLeases, geminiKeyUsageEvents } from "@/db/schema";
import { db } from "@/lib/db";
import {
  getGeminiApiKeyHash,
  getGeminiApiKeys,
  getGeminiApiLimits,
} from "@/lib/gemini-usage";
import { requireUser } from "@/lib/session";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { GeminiApiLimitsForm } from "./limits-form";
import {
  GeminiUsageClearHistoryForm,
  GeminiUsageEventDeleteForm,
} from "./history-actions";
import { TokenComparisonForm } from "./token-comparison-form";

export const instant = false;

export default async function GeminiUsagePage() {
  const currentUser = await requireUser();
  if (currentUser.role !== "super_admin") redirect("/");

  const keys = getGeminiApiKeys();
  const limits = await getGeminiApiLimits();
  const keyHashes = keys.map(getGeminiApiKeyHash);
  const pacificDayStart = sql`
    date_trunc('day', now() at time zone 'America/Los_Angeles')
      at time zone 'America/Los_Angeles'
  `;
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
          dayGenerateCalls: sql<number>`
            (count(*) filter (where ${geminiKeyUsageEvents.operation} = 'generate_content'))::integer
          `.mapWith(Number),
          dayCountTokenCalls: sql<number>`
            (count(*) filter (where ${geminiKeyUsageEvents.operation} = 'count_tokens'))::integer
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
              pacificDayStart,
            ),
          ),
        )
        .groupBy(geminiKeyUsageEvents.keyHash)
    : [];
  const usageByKey = new Map(usageRows.map((row) => [row.keyHash, row]));
  const recentEvents = keyHashes.length
    ? await db
        .select({
          id: geminiKeyUsageEvents.id,
          keyHash: geminiKeyUsageEvents.keyHash,
          operation: geminiKeyUsageEvents.operation,
          inputTokens: geminiKeyUsageEvents.inputTokens,
          occurredAt: geminiKeyUsageEvents.occurredAt,
        })
        .from(geminiKeyUsageEvents)
        .where(
          and(
            inArray(geminiKeyUsageEvents.keyHash, keyHashes),
            gte(geminiKeyUsageEvents.occurredAt, pacificDayStart),
            isNull(geminiKeyUsageEvents.deletedAt),
          ),
        )
        .orderBy(desc(geminiKeyUsageEvents.occurredAt))
        .limit(100)
    : [];
  const keyNumberByHash = new Map(keyHashes.map((hash, index) => [hash, index + 1]));
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
              Gemini API usage
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Monitor recorded API calls and configure per-key request and input-token limits.
            </p>
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

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Per-key usage limits</h2>
          <GeminiApiLimitsForm
            inputTokensPerMinute={limits.inputTokensPerMinute}
            requestsPerDay={limits.requestsPerDay}
            requestsPerMinute={limits.requestsPerMinute}
          />
        </section>

        {keys.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No Gemini API keys are configured on the server.
          </section>
        ) : (
          <PaginatedTable
            columns={[
              { label: "API key", className: "w-[14%]" },
              { label: "Requests / rolling min", className: "w-[17%]" },
              { label: "Requests / Pacific day", className: "w-[17%]" },
              { label: "Calls today", className: "w-[16%]" },
              { label: "Generate input / rolling min", className: "w-[20%]" },
              { label: "Status", className: "w-[9%]" },
              { label: "Last request", className: "w-[14%]" },
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
                minuteRequests >= limits.requestsPerMinute ||
                minuteInputTokens >= limits.inputTokensPerMinute ||
                dayRequests >= limits.requestsPerDay;

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
                    limit={limits.requestsPerMinute}
                  />,
                  <UsageMetric
                    key="day-requests"
                    used={dayRequests}
                    limit={limits.requestsPerDay}
                  />,
                  <div className="text-xs" key="api-operations">
                    <div>Generate: {usage?.dayGenerateCalls ?? 0}</div>
                    <div className="mt-1 text-slate-500">CountTokens: {usage?.dayCountTokenCalls ?? 0}</div>
                  </div>,
                  <UsageMetric
                    key="minute-tokens"
                    used={minuteInputTokens}
                    limit={limits.inputTokensPerMinute}
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
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Recorded API calls today</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Newest 100 visible records in Pacific time. Removing a record hides it but retains quota accounting.
                </p>
              </div>
              <GeminiUsageClearHistoryForm />
            </div>
          </div>
          <PaginatedTable
            columns={[
              { label: "Time (Pacific)", className: "w-[28%]" },
              { label: "API key", className: "w-[20%]" },
              { label: "Operation", className: "w-[25%]" },
              { label: "Input tokens", className: "w-[27%]" },
              { label: "Manage", className: "w-[12%]" },
            ]}
            emptyMessage={keys.length ? "No Gemini API calls recorded today." : "Configure a Gemini API key to see usage."}
            rows={recentEvents.map((event) => ({
              id: event.id,
              cells: [
                new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "medium",
                  timeZone: "America/Los_Angeles",
                }).format(event.occurredAt),
                <span className="font-mono text-xs" key="key">
                  Key {keyNumberByHash.get(event.keyHash) ?? "?"} · {event.keyHash.slice(0, 10)}
                </span>,
                event.operation === "count_tokens" ? "CountTokens" : "GenerateContent",
                event.operation === "count_tokens" && event.inputTokens === 0
                  ? "—"
                  : event.inputTokens.toLocaleString(),
                <GeminiUsageEventDeleteForm eventId={event.id} key="manage" />,
              ],
            }))}
          />
        </section>
        {process.env.VERCEL === "1" &&
        process.env.VERCEL_ENV === "production" &&
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
