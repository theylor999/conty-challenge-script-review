export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1900; // Date.UTC treats years 0-99 as 1900+, so stay clear of them.

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Strict YYYY-MM-DD. Returns null for datetimes, extra spaces and impossible dates like 2026-02-30. */
export function parseCivilDate(value: string): CivilDate | null {
  const m = CIVIL_DATE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  return { year, month, day };
}

export function formatCivilDate({ year, month, day }: CivilDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date (as yyyymmdd) that a UTC instant has in the given IANA zone. */
function localDateKey(ms: number, timeZone: string): number {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, fmt);
  }
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(ms)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return parts.year! * 10_000 + parts.month! * 100 + parts.day!;
}

const HOUR = 3_600_000;

/**
 * First instant (epoch ms) at which the zone's calendar shows `date` or later.
 * Searches the zone database instead of assuming a fixed offset, so zones with
 * DST (including Brazil before 2019, where midnight could not exist) stay correct.
 */
export function startOfDay(date: CivilDate, timeZone: string): number {
  const target = date.year * 10_000 + date.month * 100 + date.day;
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  // Real offsets are within -12h..+14h, so these bounds always straddle the target.
  let lo = utcMidnight - 15 * HOUR; // still before the target date in every zone
  let hi = utcMidnight + 13 * HOUR; // already on the target date or later in every zone
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (localDateKey(mid, timeZone) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Last millisecond of `date` in the zone: the instant before the next day starts. */
export function endOfDay(date: CivilDate, timeZone: string): number {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return (
    startOfDay(
      { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
      timeZone,
    ) - 1
  );
}
