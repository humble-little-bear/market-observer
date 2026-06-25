import { config } from "../config/index.js";
import { PRIMARY_OBSERVATION_INTERVAL } from "../agents/observer.js";
import { intervalToMs } from "../intervals.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import type { AlertEvent } from "../types.js";

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
