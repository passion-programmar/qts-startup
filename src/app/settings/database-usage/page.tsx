import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  HeartPulse,
  type LucideIcon,
  Moon,
  Server,
  Siren,
  Unplug,
  Wifi,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/session";
import { formatRomaniaTime, ROMANIA_TIME_ZONE } from "@/lib/romania-time";
import { PageHeader } from "@/app/components/page-header";
import { PaginatedTable } from "@/app/components/paginated-table";
import { WorkspaceShell } from "@/app/components/workspace-shell";
import { ZoneClock } from "@/app/components/zone-clock";
import { SettingsCard } from "@/app/settings/settings-card";
import {
  type DiagnosticsSnapshot,
  type ProjectQuotas,
  projectQuotas,
  readUsageState,
  type UsageState,
} from "@/server/database/database-usage";
import {
  DATA_TABLES,
  dataTable,
  formatBytes,
  type Level,
  NEON_LIMITS_CHECKED_ON,
  type QuotaView,
} from "@/server/database/database-usage-values";
import { CleanUpNowButton, KeepDaysForm, MonitorButton, PlanLimitsForm, TableDeleteForm } from "./database-forms";

export const instant = false;

type DatabaseUsageTab = "quota" | "diagnostics" | "cleanup";

const DATABASE_USAGE_TABS: { id: DatabaseUsageTab; label: string; description: string }[] = [
  { id: "quota", label: "Quota & limits", description: "Neon usage, what is left, forecasts, health." },
  { id: "diagnostics", label: "Diagnostics", description: "Tables, connections, queries (PostgreSQL)." },
  { id: "cleanup", label: "Clean-up & delete", description: "Automatic clean-up and deleting by hand." },
];

const LEVELS: Record<Level, { label: string; badge: string; bar: string; Icon: LucideIcon }> = {
  ok: { label: "OK", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "bg-indigo-500", Icon: CheckCircle2 },
  warning: { label: "Warning", badge: "bg-amber-50 text-amber-700 ring-amber-200", bar: "bg-amber-500", Icon: AlertTriangle },
  high: { label: "High", badge: "bg-amber-100 text-amber-800 ring-amber-300", bar: "bg-amber-600", Icon: AlertTriangle },
  critical: { label: "Critical", badge: "bg-rose-50 text-rose-700 ring-rose-200", bar: "bg-rose-500", Icon: AlertOctagon },
  reached: { label: "Limit reached", badge: "bg-rose-100 text-rose-800 ring-rose-300", bar: "bg-rose-600", Icon: Ban },
};

const cardClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6";
const hours = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} CU-h`;
const formatOf = (key: QuotaView["key"]) => (key === "compute" ? hours : formatBytes);
const ago = (minutes: number) =>
  minutes < 1 ? "just now" : minutes < 60 ? `${Math.round(minutes)} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;

export default async function DatabaseUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const currentUser = await requireUser();
  if (currentUser.role !== "super_admin") redirect("/");
  const requested = (await searchParams).tab;
  const activeTab: DatabaseUsageTab = requested === "diagnostics" || requested === "cleanup" ? requested : "quota";
  // Opening the page reads only what the last clicks and clean-up saved: one small read, no measuring.
  const state = await readUsageState();

  return (
    <WorkspaceShell activeHref="/settings/database-usage" user={currentUser}>
    <main className="py-1 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          actions={
            <>
              <Link className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50" href="/settings">
                Settings
              </Link>
              <MonitorButton kind={activeTab === "diagnostics" ? "diagnostics" : "quota"} />
            </>
          }
          description="Neon usage against the plan's limits, what is left, forecasts, database health, and diagnostics. Nothing is measured until you click, and the last result stays until the next click."
          eyebrow="Administration"
          title="Database usage"
        />

        {/* Stays under the fixed workspace header (60px below 640px, 64px above) while the page scrolls. */}
        <div className="sticky top-[60px] z-30 -mx-1 mb-4 flex flex-col gap-3 bg-surface/95 px-1 py-2 backdrop-blur sm:top-16 sm:flex-row sm:items-stretch">
        <ZoneClock className="sm:w-52" label="Romania time" timeZone={ROMANIA_TIME_ZONE} />
        <nav aria-label="Database usage sections" className="flex min-w-0 flex-1 flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1">
          {DATABASE_USAGE_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`min-w-0 flex-1 rounded-lg px-4 py-2.5 text-left transition sm:min-w-[12rem] ${
                  active
                    ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                }`}
                href={`/settings/database-usage?tab=${tab.id}`}
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

        {activeTab === "quota" && <QuotaTab state={state} />}
        {activeTab === "diagnostics" && <DiagnosticsTab state={state} />}
        {activeTab === "cleanup" && <CleanupTab state={state} />}
      </div>
    </main>
    </WorkspaceShell>
  );
}

// ---- Small pieces ----

