import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { sendBarkNotification } from "../notifications/bark.js";
import { fetchFedGoldItems } from "./sources/fed.js";
import { fetchGoogleNewsRssMany } from "./sources/googleNews.js";
import { fetchYahooGoldIntraday } from "./sources/yahoo.js";
import { detectGoldMove } from "./scoring/move.js";
import { scoreGoldNews } from "./scoring/news.js";
import { renderGoldCauseBark, renderGoldCauseReport } from "./reporting/text.js";
import type { GoldCauseRun, GoldNewsItem } from "./types.js";

export type RunGoldCauseOptions = {
  logger?: Logger;
  includeMove?: boolean;
};

export type RunGoldCauseDaemonOptions = {
  logger?: Logger;
  notify?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runGoldCause(opts: RunGoldCauseOptions = {}): Promise<GoldCauseRun> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const includeMove = opts.includeMove ?? true;

  const [fedResult, newsResult, goldResult] = await Promise.allSettled([
    fetchFedGoldItems(config.goldCause.newsLookbackMinutes),
    fetchGoogleNewsRssMany(config.goldCause.newsQueries, config.goldCause.newsLookbackMinutes),
    includeMove ? fetchYahooGoldIntraday(config.goldCause.symbol) : Promise.resolve([]),
  ]);

  const fedItems = fedResult.status === "fulfilled" ? fedResult.value : [];
  const newsItems = newsResult.status === "fulfilled" ? newsResult.value : [];
  const goldPoints = goldResult.status === "fulfilled" ? goldResult.value : [];
  const items: GoldNewsItem[] = [...fedItems, ...newsItems];
  const signal = scoreGoldNews(items);
  const move = includeMove
    ? detectGoldMove({
        symbol: config.goldCause.symbol,
        points: goldPoints,
        threshold5mPct: config.goldCause.move5mPct,
        threshold15mPct: config.goldCause.move15mPct,
      })
    : undefined;

  const warnings = [
    fedResult.status === "rejected" ? `Fed source warning: ${String(fedResult.reason)}` : undefined,
    newsResult.status === "rejected" ? `News source warning: ${String(newsResult.reason)}` : undefined,
    goldResult.status === "rejected" ? `Gold price source warning: ${String(goldResult.reason)}` : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  logger.debug(
    `[gold] fed=${fedItems.length} news=${newsItems.length} goldPoints=${goldPoints.length} warnings=${warnings.length}`,
  );
  return {
    move,
    signal,
    diagnostics: {
      fedItems: fedItems.length,
      newsItems: newsItems.length,
      goldPricePoints: goldPoints.length,
      warnings,
    },
    lookbackMinutes: config.goldCause.newsLookbackMinutes,
  };
}

export async function runGoldCauseDaemon(opts: RunGoldCauseDaemonOptions = {}): Promise<void> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const notify = opts.notify ?? false;
  let stopping = false;
  let lastNotificationKey = "";

  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.info(`[gold] daemon starting symbol=${config.goldCause.symbol}`);
  logger.info(`[gold] interval=${config.goldCause.monitorIntervalMs}ms notify=${notify ? "enabled" : "disabled"}`);
  while (!stopping) {
    try {
      const run = await runGoldCause({ logger, includeMove: true });
      const report = renderGoldCauseReport(run);
      logger.info(
        `[gold] move=${run.move?.triggered ? "triggered" : "none"} bias=${run.signal.bias} confidence=${run.signal.confidence}`,
      );
      logger.debug(`\n${report}`);
      if (notify && run.move?.triggered) {
        const key = [
          run.move.symbol,
          run.move.direction,
          run.move.latest.time.toISOString().slice(0, 16),
          run.signal.bias,
        ].join(":");
        if (key !== lastNotificationKey) {
          const message = renderGoldCauseBark(run);
          await sendBarkNotification({ ...message, logger, level: "timeSensitive" });
          lastNotificationKey = key;
        }
      }
    } catch (e) {
      logger.error("[gold] daemon tick failed", e);
    }
    await sleep(config.goldCause.monitorIntervalMs);
  }
  logger.info("[gold] daemon stopping");
}
