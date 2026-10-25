import { and, desc, gte, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  geminiApiCallLogs,
  geminiKeyBusyLeases,
  geminiKeyUsageEvents,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  getGeminiApiKeyHash,
  getGeminiApiKeys,
  getGeminiApiLimits,
  removeOldGeminiApiCallLogs,
} from "@/lib/gemini-usage";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { GeminiApiLimitsForm } from "./limits-form";
import { TokenComparisonForm } from "./token-comparison-form";
import { TokenCountModeForm } from "./token-count-mode-form";
import { PacificClock } from "./pacific-clock";
import { getGeminiTokenCountMode } from "@/server/gemini/token-count-mode";

export const instant = false;

type GeminiUsageTab = "limits" | "responses";

const GEMINI_USAGE_TABS: { id: GeminiUsageTab; label: string; description: string }[] = [
  { id: "limits", label: "Usage limits & key status", description: "Per-key limits and each key's current usage." },
  { id: "responses", label: "Google responses & calibration", description: "Today's Google API responses and token calibration." },
];

export default async function GeminiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const currentUser = await requireUser();
  if (currentUser.role !== "super_admin") redirect("/");
  // Old Google response records (3+ Pacific days ago) are cleaned up only when a Super Admin visits.
  await removeOldGeminiApiCallLogs();
  // Sub tabs are links (?tab=responses), so each tab is server-rendered and can be bookmarked.
  const activeTab: GeminiUsageTab = (await searchParams).tab === "responses" ? "responses" : "limits";
  const tokenCountMode = activeTab === "responses" ? await getGeminiTokenCountMode() : "local";

  const keys = getGeminiApiKeys();
  const limits = await getGeminiApiLimits();
  const keyHashes = keys.map(getGeminiApiKeyHash);
  const pacificDayStart = sql`
    date_trunc('day', now() at time zone 'America/Los_Angeles')
      at time zone 'America/Los_Angeles'
  `;
  // Each tab loads only the data it shows.
  const usageRows = keyHashes.length && activeTab === "limits"
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
  const recentApiCalls = keyHashes.length && activeTab === "responses"
    ? await db
        .select({
          id: geminiApiCallLogs.id,
          keyHash: geminiApiCallLogs.keyHash,
          operation: geminiApiCallLogs.operation,
          status: geminiApiCallLogs.status,
          httpStatus: geminiApiCallLogs.httpStatus,
          responseBody: geminiApiCallLogs.responseBody,
          responseTruncated: geminiApiCallLogs.responseTruncated,
          errorMessage: geminiApiCallLogs.errorMessage,
          durationMs: geminiApiCallLogs.durationMs,
          localInputTokens: geminiApiCallLogs.localInputTokens,
          geminiInputTokens: geminiApiCallLogs.geminiInputTokens,
          startedAt: geminiApiCallLogs.startedAt,
        })
        .from(geminiApiCallLogs)
        .where(
          and(
            inArray(geminiApiCallLogs.keyHash, keyHashes),
            gte(geminiApiCallLogs.startedAt, pacificDayStart),
          ),
        )
        .orderBy(desc(geminiApiCallLogs.startedAt))
        .limit(100)
    : [];
  const keyNumberByHash = new Map(keyHashes.map((hash, index) => [hash, index + 1]));
  const busyRows = keyHashes.length && activeTab === "limits"
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
        <PageHeader
          actions={
            <>
              <Link className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50" href={`/settings/gemini-usage?tab=${activeTab}`}>
                Refresh
              </Link>
              <Link className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50" href="/settings">
                Settings
              </Link>
            </>
          }
          description="Configure per-key limits, check key status, and review Google API responses."
          eyebrow="Administration"
          title="Gemini usage"
        />

        {/* Stays under the fixed workspace header (60px below 640px, 64px above) while the page scrolls. */}
        <div className="sticky top-[60px] z-30 -mx-1 mb-4 flex flex-col gap-3 bg-surface/95 px-1 py-2 backdrop-blur sm:top-16 sm:flex-row sm:items-stretch">
        <PacificClock />
        <nav aria-label="Gemini usage sections" className="flex min-w-0 flex-1 flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1">
          {GEMINI_USAGE_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`min-w-0 flex-1 rounded-lg px-4 py-2.5 text-left transition sm:min-w-[14rem] ${
                  active
                    ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                }`}
                href={`/settings/gemini-usage?tab=${tab.id}`}
                key={tab.id}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className={`mt-0.5 block text-xs ${active ? "text-slate-500" : "text-slate-400"}`}>
                  {tab.description}
                </span>
              </Link>
            );
          })}
        </nav>
        </div>

        {activeTab === "limits" ? (
        <>
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Per-key usage limits</h2>
          <GeminiApiLimitsForm
            inputTokensPerMinute={limits.inputTokensPerMinute}
            requestsPerDay={limits.requestsPerDay}
            requestsPerMinute={limits.requestsPerMinute}
          />
        </section>

        <h2 className="mb-3 text-sm font-semibold text-slate-800">Key status</h2>
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
                    <div className="font-semibold">Request {index + 1}</div>
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
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
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
        </>
        ) : (
        <>
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <TokenCountModeForm mode={tokenCountMode} />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-800">
              Google API responses today
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Latest 100 requests today, in Pacific time. Records from three or more days ago are removed when a Super Admin opens this page. Response bodies are capped at 1 MB; prompts and API keys are not stored.
            </p>
          </div>
          <PaginatedTable
            columns={[
              { label: "No", className: "w-[5%]" },
              { label: "Time (Pacific)", className: "w-[15%]" },
              { label: "API key", className: "w-[11%]" },
              { label: "Operation", className: "w-[12%]" },
              { label: "Result", className: "w-[14%]" },
              { label: "Local tokens", className: "w-[9%]" },
              { label: "Gemini tokens", className: "w-[11%]" },
              { label: "Duration", className: "w-[8%]" },
              { label: "Google response / error", className: "w-[15%]" },
            ]}
            emptyMessage={keys.length ? "No Google API requests recorded today." : "Configure a Gemini API key to see responses."}
            rows={recentApiCalls.map((call, index) => {
              const responseText = call.responseBody ?? call.errorMessage ??
                "No response body or error message was recorded.";
              const statusLabel = call.status === "http_success"
                ? `HTTP ${call.httpStatus} · success`
                : call.status === "http_error"
                  ? `HTTP ${call.httpStatus} · provider error`
                  : call.status === "network_error"
                    ? "No HTTP response · network error"
                    : "Request pending";
              return {
                id: call.id,
                cells: [
                  <span className="text-xs text-slate-500" key="number">{index + 1}</span>,
                  <span key="time">
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeZone: "America/Los_Angeles",
                    }).format(call.startedAt)},{" "}
                    <strong className="font-semibold text-slate-900">
                      {new Intl.DateTimeFormat("en-US", {
                        timeStyle: "medium",
                        timeZone: "America/Los_Angeles",
                      }).format(call.startedAt)}
                    </strong>
                  </span>,
                  <span className="font-mono text-xs" key="key">
                    Key {keyNumberByHash.get(call.keyHash) ?? "?"} · {call.keyHash.slice(0, 10)}
                  </span>,
                  call.operation === "count_tokens" ? "CountTokens" : "GenerateContent",
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      call.status === "http_success"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700"
                    }`}
                    key="result"
                  >
                    {statusLabel}
                  </span>,
                  <TokenCount key="local-tokens" value={call.localInputTokens} />,
                  <TokenCount
                    compareTo={call.localInputTokens}
                    key="gemini-tokens"
                    value={call.geminiInputTokens}
                  />,
                  call.durationMs === null ? "—" : `${call.durationMs.toLocaleString()} ms`,
                  <details className="max-w-full" key="response">
                    <summary className="cursor-pointer text-xs font-medium text-indigo-700">
                      View response details
                    </summary>
                    {call.responseTruncated ? (
                      <p className="mt-2 text-xs text-amber-700">
                        Response was truncated after 1 MB.
                      </p>
                    ) : null}
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
                      {responseText}
                    </pre>
                  </details>,
                ],
              };
            })}
          />
        </section>
        {process.env.VERCEL === "1" &&
        process.env.VERCEL_ENV === "production" &&
        process.env.ENABLE_GEMINI_TOKEN_COMPARISON === "true" ? (
          <TokenComparisonForm />
        ) : (
          <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
            <h2 className="text-sm font-semibold text-slate-800">Gemini token calibration</h2>
            <p className="mt-1 text-xs text-slate-500">
              Available on the production deployment when <code>ENABLE_GEMINI_TOKEN_COMPARISON=true</code> is set in Vercel.
            </p>
          </section>
        )}
        </>
        )}
      </div>
    </main>
    </WorkspaceShell>
  );
}

// A token count, with the local estimate's difference from Google's count when both exist.
function TokenCount({ value, compareTo }: { value: number | null; compareTo?: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">—</span>;
  const difference = compareTo != null && value > 0 ? Math.round(((compareTo - value) / value) * 100) : null;
  return (
    <span className="text-xs">
      {value.toLocaleString()}
      {difference !== null ? (
        <span
          className={`mt-0.5 block ${Math.abs(difference) <= 25 ? "text-emerald-700" : "text-amber-700"}`}
          title="Local estimate compared with Google's count"
        >
          local {difference > 0 ? "+" : ""}{difference}%
        </span>
      ) : null}
    </span>
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