function LevelBadge({ level }: { level: Level | null }) {
  if (!level) {
    return <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">Unavailable</span>;
  }
  const { label, badge, Icon } = LEVELS[level];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${badge}`}>
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

// Where a number comes from: Neon's API, PostgreSQL, an estimate, or nothing.
function SourceChip({ kind, children }: { kind: "neon" | "database" | "estimate" | "unavailable"; children?: ReactNode }) {
  const styles = {
    neon: "bg-indigo-50 text-indigo-700",
    database: "bg-slate-100 text-slate-700",
    estimate: "bg-amber-50 text-amber-700",
    unavailable: "bg-slate-100 text-slate-500",
  } as const;
  const labels = { neon: "Neon API", database: "PostgreSQL", estimate: "Estimate", unavailable: "Unavailable" } as const;
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[kind]}`}>{children ?? labels[kind]}</span>;
}

// Live right after a click, cached until a day old, then stale.
function Freshness({ minutes, what }: { minutes: number | null; what: string }) {
  if (minutes === null) return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">Not checked yet</span>;
  const kind = minutes < 2 ? "live" : minutes < 24 * 60 ? "cached" : "stale";
  const style = { live: "bg-emerald-50 text-emerald-700 ring-emerald-200", cached: "bg-slate-100 text-slate-600 ring-slate-200", stale: "bg-amber-50 text-amber-700 ring-amber-200" }[kind];
  const label = { live: "Live", cached: "Cached", stale: "Stale: check again" }[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${style}`}>
      <CalendarClock className="size-3.5" /> {label} · {what} {ago(minutes)}
    </span>
  );
}

function Meter({ view }: { view: QuotaView }) {
  const format = formatOf(view.key);
  if (view.used === null) return <p className="text-sm font-semibold text-slate-400">—</p>;
  const share = Math.min(100, view.percent ?? 0);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-slate-900">{format(view.used)}</span>
        <span className="text-xs tabular-nums text-slate-500">of {format(view.limit)} · {(view.percent ?? 0).toFixed((view.percent ?? 0) < 10 ? 1 : 0)}%</span>
      </div>
      <div
        aria-label={`${format(view.used)} of ${format(view.limit)}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(share)}
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
      >
        <div className={`h-full rounded-full transition-[width] ${LEVELS[view.level ?? "ok"].bar}`} style={{ width: `${Math.max(share, 1)}%` }} />
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-slate-500">{format(view.remaining ?? 0)} left</p>
    </div>
  );
}

const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

