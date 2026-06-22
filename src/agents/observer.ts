// Observer agent.
//
// Produces a structured, NON-PREDICTIVE observation of the current state of
// a market based on its latest indicator values.
//
// HARD RULES (enforced in code):
//   - strategyBias is always "observe" — this system never trades.
//   - summary describes CURRENT conditions only. No "will rise" / "expected
//     to" / "likely to" language. Verifiable facts only.
//   - The primary observation timeframe is 4h (documented in README + here).

import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import { computeIndicators } from "../indicators/compute.js";
import type {
  Candle,
  Interval,
  Market,
  Observation,
  Trend,
  Volatility,
} from "../types.js";

export const PRIMARY_OBSERVATION_INTERVAL: Interval = "4h";

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function classifyTrend(
  close: number,
  ema20: number | null,
  ema60: number | null,
): Trend {
  if (ema20 === null || ema60 === null) return "ranging";
  if (close > ema20 && ema20 > ema60) return "bullish";
  if (close < ema20 && ema20 < ema60) return "bearish";
  return "ranging";
}

function classifyVolatility(
  atrPct: number | null,
  atrPctMean: number,
): Volatility {
  if (atrPct === null || atrPctMean <= 0) return "normal";
  const ratio = atrPct / atrPctMean;
  if (ratio < 0.8) return "low";
  if (ratio < 1.2) return "normal";
  if (ratio < 2.0) return "elevated";
  return "high";
}

function computeConfidence(args: {
  trend: Trend;
  macdHist: number | null;
  rsi: number | null;
  close: number;
  ema20: number | null;
  ema60: number | null;
}): number {
  // Higher when EMA20/EMA60 agree on direction AND MACD hist sign agrees.
  // Lower when conflicting.
  let score = 0.5;
  const { trend, macdHist, rsi, close, ema20, ema60 } = args;

  if (ema20 !== null && ema60 !== null) {
    const emaBullish = ema20 > ema60;
    const emaBearish = ema20 < ema60;
    if ((trend === "bullish" && emaBullish) || (trend === "bearish" && emaBearish)) {
      score += 0.15;
    }
    if (trend === "ranging" && Math.abs(ema20 - ema60) / Math.max(Math.abs(ema60), 1e-9) < 0.005) {
      // EMAs are essentially flat against each other — confidence in "ranging" is OK but lower.
      score += 0.05;
    }
  }

  if (macdHist !== null) {
    if ((trend === "bullish" && macdHist > 0) || (trend === "bearish" && macdHist < 0)) {
      score += 0.15;
    } else if (macdHist === 0) {
      score -= 0.05;
    } else if (trend !== "ranging") {
      score -= 0.15;
    }
  } else {
    score -= 0.05;
  }

  if (rsi !== null) {
    if (trend === "bullish" && rsi > 50) score += 0.1;
    else if (trend === "bullish" && rsi < 50) score -= 0.1;
    else if (trend === "bearish" && rsi < 50) score += 0.1;
    else if (trend === "bearish" && rsi > 50) score -= 0.1;
    if (rsi >= 70 || rsi <= 30) score -= 0.05; // extreme RSI = less clean read
  } else {
    score -= 0.05;
  }

  // Distance of close from EMAs — small distance = ranging = lower confidence
  // in a directional call.
  if (ema20 !== null) {
    const dist = Math.abs(close - ema20) / Math.max(Math.abs(ema20), 1e-9);
    if (trend !== "ranging" && dist < 0.002) score -= 0.05;
  }

  return clamp01(score);
}

function fmtPriceAdaptive(x: number): string {
  if (!Number.isFinite(x) || x === 0) return x.toString();
  const ax = Math.abs(x);
  if (ax >= 1000) return x.toFixed(2);
  if (ax >= 1) return x.toFixed(4);
  if (ax >= 0.01) return x.toFixed(6);
  return x.toExponential(3);
}

function buildSummary(args: {
  market: Market;
  close: number;
  ema20: number | null;
  ema60: number | null;
  rsi: number | null;
  macdHist: number | null;
  atrPct: number | null;
  atrPctMean: number | null;
  trend: Trend;
  volatility: Volatility;
  interval: Interval;
}): string {
  const parts: string[] = [];
  const f = fmtPriceAdaptive;
  if (args.ema20 !== null && args.ema60 !== null) {
    if (args.trend === "bullish") {
      parts.push(
        `Price ${f(args.close)} is above EMA20 ${f(args.ema20)} and EMA60 ${f(args.ema60)} on ${args.interval}.`,
      );
    } else if (args.trend === "bearish") {
      parts.push(
        `Price ${f(args.close)} is below EMA20 ${f(args.ema20)} and EMA60 ${f(args.ema60)} on ${args.interval}.`,
      );
    } else {
      parts.push(
        `Price ${f(args.close)} is mixed relative to EMA20 ${f(args.ema20)} and EMA60 ${f(args.ema60)} on ${args.interval}.`,
      );
    }
  } else {
    parts.push(`Price ${f(args.close)} on ${args.interval}; EMAs not yet available.`);
  }
  if (args.rsi !== null) {
    parts.push(`RSI ${args.rsi.toFixed(1)}.`);
  }
  if (args.macdHist !== null) {
    const sign = args.macdHist >= 0 ? "positive" : "negative";
    parts.push(`MACD histogram is ${sign} (${args.macdHist.toFixed(4)}).`);
  }
  if (args.atrPct !== null && args.atrPctMean !== null && args.atrPctMean > 0) {
    const ratio = args.atrPct / args.atrPctMean;
    parts.push(
      `ATR ${args.atrPct.toFixed(2)}% vs ${args.atrPctMean.toFixed(2)}% 20-period mean (${ratio.toFixed(2)}x).`,
    );
  } else if (args.atrPct !== null) {
    parts.push(`ATR ${args.atrPct.toFixed(2)}%.`);
  }
  return parts.join(" ");
}

