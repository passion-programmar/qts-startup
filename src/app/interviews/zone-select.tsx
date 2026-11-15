"use client";

// A time zone menu: the common zones first (CET, GMT, Japan…), then every other zone the browser knows.
import { useMemo } from "react";
import { commonTimeZones, zoneShortName } from "@/server/interviews/zone-time";

function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export function ZoneSelect({
  id,
  name,
  value,
  onChange,
  allowNone,
  label,
  className = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100",
  short = false,
}: {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
  /** For screen readers, when no visible label is next to it. */
  label?: string;
  className?: string;
  /** Common zones as "CET · Central Europe…" (short name first), for narrow places. */
  short?: boolean;
}) {
  const more = useMemo(() => allZones().filter((zone) => !commonTimeZones.some((entry) => entry.zone === zone)), []);
  const known = !value || commonTimeZones.some((entry) => entry.zone === value) || more.includes(value);
  return (
    <select aria-label={label} className={className} id={id} name={name} onChange={(event) => onChange(event.target.value)} value={value}>
      {allowNone && <option value="">None</option>}
      {!known && <option value={value}>{value}</option>}
      <optgroup label="Common">
        {commonTimeZones.map((entry) => (
          <option key={entry.zone} value={entry.zone}>
            {short ? `${zoneShortName(entry.zone)} · ${entry.label}` : `${entry.label} — ${zoneShortName(entry.zone)}`}
          </option>
        ))}
      </optgroup>
      {more.length > 0 && (
        <optgroup label="More time zones">
          {more.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
        </optgroup>
      )}
    </select>
  );
}