// One series of daily values: one hue, no legend; each bar names its day and value on hover.
function DailyBars({ values, format, label }: { values: { day: string; value: number }[]; format: (value: number) => string; label: string }) {
  const max = Math.max(...values.map((entry) => entry.value), 0);
  if (values.length < 2 || max <= 0) {
    return <p className="text-[11px] text-slate-400">Daily history: insufficient data (needs Check quota on at least three days).</p>;
  }
  return (
    <div>
      <p className="mb-1 text-[11px] text-slate-500">{label} · up to {format(max)} a day</p>
      <div aria-label={label} className="flex h-12 items-end gap-[2px] border-b border-slate-200" role="img">
        {values.slice(-30).map((entry) => (
          <div className="group flex h-full min-w-0 flex-1 items-end" key={entry.day} title={`${dayLabel(entry.day)}: ${format(entry.value)}`}>
            <div className="w-full rounded-t-[4px] bg-indigo-500 transition group-hover:bg-indigo-700" style={{ height: `${Math.max(3, (entry.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastLines({ view }: { view: QuotaView }) {
  const format = formatOf(view.key);
  const forecast = view.forecast;
  if (!forecast.enough) return <p className="text-[11px] text-slate-500"><SourceChip kind="estimate">Forecast</SourceChip> {forecast.reason}</p>;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
      <dt className="text-slate-500">Average per day</dt>
      <dd className="text-right tabular-nums">{forecast.perDay > 0 ? format(forecast.perDay) : "not growing"}</dd>
      {forecast.projectedAtPeriodEnd !== null && (
        <>
          <dt className="text-slate-500">By the period&apos;s end</dt>
          <dd className="text-right tabular-nums">{format(forecast.projectedAtPeriodEnd)}</dd>
        </>
      )}
      <dt className="text-slate-500">Limit reached</dt>
      <dd className="text-right tabular-nums">
        {forecast.limitDate ? `${formatRomaniaTime(forecast.limitDate).split(",")[0]} (~${forecast.daysToLimit} days)` : view.key === "storage" ? "not at this pace" : "not this period"}
      </dd>
    </dl>
  );
}

function QuotaCard({
  view,
  icon: Icon,
  title,
  extra,
  atLimit,
  solutions,
}: {
  view: QuotaView;
  icon: LucideIcon;
  title: string;
  extra?: ReactNode;
  atLimit: string;
  solutions: ReactNode[];
}) {
  const format = formatOf(view.key);
  return (
    <article className={`${cardClass} flex flex-col gap-4`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <span className="grid size-8 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon className="size-4" /></span>
            {title}
          </h3>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <SourceChip kind={view.source} /> {view.sourceNote}
          </p>
        </div>
        <LevelBadge level={view.level} />
      </header>
      <Meter view={view} />
      {view.used === null && <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">{view.sourceNote}</p>}
      {extra}
      <ForecastLines view={view} />
      {view.key !== "storage" && <DailyBars format={format} label="Used per day" values={view.daily} />}
      <p className="text-[11px] leading-5 text-slate-500">{atLimit}</p>
      <div className="rounded-xl bg-indigo-50/60 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">What to do</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
          {solutions.map((solution, index) => <li key={index}>{solution}</li>)}
        </ul>
      </div>
    </article>
  );
}

// ---- Quota & limits ----

function ComputeState({ project }: { project: ProjectQuotas }) {
  const endpoint = project.usage?.endpoints.find((entry) => entry.state) ?? project.usage?.endpoints[0];
  if (!project.usage) return null;
  if (!endpoint) {
    return <p className="text-[11px] text-slate-500">Compute state: {project.usage.endpointError ?? "Neon listed no compute."}</p>;
  }
  const idle = endpoint.state === "idle";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${idle ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
        {idle ? <Moon className="size-3" /> : <Zap className="size-3" />}
        {idle ? "Suspended (normal when idle)" : endpoint.state === "active" ? "Running" : endpoint.state ?? "Unknown"}
      </span>
      {endpoint.minCu !== null && endpoint.maxCu !== null && (
        <span>Size {endpoint.minCu === endpoint.maxCu ? `${endpoint.minCu} CU` : `${endpoint.minCu}–${endpoint.maxCu} CU (autoscaling)`}</span>
      )}
      {endpoint.suspendSeconds !== null && <span>· sleeps after {endpoint.suspendSeconds > 0 ? `${Math.round(endpoint.suspendSeconds / 60)} min` : "5 min (plan default)"} idle</span>}
      {endpoint.lastActive && <span>· last active {formatRomaniaTime(endpoint.lastActive)}</span>}
    </div>
  );
}

function ProjectQuotaCards({ project, state }: { project: ProjectQuotas; state: UsageState }) {
  const { storage, compute, transfer } = project.views;
  const usage = project.usage;
  const database = project.isAppProject ? state.quota?.database ?? null : null;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <QuotaCard
        atLimit="Neon Free: at the storage limit, writes (inserts, updates, deletes) fail until space is freed or the plan is upgraded. Data is not deleted."
        extra={
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
            <dt className="text-slate-500">This database (PostgreSQL)</dt>
            <dd className="text-right tabular-nums">{database?.usedBytes != null ? formatBytes(database.usedBytes) : "—"}</dd>
            <dt className="text-slate-500">All branches (Neon, logical size)</dt>
            <dd className="text-right tabular-nums">{usage?.storageBytes ? formatBytes(usage.storageBytes) : "not reported"}</dd>
            <dt className="text-slate-500">Write limit per branch</dt>
            <dd className="text-right tabular-nums">
              {usage?.branchLimitBytes
                ? `${formatBytes(usage.branchLimitBytes)} (Neon)`
                : database?.writeLimitBytes ? `${formatBytes(database.writeLimitBytes)} (PostgreSQL)` : "—"}
            </dd>
          </dl>
        }
        icon={HardDrive}
        solutions={[
          <>Lower <b>Keep Generation runs</b> days (Clean-up tab): usually the biggest table.</>,
          <>Answer <b>Yes</b> to the daily “Clear applied jobs?” in Get JD.</>,
          <>Delete old Failed job rows, Apply history, or key counters (Clean-up tab).</>,
          <>Upgrade the Neon plan for more storage.</>,
        ]}
        title="Storage"
        view={storage}
      />
      <QuotaCard
        atLimit="Neon Free: when the CU-hours run out, the compute is suspended until the next billing period: QTS stops working. Data is not deleted."
        extra={
          usage && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <dt className="text-slate-500">Running time (wall clock)</dt>
              <dd className="text-right tabular-nums">{usage.activeSeconds !== null ? `${(usage.activeSeconds / 3600).toFixed(1)} h` : "—"}</dd>
              <dt className="text-slate-500">CPU time</dt>
              <dd className="text-right tabular-nums">{usage.cpuSeconds !== null ? `${(usage.cpuSeconds / 3600).toFixed(2)} h` : "—"}</dd>
            </dl>
          )
        }
        icon={Cpu}
        solutions={[
          <>CU-hours = compute size × running time. A suspended compute uses none; it sleeps after 5 minutes without requests.</>,
          <>Chromes running Apply or Get JD keep it awake (Apply checks in every 30 seconds): stop them when not working, especially overnight.</>,
          <>Keep the compute at the smallest size (0.25 CU) in Neon console → Branches → Compute.</>,
          <>Upgrade the Neon plan for more CU-hours.</>,
        ]}
        title="Compute (this billing period)"
        view={compute}
      />
      <QuotaCard
        atLimit="Neon Free: when the transfer allowance runs out, the compute is suspended until the next billing period."
        icon={Wifi}
        solutions={[
          <>Most transfer is job descriptions, résumé text, and documents sent to the Chromes.</>,
          <>Avoid running Get JD and Generation again on the same jobs.</>,
          <>Upgrade the Neon plan for a larger allowance.</>,
        ]}
        title="Network transfer (this billing period)"
        view={transfer}
      />
    </div>
  );
}

function QuotaTab({ state }: { state: UsageState }) {
  const projects = projectQuotas(state);
  const app = projects.find((project) => project.isAppProject) ?? projects[0];
  const others = projects.filter((project) => project !== app);
  const neon = state.quota?.neon;
  const reported = projects.flatMap((project) => (project.usage?.storageBytes ? [project.usage.storageBytes] : []));
  const accountLimit = state.planLimits.accountStorageGb * 1024 ** 3;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Freshness minutes={state.quotaAgeMinutes} what="checked" />
        <span className="text-[11px] text-slate-500">Neon refreshes its usage numbers about every 15 minutes; Check quota never wakes the database compute.</span>
      </div>

      {!state.quota && (
        <section className={`${cardClass} mb-6 flex flex-col items-center gap-3 py-10 text-center`}>
          <span className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Database className="size-6" /></span>
          <h2 className="text-sm font-semibold text-slate-800">No quota check yet</h2>
          <p className="max-w-md text-xs leading-5 text-slate-500">
            Click Check quota at the top: QTS asks Neon&apos;s API for this billing period&apos;s compute, transfer, and storage, and reads this database&apos;s size once. The numbers stay here until the next check.
          </p>
        </section>
      )}

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            {app.name} {app.isAppProject && <span className="ml-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">this app&apos;s database</span>}
          </h2>
          {app.usage?.periodStart && (
            <p className="text-[11px] text-slate-500">
              Billing period {formatRomaniaTime(app.usage.periodStart).split(",")[0]}
              {app.usage.periodEnd ? ` – ${formatRomaniaTime(app.usage.periodEnd).split(",")[0]}` : ""}
            </p>
          )}
        </div>
        <div className="mb-3"><ComputeState project={app} /></div>
        {neon?.state === "not_configured" && <NeonNotConnected />}
        {app.error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">Neon: {app.error}</p>}
        <ProjectQuotaCards project={app} state={state} />
      </section>

      {others.map((project) => (
        <section className="mb-6" key={project.id}>
          <h2 className="mb-1 text-sm font-semibold text-slate-800">{project.name} <span className="font-mono text-[11px] font-normal text-slate-500">{project.id}</span></h2>
          <p className="mb-3 text-[11px] text-slate-500">Its own allowance: separate from this app&apos;s project.</p>
          <div className="mb-3"><ComputeState project={project} /></div>
          {project.error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">Neon: {project.error}</p>}
          <ProjectQuotaCards project={project} state={state} />
        </section>
      ))}

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <HealthCard state={state} />
        <article className={`${cardClass} flex flex-col gap-3`}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <span className="grid size-8 place-items-center rounded-xl bg-slate-100 text-slate-600"><Server className="size-4" /></span>
            Account-wide and hosting
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
            <dt className="text-slate-500">Storage, all configured projects</dt>
            <dd className="text-right tabular-nums">
              {reported.length ? `${formatBytes(reported.reduce((sum, bytes) => sum + bytes, 0))} of ${formatBytes(accountLimit)}` : "Unavailable (needs Neon's branch sizes)"}
            </dd>
            <dt className="text-slate-500">Projects monitored</dt>
            <dd className="text-right tabular-nums">{neon?.state === "checked" ? neon.projects.length : 0} (Free plan allows 100)</dd>
          </dl>
          <p className="text-[11px] leading-5 text-slate-500">
            Each project has its own compute, storage, and transfer allowance; only the 20 GB storage cap is shared by every project of the account. Projects not listed in NEON_PROJECT_ID are not counted.
          </p>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-[11px] leading-5 text-slate-600">
            <b>Vercel hosting (free plan)</b> is not measured here: see Vercel dashboard → Usage. QTS keeps it low: this page measures only on a click, and the daily clean-up runs inside requests that happen anyway. If Vercel&apos;s limits are reached, upgrade to Vercel Pro.
          </div>
        </article>
      </div>

      <details className={`${cardClass} mb-3 !p-4`}>
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          Plan limits and levels · {state.planLimits.storageMb} MB storage, {state.planLimits.computeHours} CU-hours, {state.planLimits.transferGb} GB transfer per project · warning {state.planLimits.thresholds.warning}%, high {state.planLimits.thresholds.high}%, critical {state.planLimits.thresholds.critical}%
        </summary>
        <p className="my-3 text-xs leading-5 text-slate-500">
          The defaults are Neon&apos;s Free plan. If your plan differs, correct them from Neon console → Billing. Super Admin sees a banner on every page when a quota passes a level; Dismiss hides it until a level gets worse.
        </p>
        <PlanLimitsForm limits={state.planLimits} />
      </details>

      <NeonLimitsReference />
    </>
  );
}

function NeonNotConnected() {
  return (
    <div className="mb-3 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-xs leading-5 text-slate-600">
      <p className="flex items-center gap-1.5 font-semibold text-slate-700"><Unplug className="size-3.5" /> Neon account not connected: compute and transfer are unavailable</p>
      <p className="mt-1">Add two server environment variables (Vercel → Project → Settings → Environment Variables), redeploy, then Check quota:</p>
      <ul className="mt-1 list-disc pl-4">
        <li><code className="font-mono">NEON_API_KEY</code>: Neon console → Account settings → API keys (a project-scoped key is enough).</li>
        <li><code className="font-mono">NEON_PROJECT_ID</code>: Neon console → project → Settings → General. Several projects: separate their IDs with commas.</li>
      </ul>
      <p className="mt-1 text-slate-500">The key stays on the server and is sent only to Neon.</p>
    </div>
  );
}

function HealthCard({ state }: { state: UsageState }) {
  const { health, quota } = state;
  const database = quota?.database;
  const recent = health.events.slice(0, 6);
  return (
    <article className={`${cardClass} flex flex-col gap-3`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="grid size-8 place-items-center rounded-xl bg-slate-100 text-slate-600"><HeartPulse className="size-4" /></span>
        Health
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
        <dt className="text-slate-500">Database at the last check</dt>
        <dd className="text-right">{database ? (database.ok ? `Answered in ${database.latencyMs} ms` : "Did not answer") : "—"}</dd>
        <dt className="text-slate-500">Last successful check</dt>
        <dd className="text-right">{health.lastDatabaseOkAt ? formatRomaniaTime(health.lastDatabaseOkAt) : "—"}</dd>
        <dt className="text-slate-500">Last failed check</dt>
        <dd className="text-right">{health.lastDatabaseFailAt ? formatRomaniaTime(health.lastDatabaseFailAt) : "none"}</dd>
        <dt className="text-slate-500">Last automatic clean-up</dt>
        <dd className="text-right">{state.lastCleanup ? formatRomaniaTime(state.lastCleanup.at) : "not yet"}</dd>
      </dl>
      <p className="text-[11px] leading-5 text-slate-500">A suspended compute is normal on Neon Free (it sleeps when idle and wakes on the next request); it is not an outage.</p>
      {recent.length > 0 && (
        <ul className="space-y-1 border-t border-slate-100 pt-2 text-[11px]">
          {recent.map((event, index) => (
            <li className={`flex gap-2 ${event.ok ? "text-slate-600" : "text-rose-700"}`} key={`${event.at}-${index}`}>
              <span className="shrink-0 tabular-nums text-slate-400">{formatRomaniaTime(event.at).split(", ")[1]}</span>
              <SourceChip kind={event.source === "neon" ? "neon" : "database"} />
              <span className="min-w-0">{event.message}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// Neon's Free plan, as its documentation stated on the day it was checked.
function NeonLimitsReference() {
  const rows: [string, string, string][] = [
    ["Compute", "100 CU-hours a month", "per project"],
    ["Compute size", "up to 2 CU (8 GB RAM), autoscaling", "per compute"],
    ["Scale to zero", "suspends after 5 minutes idle; cannot be turned off", "per compute"],
    ["Storage", "1 GB", "per project"],
    ["Storage, all projects", "20 GB", "account-wide"],
    ["Network transfer", "5 GB a month", "per project"],
    ["Projects", "100", "account-wide"],
    ["Branches", "10", "per project"],
    ["Instant restore history", "6 hours (up to 1 GB-month of changes)", "per project"],
    ["Snapshots", "1 manual snapshot", "plan"],
    ["Monitoring in the console", "1 day of history", "plan"],
    ["Connections (0.25 CU)", "104 max_connections, 97 for apps; pooler accepts 10,000 clients", "per compute (depends on size)"],
    ["Pooler (PgBouncer)", "transaction mode: no SET, LISTEN, SQL PREPARE, session advisory locks", "per compute"],
    ["Usage history API", "not on Free (Launch plan and up); QTS keeps its own daily points", "plan"],
    ["Billing record", "Neon's project counters are not its invoice; the official figures are in Neon console → Billing", "account"],
    ["When compute or transfer runs out", "compute suspended until the next billing period", "per project"],
    ["When storage runs out", "writes fail; reads still work; no data is deleted", "per project"],
  ];
  return (
    <details className={`${cardClass} mb-6 !p-4`}>
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">Neon Free plan limits · checked {NEON_LIMITS_CHECKED_ON}</summary>
      <table className="mt-3 w-full text-left text-xs">
        <thead><tr className="text-slate-500"><th className="py-1 font-medium">Limit</th><th className="py-1 font-medium">Free plan</th><th className="py-1 font-medium">Scope</th></tr></thead>
        <tbody>
          {rows.map(([limit, value, scope]) => (
            <tr className="border-t border-slate-100 align-top" key={limit}>
              <td className="py-1.5 pr-3 font-medium text-slate-700">{limit}</td>
              <td className="py-1.5 pr-3 text-slate-600">{value}</td>
              <td className="py-1.5 text-slate-500">{scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-slate-500">
        Sources: <a className="text-indigo-600 hover:underline" href="https://neon.com/docs/introduction/plans" rel="noreferrer" target="_blank">Neon plans</a>,{" "}
        <a className="text-indigo-600 hover:underline" href="https://neon.com/docs/connect/connection-pooling" rel="noreferrer" target="_blank">connection pooling</a>,{" "}
        <a className="text-indigo-600 hover:underline" href="https://neon.com/docs/guides/consumption-metrics" rel="noreferrer" target="_blank">consumption metrics</a>.
      </p>
    </details>
  );
}

// ---- Diagnostics ----

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <dt className="text-[11px] text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${tone === "bad" ? "text-rose-700" : "text-slate-800"}`}>{value}</dd>
    </div>
  );
}

function DiagnosticsTab({ state }: { state: UsageState }) {
  const diagnostics = state.diagnostics;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Freshness minutes={state.diagnosticsAgeMinutes} what="read" />
        <span className="text-[11px] text-slate-500">Reads PostgreSQL&apos;s own statistics once (cheap views); run it when you need it.</span>
      </div>
      {!diagnostics ? (
        <section className={`${cardClass} flex flex-col items-center gap-3 py-10 text-center`}>
          <span className="grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Activity className="size-6" /></span>
          <h2 className="text-sm font-semibold text-slate-800">No diagnostics yet</h2>
          <p className="max-w-md text-xs leading-5 text-slate-500">Click Run diagnostics at the top for table sizes, connections, transactions, slow queries, locks, and index hints.</p>
        </section>
      ) : (
        <DiagnosticsBody diagnostics={diagnostics} />
      )}
    </>
  );
}

function DiagnosticsBody({ diagnostics }: { diagnostics: DiagnosticsSnapshot }) {
  const { connections, activity } = diagnostics;
  const usable = connections.max !== null ? connections.max - (connections.reserved ?? 0) : null;
  const heavyScans = diagnostics.tables.filter((table) => table.rows > 1000 && table.seqScans > table.indexScans);
  return (
    <>
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <article className={cardClass}>
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Connections <SourceChip kind="database" /></h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Active (this database)" value={String(connections.active)} />
            <Stat label="Idle" value={String(connections.idle)} />
            <Stat label="Idle in transaction" tone={connections.idleInTransaction ? "bad" : undefined} value={String(connections.idleInTransaction)} />
            <Stat label="Waiting on a lock" tone={connections.waitingOnLock ? "bad" : undefined} value={String(connections.waitingOnLock)} />
            <Stat label="All client connections" value={String(connections.total)} />
            <Stat label="Usable maximum" value={usable !== null ? `${usable} (of ${connections.max})` : "—"} />
          </dl>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            These are PostgreSQL backend connections on the compute. QTS sends each query through Neon&apos;s serverless HTTP driver{diagnostics.usesPooler ? " to the pooler host (PgBouncer, transaction mode)" : ""}, so it holds no long-lived connections; many app requests share a few backends.
          </p>
        </article>
        <article className={cardClass}>
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Database activity <SourceChip kind="database" /></h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Commits" value={activity.commits.toLocaleString()} />
            <Stat label="Rollbacks" value={activity.rollbacks.toLocaleString()} />
            <Stat label="Deadlocks" tone={activity.deadlocks ? "bad" : undefined} value={activity.deadlocks.toLocaleString()} />
            <Stat label="Cache hit" value={activity.cacheHitPercent !== null ? `${activity.cacheHitPercent}%` : "—"} />
            <Stat label="Sessions ended badly" tone={activity.sessionsFatal ? "bad" : undefined} value={activity.sessionsFatal !== null ? `${activity.sessionsFatal} fatal` : "—"} />
            <Stat label="Locks waiting now" tone={diagnostics.locksWaiting ? "bad" : undefined} value={String(diagnostics.locksWaiting)} />
          </dl>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            Counted since the compute last started{activity.statsSince ? ` (${formatRomaniaTime(activity.statsSince)})` : ""}: Neon resets them when the compute wakes. {activity.sessionsAbandoned !== null && `${activity.sessionsAbandoned.toLocaleString()} sessions were closed by clients without saying goodbye and ${activity.sessionsKilled?.toLocaleString() ?? 0} were ended by the server (normal for HTTP queries and idle timeouts).`}
          </p>
        </article>
      </div>

      <section className={`${cardClass} mb-6`}>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Siren className="size-4 text-slate-500" /> Queries <SourceChip kind="database" /></h3>
        <p className="mb-2 text-xs font-semibold text-slate-700">Running over 5 seconds at the read</p>
        {diagnostics.longQueries.length ? (
          <ul className="mb-4 space-y-1.5 text-[11px]">
            {diagnostics.longQueries.map((query, index) => (
              <li className="rounded-lg bg-slate-50 px-3 py-2" key={index}>
                <span className="font-semibold tabular-nums text-slate-800">{query.seconds}s</span> · {query.state}{query.wait ? ` · waiting on ${query.wait}` : ""}
                <code className="mt-1 block truncate font-mono text-slate-500">{query.query}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-[11px] text-slate-500">None.</p>
        )}
        <p className="mb-2 text-xs font-semibold text-slate-700">Most time-consuming queries</p>
        {diagnostics.statements.enabled ? (
          <ul className="space-y-1.5 text-[11px]">
            {diagnostics.statements.top.map((statement, index) => (
              <li className="rounded-lg bg-slate-50 px-3 py-2" key={index}>
                <span className="font-semibold tabular-nums text-slate-800">{(statement.totalMs / 1000).toFixed(1)}s total</span> · {statement.calls.toLocaleString()} calls · {statement.meanMs} ms each
                <code className="mt-1 block truncate font-mono text-slate-500">{statement.query}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] leading-5 text-slate-500">
            <SourceChip kind="unavailable" /> Query statistics are off: the pg_stat_statements extension is not enabled. It is optional; to turn it on, run <code className="font-mono">CREATE EXTENSION pg_stat_statements;</code> in the Neon SQL editor. QTS does not change the database by itself. Neon resets these statistics when the compute restarts.
          </p>
        )}
      </section>

      <section className={`${cardClass} mb-6`}>
        <h3 className="mb-3 text-sm font-semibold text-slate-800">Index hints <SourceChip kind="database" /></h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Tables read mostly without an index</p>
            {heavyScans.length ? (
              <ul className="space-y-0.5 text-[11px] text-slate-600">
                {heavyScans.map((table) => <li key={table.name}>{dataTable(table.name)?.label ?? table.name}: {table.seqScans.toLocaleString()} full scans, {table.indexScans.toLocaleString()} index scans</li>)}
              </ul>
            ) : <p className="text-[11px] text-slate-500">None with over 1,000 rows.</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Indexes never used since the compute started</p>
            {diagnostics.unusedIndexes.length ? (
              <ul className="space-y-0.5 text-[11px] text-slate-600">
                {diagnostics.unusedIndexes.map((index) => <li key={index.index}><code className="font-mono">{index.index}</code> on {index.table} · {formatBytes(index.bytes)}</li>)}
              </ul>
            ) : <p className="text-[11px] text-slate-500">None.</p>}
            <p className="mt-1 text-[10px] text-slate-400">Counts reset when the compute restarts, so a rarely used index can look unused.</p>
          </div>
        </div>
      </section>

      <TablesSection tables={diagnostics.tables} />
      <BidsPerDay days={diagnostics.bidsPerDay} />
    </>
  );
}

function TablesSection({ tables }: { tables: DiagnosticsSnapshot["tables"] }) {
  const biggest = tables[0]?.bytes ?? 0;
  const indexTotal = tables.reduce((sum, table) => sum + table.indexBytes, 0);
  const total = tables.reduce((sum, table) => sum + table.bytes, 0);
  return (
    <>
      <section className={`${cardClass} mb-6`}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Biggest tables <SourceChip kind="database" /></h3>
          <p className="text-[11px] text-slate-500">{formatBytes(total)} in tables, of which {formatBytes(indexTotal)} indexes</p>
        </div>
        <ul className="space-y-2.5">
          {tables.slice(0, 10).map((usage) => (
            <li className="grid grid-cols-[minmax(7rem,12rem)_1fr_4.5rem] items-center gap-3 text-xs" key={usage.name} title={`${usage.name}: ${formatBytes(usage.tableBytes)} data, ${formatBytes(usage.indexBytes)} indexes, ${usage.rows.toLocaleString()} rows`}>
              <span className="truncate font-medium text-slate-700">{dataTable(usage.name)?.label ?? usage.name}</span>
              <span className="h-2.5 rounded-full bg-slate-100">
                <span className="block h-full rounded-full bg-indigo-500" style={{ width: `${biggest ? Math.max(1, (usage.bytes / biggest) * 100) : 0}%` }} />
              </span>
              <span className="text-right tabular-nums text-slate-600">{formatBytes(usage.bytes)}</span>
            </li>
          ))}
        </ul>
      </section>
      <div className="mb-6">
        <PaginatedTable
          columns={[
            { label: "Table", className: "w-[24%]" },
            { label: "Size", className: "w-[10%]" },
            { label: "Data / indexes", className: "w-[15%]" },
            { label: "Rows", className: "w-[10%]" },
            { label: "Added per day", className: "w-[11%]" },
            { label: "Oldest row", className: "w-[14%]" },
            { label: "Kept", className: "w-[16%]" },
          ]}
          emptyMessage="No tables"
          pageSize={25}
          rows={tables.map((usage) => {
            const table = dataTable(usage.name);
            return {
              id: usage.name,
              cells: [
                <div key="table">
                  <div className="font-semibold">{table?.label ?? usage.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500">{usage.name}</div>
                </div>,
                <span className="tabular-nums" key="size">{formatBytes(usage.bytes)}</span>,
                <span className="text-xs tabular-nums" key="split">{formatBytes(usage.tableBytes)} / {formatBytes(usage.indexBytes)}</span>,
                <span className="tabular-nums" key="rows">{usage.rows.toLocaleString()}</span>,
                <span className="tabular-nums" key="added">{usage.addedPerDay === null ? "—" : Math.round(usage.addedPerDay).toLocaleString()}</span>,
                <span className="text-xs" key="oldest">{usage.oldest ? formatRomaniaTime(usage.oldest) : "—"}</span>,
                <span className="text-xs text-slate-600" key="kept">{table ? table.kept : "Never deleted here"}</span>,
              ],
            };
          })}
        />
      </div>
    </>
  );
}

// Bids made each Romania day: one series, so no legend; each bar names its day and count on hover,
// and the same numbers are in the table below it.
function BidsPerDay({ days }: { days: { day: string; count: number }[] }) {
  const total = days.reduce((sum, entry) => sum + entry.count, 0);
  const max = Math.max(...days.map((entry) => entry.count), 0);
  const busiest = days.reduce((best, entry) => (entry.count > best.count ? entry : best), days[0]);
  return (
    <section className={`${cardClass} mb-6`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">Bids per day · 30 days before the read</h3>
        <p className="text-xs text-slate-500">
          {total.toLocaleString()} in 30 days
          {max > 0 && <> · busiest {dayLabel(busiest.day)} ({busiest.count.toLocaleString()})</>}
        </p>
      </div>
      {max === 0 ? (
        <p className="text-xs text-slate-400">No bids in those 30 days.</p>
      ) : (
        <>
          <div className="relative">
            <span className="absolute -top-1 left-0 text-[10px] tabular-nums text-slate-400">{max.toLocaleString()}</span>
            <div aria-label={`Bids per day, ${total} in 30 days`} className="flex h-36 items-end gap-[2px] border-b border-slate-200 pt-4" role="img">
              {days.map((entry) => (
                <div className="group flex h-full min-w-0 flex-1 items-end" key={entry.day} title={`${dayLabel(entry.day)}: ${entry.count.toLocaleString()} bids`}>
                  {entry.count > 0 && (
                    <div className="w-full rounded-t-[4px] bg-indigo-500 transition group-hover:bg-indigo-700" style={{ height: `${Math.max(2, (entry.count / max) * 100)}%` }} />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{dayLabel(days[0].day)}</span>
            <span>{dayLabel(days[14].day)}</span>
            <span>{dayLabel(days[days.length - 1].day)}</span>
          </div>
        </>
      )}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Show as table</summary>
        <table className="mt-2 w-full max-w-xs text-left">
          <thead>
            <tr className="text-slate-500"><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">Bids</th></tr>
          </thead>
          <tbody>
            {[...days].reverse().map((entry) => (
              <tr className="border-t border-slate-100" key={entry.day}>
                <td className="py-1">{dayLabel(entry.day)}</td>
                <td className="py-1 text-right tabular-nums">{entry.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

// ---- Clean-up & delete ----

function CleanupTab({ state }: { state: UsageState }) {
  const { lastCleanup, keepDays, diagnostics } = state;
  const usageByName = new Map((diagnostics?.tables ?? []).map((usage) => [usage.name, usage]));
  return (
    <>
      <section className={`${cardClass} mb-6`}>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Automatic clean-up</h2>
        <p className="mb-4 text-xs leading-5 text-slate-500">
          Runs by itself once a Romania day, inside the first Get JD or Apply request (no extra hosting work), and records the database size for the storage forecast. It deletes Generation runs older than the keep days below (each job keeps its newest delivered run, so Apply can still print its résumé), expired Get JD checks, Gemini logs older than 3 days, and questions unseen for 90 days. Bids are never deleted automatically.
        </p>
        <div className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {lastCleanup ? (
            <>
              <div className="font-semibold text-slate-800">
                Last clean-up: {formatRomaniaTime(lastCleanup.at)} {lastCleanup.byHand ? "(by hand)" : "(automatic)"} · about {formatBytes(lastCleanup.freedBytes)} freed
              </div>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(lastCleanup.removed).map(([key, count]) => (
                  <li key={key}>{dataTable(key)?.label ?? key}: {count.toLocaleString()} rows</li>
                ))}
              </ul>
              {lastCleanup.more && <div className="mt-1 text-amber-700">More rows were left; the next run continues.</div>}
            </>
          ) : (
            "No clean-up has run yet."
          )}
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <KeepDaysForm generationRuns={keepDays.generationRuns} />
          <CleanUpNowButton />
        </div>
      </section>

      <h2 className="mb-1 text-sm font-semibold text-slate-800">Delete by hand</h2>
      <p className="mb-3 text-xs leading-5 text-slate-500">
        Check first: it counts the rows and about how much space, then Delete asks once more. Rows in use (applications being filled or reviewed, To-do and Pending jobs, each job&apos;s newest résumé run) are never deleted. Candidates, Managers, profiles, prompts, settings, reusable answers, and page rules are never deleted here. Deleted space is reused for new rows, so the size may not drop right away.
      </p>
      <div className="space-y-3">
        {DATA_TABLES.map((table) => {
          const usage = usageByName.get(table.key);
          return (
            <SettingsCard
              item
              key={table.key}
              summary={usage
                ? `${usage.rows.toLocaleString()} rows · ${formatBytes(usage.bytes)} at the last diagnostics · kept ${table.kept}`
                : `kept ${table.kept}`}
              title={table.label}
            >
              <p className="mb-1 text-xs text-slate-600">{table.holds}</p>
              {table.warning && <p className="mb-3 text-xs text-amber-700">{table.warning}</p>}
              <TableDeleteForm label={table.label} rule={table.rule} tableKey={table.key} warning={table.warning} />
            </SettingsCard>
          );
        })}
      </div>
    </>
  );
}
