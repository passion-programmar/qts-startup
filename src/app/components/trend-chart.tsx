"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { axisTicks } from "@/server/analysis/analysis-values";

export type TrendPoint = { short: string; full: string; value: number };

const height = 220;
const margin = { top: 20, right: 12, bottom: 26, left: 40 };

function roundedTopBar(x: number, y: number, width: number, barHeight: number): string {
  // Rounded at the data end, square on the baseline.
  const radius = Math.min(4, barHeight, width / 2);
  const bottom = y + barHeight;
  return `M${x},${bottom}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${bottom}Z`;
}

const formatValue = (value: number) => value.toLocaleString("en");

/**
 * One series over time, as columns ("bar") or a line with a soft area ("line"). Hover or arrow keys
 * show a period's value; the same numbers are in the table under the chart.
 */
export function TrendChart({ points, kind, color, unit, label }: { points: TrendPoint[]; kind: "bar" | "line"; color: string; unit: string; label: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const count = points.length;
  const max = Math.max(0, ...points.map((point) => point.value));
  const ticks = axisTicks(max);
  const top = ticks.at(-1) ?? 1;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const band = count ? plotWidth / count : plotWidth;
  const xAt = (index: number) => margin.left + band * (index + 0.5);
  const yAt = (value: number) => margin.top + plotHeight - (value / top) * plotHeight;
  const baseline = margin.top + plotHeight;
  const barWidth = Math.max(4, Math.min(24, band * 0.6));
  // On a narrow chart only every other period is named, ending on the latest.
  const labelEvery = band < 44 ? 2 : 1;
  const last = count - 1;

  function pick(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    const index = Math.floor((x - margin.left) / band);
    setActive(index >= 0 && index < count ? index : null);
  }

  function step(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActive((current) => {
      const from = current ?? last;
      return Math.min(last, Math.max(0, from + (event.key === "ArrowRight" ? 1 : -1)));
    });
  }

  const linePath = points.map((point, index) => `${index ? "L" : "M"}${xAt(index)},${yAt(point.value)}`).join("");
  const areaPath = count ? `${linePath}L${xAt(last)},${baseline}L${xAt(0)},${baseline}Z` : "";
  const shown = active ?? null;
  const activePoint = shown === null ? null : points[shown];
  const tooltipLeft = shown === null ? 0 : Math.min(Math.max(xAt(shown), 70), width - 70);

  return (
    <div>
      <div className="relative" ref={frame}>
        <svg
          aria-label={`${label}. Use the left and right arrow keys to read each period.`}
          className="block select-none outline-none focus-visible:ring-2 focus-visible:ring-primary-ring rounded-control"
          height={height}
          onBlur={() => setActive(null)}
          onFocus={() => setActive(last)}
          onKeyDown={step}
          onPointerLeave={() => setActive(null)}
          onPointerMove={pick}
          role="img"
          tabIndex={0}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line stroke="var(--color-line-soft)" strokeWidth={1} x1={margin.left} x2={width - margin.right} y1={yAt(tick)} y2={yAt(tick)} />
              <text className="fill-fg-muted text-[11px] tabular-nums" dominantBaseline="middle" textAnchor="end" x={margin.left - 8} y={yAt(tick)}>
                {formatValue(tick)}
              </text>
            </g>
          ))}
          <line stroke="var(--color-line)" strokeWidth={1} x1={margin.left} x2={width - margin.right} y1={baseline} y2={baseline} />

          {shown !== null && kind === "bar" ? (
            <rect fill="var(--color-line-soft)" height={plotHeight} opacity={0.7} rx={6} width={band - 4} x={xAt(shown) - (band - 4) / 2} y={margin.top} />
          ) : null}

          {kind === "bar"
            ? points.map((point, index) => {
                if (point.value <= 0) return null;
                const y = yAt(point.value);
                return <path d={roundedTopBar(xAt(index) - barWidth / 2, y, barWidth, baseline - y)} fill={color} key={point.full} opacity={shown === null || shown === index ? 1 : 0.55} />;
              })
            : max > 0 && (
                <>
                  <path d={areaPath} fill={color} opacity={0.1} />
                  <path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
                  {shown !== null ? <line stroke="var(--color-fg-faint)" strokeWidth={1} x1={xAt(shown)} x2={xAt(shown)} y1={margin.top} y2={baseline} /> : null}
                  {count ? (
                    <circle cx={xAt(shown ?? last)} cy={yAt(points[shown ?? last].value)} fill={color} r={4.5} stroke="var(--color-card)" strokeWidth={2} />
                  ) : null}
                </>
              )}

          {/* The latest period's value, so the newest number reads without hovering. */}
          {count && shown === null && points[last].value > 0 ? (
            <text className="fill-fg-soft text-[11px] font-semibold tabular-nums" textAnchor="middle" x={xAt(last)} y={yAt(points[last].value) - 9}>
              {formatValue(points[last].value)}
            </text>
          ) : null}

          {points.map((point, index) => (last - index) % labelEvery === 0 ? (
            <text className="fill-fg-muted text-[11px]" key={point.full} textAnchor="middle" x={xAt(index)} y={height - 8}>
              {point.short}
            </text>
          ) : null)}

          {max === 0 ? (
            <text className="fill-fg-muted text-[13px]" textAnchor="middle" x={margin.left + plotWidth / 2} y={margin.top + plotHeight / 2}>
              No {unit} in this range yet
            </text>
          ) : null}
        </svg>

        {activePoint ? (
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-control border border-line bg-card px-3 py-2 text-xs shadow-md"
            style={{ left: tooltipLeft }}
          >
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: color }} />
              <span className="text-sm font-semibold text-fg tabular-nums">{formatValue(activePoint.value)}</span>
              <span className="text-fg-muted">{unit}</span>
            </div>
            <div className="mt-0.5 text-fg-muted">{activePoint.full}</div>
          </div>
        ) : null}
      </div>

      <details className="mt-2 text-xs text-fg-muted">
        <summary className="cursor-pointer select-none hover:text-fg">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="border-b border-line-soft">
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium capitalize">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr className="border-b border-line-soft last:border-0" key={point.full}>
                <td className="py-1 text-fg-soft">{point.full}</td>
                <td className="py-1 text-right text-fg tabular-nums">{formatValue(point.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
