import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import type { AlertEvent, AlertSeverity, Interval, Market, Observation, Volatility } from "../types.js";

export type EvaluateAlertsOptions = {
  market: Market;
  interval: Interval;
  logger?: Logger;
};

export type EvaluateAlertsResult = {
  created: number;
};

const VOL_RANK: Record<Volatility, number> = {
  low: 0,
  normal: 1,
  elevated: 2,
  high: 3,
};

function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

function mkAlert(args: {
  market: Market;
  interval: Interval;
  ts: number;
  type: AlertEvent["type"];
  severity: AlertSeverity;
  fingerprint: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}): AlertEvent {
  return {
    market: args.market,
    interval: args.interval,
    ts: args.ts,
    type: args.type,
    severity: args.severity,
    fingerprint: args.fingerprint,
    title: args.title,
    body: args.body,
    dataJson: JSON.stringify(args.data),
    sentAt: null,
  };
}

function trendChangeAlert(obs: Observation, prior: Observation | null): AlertEvent | null {
  if (!prior || prior.trend === obs.trend) return null;
  if (obs.interval !== "1h" && obs.interval !== "4h" && obs.interval !== "1d") return null;

  const severity: AlertSeverity = obs.interval === "4h" || obs.interval === "1d" ? "warn" : "info";
  return mkAlert({
    market: obs.market,
    interval: obs.interval,
    ts: obs.ts,
    type: "trend_change",
    severity,
    fingerprint: `${obs.market}:${obs.interval}:trend:${prior.trend}->${obs.trend}:${obs.ts}`,
    title: `${obs.market} ${obs.interval} trend changed`,
    body: `${prior.trend} -> ${obs.trend}. Close ${obs.close}. Volatility ${obs.volatility}.`,
    data: { previousTrend: prior.trend, trend: obs.trend, close: obs.close, confidence: obs.confidence },
  });
}

function volatilityUpgradeAlert(obs: Observation, prior: Observation | null): AlertEvent | null {
  if (!prior) return null;
  if (VOL_RANK[obs.volatility] <= VOL_RANK[prior.volatility]) return null;
  if (obs.volatility !== "elevated" && obs.volatility !== "high") return null;

  const severity: AlertSeverity = obs.volatility === "high" ? "critical" : "warn";
  return mkAlert({
    market: obs.market,
    interval: obs.interval,
    ts: obs.ts,
    type: "volatility_upgrade",
    severity,
    fingerprint: `${obs.market}:${obs.interval}:vol:${prior.volatility}->${obs.volatility}:${obs.ts}`,
    title: `${obs.market} ${obs.interval} volatility ${obs.volatility}`,
    body: `${prior.volatility} -> ${obs.volatility}. Trend ${obs.trend}. Close ${obs.close}.`,
    data: { previousVolatility: prior.volatility, volatility: obs.volatility, trend: obs.trend, close: obs.close },
  });
}

function sharpMoveAlert(repo: Repository, market: Market, interval: Interval): AlertEvent | null {
  const threshold = interval === "15m"
    ? config.alerts.sharpMove15mPct
    : interval === "1h"
    ? config.alerts.sharpMove1hPct
    : null;
  if (threshold === null) return null;

  const candles = repo.queryLatestCandles(market, interval, Date.now(), 2);
  if (candles.length < 2) return null;
  candles.sort((a, b) => a.openTime - b.openTime);
  const prev = candles[0]!;
  const latest = candles[1]!;
  const change = pctChange(prev.close, latest.close);
  if (Math.abs(change) < threshold) return null;

  const direction = change >= 0 ? "up" : "down";
  const severity: AlertSeverity = Math.abs(change) >= threshold * 2 ? "critical" : "warn";
  return mkAlert({
    market,
    interval,
    ts: latest.closeTime,
    type: "sharp_move",
    severity,
    fingerprint: `${market}:${interval}:sharp:${direction}:${latest.closeTime}`,
    title: `${market} ${interval} sharp move ${direction}`,
    body: `${change >= 0 ? "+" : ""}${change.toFixed(2)}% in last ${interval}. Close ${latest.close}.`,
    data: { previousClose: prev.close, close: latest.close, changePct: change, thresholdPct: threshold },
  });
}

function multiTimeframeAlignmentAlert(repo: Repository, market: Market): AlertEvent | null {
  const oneHour = repo.queryLatestObservation(market, "1h");
  const fourHour = repo.queryLatestObservation(market, "4h");
  if (!oneHour || !fourHour) return null;
  if (oneHour.trend === "ranging" || oneHour.trend !== fourHour.trend) return null;

  const previousOneHour = repo.queryLatestObservationBeforeTs(market, "1h", oneHour.ts);
  const previousFourHour = repo.queryLatestObservationBeforeTs(market, "4h", fourHour.ts);
  const wasAlreadyAligned =
    previousOneHour !== null &&
    previousFourHour !== null &&
    previousOneHour.trend === oneHour.trend &&
    previousFourHour.trend === fourHour.trend &&
    previousOneHour.trend === previousFourHour.trend;
  if (wasAlreadyAligned) return null;

  const ts = Math.max(oneHour.ts, fourHour.ts);
  return mkAlert({
    market,
    interval: "4h",
    ts,
    type: "multi_timeframe_alignment",
    severity: "info",
    fingerprint: `${market}:mtf:1h+4h:${oneHour.trend}:${oneHour.ts}:${fourHour.ts}`,
    title: `${market} 1h/4h aligned`,
    body: `1h and 4h are both ${oneHour.trend}. 1h close ${oneHour.close}; 4h close ${fourHour.close}.`,
    data: {
      trend: oneHour.trend,
      oneHourTs: oneHour.ts,
      fourHourTs: fourHour.ts,
      oneHourClose: oneHour.close,
      fourHourClose: fourHour.close,
    },
  });
}

export function evaluateAlerts(opts: EvaluateAlertsOptions): EvaluateAlertsResult {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  const latest = repo.queryLatestObservation(opts.market, opts.interval);
  if (!latest) return { created: 0 };

  const prior = repo.queryLatestObservationBeforeTs(opts.market, opts.interval, latest.ts);
  const candidates: Array<AlertEvent | null> = [
    trendChangeAlert(latest, prior),
    volatilityUpgradeAlert(latest, prior),
    sharpMoveAlert(repo, opts.market, opts.interval),
  ];

  if (opts.interval === "1h" || opts.interval === "4h") {
    candidates.push(multiTimeframeAlignmentAlert(repo, opts.market));
  }

  let created = 0;
  for (const event of candidates) {
    if (!event) continue;
    if (repo.insertAlertEvent(event)) {
      created++;
      logger.info(`alert: ${event.title}`);
    }
  }

  return { created };
}
