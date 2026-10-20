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
    <main className="px-4 py-7 text-slate-900 sm:px-7 sm:py-9">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Gemini API usage
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
          <section aria-label="Gemini key usage" className="grid gap-4 sm:grid-cols-2">
            {keys.map((_key, index) => {
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

              return (
                <article
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
                  key={hash}
                >
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-800">
                        Key {index + 1}
                      </h2>
                      <p className="mt-1 font-mono text-[11px] text-slate-400">
                        Fingerprint {hash.slice(0, 10)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                        isBusy
                          ? "bg-amber-50 text-amber-700"
                          : isLimited
                            ? "bg-rose-50 text-rose-700"
                            : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {isBusy ? "Busy" : isLimited ? "Limit reached" : "Available"}
                    </span>
                  </div>

                  <dl className="grid gap-4 sm:grid-cols-3">
                    <UsageMetric
                      label="API requests in the last 60 seconds"
                      used={minuteRequests}
                      limit={geminiApiLimits.requestsPerMinute}
                    />
                    <UsageMetric
                      label="API requests today (Pacific)"
                      used={dayRequests}
                      limit={geminiApiLimits.requestsPerDay}
                    />
                    <UsageMetric
                      label="Input tokens in the last 60 seconds"
                      used={minuteInputTokens}
                      limit={geminiApiLimits.inputTokensPerMinute}
                    />
                  </dl>
                  <p className="mt-4 text-[10px] text-slate-400">
                    {usage
                      ? `Last recorded call: ${new Intl.DateTimeFormat("en", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(usage.updatedAt))}`
                      : "No requests recorded in QTS yet."}
                  </p>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
    </WorkspaceShell>
  );
}

function UsageMetric({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const remaining = Math.max(0, limit - used);
  const progress = Math.min(100, (used / limit) * 100);
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
        {used.toLocaleString()}{" "}
        <span className="text-xs font-medium text-slate-400">
          / {limit.toLocaleString()}
        </span>
      </dd>
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
      <p className="mt-1 text-[10px] text-slate-400">
        {remaining.toLocaleString()} remaining
      </p>
    </div>
  );
}
