import { config } from "../config/index.js";
import { fetchKlines } from "../collectors/binance.js";
import { makeLogger, type Logger } from "../logger.js";
import { sendBarkNotification } from "../notifications/bark.js";
import type { Candle, Market } from "../types.js";

export type PulseMove = {
  market: Market;
  latestClose: number;
  latestCloseTime: number;
  change1mPct?: number;
  change5mPct?: number;
  direction: "up" | "down" | "flat";
  triggered: boolean;
  triggerReasons: string[];
};

export type PulseRunResult = {
  moves: PulseMove[];
  warnings: string[];
};

export type PulseRunOptions = {
  logger?: Logger;
};

export type PulseDaemonOptions = {
  logger?: Logger;
  notify?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

function formatPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function directionFromChange(change?: number): PulseMove["direction"] {
  if (change === undefined || Math.abs(change) < 0.05) return "flat";
  return change > 0 ? "up" : "down";
}

function detectPulseMove(market: Market, candles: readonly Candle[]): PulseMove | undefined {
  const sorted = [...candles].sort((a, b) => a.closeTime - b.closeTime);
  const latest = sorted.at(-1);
  const previous1m = sorted.at(-2);
  const previous5m = sorted.at(-6);
  if (!latest) return undefined;

  const change1mPct = previous1m ? pctChange(previous1m.close, latest.close) : undefined;
  const change5mPct = previous5m ? pctChange(previous5m.close, latest.close) : undefined;
  const triggerReasons: string[] = [];

  if (change1mPct !== undefined && Math.abs(change1mPct) >= config.pulse.move1mPct) {
    triggerReasons.push(`1m ${formatPct(change1mPct)} crossed ${formatPct(config.pulse.move1mPct)}`);
  }
  if (change5mPct !== undefined && Math.abs(change5mPct) >= config.pulse.move5mPct) {
    triggerReasons.push(`5m ${formatPct(change5mPct)} crossed ${formatPct(config.pulse.move5mPct)}`);
  }

  const direction = directionFromChange(change1mPct) !== "flat"
    ? directionFromChange(change1mPct)
    : directionFromChange(change5mPct);

  return {
    market,
    latestClose: latest.close,
    latestCloseTime: latest.closeTime,
    change1mPct,
    change5mPct,
    direction,
    triggered: triggerReasons.length > 0,
    triggerReasons,
  };
}

async function fetchPulseMove(market: Market): Promise<PulseMove | undefined> {
  const res = await fetchKlines({
    baseUrl: config.binanceBaseUrl,
    market,
    interval: "1m",
    limit: 8,
    timeoutMs: 10_000,
    maxRetries: 2,
  });
  return detectPulseMove(market, res.candles);
}

export async function runPulse(opts: PulseRunOptions = {}): Promise<PulseRunResult> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const results = await Promise.allSettled(config.pulse.markets.map((market) => fetchPulseMove(market)));
  const moves: PulseMove[] = [];
  const warnings: string[] = [];

  results.forEach((result, index) => {
    const market = config.pulse.markets[index]!;
    if (result.status === "fulfilled") {
      if (result.value) moves.push(result.value);
      return;
    }
    const warning = `${market}: ${String(result.reason)}`;
    warnings.push(warning);
    logger.warn(`[pulse] ${warning}`);
  });

  return { moves, warnings };
}

export function renderPulseReport(result: PulseRunResult): string {
  const lines = ["Price Pulse Report"];
  for (const move of result.moves) {
    lines.push("");
    lines.push(`${move.market} ${move.latestClose} @ ${new Date(move.latestCloseTime).toISOString()}`);
    lines.push(`- 1m: ${move.change1mPct === undefined ? "n/a" : formatPct(move.change1mPct)}`);
    lines.push(`- 5m: ${move.change5mPct === undefined ? "n/a" : formatPct(move.change5mPct)}`);
    lines.push(`- triggered: ${move.triggered ? "yes" : "no"}`);
    for (const reason of move.triggerReasons) lines.push(`  ${reason}`);
  }
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

function pulseBarkMessage(move: PulseMove): { title: string; body: string } {
  const direction = move.direction === "up" ? "急涨" : move.direction === "down" ? "急跌" : "异动";
  const lines = [
    `现价 ${move.latestClose}`,
    `1m ${move.change1mPct === undefined ? "n/a" : formatPct(move.change1mPct)}`,
    `5m ${move.change5mPct === undefined ? "n/a" : formatPct(move.change5mPct)}`,
  ];
  return {
    title: `${move.market} ${direction}`,
    body: lines.join("\n"),
  };
}

function notificationKey(move: PulseMove): string {
  return [move.market, move.direction].join(":");
}

export async function runPulseDaemon(opts: PulseDaemonOptions = {}): Promise<void> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const notify = opts.notify ?? false;
  const lastSentAt = new Map<string, number>();
  let stopping = false;

  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.info(`[pulse] daemon starting markets=${config.pulse.markets.join(",")}`);
  logger.info(
    `[pulse] interval=${config.pulse.intervalMs}ms thresholds=1m:${config.pulse.move1mPct}% 5m:${config.pulse.move5mPct}% notify=${notify ? "enabled" : "disabled"}`,
  );

  while (!stopping) {
    try {
      const result = await runPulse({ logger });
      for (const move of result.moves) {
        logger.info(
          `[pulse] ${move.market} triggered=${move.triggered ? "yes" : "no"} 1m=${move.change1mPct === undefined ? "n/a" : formatPct(move.change1mPct)} 5m=${move.change5mPct === undefined ? "n/a" : formatPct(move.change5mPct)}`,
        );
        if (!notify || !move.triggered || move.direction === "flat") continue;

        const key = notificationKey(move);
        const last = lastSentAt.get(key) ?? 0;
        if (Date.now() - last < config.pulse.cooldownMs) continue;

        await sendBarkNotification({ ...pulseBarkMessage(move), logger, level: "timeSensitive" });
        lastSentAt.set(key, Date.now());
      }
    } catch (e) {
      logger.error("[pulse] daemon tick failed", e);
    }
    await sleep(config.pulse.intervalMs);
  }

  logger.info("[pulse] daemon stopping");
}
