import { and, desc, gte, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  geminiApiCallLogs,
  geminiKeyBusyLeases,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  getGeminiApiKeyHash,
  getGeminiApiKeys,
  getGroqApiKeys,
  removeOldGeminiApiCallLogs,
} from "@/lib/gemini-usage";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/app/components/page-header";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { PaginatedTable } from "@/app/components/paginated-table";
import { AiLimitsForm } from "./model-limits-form";
import { ModelTestPanel } from "./model-test-panel";
import { TokenComparisonForm } from "./token-comparison-form";
import { TokenCountModeForm } from "./token-count-mode-form";
import { ResponseDetailsButton } from "./response-details";
import { ZoneClock } from "@/app/components/zone-clock";
import { getGeminiTokenCountMode } from "@/server/gemini/token-count-mode";
import { aiModelLabel, aiModels, aiSlotId, describeAiSlot, emptyAiSlotUsage, parseAiSlotId, type AiProvider } from "@/server/gemini/ai-models";
import { readAiSettings, readAiSlotUsage } from "@/server/gemini/ai-store";
import { isModelTestAllowed } from "@/server/gemini/model-test";
import { modelTestKeyId, readModelTestState } from "@/server/gemini/model-test-store";

export const instant = false;

type GeminiUsageTab = "limits" | "responses" | "test";

