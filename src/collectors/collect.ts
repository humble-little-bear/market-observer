import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import {
  fetchKlines,
  SymbolUnavailableError,
  type FetchKlinesResult,
} from "./binance.js";
import type { Candle, Interval, Market } from "../types.js";

export type CollectOptions = {
  baseUrl?: string;
  markets?: readonly Market[];
  intervals?: readonly Interval[];
  logger?: Logger;
};

export type CollectResult = {
  fetched: number;
  upserted: number;
  byMarket: Record<string, { upserted: number; source: "spot" | "futures" }>;
  unavailable: Array<{ market: Market; reason: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isClosedCloseTime(c: Candle, now: number): boolean {
  return c.closeTime < now;
}

export async function runCollect(opts: CollectOptions = {}): Promise<CollectResult> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const db = getDb(config.dbPath);
  const repo = new Repository(db);

  const baseUrl = opts.baseUrl ?? config.binanceBaseUrl;
  const markets = opts.markets ?? config.markets;
  const intervals = opts.intervals ?? config.intervals;
  const now = Date.now();

  const byMarket: Record<string, { upserted: number; source: "spot" | "futures" }> = {};
  const unavailable: Array<{ market: Market; reason: string }> = [];
  let totalFetched = 0;
  let totalUpserted = 0;

  for (const market of markets) {
    for (const interval of intervals) {
      const existing = repo.countCandles(market, interval);
      const limit = existing === 0 ? 1000 : 10;
      const isBackfill = existing === 0;
      logger.info(
        `collect ${market} ${interval} limit=${limit} (${isBackfill ? "backfill" : "poll"})`,
      );
      let res: FetchKlinesResult;
      try {
        res = await fetchKlines({ baseUrl, market, interval, limit });
      } catch (e) {
        if (e instanceof SymbolUnavailableError) {
          logger.warn(
            `symbol ${market} unavailable on ${e.source} — marking unavailable and skipping`,
          );
          repo.setSymbolStatus({
            market,
            available: 0,
            lastChecked: now,
            note: e.message,
          });
          unavailable.push({ market, reason: e.message });
          continue;
        }
        logger.error(`fetch failed for ${market} ${interval}`, e);
        throw e;
      }

      // Drop the still-forming candle (openTime + intervalMs would be > now).
      const closed = res.candles.filter((c) => isClosedCloseTime(c, now));
      const skipped = res.candles.length - closed.length;

      const upserted = repo.upsertCandles(closed);
      repo.setSymbolStatus({
        market,
        available: 1,
        lastChecked: now,
        note: `source=${res.source}`,
      });
      byMarket[market] = {
        upserted: (byMarket[market]?.upserted ?? 0) + upserted,
        source: res.source,
      };
      totalFetched += res.candles.length;
      totalUpserted += upserted;
      logger.info(
        `${market} ${interval}: fetched=${res.candles.length} closed=${closed.length} skippedStillForming=${skipped} upserted=${upserted} source=${res.source}`,
      );
      // Stay well under Binance weight limits.
      await sleep(250);
    }
  }

  logger.info(
    `collect done: fetched=${totalFetched} upserted=${totalUpserted} unavailable=${unavailable.length}`,
  );
  return { fetched: totalFetched, upserted: totalUpserted, byMarket, unavailable };
}
