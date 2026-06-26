import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import { PRIMARY_OBSERVATION_INTERVAL } from "../agents/observer.js";
import type { AlertEvent, Market, Observation } from "../types.js";

export type NotifyOptions = {
  logger?: Logger;
};

export type NotifyResult = {
  sent: boolean;
  title: string;
  body: string;
};

type BarkPayload = {
  device_key: string;
  title: string;
  body: string;
  group: string;
  level: "active" | "timeSensitive" | "passive";
};

type BarkResponse = {
  code?: number;
  message?: string;
  timestamp?: number;
};

type AlertData = Record<string, unknown>;

type AlertMessage = {
  title: string;
  body: string;
};

function fmtPriceAdaptive(x: number): string {
  if (!Number.isFinite(x) || x === 0) return x.toString();
  const ax = Math.abs(x);
  if (ax >= 1000) return x.toFixed(2);
  if (ax >= 1) return x.toFixed(4);
  if (ax >= 0.01) return x.toFixed(6);
  return x.toExponential(3);
}

function marketLabel(market: Market): string {
  if (market.endsWith("USDT")) return market.slice(0, -"USDT".length);
  if (market.endsWith("USD")) return market.slice(0, -"USD".length);
  return market;
}

function trendMark(trend: Observation["trend"]): string {
  switch (trend) {
    case "bullish":
      return "up";
    case "bearish":
      return "down";
    case "ranging":
      return "flat";
  }
}

function trendZh(value: unknown): string {
  switch (value) {
    case "bullish":
      return "多头";
    case "bearish":
      return "空头";
    case "ranging":
      return "震荡";
    default:
      return String(value);
  }
}

function volatilityZh(value: unknown): string {
  switch (value) {
    case "low":
      return "低";
    case "normal":
      return "正常";
    case "elevated":
      return "升高";
    case "high":
      return "高";
    default:
      return String(value);
  }
}

function numberFromData(data: AlertData, key: string): number | null {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assetClass(market: Market): "crypto" | "gold" {
  return market.startsWith("XAU") ? "gold" : "crypto";
}

function alertDirection(event: AlertEvent, data: AlertData): string {
  switch (event.type) {
    case "sharp_move": {
      const changePct = numberFromData(data, "changePct");
      return changePct === null || changePct >= 0 ? "up" : "down";
    }
    case "trend_change":
      return String(data.trend ?? "");
    case "volatility_upgrade":
      return String(data.volatility ?? "");
    case "multi_timeframe_alignment":
      return String(data.trend ?? "");
  }
}

function aggregationKey(event: AlertEvent): string {
  const data = parseAlertData(event);
  return [
    assetClass(event.market),
    event.type,
    event.interval,
    alertDirection(event, data),
    event.severity,
  ].join(":");
}

function parseAlertData(event: AlertEvent): AlertData {
  try {
    const parsed = JSON.parse(event.dataJson) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as AlertData;
    }
  } catch {
    // Fall through to an empty object. The original English body remains a
    // reasonable fallback when old rows do not have parseable metadata.
  }
  return {};
}

function buildChineseAlertMessage(event: AlertEvent): AlertMessage {
  const data = parseAlertData(event);
  const close = numberFromData(data, "close");
  const closeText = close === null ? "" : `收盘 ${close}；`;

  switch (event.type) {
    case "trend_change": {
      const previousTrend = trendZh(data.previousTrend);
      const trend = trendZh(data.trend);
      const confidence = numberFromData(data, "confidence");
      const confidenceText = confidence === null ? "" : `，置信度 ${(confidence * 100).toFixed(0)}%`;
      return {
        title: `${event.market} ${event.interval} 趋势变化`,
        body: `${closeText}趋势 ${previousTrend} -> ${trend}${confidenceText}`,
      };
    }
    case "volatility_upgrade": {
      const previousVolatility = volatilityZh(data.previousVolatility);
      const volatility = volatilityZh(data.volatility);
      return {
        title: `${event.market} ${event.interval} 波动升高`,
        body: `${closeText}波动 ${previousVolatility} -> ${volatility}，趋势 ${trendZh(data.trend)}`,
      };
    }
    case "sharp_move": {
      const changePct = numberFromData(data, "changePct");
      const thresholdPct = numberFromData(data, "thresholdPct");
      const direction = changePct === null || changePct >= 0 ? "急涨" : "急跌";
      const changeText = changePct === null ? "触发急涨急跌" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
      const thresholdText = thresholdPct === null ? "" : `，阈值 ${thresholdPct}%`;
      return {
        title: `${event.market} ${event.interval} ${direction}`,
        body: `${closeText}${event.interval} ${changeText}${thresholdText}`,
      };
    }
    case "multi_timeframe_alignment": {
      const oneHourClose = numberFromData(data, "oneHourClose");
      const fourHourClose = numberFromData(data, "fourHourClose");
      const priceText = oneHourClose === null && fourHourClose === null
        ? ""
        : `1h收盘 ${oneHourClose ?? "未知"}，4h收盘 ${fourHourClose ?? "未知"}；`;
      return {
        title: `${event.market} 1h/4h 同向`,
        body: `${priceText}1h 和 4h 同为${trendZh(data.trend)}，值得留意`,
      };
    }
  }
}

