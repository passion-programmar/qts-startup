import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, FileCheck2, ListOrdered, Minus, Target, TrendingDown, TrendingUp, Trophy } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { TrendChart, type TrendPoint } from "@/app/components/trend-chart";
import { buttonClass, LinkButton } from "@/app/ui/button";
import { Card, CardHeader } from "@/app/ui/card";
import { PageHeader } from "@/app/ui/page-header";
import { LinkTabs } from "@/app/ui/tabs";
import type { StaffSession } from "@/lib/session";
import {
  analysisHref,
  analysisRanges,
  analysisZones,
  changeVsPrevious,
  DAILY_BID_TARGET,
  periodLabels,
  previousLabel,
  seriesSummary,
  weekSpan,
  type AnalysisRange,
  type AnalysisView,
  type AnalysisZone,
  type Change,
} from "@/server/analysis/analysis-values";
import { readManagerAnalysis, type ManagerAnalysis } from "@/server/analysis/manager-analysis";
// The interview steps and results as the database names them (interview_step, interview_result).
const interviewSteps = [
  { key: "intro", label: "Intro" },
  { key: "tech", label: "Tech" },
  { key: "final", label: "Final" },
  { key: "offer", label: "Offer" },
] as const;
type InterviewResult = keyof ManagerAnalysis["results"];
const resultLabels: Record<InterviewResult, string> = { passed: "Passed", waiting: "Waiting", rejected: "Rejected", no_show: "No-show", cancelled: "Cancelled" };

// Status colours for round results, the same in light and dark (checked against both card colours).
// Passed and Rejected are kept apart by Waiting, and every part carries its name, so colour is never
// the only clue.
const resultOrder: InterviewResult[] = ["passed", "waiting", "rejected", "no_show", "cancelled"];
const resultColors: Record<InterviewResult, string> = {
  passed: "#059669",
  waiting: "#d97706",
  rejected: "#e11d48",
  no_show: "#64748b",
  cancelled: "#ea580c",
};
const resultName = (key: InterviewResult) => resultLabels[key];

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");
const formatNumber = (value: number) => value.toLocaleString("en");

type SummaryItem = { label: string; value: string; extra?: ReactNode };

function SummaryRow({ items }: { items: SummaryItem[] }) {
  return (
    <dl className="grid grid-cols-3 border-y border-line-soft">
      {items.map((item, index) => (
        <div className={index ? "min-w-0 border-l border-line-soft px-4 py-3 sm:px-5" : "min-w-0 px-4 py-3 sm:px-5"} key={item.label}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{item.label}</dt>
          <dd className="mt-1 text-lg font-semibold text-fg">{item.value}</dd>
          {item.extra}
        </div>
      ))}
    </dl>
  );
}

// "▲ 12%" against the window before; the icon and words carry the direction, not only the colour.
// "before" is the earlier value as the tooltip shows it.
function ChangeNote({ change, label, before }: { change: Change; label: string; before: string }) {
  if (!change) return <p className="mt-0.5 text-[11px] text-fg-muted">No change {label.replace(/^vs /, "from ")}</p>;
  const Icon = change.direction === "up" ? TrendingUp : change.direction === "down" ? TrendingDown : Minus;
  const tone = change.direction === "up" ? "text-success-text" : change.direction === "down" ? "text-danger-text" : "text-fg-muted";
  const word = change.direction === "up" ? "Up" : change.direction === "down" ? "Down" : "";
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px]" title={`${before} ${label.replace(/^vs /, "in ")}`}>
      <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
        <Icon aria-hidden="true" className="size-3.5" />
        <span className="sr-only">{word}</span>
        {change.text}
      </span>
      <span className="text-fg-muted">{label}</span>
    </p>
  );
}

