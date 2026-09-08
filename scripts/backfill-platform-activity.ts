import { resolve } from "node:path";
import { collectLongHistory, LONG_HISTORY_MAX_DAYS_PER_REQUEST } from "../src/collectors/long.js";
import {
  LONG_ACTIVITY_HISTORY_START_DATE,
  missingDateRanges,
} from "../src/platform-activity/backfill.js";
import { DashboardDatabase } from "../src/storage/database.js";
import { lastClosedUtcDate } from "../src/utils/time.js";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function assertDate(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be a UTC date in YYYY-MM-DD format`);
  }
  return value;
}

const startDate = assertDate(option("--from") ?? LONG_ACTIVITY_HISTORY_START_DATE, "--from");
const endDate = assertDate(option("--to") ?? lastClosedUtcDate(new Date()), "--to");
if (startDate > endDate) throw new Error("--from cannot be later than --to");
const chunkDays = Number.parseInt(option("--chunk-days") ?? "1", 10);
if (
  !Number.isInteger(chunkDays) ||
  chunkDays < 1 ||
  chunkDays > LONG_HISTORY_MAX_DAYS_PER_REQUEST
) {
  throw new Error(`--chunk-days must be between 1 and ${LONG_HISTORY_MAX_DAYS_PER_REQUEST}`);
}

const databasePath = resolve(
  option("--database") ?? process.env.DATABASE_PATH ?? "data/launchpad-dashboard.sqlite",
);
const database = new DashboardDatabase(databasePath);

try {
  const existingDates = new Set(
    database.getMetricHistory("long", "volume_usd").map((metric) => metric.date),
  );
  const ranges = missingDateRanges(startDate, endDate, existingDates, chunkDays);
  let written = 0;
  for (const [index, range] of ranges.entries()) {
    const batch = await collectLongHistory(range.startDate, range.endDate);
    if (
      batch.metrics.length === 0 ||
      batch.sourceHealth.some((source) => source.status === "failed")
    ) {
      throw new Error(`Long history source failed for ${range.startDate}..${range.endDate}`);
    }
    const metrics = batch.metrics.filter((metric) => !existingDates.has(metric.date));
    database.writeBatch({
      platforms: batch.platforms,
      metrics,
      stats: [],
      sourceHealth: [],
      raw: [],
      warnings: batch.warnings,
    });
    for (const metric of metrics) existingDates.add(metric.date);
    written += metrics.length;
    console.log(
      JSON.stringify({
        range: `${range.startDate}..${range.endDate}`,
        progress: `${index + 1}/${ranges.length}`,
        written: metrics.length,
      }),
    );
  }
  console.log(JSON.stringify({ ok: true, databasePath, startDate, endDate, chunkDays, written }));
} finally {
  database.close();
}
