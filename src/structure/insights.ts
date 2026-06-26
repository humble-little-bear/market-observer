import { Repository } from "../storage/repository.js";
import type { Market, MarketMetric } from "../types.js";

export type StructureWindowName = "15m" | "1h" | "4h";

export type StructureWindowChange = {
  window: StructureWindowName;
  spotDepth25Pct: number | null;
  spotSlippagePct: number | null;
  futuresDepth25Pct: number | null;
  futuresSlippagePct: number | null;
  openInterestPct: number | null;
  basisBpsChange: number | null;
  fundingRateChange: number | null;
};

export type StructureSignal =
  | "liquidity_thinning"
  | "futures_crowding"
  | "basis_divergence"
  | "book_bullish"
  | "book_bearish"
  | "stable";

export type StructureInsight = {
  market: Market;
  spot: MarketMetric | null;
  futures: MarketMetric | null;
  windows: readonly StructureWindowChange[];
  signals: readonly StructureSignal[];
  labels: readonly string[];
  abnormalLines: readonly string[];
  summary: string;
};

const WINDOW_MS: Record<StructureWindowName, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
};

const SIGNAL_ZH: Record<StructureSignal, string> = {
  liquidity_thinning: "流动性变薄",
  futures_crowding: "永续拥挤",
  basis_divergence: "期现偏离",
  book_bullish: "盘口偏多",
  book_bearish: "盘口偏空",
  stable: "结构平稳",
};

function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function diff(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  return to - from;
}

function depth25(metric: MarketMetric | null): number | null {
  if (!metric) return null;
  return metric.depthBid25Bps + metric.depthAsk25Bps;
}

function maxSlippage(metric: MarketMetric | null): number | null {
  if (!metric || metric.slippageBuy10kBps === null || metric.slippageSell10kBps === null) {
    return null;
  }
  return Math.max(metric.slippageBuy10kBps, metric.slippageSell10kBps);
}

function buildWindow(
  repo: Repository,
  market: Market,
  spot: MarketMetric | null,
  futures: MarketMetric | null,
  window: StructureWindowName,
): StructureWindowChange {
  const latestTs = Math.max(spot?.ts ?? 0, futures?.ts ?? 0);
  const targetTs = latestTs - WINDOW_MS[window];
  const priorSpot = spot ? repo.queryMarketMetricAtOrBefore(market, "spot", targetTs) : null;
  const priorFutures = futures ? repo.queryMarketMetricAtOrBefore(market, "futures", targetTs) : null;

  return {
    window,
    spotDepth25Pct: pctChange(depth25(priorSpot), depth25(spot)),
    spotSlippagePct: pctChange(maxSlippage(priorSpot), maxSlippage(spot)),
    futuresDepth25Pct: pctChange(depth25(priorFutures), depth25(futures)),
    futuresSlippagePct: pctChange(maxSlippage(priorFutures), maxSlippage(futures)),
    openInterestPct: pctChange(priorFutures?.openInterest ?? null, futures?.openInterest ?? null),
    basisBpsChange: diff(priorFutures?.basisBps ?? null, futures?.basisBps ?? null),
    fundingRateChange: diff(priorFutures?.fundingRate ?? null, futures?.fundingRate ?? null),
  };
}

function hasLiquidityThinning(windows: readonly StructureWindowChange[]): boolean {
  return windows.some((w) =>
    (w.window === "1h" || w.window === "4h") &&
    ((w.spotDepth25Pct !== null && w.spotDepth25Pct <= -30) ||
      (w.futuresDepth25Pct !== null && w.futuresDepth25Pct <= -30) ||
      (w.spotSlippagePct !== null && w.spotSlippagePct >= 50) ||
      (w.futuresSlippagePct !== null && w.futuresSlippagePct >= 50)),
  );
}

