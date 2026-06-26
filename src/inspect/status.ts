import { config } from "../config/index.js";
import { PRIMARY_OBSERVATION_INTERVAL } from "../agents/observer.js";
import { intervalToMs } from "../intervals.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import { buildStructureInsight } from "../structure/insights.js";
import type { AlertEvent, MarketMetric } from "../types.js";

export type StatusOptions = {
  nowMs?: number;
};

function fmtTs(ts: number | null): string {
  if (ts === null) return "none";
  return new Date(ts).toISOString();
}

function fmtLag(ts: number | null, nowMs: number): string {
  if (ts === null) return "n/a";
  const mins = Math.max(0, Math.round((nowMs - ts) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 48) return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function fmtAlert(event: AlertEvent | undefined): string {
  if (!event) return "none";
  const sent = event.sentAt === null ? "unsent" : `sent ${fmtTs(event.sentAt)}`;
  return `${fmtTs(event.ts)} ${event.severity} ${event.market} ${event.interval} ${event.type} (${sent})`;
}

function fmtUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toFixed(0);
}

function fmtMetric(metric: MarketMetric): string {
  const oi = metric.openInterest === null ? "" : ` oi ${metric.openInterest.toFixed(0)}`;
  const funding = metric.fundingRate === null ? "" : ` funding ${(metric.fundingRate * 100).toFixed(4)}%`;
  const basis = metric.basisBps === null ? "" : ` basis ${metric.basisBps.toFixed(1)}bps`;
  const slip =
    metric.slippageBuy10kBps === null || metric.slippageSell10kBps === null
      ? ""
      : ` slip10k ${metric.slippageBuy10kBps.toFixed(1)}/${metric.slippageSell10kBps.toFixed(1)}bps`;
  return `${metric.venue} mid ${metric.midPrice.toFixed(4)} spread ${metric.spreadBps.toFixed(2)}bps depth25 ${fmtUsd(metric.depthBid25Bps)}/${fmtUsd(metric.depthAsk25Bps)} imb ${metric.imbalance25Bps.toFixed(2)}${slip}${basis}${funding}${oi} lag ${fmtLag(metric.ts, Date.now())}`;
}

function fmtPct(value: number | null): string {
  return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(0)}%`;
}

export function renderStatus(opts: StatusOptions = {}): string {
  const nowMs = opts.nowMs ?? Date.now();
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  const lines: string[] = [];

  lines.push(`DB: ${config.dbPath}`);
  lines.push(`Markets: ${config.markets.join(", ")}`);
  lines.push(`Intervals: ${config.intervals.join(", ")}`);
  lines.push(`Request gap: ${config.collectMinRequestIntervalMs}ms`);
  lines.push("");

  for (const market of config.markets) {
    lines.push(market);
    for (const interval of config.intervals) {
      const latestCandle = repo.queryLatestCandles(market, interval, nowMs, 1)[0];
      const latestObs = repo.queryLatestObservation(market, interval);
      const expectedLag = Math.round(intervalToMs(interval) / 60_000);
      const candleTs = latestCandle?.closeTime ?? null;
      const obsText = latestObs
        ? `${latestObs.trend}/${latestObs.volatility}/conf ${(latestObs.confidence * 100).toFixed(0)}%`
        : "none";
      lines.push(
        `  ${interval.padEnd(3)} candle ${fmtTs(candleTs)} lag ${fmtLag(candleTs, nowMs)} expected<=~${expectedLag}m obs ${obsText}`,
      );
    }
    const primary = repo.queryLatestObservation(market, PRIMARY_OBSERVATION_INTERVAL);
    if (primary) {
      lines.push(
        `  primary ${PRIMARY_OBSERVATION_INTERVAL}: ${primary.trend}/${primary.volatility} close ${primary.close}`,
      );
    }
    const metrics = repo.queryLatestMarketMetrics(market, 2);
    for (const metric of metrics) {
      lines.push(`  structure ${fmtMetric(metric)}`);
    }
    const insight = buildStructureInsight(repo, market);
    if (insight) {
      lines.push(`  structure labels: ${insight.summary}`);
      const oneHour = insight.windows.find((w) => w.window === "1h");
      if (oneHour) {
        lines.push(
          `  structure 1h: spotDepth ${fmtPct(oneHour.spotDepth25Pct)} futuresDepth ${fmtPct(oneHour.futuresDepth25Pct)} oi ${fmtPct(oneHour.openInterestPct)} slippage ${fmtPct(oneHour.spotSlippagePct)}/${fmtPct(oneHour.futuresSlippagePct)}`,
        );
      }
    }
    lines.push("");
  }

  const counts = repo.countAlertEvents();
  const recent = repo.queryAlertEvents(1)[0];
  lines.push("Alerts");
  lines.push(`  total: ${counts.total}`);
  lines.push(`  unsent: ${counts.unsent}`);
  lines.push(`  last: ${fmtAlert(recent)}`);

  return lines.join("\n");
}

export function renderAlerts(args: { limit: number; unsentOnly: boolean }): string {
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  const events = args.unsentOnly ? repo.queryUnsentAlertEvents(args.limit) : repo.queryAlertEvents(args.limit);
  if (events.length === 0) {
    return args.unsentOnly ? "No unsent alerts." : "No alerts.";
  }

  const lines: string[] = [];
  for (const event of events) {
    const sent = event.sentAt === null ? "unsent" : `sent ${fmtTs(event.sentAt)}`;
    lines.push(
      `[${fmtTs(event.ts)}] ${event.severity.toUpperCase()} ${event.market} ${event.interval} ${event.type} (${sent})`,
    );
    lines.push(`  ${event.title}`);
    lines.push(`  ${event.body}`);
  }
  return lines.join("\n");
}
