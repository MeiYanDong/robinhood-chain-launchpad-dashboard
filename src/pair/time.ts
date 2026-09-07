function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new Error("Invalid ISO date");
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function latestChinaEightCutoff(now: Date): { reportDate: string; cutoffAt: string } {
  if (Number.isNaN(now.valueOf())) throw new Error("Invalid report clock");
  const chinaClock = new Date(now.valueOf() + 8 * 60 * 60 * 1_000);
  let reportDate = isoDate(chinaClock);
  let cutoff = new Date(`${reportDate}T00:00:00.000Z`);
  if (cutoff.valueOf() > now.valueOf()) {
    reportDate = shiftIsoDate(reportDate, -1);
    cutoff = new Date(`${reportDate}T00:00:00.000Z`);
  }
  return { reportDate, cutoffAt: cutoff.toISOString() };
}