function hasFuturesCrowding(futures: MarketMetric | null, windows: readonly StructureWindowChange[]): boolean {
  if (!futures) return false;
  const fundingAbs = futures.fundingRate === null ? 0 : Math.abs(futures.fundingRate);
  const basisAbs = futures.basisBps === null ? 0 : Math.abs(futures.basisBps);
  return windows.some((w) =>
    (w.window === "1h" || w.window === "4h") &&
    w.openInterestPct !== null &&
    w.openInterestPct >= 2 &&
    (fundingAbs >= 0.00005 || basisAbs >= 5),
  );
}

function hasBasisDivergence(futures: MarketMetric | null): boolean {
  return futures?.basisBps !== null && futures !== null && Math.abs(futures.basisBps) >= 8;
}

function bookSignal(spot: MarketMetric | null, futures: MarketMetric | null): StructureSignal | null {
  const spotImb = spot?.imbalance25Bps ?? 0;
  const futImb = futures?.imbalance25Bps ?? 0;
  const avg = spot && futures ? (spotImb + futImb) / 2 : spot ? spotImb : futures ? futImb : 0;
  if (avg >= 0.25) return "book_bullish";
  if (avg <= -0.25) return "book_bearish";
  return null;
}

function fmtPct(value: number | null): string {
  return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;
}

function fmtBps(value: number | null): string {
  return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}bps`;
}

function abnormalLines(
  futures: MarketMetric | null,
  windows: readonly StructureWindowChange[],
  signals: readonly StructureSignal[],
): string[] {
  const lines: string[] = [];
  const oneHour = windows.find((w) => w.window === "1h");
  const fourHour = windows.find((w) => w.window === "4h");

  if (signals.includes("liquidity_thinning")) {
    lines.push(
      `流动性：1h 现货深度 ${fmtPct(oneHour?.spotDepth25Pct ?? null)}，永续深度 ${fmtPct(oneHour?.futuresDepth25Pct ?? null)}，10k冲击 ${
        oneHour?.spotSlippagePct === null && oneHour?.futuresSlippagePct === null
          ? "n/a"
          : `${fmtPct(oneHour?.spotSlippagePct ?? null)}/${fmtPct(oneHour?.futuresSlippagePct ?? null)}`
      }`,
    );
  }

  if (signals.includes("futures_crowding")) {
    lines.push(
      `永续：1h OI ${fmtPct(oneHour?.openInterestPct ?? null)}，4h OI ${fmtPct(fourHour?.openInterestPct ?? null)}，资金费率 ${
        futures?.fundingRate === null || futures === null ? "n/a" : `${(futures.fundingRate * 100).toFixed(4)}%`
      }`,
    );
  }

  if (signals.includes("basis_divergence")) {
    lines.push(`期现：当前基差 ${fmtBps(futures?.basisBps ?? null)}，1h变化 ${fmtBps(oneHour?.basisBpsChange ?? null)}`);
  }

  return lines;
}

export function buildStructureInsight(repo: Repository, market: Market): StructureInsight | null {
  const spot = repo.queryLatestMarketMetric(market, "spot");
  const futures = repo.queryLatestMarketMetric(market, "futures");
  if (!spot && !futures) return null;

  const windows = (["15m", "1h", "4h"] as const).map((window) =>
    buildWindow(repo, market, spot, futures, window),
  );
  const signals = new Set<StructureSignal>();
  if (hasLiquidityThinning(windows)) signals.add("liquidity_thinning");
  if (hasFuturesCrowding(futures, windows)) signals.add("futures_crowding");
  if (hasBasisDivergence(futures)) signals.add("basis_divergence");
  const book = bookSignal(spot, futures);
  if (book) signals.add(book);
  if (signals.size === 0) signals.add("stable");

  const signalList = [...signals];
  const labels = signalList.map((signal) => SIGNAL_ZH[signal]);
  const lines = abnormalLines(futures, windows, signalList);
  return {
    market,
    spot,
    futures,
    windows,
    signals: signalList,
    labels,
    abnormalLines: lines,
    summary: labels.join("、"),
  };
}

export function signalZh(signal: StructureSignal): string {
  return SIGNAL_ZH[signal];
}
