import { config } from "../config/index.js";
import { PRIMARY_OBSERVATION_INTERVAL } from "../agents/observer.js";
import { makeLogger, type Logger } from "../logger.js";
import { sendBarkNotification } from "../notifications/bark.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import type { AlertEvent, DigestRun, Market, Observation } from "../types.js";

export type DigestOptions = {
  nowMs?: number;
  logger?: Logger;
  notify?: boolean;
  force?: boolean;
};

function periodFor(nowMs: number): { start: number; end: number } {
  const intervalMs = config.digestIntervalHours * 60 * 60_000;
  const end = Math.floor(nowMs / intervalMs) * intervalMs;
  return { start: end - intervalMs, end };
}

function fmtHour(ts: number): string {
  return new Date(ts).toISOString().slice(5, 16).replace("T", " ");
}

function trendZh(value: Observation["trend"]): string {
  if (value === "bullish") return "多头";
  if (value === "bearish") return "空头";
  return "震荡";
}

function volatilityZh(value: Observation["volatility"]): string {
  if (value === "low") return "低波动";
  if (value === "normal") return "正常";
  if (value === "elevated") return "波动升高";
  return "高波动";
}

function alertTypeZh(type: AlertEvent["type"]): string {
  switch (type) {
    case "sharp_move":
      return "急涨跌";
    case "trend_change":
      return "趋势变化";
    case "volatility_upgrade":
      return "波动升高";
    case "multi_timeframe_alignment":
      return "多周期同向";
  }
}

function marketLabel(market: Market): string {
  if (market.endsWith("USDT")) return market.slice(0, -"USDT".length);
  return market;
}

function summarizeAlerts(alerts: readonly AlertEvent[]): string[] {
  if (alerts.length === 0) return ["提醒：本窗口没有触发 alert。"];

  const byMarket = new Map<Market, number>();
  const byType = new Map<AlertEvent["type"], number>();
  for (const alert of alerts) {
    byMarket.set(alert.market, (byMarket.get(alert.market) ?? 0) + 1);
    byType.set(alert.type, (byType.get(alert.type) ?? 0) + 1);
  }

  const marketSummary = [...byMarket.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([market, count]) => `${marketLabel(market)} ${count}`)
    .join("，");
  const typeSummary = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${alertTypeZh(type)} ${count}`)
    .join("，");

  return [
    `提醒：共 ${alerts.length} 条。${marketSummary}`,
    `类型：${typeSummary}`,
  ];
}

function buildDigestBody(repo: Repository, start: number, end: number): string {
  const alerts = repo.queryAlertEventsBetween(start, end);
  const lines: string[] = [];
  lines.push(`${fmtHour(start)} - ${fmtHour(end)} UTC`);

  for (const market of config.markets) {
    const obs = repo.queryLatestObservation(market, PRIMARY_OBSERVATION_INTERVAL);
    if (!obs) {
      lines.push(`${marketLabel(market)}：暂无 ${PRIMARY_OBSERVATION_INTERVAL} 观察`);
      continue;
    }
    lines.push(
      `${marketLabel(market)} ${obs.close}：${PRIMARY_OBSERVATION_INTERVAL} ${trendZh(obs.trend)} / ${volatilityZh(obs.volatility)}`,
    );
  }

  lines.push(...summarizeAlerts(alerts));
  return lines.join("\n");
}

export function buildDigestRun(opts: DigestOptions = {}): DigestRun {
  const nowMs = opts.nowMs ?? Date.now();
  const { start, end } = periodFor(nowMs);
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  return {
    periodStart: start,
    periodEnd: end,
    title: `${config.digestIntervalHours}小时市场摘要`,
    body: buildDigestBody(repo, start, end),
    sentAt: null,
  };
}

export async function runDigest(opts: DigestOptions = {}): Promise<{ created: boolean; sent: boolean; digest: DigestRun }> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const digest = buildDigestRun(opts);
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  const existing = repo.queryDigestRun(digest.periodStart, digest.periodEnd);
  if (existing && !opts.force && (existing.sentAt !== null || opts.notify !== true)) {
    return { created: false, sent: existing.sentAt !== null, digest: existing };
  }

  const created = existing ? false : repo.insertDigestRun(digest);
  const current = repo.queryDigestRun(digest.periodStart, digest.periodEnd) ?? digest;
  if (opts.notify === true && current.sentAt === null) {
    await sendBarkNotification({
      title: current.title,
      body: current.body,
      level: "active",
      logger,
    });
    if (current.id !== undefined) repo.markDigestRunSent(current.id, Date.now());
    return { created, sent: true, digest: { ...current, sentAt: Date.now() } };
  }

  return { created, sent: false, digest: current };
}
