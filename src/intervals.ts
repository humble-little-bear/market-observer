import type { Interval } from "./types.js";

const INTERVAL_MS: Record<Interval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function intervalToMs(interval: Interval): number {
  return INTERVAL_MS[interval];
}

export function nextClosedCandleDueMs(interval: Interval, nowMs: number): number {
  const ms = intervalToMs(interval);
  return Math.floor(nowMs / ms) * ms + ms + 2_000;
}

