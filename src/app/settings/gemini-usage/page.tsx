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
    <main className="min-h-screen bg-[#f7f8fa] px-5 py-8 text-slate-900 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium text-slate-400">
              Super Admin workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Gemini API usage
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Usage and remaining QTS limits for each configured key. Refresh
              this page to see the latest counters.
            </p>
          </div>
          <div className="flex gap-4 text-xs font-semibold text-indigo-600">
            <Link className="hover:text-indigo-700" href="/settings/gemini-usage">
              Refresh
            </Link>
            <Link className="hover:text-indigo-700" href="/settings">
              Settings
            </Link>
          </div>
        </header>

        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
          Google applies its own quota per project. Multiple keys from the same
          project still share Google&apos;s project quota; these counters show only
          the per-key limits enforced by QTS. Each evaluation uses a token-count
          call and, if allowed, one generation call.
        </section>

        {keys.length === 0 ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            No Gemini API keys are configured on the server.
          </section>
        ) : (
          <section aria-label="Gemini key usage" className="grid gap-4">
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
                  className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
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
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-800">
        {used.toLocaleString()}{" "}
        <span className="text-xs font-medium text-slate-400">
          / {limit.toLocaleString()}
        </span>
      </dd>
      <p className="mt-1 text-[10px] text-slate-400">
        {remaining.toLocaleString()} remaining
      </p>
    </div>
  );
}