// Total (with its change), average and busiest period.
function ChartCard({ icon, title, description, values, bucket, previous, previousText, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  values: number[];
  bucket: string;
  previous: number;
  previousText: string;
  children: ReactNode;
}) {
  const { total, average, max } = seriesSummary(values);
  return (
    <Card flush className="overflow-hidden">
      <CardHeader className="px-5 py-4" description={description} icon={icon} title={title} />
      <SummaryRow items={[
        { label: "Total", value: formatNumber(total), extra: <ChangeNote before={formatNumber(previous)} change={changeVsPrevious(total, previous)} label={previousText} /> },
        { label: `Avg / ${bucket}`, value: formatNumber(average) },
        { label: "Max", value: formatNumber(max) },
      ]} />
      <div className="px-3 pb-4 pt-3 sm:px-4">{children}</div>
    </Card>
  );
}

// Today's bids against the daily target, whatever range is chosen below.
function TodayCard({ bids, interviews, zoneLabel }: { bids: number; interviews: number; zoneLabel: string }) {
  const share = Math.min(1, bids / DAILY_BID_TARGET);
  const reached = bids >= DAILY_BID_TARGET;
  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary-text ring-1 ring-primary-ring">
          <Target aria-hidden="true" className="size-4.5" />
        </span>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">Today · {zoneLabel} time</p>
          <p className="text-2xl font-semibold text-fg">
            {formatNumber(bids)} <span className="text-base font-medium text-fg-muted">/ {formatNumber(DAILY_BID_TARGET)} bids</span>
          </p>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div
          aria-label={`Today's bids: ${bids} of ${DAILY_BID_TARGET}`}
          aria-valuemax={DAILY_BID_TARGET}
          aria-valuemin={0}
          aria-valuenow={Math.min(bids, DAILY_BID_TARGET)}
          className="h-2 overflow-hidden rounded-full bg-primary-soft"
          role="progressbar"
        >
          <div className={`h-full rounded-full ${reached ? "bg-success" : "bg-primary"}`} style={{ width: `${share * 100}%` }} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
          {reached ? (
            <>
              <CheckCircle2 aria-hidden="true" className="size-3.5 text-success-text" />
              <span className="font-semibold text-success-text">Daily target reached</span>
            </>
          ) : (
            <span>
              <span className="font-semibold text-fg-soft">{percent(bids, DAILY_BID_TARGET)}</span> of the daily target · {formatNumber(DAILY_BID_TARGET - bids)} to go
            </span>
          )}
        </p>
      </div>
      <Link className="text-sm text-fg-muted hover:text-fg sm:text-right" href="/interviews">
        <span className="font-semibold text-fg">{formatNumber(interviews)}</span> interview {interviews === 1 ? "round" : "rounds"} today
      </Link>
    </Card>
  );
}

// Earlier / later week, and the week shown; "This week" comes back from an earlier one.
function WeekStepper({ view, monday }: { view: AnalysisView; monday: string }) {
  const name = view.weeksBack === 0 ? "This week" : view.weeksBack === 1 ? "Last week" : `${view.weeksBack} weeks ago`;
  const arrow = "size-9 px-0";
  return (
    <nav aria-label="Choose a week" className="flex items-center gap-2">
      <LinkButton aria-label="Earlier week" className={arrow} href={analysisHref({ ...view, weeksBack: view.weeksBack + 1 })} scroll={false} size="sm" variant="secondary">
        <ChevronLeft aria-hidden="true" className="size-5" />
      </LinkButton>
      {view.weeksBack > 0 ? (
        <LinkButton aria-label="Later week" className={arrow} href={analysisHref({ ...view, weeksBack: view.weeksBack - 1 })} scroll={false} size="sm" variant="secondary">
          <ChevronRight aria-hidden="true" className="size-5" />
        </LinkButton>
      ) : (
        <span aria-hidden="true" className={`${buttonClass({ size: "sm", variant: "secondary", className: arrow })} pointer-events-none opacity-40`}>
          <ChevronRight className="size-5" />
        </span>
      )}
      <p className="text-sm">
        <span className="font-semibold text-fg">{name}</span>
        {monday ? <span className="text-fg-muted"> · {weekSpan(monday)}</span> : null}
      </p>
      {view.weeksBack > 0 ? (
        <LinkButton className="ml-1" href={analysisHref({ ...view, weeksBack: 0 })} scroll={false} size="sm" variant="ghost">This week</LinkButton>
      ) : null}
    </nav>
  );
}