function severityRank(severity: AlertEvent["severity"]): number {
  if (severity === "critical") return 2;
  if (severity === "warn") return 1;
  return 0;
}

function maxSeverity(events: readonly AlertEvent[]): AlertEvent["severity"] {
  let out: AlertEvent["severity"] = "info";
  for (const event of events) {
    if (severityRank(event.severity) > severityRank(out)) out = event.severity;
  }
  return out;
}

function buildAggregatedAlertMessage(events: readonly AlertEvent[]): AlertMessage {
  const first = events[0]!;
  const firstData = parseAlertData(first);
  const direction = alertDirection(first, firstData);
  const directionZh = direction === "up"
    ? "急涨"
    : direction === "down"
    ? "急跌"
    : trendZh(direction);
  const className = assetClass(first.market) === "gold" ? "黄金" : "加密市场";

  const lines = events.map((event) => {
    const data = parseAlertData(event);
    const close = numberFromData(data, "close");
    const changePct = numberFromData(data, "changePct");
    const oneHourClose = numberFromData(data, "oneHourClose");
    const fourHourClose = numberFromData(data, "fourHourClose");
    if (event.type === "sharp_move" && changePct !== null) {
      return `${event.market} ${close ?? "未知"} ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;
    }
    if (event.type === "multi_timeframe_alignment") {
      return `${event.market} 1h ${oneHourClose ?? "未知"} / 4h ${fourHourClose ?? "未知"}`;
    }
    return `${event.market} ${close ?? "未知"} ${buildChineseAlertMessage(event).body}`;
  });

  switch (first.type) {
    case "sharp_move":
      return { title: `${className}同步${directionZh}`, body: lines.join("\n") };
    case "multi_timeframe_alignment":
      return { title: `${className}1h/4h同步${directionZh}`, body: lines.join("\n") };
    case "trend_change":
      return { title: `${className}趋势同步变化`, body: lines.join("\n") };
    case "volatility_upgrade":
      return { title: `${className}波动同步升高`, body: lines.join("\n") };
  }
}

function groupPendingAlerts(events: readonly AlertEvent[]): AlertEvent[][] {
  const groups: AlertEvent[][] = [];
  const used = new Set<number>();
  const windowMs = config.alerts.aggregationWindowMs;

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.id !== undefined && used.has(event.id)) continue;
    const key = aggregationKey(event);
    const group = [event];
    if (event.id !== undefined) used.add(event.id);

    for (let j = i + 1; j < events.length; j++) {
      const candidate = events[j]!;
      if (candidate.id !== undefined && used.has(candidate.id)) continue;
      if (Math.abs(candidate.ts - event.ts) > windowMs) continue;
      if (aggregationKey(candidate) !== key) continue;
      group.push(candidate);
      if (candidate.id !== undefined) used.add(candidate.id);
    }
    groups.push(group);
  }

  return groups;
}

function pickNotificationObservations(observations: readonly Observation[]): Observation[] {
  const byMarket = new Map<Market, Observation>();
  for (const obs of observations) {
    byMarket.set(obs.market, obs);
  }

  const picked: Observation[] = [];
  for (const market of config.markets) {
    const obs = byMarket.get(market);
    if (obs) picked.push(obs);
  }
  return picked;
}

function buildBarkMessage(observations: readonly Observation[]): { title: string; body: string } {
  const picked = pickNotificationObservations(observations);
  const title = `Market ${PRIMARY_OBSERVATION_INTERVAL}`;
  if (picked.length === 0) {
    return { title, body: "No observations available yet." };
  }

  const lines = picked.map((obs) => {
    const label = marketLabel(obs.market);
    const price = fmtPriceAdaptive(obs.close);
    return `${label} ${price} ${trendMark(obs.trend)} ${obs.volatility}`;
  });

  return { title, body: lines.join("\n") };
}

function getBarkConfig(): { baseUrl: string; deviceKey: string; group: string; level: BarkPayload["level"] } {
  const { baseUrl, deviceKey, group, level } = config.bark;
  if (!baseUrl || !deviceKey) {
    throw new Error("Bark is not configured. Set BARK_BASE_URL and BARK_DEVICE_KEY.");
  }
  return { baseUrl, deviceKey, group, level };
}

async function postBark(payload: BarkPayload): Promise<void> {
  const bark = getBarkConfig();
  const res = await fetch(`${bark.baseUrl}/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let parsed: BarkResponse | undefined;
  try {
    parsed = text ? (JSON.parse(text) as BarkResponse) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!res.ok || (parsed?.code !== undefined && parsed.code !== 200)) {
    const msg = parsed?.message ?? text;
    throw new Error(`Bark push failed: HTTP ${res.status}${msg ? `: ${msg}` : ""}`);
  }
}

export async function sendBarkNotification(args: {
  title: string;
  body: string;
  level?: BarkPayload["level"];
  logger?: Logger;
}): Promise<NotifyResult> {
  const logger = args.logger ?? makeLogger(config.logLevel);
  const bark = getBarkConfig();
  await postBark({
    device_key: bark.deviceKey,
    title: args.title,
    body: args.body,
    group: bark.group,
    level: args.level ?? bark.level,
  });
  logger.info(`bark: sent ${args.title}`);
  return { sent: true, title: args.title, body: args.body };
}

export async function sendBarkMarketSummary(opts: NotifyOptions = {}): Promise<NotifyResult> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const bark = getBarkConfig();
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  const observations = repo.queryLatestObservationsForInterval(PRIMARY_OBSERVATION_INTERVAL);
  const { title, body } = buildBarkMessage(observations);

  const payload: BarkPayload = {
    device_key: bark.deviceKey,
    title,
    body,
    group: bark.group,
    level: bark.level,
  };

  await postBark(payload);

  logger.info(`bark: sent ${title}`);
  return { sent: true, title, body };
}

function barkLevelForSeverity(severity: AlertEvent["severity"]): BarkPayload["level"] {
  if (severity === "critical") return "timeSensitive";
  if (severity === "warn") return "active";
  return config.bark.level;
}

export async function sendBarkAlert(event: AlertEvent, opts: NotifyOptions = {}): Promise<NotifyResult> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const bark = getBarkConfig();
  const { title, body } = buildChineseAlertMessage(event);

  await postBark({
    device_key: bark.deviceKey,
    title,
    body,
    group: bark.group,
    level: barkLevelForSeverity(event.severity),
  });

  logger.info(`bark: sent alert ${event.fingerprint}`);
  return { sent: true, title, body };
}

export async function dispatchPendingBarkAlerts(opts: NotifyOptions = {}): Promise<{ sent: number }> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  const events = repo.queryUnsentAlertEvents(50);
  const groups = groupPendingAlerts(events);
  let sent = 0;

  for (const group of groups) {
    if (group.length === 0) continue;
    if (group.length === 1) {
      const event = group[0]!;
      if (event.id === undefined) continue;
      await sendBarkAlert(event, { logger });
      repo.markAlertEventSent(event.id, Date.now());
      sent++;
      continue;
    }

    const bark = getBarkConfig();
    const message = buildAggregatedAlertMessage(group);
    await postBark({
      device_key: bark.deviceKey,
      title: message.title,
      body: message.body,
      group: bark.group,
      level: barkLevelForSeverity(maxSeverity(group)),
    });
    const sentAt = Date.now();
    for (const event of group) {
      if (event.id !== undefined) repo.markAlertEventSent(event.id, sentAt);
    }
    logger.info(`bark: sent aggregated alerts count=${group.length}`);
    sent++;
  }

  return { sent };
}
