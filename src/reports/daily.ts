// Daily markdown report generator.
//
// Reads the latest observations from SQLite and renders reports/YYYY-MM-DD.md
// with the sections documented in README.md.

import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import { PRIMARY_OBSERVATION_INTERVAL } from "../agents/observer.js";
import type { Market, Observation } from "../types.js";

export type BuildDailyReportOptions = {
  logger?: Logger;
};

export type BuildDailyReportResult = {
  path: string;
};

const REPORT_MARKETS: { section: string; markets: Market[] }[] = [
  { section: "BTC", markets: ["BTCUSDT"] },
  { section: "CKB", markets: ["CKBUSDT"] },
  { section: "Gold", markets: ["XAUTUSDT", "XAUUSDT"] },
];

function fmtPriceAdaptive(x: number): string {
  if (!Number.isFinite(x) || x === 0) return x.toString();
  const ax = Math.abs(x);
  if (ax >= 1000) return x.toFixed(2);
  if (ax >= 1) return x.toFixed(4);
  if (ax >= 0.01) return x.toFixed(6);
  return x.toExponential(3);
}

function fmtTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

function trendEmoji(trend: Observation["trend"]): string {
  switch (trend) {
    case "bullish":
      return "📈";
    case "bearish":
      return "📉";
    case "ranging":
      return "↔️";
  }
}

function volatilityEmoji(volatility: Observation["volatility"]): string {
  switch (volatility) {
    case "low":
      return "🟢";
    case "normal":
      return "🟡";
    case "elevated":
      return "🟠";
    case "high":
      return "🔴";
  }
}

function formatObservation(obs: Observation): string {
  const lines: string[] = [
    `- **Symbol:** ${obs.market}`,
    `- **Price:** ${fmtPriceAdaptive(obs.close)} USDT`,
    `- **Trend:** ${trendEmoji(obs.trend)} ${obs.trend}`,
    `- **Volatility:** ${volatilityEmoji(obs.volatility)} ${obs.volatility}`,
    `- **Confidence:** ${(obs.confidence * 100).toFixed(0)}%`,
    `- **Observation time:** ${fmtTimestamp(obs.ts)}`,
    `- **Summary:** ${obs.summary}`,
  ];
  return lines.join("\n");
}

function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function previousDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1));
}

function dateToYyyyMmDd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildChangesSinceYesterday(
  repo: Repository,
  todayObs: Map<Market, Observation>,
  today: Date,
): string {
  const lines: string[] = [];
  let hasAny = false;

  for (const market of config.markets) {
    const today = todayObs.get(market);
    if (!today) {
      continue;
    }

    hasAny = true;

    // The latest closed candle may belong to the previous UTC day (e.g., when
    // the report runs before the first candle of today closes). Anchor the
    // "prior" lookup to the UTC day of the current observation, not the report
    // generation time, so we compare against the previous day's close.
    const todayObsDayStart = startOfDayUtc(new Date(today.ts)).getTime();
    const yesterdayObsDayStart = startOfDayUtc(previousDay(new Date(today.ts))).getTime();
    const prior = repo.queryLatestObservationBeforeTs(
      market,
      PRIMARY_OBSERVATION_INTERVAL,
      todayObsDayStart,
    );

    if (!prior) {
      lines.push(`- **${market}:** no prior observation from yesterday to compare.`);
      continue;
    }

    const priceDelta = today.close - prior.close;
    const priceDeltaPct = prior.close !== 0 ? (priceDelta / prior.close) * 100 : 0;
    const trendChanged = today.trend !== prior.trend ? ` trend changed from ${prior.trend} to ${today.trend}` : "";
    const volChanged = today.volatility !== prior.volatility
      ? ` volatility shifted from ${prior.volatility} to ${today.volatility}`
      : "";

    const parts: string[] = [];
    parts.push(
      `price ${priceDelta >= 0 ? "+" : ""}${fmtPriceAdaptive(priceDelta)} (${priceDeltaPct >= 0 ? "+" : ""}${priceDeltaPct.toFixed(2)}%)`,
    );
    if (trendChanged) parts.push(trendChanged.trim());
    if (volChanged) parts.push(volChanged.trim());

    // If the prior observation is older than the day before the current one,
    // label it so the report is honest about the comparison baseline.
    const ageLabel = prior.ts < yesterdayObsDayStart
      ? ` (vs ${dateToYyyyMmDd(new Date(prior.ts))})`
      : "";

    lines.push(`- **${market}:** ${parts.join("; ")}.${ageLabel}`);
  }

  if (!hasAny) {
    return "No market observations available for today.";
  }
  return lines.join("\n");
}

