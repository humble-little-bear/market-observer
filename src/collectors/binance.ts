import { z } from "zod";
import { assertSafeSymbol, assertSafeUrl, SafetyError } from "../safety/guard.js";
import type { Candle, Interval, Market, MarketVenue } from "../types.js";

const RawKlineSchema = z.array(z.unknown()).min(7);
const RawBookLevelSchema = z.tuple([z.string(), z.string()]);
const RawDepthSchema = z.object({
  lastUpdateId: z.number().optional(),
  E: z.number().optional(),
  T: z.number().optional(),
  bids: z.array(RawBookLevelSchema),
  asks: z.array(RawBookLevelSchema),
});
const RawOpenInterestSchema = z.object({
  openInterest: z.string(),
  symbol: z.string(),
  time: z.number().optional(),
});
const RawFundingRateSchema = z.array(
  z.object({
    symbol: z.string(),
    fundingRate: z.string(),
    fundingTime: z.number(),
  }),
);

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isFinite(n)) {
      throw new Error(`cannot parse number from: ${v}`);
    }
    return n;
  }
  throw new Error(`cannot parse number from: ${String(v)}`);
}

export type FetchKlinesOptions = {
  baseUrl: string;
  market: Market;
  interval: Interval;
  limit?: number; // max 1000 on Binance
  endTimeMs?: number; // exclusive upper bound for openTime
  timeoutMs?: number; // default 15_000
  maxRetries?: number; // default 3
  fetcher?: typeof fetch; // injectable for tests
};

export class BinanceError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(status: number, body: string, msg?: string) {
    super(msg ?? `Binance HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "BinanceError";
    this.status = status;
    this.body = body;
  }
}

export class SymbolUnavailableError extends Error {
  public readonly market: Market;
  public readonly source: "spot" | "futures";
  constructor(market: Market, source: "spot" | "futures", body: string) {
    super(`Symbol ${market} unavailable on ${source}: ${body.slice(0, 200)}`);
    this.name = "SymbolUnavailableError";
    this.market = market;
    this.source = source;
  }
}

function buildUrl(baseUrl: string, market: Market, interval: Interval, limit: number, endTimeMs?: number): string {
  const u = new URL(`${baseUrl}/api/v3/klines`);
  u.searchParams.set("symbol", market);
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  if (endTimeMs !== undefined) u.searchParams.set("endTime", String(endTimeMs));
  return u.toString();
}

function buildFuturesUrl(baseUrl: string, market: Market, interval: Interval, limit: number, endTimeMs?: number): string {
  // Derive the futures host from the spot base. Convention is:
  //   api.binance.com      → fapi.binance.com
  //   testnet.binance.vision → testnet.binancefuture.com
  // We do a simple prefix swap: if the host begins with "api.", replace
  // with "fapi."; otherwise insert "fapi." at the start.
  const u = new URL(`${futuresBaseUrl(baseUrl)}/fapi/v1/klines`);
  u.searchParams.set("symbol", market);
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  if (endTimeMs !== undefined) u.searchParams.set("endTime", String(endTimeMs));
  return u.toString();
}

function futuresBaseUrl(baseUrl: string): string {
  const rawHost = baseUrl.replace(/^https?:\/\//, "").split("/")[0] ?? "api.binance.com";
  if (rawHost.startsWith("fapi.")) return `https://${rawHost}`;
  if (rawHost === "data-api.binance.vision") return "https://fapi.binance.com";
  if (rawHost.startsWith("api.")) return `https://fapi.${rawHost.slice(4)}`;
  return `https://fapi.${rawHost}`;
}

function parseKlines(raw: unknown, market: Market, interval: Interval): Candle[] {
  if (!Array.isArray(raw)) {
    throw new Error("klines response is not an array");
  }
  const out: Candle[] = [];
  for (const row of raw) {
    const parsed = RawKlineSchema.parse(row);
    const openTime = toNumber(parsed[0]);
    const open = toNumber(parsed[1]);
    const high = toNumber(parsed[2]);
    const low = toNumber(parsed[3]);
    const close = toNumber(parsed[4]);
    const volume = toNumber(parsed[5]);
    const closeTime = toNumber(parsed[6]);
    out.push({
      market,
      interval,
      openTime,
      open,
      high,
      low,
      close,
      volume,
      closeTime,
    });
  }
  return out;
}

export type BookLevel = {
  price: number;
  quantity: number;
};

export type OrderBookSnapshot = {
  market: Market;
  venue: MarketVenue;
  eventTime: number;
  bids: BookLevel[];
  asks: BookLevel[];
};

export type FuturesStats = {
  market: Market;
  openInterest: number | null;
  fundingRate: number | null;
};

function parseBookLevels(rows: readonly [string, string][]): BookLevel[] {
  return rows.map(([price, quantity]) => ({
    price: toNumber(price),
    quantity: toNumber(quantity),
  }));
}

function parseDepth(raw: unknown, market: Market, venue: MarketVenue): OrderBookSnapshot {
  const parsed = RawDepthSchema.parse(raw);
  const eventTime = parsed.E ?? parsed.T ?? Date.now();
  return {
    market,
    venue,
    eventTime,
    bids: parseBookLevels(parsed.bids),
    asks: parseBookLevels(parsed.asks),
  };
}

async function fetchOnce(
  url: string,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<unknown> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { method: "GET", signal: ac.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new BinanceError(res.status, text);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`invalid JSON from ${url}: ${(e as Error).message}`);
    }
  } finally {
    clearTimeout(t);
  }
}

