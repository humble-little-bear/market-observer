import type { GoldMove, GoldMoveDirection, GoldPricePoint } from "../types.js";

export function formatPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

function directionFromChange(change?: number): GoldMoveDirection {
  if (change === undefined || Math.abs(change) < 0.05) return "flat";
  return change > 0 ? "up" : "down";
}

function pointAtOrBefore(
  points: readonly GoldPricePoint[],
  targetTimeMs: number,
  maxLagMs: number,
): GoldPricePoint | undefined {
  let candidate: GoldPricePoint | undefined;
  for (const point of points) {
    if (point.time.getTime() <= targetTimeMs) candidate = point;
  }
  if (!candidate) return undefined;
  return targetTimeMs - candidate.time.getTime() <= maxLagMs ? candidate : undefined;
}

export function detectGoldMove(args: {
  symbol: string;
  points: readonly GoldPricePoint[];
  threshold5mPct: number;
  threshold15mPct: number;
}): GoldMove | undefined {
  const sorted = [...args.points].sort((a, b) => a.time.getTime() - b.time.getTime());
  const latest = sorted.at(-1);
  if (!latest) return undefined;

  const latestMs = latest.time.getTime();
  const point5m = pointAtOrBefore(sorted, latestMs - 5 * 60_000, 10 * 60_000);
  const point15m = pointAtOrBefore(sorted, latestMs - 15 * 60_000, 25 * 60_000);
  const change5mPct = point5m ? pctChange(point5m.price, latest.price) : undefined;
  const change15mPct = point15m ? pctChange(point15m.price, latest.price) : undefined;

  const triggerReasons: string[] = [];
  if (change5mPct !== undefined && Math.abs(change5mPct) >= args.threshold5mPct) {
    triggerReasons.push(`5m move ${formatPct(change5mPct)} crossed ${formatPct(args.threshold5mPct)} threshold`);
  }
  if (change15mPct !== undefined && Math.abs(change15mPct) >= args.threshold15mPct) {
    triggerReasons.push(`15m move ${formatPct(change15mPct)} crossed ${formatPct(args.threshold15mPct)} threshold`);
  }

  const direction = directionFromChange(change15mPct) !== "flat"
    ? directionFromChange(change15mPct)
    : directionFromChange(change5mPct);
  return {
    symbol: args.symbol,
    latest,
    change5mPct,
    change15mPct,
    direction,
    triggered: triggerReasons.length > 0,
    triggerReasons,
  };
}