function ResultsCard({ analysis, windowText, bidTotal }: { analysis: ManagerAnalysis; windowText: string; bidTotal: number }) {
  const results = analysis.results;
  const roundTotal = resultOrder.reduce((sum, key) => sum + results[key], 0);
  const decided = results.passed + results.rejected + results.no_show;
  return (
    <Card flush className="overflow-hidden">
      <CardHeader className="px-5 py-4" description={`How the interview rounds in ${windowText} went.`} icon={<Trophy />} title="Interview results" />
      <SummaryRow items={[
        { label: "Rounds", value: formatNumber(roundTotal) },
        { label: "Bids → interview", value: percent(analysis.bidsWithInterview, bidTotal) },
        { label: "Pass rate", value: percent(results.passed, decided) },
      ]} />
      <div className="space-y-4 px-5 py-5">
        {roundTotal > 0 ? (
          <div aria-label={`Interview results: ${resultOrder.map((key) => `${resultName(key)} ${results[key]}`).join(", ")}`} className="flex h-7 gap-0.5" role="img">
            {resultOrder.filter((key) => results[key] > 0).map((key) => (
              <div
                className="flex min-w-0 items-center rounded px-2 text-[11px] font-semibold text-white"
                key={key}
                style={{ background: resultColors[key], flexGrow: results[key], flexBasis: 0 }}
                title={`${resultName(key)}: ${results[key]} (${percent(results[key], roundTotal)})`}
              >
                {results[key] / roundTotal >= 0.12 ? percent(results[key], roundTotal) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-muted">No interview rounds in this range yet.</p>
        )}
        <ul className="grid grid-cols-2 gap-x-8 gap-y-2">
          {resultOrder.map((key) => (
            <li className="flex items-center gap-2 text-sm" key={key}>
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ background: resultColors[key] }} />
              <span className="text-fg-soft">{resultName(key)}</span>
              <span className="ml-auto font-semibold text-fg tabular-nums">{formatNumber(results[key])}</span>
              <span className="w-9 text-right text-xs text-fg-muted tabular-nums">{percent(results[key], roundTotal)}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-muted">
          Bids → interview: {formatNumber(analysis.bidsWithInterview)} of {formatNumber(bidTotal)} bids in this range have at least one round. Pass rate counts finished rounds only (Passed, Rejected, No-show).
        </p>
      </div>
    </Card>
  );
}

// How far jobs got: each job counts at every step up to the furthest one it reached, so the bars
// only get shorter, and "from the step before" shows where jobs stop.
function StepsCard({ steps, windowText }: { steps: ManagerAnalysis["steps"]; windowText: string }) {
  const top = steps.intro;
  return (
    <Card flush className="overflow-hidden">
      <CardHeader className="px-5 py-4" description={`How far the jobs with a round in ${windowText} got.`} icon={<ListOrdered />} title="Interview steps" />
      <SummaryRow items={[
        { label: "Jobs", value: formatNumber(top) },
        { label: "Offers", value: formatNumber(steps.offer) },
        { label: "Offer rate", value: percent(steps.offer, top) },
      ]} />
      <div className="px-5 py-5">
        {top > 0 ? (
          <ol className="space-y-3">
            {interviewSteps.map((step, index) => {
              const value = steps[step.key];
              const before = index > 0 ? steps[interviewSteps[index - 1].key] : null;
              return (
                <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem_7.5rem] items-center gap-3 text-sm" key={step.key}>
                  <span className="text-fg-soft">{step.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-line-soft">
                    <span className="block h-full rounded-full" style={{ background: "var(--chart-interviews)", width: `${(value / top) * 100}%` }} />
                  </span>
                  <span className="text-right font-semibold text-fg tabular-nums">{formatNumber(value)}</span>
                  <span className="text-xs text-fg-muted tabular-nums">{before === null ? "all jobs" : `${percent(value, before)} of ${interviewSteps[index - 1].label}`}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-fg-muted">No interview rounds in this range yet.</p>
        )}
        <p className="mt-4 text-xs text-fg-muted">A job counts at every step up to the furthest it reached by today, including its earlier rounds.</p>
      </div>
    </Card>
  );
}

/** A Manager's Overview: today against the target; bids and interview rounds for a week day by day, or by month or year. */
export async function ManagerOverview({ user, view }: { user: StaffSession; view: AnalysisView }) {
  const analysis = await readManagerAnalysis(user.id, view);
  return <ManagerOverviewView analysis={analysis} view={view} />;
}

export function ManagerOverviewView({ analysis, view }: { analysis: ManagerAnalysis; view: AnalysisView }) {
  const { range } = view;
  const labelled = analysis.points.map((point) => ({ ...point, ...periodLabels(point.start, range) }));
  const bidPoints: TrendPoint[] = labelled.map((point) => ({ short: point.short, full: point.full, value: point.bids }));
  const roundPoints: TrendPoint[] = labelled.map((point) => ({ short: point.short, full: point.full, value: point.interviews }));
  const bidTotal = seriesSummary(bidPoints.map((point) => point.value)).total;
  const { bucket, count } = analysisRanges[range];
  const monday = analysis.points[0]?.start ?? "";
  const windowText = range === "week"
    ? (view.weeksBack === 0 ? "this week" : `the week of ${monday ? weekSpan(monday) : "–"}`)
    : `the last ${count} ${bucket}s`;
  const previousText = previousLabel(view);

  return (
    <main className="mx-auto max-w-[1440px] space-y-6 py-1 2xl:max-w-none">
      <PageHeader
        title="Overview"
      />

      <TodayCard bids={analysis.today.bids} interviews={analysis.today.interviews} zoneLabel={analysisZones[view.zone].label} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <LinkTabs
          className="w-fit max-w-full"
          items={(Object.keys(analysisRanges) as AnalysisRange[]).map((key) => ({
            href: analysisHref({ ...view, range: key, weeksBack: 0 }),
            label: analysisRanges[key].label,
            active: key === range,
          }))}
          label="Group by"
        />
        {range === "week" ? <WeekStepper monday={monday} view={view} /> : null}
        {/* The zone days and "today" are counted in; the same week stays chosen. */}
        <LinkTabs
          className="w-fit max-w-full sm:ml-auto"
          items={(Object.keys(analysisZones) as AnalysisZone[]).map((key) => ({
            href: analysisHref({ ...view, zone: key }),
            label: analysisZones[key].label,
            active: key === view.zone,
          }))}
          label="Time zone"
        />
      </div>

      <section aria-label="Bids and interviews over time" className="grid gap-4 lg:grid-cols-2">
        <ChartCard bucket={bucket} description={`Bids you submitted, per ${bucket}.`} icon={<FileCheck2 />} previous={analysis.previous.bids} previousText={previousText} title="Bid submissions" values={bidPoints.map((point) => point.value)}>
          <TrendChart color="var(--chart-bids)" kind="bar" label={`Bid submissions per ${bucket}`} points={bidPoints} unit="bids" />
        </ChartCard>
        <ChartCard bucket={bucket} description={`Interview rounds, per ${bucket} they take place.`} icon={<CalendarClock />} previous={analysis.previous.interviews} previousText={previousText} title="Interviews over time" values={roundPoints.map((point) => point.value)}>
          <TrendChart color="var(--chart-interviews)" kind="line" label={`Interview rounds per ${bucket}`} points={roundPoints} unit="rounds" />
        </ChartCard>
      </section>

      <section aria-label="How interviews went" className="grid gap-4 lg:grid-cols-2">
        <ResultsCard analysis={analysis} bidTotal={bidTotal} windowText={windowText} />
        <StepsCard steps={analysis.steps} windowText={windowText} />
      </section>
    </main>
  );
}
