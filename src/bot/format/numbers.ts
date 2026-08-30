export function formatUsd(value: number | null): string {
  if (value === null) return "未知";
  if (!Number.isFinite(value)) return "未知";
  if (Object.is(value, -0) || value === 0) return "$0";
  if (value > 0 && value < 0.01) return "<$0.01";
  if (value < 0 && value > -0.01) return ">-$0.01";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "未知";
  if (Object.is(value, -0) || value === 0) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatUtcDate(value: string | null): string {
  return value ? `${value} UTC` : "未知日期";
}
