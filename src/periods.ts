export const PERIOD_WORDS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
] as const;

export type PeriodWord = (typeof PERIOD_WORDS)[number];

export interface DateRange {
  from: string; // yyyy-MM-dd inclusive
  to: string; // yyyy-MM-dd inclusive
}

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday */
function dayOfWeek(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function periodToRange(period: PeriodWord, tz: string): DateRange {
  const today = todayInTz(tz);
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "this_week":
      return { from: addDays(today, -dayOfWeek(today)), to: today };
    case "last_week": {
      const monday = addDays(today, -dayOfWeek(today) - 7);
      return { from: monday, to: addDays(monday, 6) };
    }
    case "this_month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last_month": {
      const firstOfThis = `${today.slice(0, 8)}01`;
      const lastOfPrev = addDays(firstOfThis, -1);
      return { from: `${lastOfPrev.slice(0, 8)}01`, to: lastOfPrev };
    }
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
  }
}

export function resolveRange(
  args: { period?: PeriodWord; from?: string; to?: string },
  tz: string
): DateRange {
  if (args.period && (args.from || args.to)) {
    throw new Error("Pass either `period` or explicit `from`/`to` dates, not both.");
  }
  if (args.period) return periodToRange(args.period, tz);
  if (args.from && args.to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
      throw new Error("`from` and `to` must be yyyy-MM-dd dates.");
    }
    return { from: args.from, to: args.to };
  }
  throw new Error("Provide `period` (e.g. \"this_week\") or both `from` and `to` dates.");
}

export function rangeDays(range: DateRange): number {
  const ms = Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Convert a wall-clock datetime in a timezone to a UTC Date.
 * Accepts "yyyy-MM-dd HH:mm[:ss]" or "yyyy-MM-ddTHH:mm[:ss]".
 */
export function wallTimeToUtc(input: string, tz: string): Date {
  let s = input.trim().replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ":00";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
    throw new Error(`Invalid datetime "${input}" — use "yyyy-MM-dd HH:mm" (interpreted in the user's timezone).`);
  }
  const target = Date.parse(`${s}Z`);
  let guess = target;
  // Iterate: adjust the UTC guess until it renders as the requested wall time in tz (handles DST).
  for (let i = 0; i < 3; i++) {
    guess += target - wallClockAsUtcMs(new Date(guess), tz);
  }
  return new Date(guess);
}

function wallClockAsUtcMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return Date.parse(`${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}Z`);
}

/** Format a unix-seconds timestamp as local wall time in tz: "yyyy-MM-dd HH:mm". */
export function unixToLocal(unixSeconds: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(unixSeconds * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
}