const GEMINI_USAGE_TABS: { id: GeminiUsageTab; label: string; description: string }[] = [
  { id: "limits", label: "Usage limits & key status", description: "Per-key limits and each key's current usage." },
  { id: "responses", label: "Google responses & calibration", description: "Today's Google API responses and token calibration." },
  { id: "test", label: "Model test", description: "How many calls each key and model can make." },
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
  const requestedTab = (await searchParams).tab;
  const activeTab: GeminiUsageTab = requestedTab === "responses" || requestedTab === "test" ? requestedTab : "limits";
  const tokenCountMode = activeTab === "responses" ? await getGeminiTokenCountMode() : "local";
  const modelTest = activeTab === "test" ? await readModelTestState() : null;

  const keys = getGeminiApiKeys();
  const groqKeys = getGroqApiKeys();
  const keyHashes = keys.map(getGeminiApiKeyHash);
  const groqKeyHashes = groqKeys.map(getGeminiApiKeyHash);
  const hashesOf = (provider: AiProvider) => (provider === "groq" ? groqKeyHashes : keyHashes);
  const slotIds = aiModels.flatMap((model) => hashesOf(model.provider).map((hash) => aiSlotId(hash, model.id)));
  const pacificDayStart = sql`
    date_trunc('day', now() at time zone 'America/Los_Angeles')
      at time zone 'America/Los_Angeles'
  `;
  // Each tab loads only the data it shows.
  const [aiSettings, slotUsage] = activeTab === "limits"
    ? await Promise.all([readAiSettings(), readAiSlotUsage(slotIds)])
    : [null, new Map<string, typeof emptyAiSlotUsage>()];
  // Calls before the switch to key + model slots were filed under the key alone.
  const logKeys = [...keyHashes, ...groqKeyHashes, ...slotIds];
  const recentApiCalls = logKeys.length && activeTab === "responses"
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
            inArray(geminiApiCallLogs.keyHash, logKeys),
            gte(geminiApiCallLogs.startedAt, pacificDayStart),
          ),
        )
        .orderBy(desc(geminiApiCallLogs.startedAt))
        .limit(100)
    : [];
  const keyNameByHash = new Map([
    ...keyHashes.map((hash, index) => [hash, `Key ${index + 1}`] as const),
    ...groqKeyHashes.map((hash, index) => [hash, `Groq ${index + 1}`] as const),
  ]);
  const busyRows = slotIds.length && activeTab === "limits"
    ? await db
        .select({ slotId: geminiKeyBusyLeases.keyHash })
        .from(geminiKeyBusyLeases)
        .where(
          and(
            inArray(geminiKeyBusyLeases.keyHash, slotIds),
            gte(geminiKeyBusyLeases.expiresAt, sql`now()`),
          ),
        )
    : [];
  const busySlots = new Set(busyRows.map((row) => row.slotId));
  const statusAt = modelTest?.readAt ?? await currentTime();

  function keyStatusTable(title: string, provider: AiProvider) {
    if (!aiSettings) return null;
    const settings = aiSettings;
    const models = aiModels.filter((model) => model.provider === provider);
    const hashes = hashesOf(provider);
    if (!hashes.length) return null;
    return (
      <div className="mb-6" key={provider}>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
        <PaginatedTable
          columns={[
            { label: "API key", className: "w-[20%]" },
            ...models.map((model) => ({ label: model.label })),
          ]}
          emptyMessage="No API keys configured"
          rows={hashes.map((hash) => ({
            id: hash,
            cells: [
              <div key="key">
                <div className="font-semibold">{keyNameByHash.get(hash)}</div>
                <div className="mt-1 font-mono text-xs text-slate-500">{hash.slice(0, 10)}</div>
              </div>,
              ...models.map((model) => {
                const slotId = aiSlotId(hash, model.id);
                const view = describeAiSlot(
                  settings.limits[model.id],
                  slotUsage.get(slotId) ?? emptyAiSlotUsage,
                  settings.pauses[slotId],
                  busySlots.has(slotId),
                  statusAt,
                );
                return (
                  <div key={model.id}>
                    <div className="font-semibold tabular-nums text-slate-800">{view.used}</div>
                    <span className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${slotToneClass[view.tone]}`}>
                      {view.status}
                    </span>
                  </div>
                );
              }),
            ],
          }))}
        />
      </div>
    );
  }

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
        <ZoneClock className="sm:w-52" label="Pacific time" timeZone="America/Los_Angeles" />
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

        {modelTest ? (
          <ModelTestPanel
            enabled={isModelTestAllowed(process.env)}
            initialRun={modelTest.run}
            initialSettings={modelTest.settings}
            keys={[
              ...keys.map((key, index) => ({ number: index + 1, keyId: modelTestKeyId(key), prefix: keyHashes[index].slice(0, 10), provider: "gemini" as const })),
              ...groqKeys.map((key, index) => ({ number: index + 1, keyId: modelTestKeyId(key), prefix: groqKeyHashes[index].slice(0, 10), provider: "groq" as const })),
            ]}
            serverNow={modelTest.readAt}
          />
        ) : activeTab === "limits" ? (
        <>
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-800">Limits per model</h2>
          {aiSettings ? <AiLimitsForm limits={aiSettings.limits} /> : null}
        </section>

        <h2 className="mb-3 text-sm font-semibold text-slate-800">Status of each key and model today</h2>
        {keys.length === 0 && groqKeys.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No Gemini or Groq API keys are configured on the server.
          </section>
        ) : (
          <>
            {keyStatusTable("Gemini keys", "gemini")}
            {keyStatusTable("Groq keys", "groq")}
          </>
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
              { label: "No", className: "w-[4%]" },
              { label: "Time (Pacific)", className: "w-[13%]" },
              { label: "API key", className: "w-[11%]" },
              { label: "Operation", className: "w-[11%]" },
              { label: "Result / reason", className: "w-[23%]" },
              { label: "Local tokens", className: "w-[8%]" },
              { label: "Gemini tokens", className: "w-[9%]" },
              { label: "Duration", className: "w-[8%]" },
              { label: "Details", className: "w-[13%]" },
            ]}
            emptyMessage={keys.length ? "No Google API requests recorded today." : "Configure a Gemini API key to see responses."}
            rows={recentApiCalls.map((call, index) => {
              const startedDate = new Intl.DateTimeFormat("en-US", {
                dateStyle: "medium",
                timeZone: "America/Los_Angeles",
              }).format(call.startedAt);
              const startedTime = new Intl.DateTimeFormat("en-US", {
                timeStyle: "medium",
                timeZone: "America/Los_Angeles",
              }).format(call.startedAt);
              const slot = parseAiSlotId(call.keyHash);
              const keyLabel = [keyNameByHash.get(slot.keyHash) ?? "Key ?", ...(slot.modelId ? [aiModelLabel(slot.modelId)] : []), slot.keyHash.slice(0, 10)].join(" · ");
              const operationLabel = call.operation === "count_tokens" ? "CountTokens" : "GenerateContent";
              const durationLabel = call.durationMs === null ? "—" : `${call.durationMs.toLocaleString()} ms`;
              const reason = readCallReason(call);
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
                    {startedDate},{" "}
                    <strong className="font-semibold text-slate-900">{startedTime}</strong>
                  </span>,
                  <span className="font-mono text-xs" key="key">{keyLabel}</span>,
                  operationLabel,
                  <div key="result">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        call.status === "http_success"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {statusLabel}
                    </span>
                    <p className="mt-1.5 break-words text-xs text-slate-600">{reason}</p>
                  </div>,
                  <TokenCount key="local-tokens" value={call.localInputTokens} />,
                  <TokenCount
                    compareTo={call.localInputTokens}
                    key="gemini-tokens"
                    value={call.geminiInputTokens}
                  />,
                  durationLabel,
                  <ResponseDetailsButton
                    call={{
                      summary: [
                        { label: "Time (Pacific)", value: `${startedDate}, ${startedTime}` },
                        { label: "API key", value: keyLabel },
                        { label: "Operation", value: operationLabel },
                        { label: "Result", value: statusLabel },
                        { label: "Duration", value: durationLabel },
                        { label: "Local tokens", value: call.localInputTokens?.toLocaleString() ?? "—" },
                        { label: "Gemini tokens", value: call.geminiInputTokens?.toLocaleString() ?? "—" },
                      ],
                      reason,
                      responseBody: call.responseBody,
                      responseTruncated: call.responseTruncated,
                      errorMessage: call.errorMessage,
                    }}
                    key="response"
                  />,
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

const slotToneClass = {
  ok: "bg-emerald-50 text-emerald-700",
  busy: "bg-amber-50 text-amber-700",
  out: "bg-slate-100 text-slate-600",
  problem: "bg-rose-50 text-rose-700",
} as const;

/** The status column's "now", outside the component so that it stays a pure render. */
async function currentTime(): Promise<number> {
  return Date.now();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finishReasonText: Record<string, string> = {
  STOP: "Finished normally",
  MAX_TOKENS: "Cut off at the output token limit",
  SAFETY: "Blocked by safety filters",
  RECITATION: "Blocked for recitation",
  BLOCKLIST: "Blocked by a term blocklist",
  PROHIBITED_CONTENT: "Blocked as prohibited content",
  SPII: "Blocked for personal information",
  MALFORMED_FUNCTION_CALL: "Malformed function call",
  OTHER: "Stopped for another reason",
};

// One readable line saying why a call ended the way it did, so the JSON need not be opened.
function readCallReason(call: {
  status: string;
  operation: string;
  responseBody: string | null;
  responseTruncated: boolean;
  errorMessage: string | null;
}): string {
  if (call.status === "pending") return "Waiting for Google's reply.";
  if (call.status === "network_error") return call.errorMessage ?? "The request failed before Google replied.";
  let body: unknown;
  try {
    body = JSON.parse(call.responseBody ?? "");
  } catch {
    return call.responseTruncated
      ? "Response was over 1 MB and cut off; open the details."
      : "Response was not JSON; open the details.";
  }
  if (!isRecord(body)) return "Response was empty.";
  if (isRecord(body.error)) {
    const status = typeof body.error.status === "string" ? `${body.error.status}: ` : "";
    const message = typeof body.error.message === "string" ? body.error.message : "No error message.";
    return `${status}${message}`;
  }
  if (call.operation === "count_tokens") {
    return typeof body.totalTokens === "number"
      ? `Counted ${body.totalTokens.toLocaleString()} tokens`
      : "No token count in the response.";
  }
  if (Array.isArray(body.choices)) {
    const choice = body.choices[0];
    const finish = isRecord(choice) ? choice.finish_reason : undefined;
    const tokens = isRecord(body.usage) ? body.usage.completion_tokens : undefined;
    return `${finish === "stop" ? "Finished normally" : "Stopped"} (${String(finish)})${typeof tokens === "number" ? ` · ${tokens.toLocaleString()} output tokens` : ""}`;
  }
  const blockReason = isRecord(body.promptFeedback) ? body.promptFeedback.blockReason : undefined;
  if (typeof blockReason === "string") return `Prompt blocked (${blockReason})`;
  const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
  const finishReason = isRecord(candidate) ? candidate.finishReason : undefined;
  if (typeof finishReason !== "string") return "No reply candidate returned.";
  const outputTokens = isRecord(body.usageMetadata) ? body.usageMetadata.candidatesTokenCount : undefined;
  return `${finishReasonText[finishReason] ?? "Stopped"} (${finishReason})${
    typeof outputTokens === "number" ? ` · ${outputTokens.toLocaleString()} output tokens` : ""
  }`;
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