function buildCrossMarket(todayObs: Map<Market, Observation>): string {
  if (todayObs.size === 0) {
    return "No observations available for cross-market summary.";
  }

  const trendCounts = { bullish: 0, bearish: 0, ranging: 0 };
  const volCounts = { low: 0, normal: 0, elevated: 0, high: 0 };
  let avgConfidence = 0;

  for (const obs of todayObs.values()) {
    trendCounts[obs.trend]++;
    volCounts[obs.volatility]++;
    avgConfidence += obs.confidence;
  }
  avgConfidence /= todayObs.size;

  const parts: string[] = [];
  parts.push(
    `- **Markets observed:** ${todayObs.size}/${config.markets.length}`,
  );
  parts.push(
    `- **Trend distribution:** ${trendCounts.bullish} bullish, ${trendCounts.bearish} bearish, ${trendCounts.ranging} ranging`,
  );
  parts.push(
    `- **Volatility distribution:** ${volCounts.low} low, ${volCounts.normal} normal, ${volCounts.elevated} elevated, ${volCounts.high} high`,
  );
  parts.push(`- **Average confidence:** ${(avgConfidence * 100).toFixed(0)}%`);

  const trendNotes: string[] = [];
  for (const obs of todayObs.values()) {
    if (obs.volatility === "high" || obs.volatility === "elevated") {
      trendNotes.push(`${obs.market} is showing ${obs.volatility} volatility on the 4h timeframe.`);
    }
  }
  if (trendNotes.length > 0) {
    parts.push("");
    parts.push("**Notable conditions:**");
    for (const note of trendNotes) {
      parts.push(`- ${note}`);
    }
  }

  return parts.join("\n");
}

function buildThingsWorthWatching(todayObs: Map<Market, Observation>): string {
  if (todayObs.size === 0) {
    return "No observations available.";
  }

  const notes: string[] = [];

  for (const obs of todayObs.values()) {
    const lines: string[] = [];
    if (obs.confidence >= 0.7) {
      lines.push(`clean technical read on ${obs.market} (${obs.trend}, ${(obs.confidence * 100).toFixed(0)}% confidence)`);
    } else if (obs.confidence <= 0.4) {
      lines.push(`mixed signals on ${obs.market} — low confidence (${(obs.confidence * 100).toFixed(0)}%)`);
    }
    if (obs.volatility === "high") {
      lines.push(`elevated volatility in ${obs.market}`);
    }
    if (lines.length > 0) {
      notes.push(`- ${lines.join("; ")}.`);
    }
  }

  if (notes.length === 0) {
    return "Conditions are broadly stable across observed markets.";
  }
  return notes.join("\n");
}

export function buildDailyReport(opts: BuildDailyReportOptions = {}): BuildDailyReportResult {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const now = new Date();
  const dateStr = dateToYyyyMmDd(now);
  const reportPath = path.resolve(config.reportsDir, `${dateStr}.md`);

  logger.info(`building daily report for ${dateStr}`);

  const db = getDb(config.dbPath);
  const repo = new Repository(db);

  const latest4h = repo.queryLatestObservationsForInterval(PRIMARY_OBSERVATION_INTERVAL);
  const todayObs = new Map<Market, Observation>();
  for (const obs of latest4h) {
    todayObs.set(obs.market, obs);
  }

  const sections: string[] = [];

  sections.push(`# Daily Summary — ${dateStr}`);
  sections.push("");
  sections.push(`_Generated at ${fmtTimestamp(now.getTime())} UTC — read-only observation, not investment advice._`);
  sections.push("");
  sections.push(`Primary timeframe: **${PRIMARY_OBSERVATION_INTERVAL}**`);
  sections.push("");

  for (const { section, markets } of REPORT_MARKETS) {
    sections.push(`## ${section}`);
    sections.push("");

    const entries: string[] = [];
    for (const market of markets) {
      const obs = todayObs.get(market);
      if (!obs) {
        entries.push(`_No ${PRIMARY_OBSERVATION_INTERVAL} observation available for ${market}._`);
        continue;
      }
      entries.push(formatObservation(obs));
    }
    sections.push(entries.join("\n\n"));
    sections.push("");
  }

  sections.push("## Cross Market");
  sections.push("");
  sections.push(buildCrossMarket(todayObs));
  sections.push("");

  sections.push("## Changes Since Yesterday");
  sections.push("");
  sections.push(buildChangesSinceYesterday(repo, todayObs, now));
  sections.push("");

  sections.push("## Things Worth Watching");
  sections.push("");
  sections.push(buildThingsWorthWatching(todayObs));
  sections.push("");

  const content = sections.join("\n");

  fs.mkdirSync(config.reportsDir, { recursive: true });
  fs.writeFileSync(reportPath, content, "utf8");

  repo.upsertReport(dateStr, reportPath, content);

  logger.info(`daily report written: ${reportPath}`);
  return { path: reportPath };
}