export function observeMarket(
  market: Market,
  candles: readonly Candle[],
  indicators: ReturnType<typeof computeIndicators>,
): Observation | null {
  if (candles.length === 0 || indicators.length === 0) return null;
  const lastCandle = candles[candles.length - 1]!;
  const lastInd = indicators[indicators.length - 1]!;
  // 20-period mean of atr_pct for volatility classification. Use the most
  // recent up-to-20 valid atr_pct values; ignore nulls.
  const recentAtrPct: number[] = [];
  for (let i = indicators.length - 1; i >= 0 && recentAtrPct.length < 20; i--) {
    const v = indicators[i]!.atrPct;
    if (v !== null) recentAtrPct.push(v);
  }
  recentAtrPct.reverse();
  const atrPctMean = recentAtrPct.length > 0 ? mean(recentAtrPct) : null;
  const trend = classifyTrend(lastCandle.close, lastInd.ema20, lastInd.ema60);
  const volatility = classifyVolatility(lastInd.atrPct, atrPctMean ?? 0);
  const confidence = computeConfidence({
    trend,
    macdHist: lastInd.macdHist,
    rsi: lastInd.rsi,
    close: lastCandle.close,
    ema20: lastInd.ema20,
    ema60: lastInd.ema60,
  });
  const summary = buildSummary({
    market,
    close: lastCandle.close,
    ema20: lastInd.ema20,
    ema60: lastInd.ema60,
    rsi: lastInd.rsi,
    macdHist: lastInd.macdHist,
    atrPct: lastInd.atrPct,
    atrPctMean,
    trend,
    volatility,
    interval: lastCandle.interval,
  });
  return {
    market,
    interval: lastCandle.interval,
    strategyBias: "observe",
    confidence,
    trend,
    volatility,
    summary,
    // Anchor the observation to the market data it describes, not the analyze
    // run time. This makes day-over-day comparisons deterministic and avoids
    // timezone/boundary issues caused by wall-clock timestamps.
    ts: lastCandle.closeTime,
    close: lastCandle.close,
  };
}

export type AnalyzeOptions = {
  baseUrl?: string;
  markets?: readonly Market[];
  intervals?: readonly Interval[];
  logger?: Logger;
};

export type AnalyzeResult = {
  marketsAnalyzed: number;
  indicatorsUpserted: number;
  observationsInserted: number;
  byMarket: Record<string, { observations: number; indicators: number; trend: string; volatility: string }>;
};

export async function runAnalyze(opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const db = getDb(config.dbPath);
  const repo = new Repository(db);

  const markets = opts.markets ?? config.markets;
  const intervals = opts.intervals ?? config.intervals;
  const now = Date.now();
  let totalIndicators = 0;
  let totalObservations = 0;
  const byMarket: AnalyzeResult["byMarket"] = {};

  for (const market of markets) {
    for (const interval of intervals) {
      // Need enough history for EMA60 + ATR(14) + MACD(26) ≈ 80+ candles.
      const candles = repo.queryLatestCandles(market, interval, now, 1000);
      if (candles.length < 80) {
        logger.warn(
          `analyze ${market} ${interval}: only ${candles.length} candles — need ≥80, skipping`,
        );
        continue;
      }
      candles.sort((a, b) => a.openTime - b.openTime);
      const indicators = computeIndicators(market, interval, candles);
      const upserted = repo.upsertIndicators(indicators);
      totalIndicators += upserted;
      logger.info(`analyze ${market} ${interval}: ${candles.length} candles → ${upserted} indicator rows`);

      // Emit one observation per (market, interval). The daily report uses 4h.
      const obs = observeMarket(market, candles, indicators);
      if (obs) {
        repo.insertObservation(obs);
        totalObservations++;
        byMarket[market] = {
          observations: (byMarket[market]?.observations ?? 0) + 1,
          indicators: (byMarket[market]?.indicators ?? 0) + upserted,
          trend: obs.trend,
          volatility: obs.volatility,
        };
        logger.info(
          `observation ${market} ${interval}: trend=${obs.trend} vol=${obs.volatility} conf=${obs.confidence.toFixed(2)}`,
        );
      }
    }
  }

  logger.info(
    `analyze done: indicators=${totalIndicators} observations=${totalObservations} markets=${markets.length}`,
  );
  return {
    marketsAnalyzed: markets.length,
    indicatorsUpserted: totalIndicators,
    observationsInserted: totalObservations,
    byMarket,
  };
}
