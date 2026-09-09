import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { SourceReceipt } from "./types.js";

export interface FetchResult {
  data: unknown;
  receipt: SourceReceipt;
  rawText: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function sanitize(value: string): string {
  return value
    .replace(/:\/\/([^/@\s]+)@/g, "://[redacted]@")
    .replace(/([?&](?:api[_-]?key|token|key|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bbk_usr_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .slice(0, 600);
}

export async function fetchSource(
  id: string,
  label: string,
  url: string,
  init?: RequestInit,
): Promise<FetchResult> {
  const fetchedAt = new Date().toISOString();
  let lastError = "unknown fetch error";
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { accept: "application/json", "user-agent": "robinhood-chain-daily-radar/1.0", ...init?.headers },
        signal: controller.signal,
      });
      lastStatus = response.status;
      const rawText = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = JSON.parse(rawText);
      clearTimeout(timer);
      return {
        data,
        rawText,
        receipt: {
          id,
          label,
          url: sanitize(url),
          fetchedAt,
          ok: true,
          httpStatus: response.status,
          bytes: Buffer.byteLength(rawText),
          sha256: createHash("sha256").update(rawText).digest("hex"),
          dataDate: null,
          error: null,
        },
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = sanitize(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    data: null,
    rawText: "",
    receipt: {
      id,
      label,
      url: sanitize(url),
      fetchedAt,
      ok: false,
      httpStatus: lastStatus,
      bytes: null,
      sha256: null,
      dataDate: null,
      error: lastError,
    },
  };
}

export function previousUtcDate(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function dateDiffDays(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
}

export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temp = `${absolute}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, absolute);
}

export async function atomicWriteGzipJson(path: string, data: unknown): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temp = `${absolute}.${process.pid}.tmp`;
  const compressed = gzipSync(Buffer.from(`${JSON.stringify(data)}\n`), { level: 9 });
  await writeFile(temp, compressed, { mode: 0o600 });
  await rename(temp, absolute);
}

export async function atomicWriteText(path: string, data: string): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temp = `${absolute}.${process.pid}.tmp`;
  await writeFile(temp, data, { mode: 0o600 });
  await rename(temp, absolute);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as T;
}

export function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
