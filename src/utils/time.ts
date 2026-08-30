const DAY_MS = 86_400_000;

export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function lastClosedUtcDate(now = new Date()): string {
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return formatUtcDate(new Date(utcMidnight - DAY_MS));
}

export function unixSecondsToUtcDate(timestamp: number): string {
  return formatUtcDate(new Date(timestamp * 1_000));
}

export function shiftUtcDate(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid UTC date: ${date}`);
  }
  return formatUtcDate(new Date(timestamp + days * DAY_MS));
}

export function isDateOnOrBefore(date: string, ceiling: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= ceiling;
}

export function windowStart(targetDate: string, windowDays: number): string {
  return shiftUtcDate(targetDate, -(windowDays - 1));
}

export function parseLooseUtcDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.valueOf()) ? null : formatUtcDate(parsed);
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (dateOnly) return dateOnly;

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : formatUtcDate(parsed);
}

export function utcDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = shiftUtcDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}
