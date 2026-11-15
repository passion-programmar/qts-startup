// Moments shown and entered in a chosen time zone, for the Interviews page and calendar. Days are
// "YYYY-MM-DD" and times "HH:MM" in that zone. No server imports: the browser uses it too.

export const ROMANIA_ZONE = "Europe/Bucharest";
/** Central European Time (CET, CEST in summer): the zone interviews use unless a Manager picks another. */
export const CET_ZONE = "Europe/Berlin";

// The zones offered first in the settings; any other IANA zone can still be chosen.
export const commonTimeZones = [
  { zone: "Europe/Berlin", label: "CET/CEST · Central Europe (Berlin, Paris, Warsaw)" },
  { zone: "Europe/Bucharest", label: "Romania (EET/EEST)" },
  { zone: "UTC", label: "GMT / UTC (no summer time)" },
  { zone: "Europe/London", label: "UK (GMT/BST)" },
  { zone: "America/New_York", label: "US Eastern (ET)" },
  { zone: "America/Chicago", label: "US Central (CT)" },
  { zone: "America/Denver", label: "US Mountain (MT)" },
  { zone: "America/Los_Angeles", label: "US Pacific (PT)" },
  { zone: "America/Toronto", label: "Canada Eastern (Toronto)" },
  { zone: "Asia/Dubai", label: "Gulf (Dubai)" },
  { zone: "Asia/Karachi", label: "Pakistan (PKT)" },
  { zone: "Asia/Kolkata", label: "India (IST)" },
  { zone: "Asia/Singapore", label: "Singapore" },
  { zone: "Asia/Tokyo", label: "Japan (JST)" },
  { zone: "Australia/Sydney", label: "Australia Eastern (Sydney)" },
] as const;

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
const formatters = new Map<string, Intl.DateTimeFormat>();
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall-clock parts of a moment in a zone (month 1–12, weekday 0 = Sunday). */
export function zonedParts(moment: Date, zone: string): Parts {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    });
    formatters.set(zone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(moment).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: weekdays.indexOf(parts.weekday ?? ""),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The moment's day in the zone, "YYYY-MM-DD". */
export function zonedDay(moment: Date, zone: string): string {
  const parts = zonedParts(moment, zone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The moment's time in the zone, "HH:MM". */
export function zonedTime(moment: Date, zone: string): string {
  const parts = zonedParts(moment, zone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Minutes the zone is ahead of UTC at that moment. */
function offsetMinutes(moment: Date, zone: string): number {
  const parts = zonedParts(moment, zone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return Math.round((asUtc - Math.floor(moment.getTime() / 60000) * 60000) / 60000);
}

/** The moment a zone's wall clock shows day + time. In a summer-time gap it moves forward. */
export function zonedMoment(day: string, time: string, zone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0);
  let guess = wall - offsetMinutes(new Date(wall), zone) * 60000;
  // A second pass settles moments near a summer-time change.
  guess = wall - offsetMinutes(new Date(guess), zone) * 60000;
  return new Date(guess);
}

/** "YYYY-MM-DD" moved by some days. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** Weekday of a "YYYY-MM-DD" (0 = Sunday). */
export function weekdayOf(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1)).getUTCDay();
}

/** The Sunday that starts the day's week. */
export function startOfWeek(day: string): string {
  return addDays(day, -weekdayOf(day));
}

/** The first day of the day's month. */
export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The same day of the next (or previous) month, kept within that month. */
export function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const first = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(date ?? 1, last))}`;
}

/** The zone's short name at that moment, e.g. "GMT+2", "CET", "EST". */
// The usual short names (standard time, summer time); browsers write most of these as "GMT+1".
const knownShortNames: Record<string, [string, string]> = {
  "Europe/Berlin": ["CET", "CEST"],
  "Europe/Paris": ["CET", "CEST"],
  "Europe/Bucharest": ["EET", "EEST"],
  "Europe/London": ["GMT", "BST"],
  UTC: ["UTC", "UTC"],
  "Asia/Tokyo": ["JST", "JST"],
  "Asia/Dubai": ["GST", "GST"],
  "Asia/Karachi": ["PKT", "PKT"],
  "Asia/Kolkata": ["IST", "IST"],
  "Asia/Singapore": ["SGT", "SGT"],
  "Australia/Sydney": ["AEST", "AEDT"],
  "America/Toronto": ["EST", "EDT"],
};

export function zoneShortName(zone: string, moment: Date = new Date()): string {
  try {
    const known = knownShortNames[zone];
    if (known) {
      // Summer time is the larger of the year's two offsets (south of the equator too).
      const year = moment.getUTCFullYear();
      const standard = Math.min(offsetMinutes(new Date(Date.UTC(year, 0, 1)), zone), offsetMinutes(new Date(Date.UTC(year, 6, 1)), zone));
      return offsetMinutes(moment, zone) > standard ? known[1] : known[0];
    }
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(moment).find((entry) => entry.type === "timeZoneName");
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}

/** The label a zone is listed with in the settings. */
export function zoneLabel(zone: string): string {
  return commonTimeZones.find((entry) => entry.zone === zone)?.label ?? zone.replaceAll("_", " ");
}

/** Minutes between two moments. */
export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

/** "15:00–16:00": a round's start and end in the zone. */
export function timeRange(round: { startsAt: string | Date; endsAt: string | Date }, zone: string): string {
  return `${zonedTime(new Date(round.startsAt), zone)}–${zonedTime(new Date(round.endsAt), zone)}`;
}