function isInvalidSymbol(err: unknown): boolean {
  if (!(err instanceof BinanceError)) return false;
  if (err.status !== 400) return false;
  // Binance returns {"code":-1121,"msg":"Invalid symbol."} for unknown symbols.
  return /"code":-1121/.test(err.body) || /Invalid symbol/i.test(err.body);
}

export type FetchKlinesResult = {
  candles: Candle[];
  source: "spot" | "futures";
};

/**
 * Fetch klines for (market, interval). GET only. Goes through the safety guard.
 * Tries spot first; on Binance 400 / -1121 (invalid symbol) falls back to
 * futures; on any other error, throws.
 */
export async function fetchKlines(opts: FetchKlinesOptions): Promise<FetchKlinesResult> {
  assertSafeSymbol(opts.market);
  const {
    baseUrl,
    market,
    interval,
    limit = 1000,
    endTimeMs,
    timeoutMs = 15_000,
    maxRetries = 3,
    fetcher = fetch,
  } = opts;

  if (limit < 1 || limit > 1000) {
    throw new Error(`limit must be 1..1000, got ${limit}`);
  }

  // Attempt spot
  const spotUrl = buildUrl(baseUrl, market, interval, limit, endTimeMs);
  assertSafeUrl(spotUrl, "GET");

  let spotErr: unknown = null;
  try {
    const raw = await retry(() => fetchOnce(spotUrl, timeoutMs, fetcher), maxRetries);
    return { candles: parseKlines(raw, market, interval), source: "spot" };
  } catch (e) {
    if (isInvalidSymbol(e)) {
      // Fall through to futures.
      spotErr = new SymbolUnavailableError(market, "spot", (e as BinanceError).body);
    } else {
      throw e;
    }
  }

  // Fallback: futures
  const futUrl = buildFuturesUrl(baseUrl, market, interval, limit, endTimeMs);
  assertSafeUrl(futUrl, "GET");
  try {
    const raw = await retry(() => fetchOnce(futUrl, timeoutMs, fetcher), maxRetries);
    return { candles: parseKlines(raw, market, interval), source: "futures" };
  } catch (e) {
    if (isInvalidSymbol(e)) {
      throw new SymbolUnavailableError(market, "futures", (e as BinanceError).body);
    }
    // Wrap the futures error with the spot error for context.
    if (spotErr) {
      const wrapped = new Error(
        `fetch failed for ${market} (spot: ${(spotErr as Error).message}; futures: ${(e as Error).message})`,
      );
      wrapped.name = "FetchFailedError";
      throw wrapped;
    }
    throw e;
  }
}

export type FetchDepthOptions = {
  baseUrl: string;
  market: Market;
  venue: MarketVenue;
  limit?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetcher?: typeof fetch;
};

export async function fetchDepth(opts: FetchDepthOptions): Promise<OrderBookSnapshot> {
  assertSafeSymbol(opts.market);
  const {
    baseUrl,
    market,
    venue,
    limit = 100,
    timeoutMs = 15_000,
    maxRetries = 3,
    fetcher = fetch,
  } = opts;
  if (![20, 50, 100, 500, 1000, 5000].includes(limit)) {
    throw new Error(`unsupported depth limit: ${limit}`);
  }

  const root = venue === "spot" ? baseUrl.replace(/\/+$/, "") : futuresBaseUrl(baseUrl);
  const path = venue === "spot" ? "/api/v3/depth" : "/fapi/v1/depth";
  const u = new URL(`${root}${path}`);
  u.searchParams.set("symbol", market);
  u.searchParams.set("limit", String(limit));
  const url = u.toString();
  assertSafeUrl(url, "GET");

  const raw = await retry(() => fetchOnce(url, timeoutMs, fetcher), maxRetries);
  return parseDepth(raw, market, venue);
}

export type FetchFuturesStatsOptions = {
  baseUrl: string;
  market: Market;
  timeoutMs?: number;
  maxRetries?: number;
  fetcher?: typeof fetch;
};

export async function fetchFuturesStats(opts: FetchFuturesStatsOptions): Promise<FuturesStats> {
  assertSafeSymbol(opts.market);
  const {
    baseUrl,
    market,
    timeoutMs = 15_000,
    maxRetries = 3,
    fetcher = fetch,
  } = opts;
  const root = futuresBaseUrl(baseUrl);

  const oiUrl = new URL(`${root}/fapi/v1/openInterest`);
  oiUrl.searchParams.set("symbol", market);
  assertSafeUrl(oiUrl.toString(), "GET");

  const fundingUrl = new URL(`${root}/fapi/v1/fundingRate`);
  fundingUrl.searchParams.set("symbol", market);
  fundingUrl.searchParams.set("limit", "1");
  assertSafeUrl(fundingUrl.toString(), "GET");

  const rawOi = await retry(() => fetchOnce(oiUrl.toString(), timeoutMs, fetcher), maxRetries);
  const rawFunding = await retry(() => fetchOnce(fundingUrl.toString(), timeoutMs, fetcher), maxRetries);
  const oi = RawOpenInterestSchema.parse(rawOi);
  const funding = RawFundingRateSchema.parse(rawFunding);
  return {
    market,
    openInterest: toNumber(oi.openInterest),
    fundingRate: funding.length > 0 ? toNumber(funding[funding.length - 1].fundingRate) : null,
  };
}

async function retry(fn: () => Promise<unknown>, maxRetries: number): Promise<unknown> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e instanceof BinanceError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        // 4xx (other than 429) won't be fixed by retry.
        throw e;
      }
      if (e instanceof SafetyError) throw e; // never retry safety violations
      const backoffMs = 250 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}
