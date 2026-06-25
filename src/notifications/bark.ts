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
  const title = event.title;
  const body = event.body;

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
  const events = repo.queryUnsentAlertEvents(10);
  let sent = 0;

  for (const event of events) {
    if (event.id === undefined) continue;
    await sendBarkAlert(event, { logger });
    repo.markAlertEventSent(event.id, Date.now());
    sent++;
  }

  return { sent };
}
