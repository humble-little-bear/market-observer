import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import type { Market, MarketMetric, MarketVenue } from "../types.js";
import {
  fetchDepth,
  fetchFuturesStats,
  type BookLevel,
  type OrderBookSnapshot,
} from "./binance.js";

export type StructureCollectOptions = {
  baseUrl?: string;
  markets?: readonly Market[];
  logger?: Logger;
};

export type StructureCollectResult = {
  markets: number;
  metricsUpserted: number;
  failed: Array<{ market: Market; reason: string }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function midPrice(book: OrderBookSnapshot): number {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (!bestBid || !bestAsk) throw new Error(`${book.market} ${book.venue} empty book`);
  return (bestBid + bestAsk) / 2;
}

function quoteDepthWithinBps(
  levels: readonly BookLevel[],
  mid: number,
  side: "bid" | "ask",
  bps: number,
): number {
  const threshold =
    side === "bid" ? mid * (1 - bps / 10_000) : mid * (1 + bps / 10_000);
  let total = 0;
  for (const level of levels) {
    if (side === "bid" && level.price < threshold) break;
    if (side === "ask" && level.price > threshold) break;
    total += level.price * level.quantity;
  }
  return total;
}

function slippageBps(
  levels: readonly BookLevel[],
  mid: number,
  notional: number,
  side: "buy" | "sell",
): number | null {
  let remaining = notional;
  let baseFilled = 0;
  let quoteSpent = 0;

  for (const level of levels) {
    const levelQuote = level.price * level.quantity;
    const takeQuote = Math.min(remaining, levelQuote);
    baseFilled += takeQuote / level.price;
    quoteSpent += takeQuote;
    remaining -= takeQuote;
    if (remaining <= 1e-8) break;
  }

  if (remaining > 1e-8 || baseFilled <= 0) return null;
  const vwap = quoteSpent / baseFilled;
  const raw = side === "buy" ? (vwap - mid) / mid : (mid - vwap) / mid;
  return raw * 10_000;
}

function computeBookMetric(
  book: OrderBookSnapshot,
  ts: number,
  slippageNotional: number,
): Omit<MarketMetric, "openInterest" | "fundingRate" | "basisBps"> {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (!bestBid || !bestAsk) throw new Error(`${book.market} ${book.venue} empty book`);

  const mid = (bestBid + bestAsk) / 2;
  const depthBid25 = quoteDepthWithinBps(book.bids, mid, "bid", 25);
  const depthAsk25 = quoteDepthWithinBps(book.asks, mid, "ask", 25);
  const depth25Total = depthBid25 + depthAsk25;

  return {
    market: book.market,
    venue: book.venue,
    ts,
    midPrice: mid,
    bestBid,
    bestAsk,
    spreadBps: ((bestAsk - bestBid) / mid) * 10_000,
    depthBid25Bps: depthBid25,
    depthAsk25Bps: depthAsk25,
    depthBid50Bps: quoteDepthWithinBps(book.bids, mid, "bid", 50),
    depthAsk50Bps: quoteDepthWithinBps(book.asks, mid, "ask", 50),
    imbalance25Bps: depth25Total > 0 ? (depthBid25 - depthAsk25) / depth25Total : 0,
    slippageBuy10kBps: slippageBps(book.asks, mid, slippageNotional, "buy"),
    slippageSell10kBps: slippageBps(book.bids, mid, slippageNotional, "sell"),
  };
}

function withDerivedFields(
  base: Omit<MarketMetric, "openInterest" | "fundingRate" | "basisBps">,
  values: Pick<MarketMetric, "openInterest" | "fundingRate" | "basisBps">,
): MarketMetric {
  return {
    ...base,
    openInterest: values.openInterest,
    fundingRate: values.fundingRate,
    basisBps: values.basisBps,
  };
}

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const result = await fn();
  await sleep(config.collectMinRequestIntervalMs);
  return result;
}

function shortReason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runCollectStructure(
  opts: StructureCollectOptions = {},
): Promise<StructureCollectResult> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const db = getDb(config.dbPath);
  const repo = new Repository(db);
  const baseUrl = opts.baseUrl ?? config.binanceBaseUrl;
  const markets = opts.markets ?? config.structure.markets;
  const failed: Array<{ market: Market; reason: string }> = [];
  let metricsUpserted = 0;

  for (const market of markets) {
    logger.info(`collect-structure ${market}`);
    try {
      const spot = await paced(() =>
        fetchDepth({
          baseUrl,
          market,
          venue: "spot",
          limit: config.structure.depthLimit,
        }),
      );
      const futures = await paced(() =>
        fetchDepth({
          baseUrl,
          market,
          venue: "futures",
          limit: config.structure.depthLimit,
        }),
      );
      const stats = await paced(() => fetchFuturesStats({ baseUrl, market }));

      const ts = Math.max(spot.eventTime, futures.eventTime, Date.now());
      const spotMid = midPrice(spot);
      const futMid = midPrice(futures);
      const spotMetric = withDerivedFields(
        computeBookMetric(spot, ts, config.structure.slippageNotional),
        { openInterest: null, fundingRate: null, basisBps: null },
      );
      const futuresMetric = withDerivedFields(
        computeBookMetric(futures, ts, config.structure.slippageNotional),
        {
          openInterest: stats.openInterest,
          fundingRate: stats.fundingRate,
          basisBps: ((futMid - spotMid) / spotMid) * 10_000,
        },
      );

      const upserted = repo.upsertMarketMetrics([spotMetric, futuresMetric]);
      metricsUpserted += upserted;
      logger.info(
        `${market}: structure upserted=${upserted} spread=${formatVenue(spotMetric)} futures=${formatVenue(futuresMetric)}`,
      );
    } catch (e) {
      const reason = shortReason(e);
      logger.warn(`collect-structure ${market} failed: ${reason}`);
      failed.push({ market, reason });
    }
  }

  return { markets: markets.length, metricsUpserted, failed };
}

function formatVenue(metric: Pick<MarketMetric, "venue" | "spreadBps" | "imbalance25Bps">): string {
  const venue: MarketVenue = metric.venue;
  return `${venue}:${metric.spreadBps.toFixed(2)}bps imb=${metric.imbalance25Bps.toFixed(2)}`;
}
