import { z } from "zod";
import { assertSafeSymbol, assertSafeUrl, SafetyError } from "../safety/guard.js";
import type { Candle, Interval, Market } from "../types.js";

const RawKlineSchema = z.array(z.unknown()).min(7);

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
  const rawHost = baseUrl.replace(/^https?:\/\//, "").split("/")[0] ?? "api.binance.com";
  const host = rawHost.startsWith("api.")
    ? `fapi.${rawHost.slice(4)}`
    : rawHost.startsWith("fapi.")
    ? rawHost
    : `fapi.${rawHost}`;
  const u = new URL(`https://${host}/fapi/v1/klines`);
  u.searchParams.set("symbol", market);
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));
  if (endTimeMs !== undefined) u.searchParams.set("endTime", String(endTimeMs));
  return u.toString();
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
