import { shiftUtcDate, utcDateRange } from "../utils/time.js";

export const LONG_ACTIVITY_HISTORY_START_DATE = "2026-07-13";

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Build bounded contiguous ranges without requesting dates already in the ledger. */
export function missingDateRanges(
  startDate: string,
  endDate: string,
  existingDates: ReadonlySet<string>,
  maximumDays: number,
): DateRange[] {
  if (!Number.isInteger(maximumDays) || maximumDays < 1) {
    throw new Error("maximumDays must be a positive integer");
  }
  const missingDates = utcDateRange(startDate, endDate).filter((date) => !existingDates.has(date));
  const ranges: DateRange[] = [];
  let current: string[] = [];
  for (const date of missingDates) {
    const previous = current.at(-1);
    if (
      current.length > 0 &&
      (current.length >= maximumDays ||
        (previous !== undefined && date !== shiftUtcDate(previous, 1)))
    ) {
      ranges.push({ startDate: current[0] ?? date, endDate: previous ?? date });
      current = [];
    }
    current.push(date);
  }
  if (current.length > 0) {
    ranges.push({
      startDate: current[0] ?? startDate,
      endDate: current.at(-1) ?? endDate,
    });
  }
  return ranges;
}
