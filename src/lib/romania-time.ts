// QTS works on Romania time: applied dates and the daily 4:00 PM clean-up use Europe/Bucharest,
// whatever the server's or the viewer's own time zone.

export const ROMANIA_TIME_ZONE = "Europe/Bucharest";

/** Today's date in Romania (YYYY-MM-DD) and the hour there (0–23). */
export function romaniaClock(now: Date = new Date()): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ROMANIA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** A moment as Romania time, for example "27 Oct 2026, 18:43". */
export function formatRomaniaTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ROMANIA_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** A moment's date in Romania as YYYY/MM/DD. */
export function formatRomaniaDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return romaniaClock(date).day.replaceAll("-", "/");
}
