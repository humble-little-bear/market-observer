import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_INTERVALS, DEFAULT_MARKETS, type Interval, type Market } from "../types.js";
import { assertSafeSymbol } from "../safety/guard.js";

const LogLevelSchema = z.enum(["error", "warn", "info", "debug"]);
const BarkLevelSchema = z.enum(["active", "timeSensitive", "passive"]).default("active");

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

const EnvSchema = z.object({
  BINANCE_BASE_URL: z.string().url().default("https://api.binance.com"),
  DB_PATH: z.string().default("./data/observer.db"),
  LOG_LEVEL: LogLevelSchema.default("info"),
  MARKETS: z.string().optional(),
  INTERVALS: z.string().optional(),
  COLLECT_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().positive().default(1200),
  ALERT_SHARP_MOVE_15M_PCT: z.coerce.number().positive().default(1.5),
  ALERT_SHARP_MOVE_1H_PCT: z.coerce.number().positive().default(3),
  ALERT_AGGREGATION_WINDOW_MS: z.coerce.number().int().positive().default(180_000),
  DIGEST_INTERVAL_HOURS: z.coerce.number().int().positive().default(6),
  STRUCTURE_MARKETS: z.string().optional(),
  STRUCTURE_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  STRUCTURE_DEPTH_LIMIT: z.coerce.number().int().positive().default(100),
  STRUCTURE_SLIPPAGE_NOTIONAL: z.coerce.number().positive().default(10_000),
  BARK_BASE_URL: z.preprocess(optionalString, z.string().url().optional()),
  BARK_DEVICE_KEY: z.preprocess(optionalString, z.string().min(1).optional()),
  BARK_GROUP: z.string().default("market-observer"),
  BARK_LEVEL: BarkLevelSchema,
  GOLD_CAUSE_ENABLED: z.coerce.boolean().default(false),
  GOLD_SYMBOL: z.string().default("GC=F"),
  GOLD_NEWS_QUERIES: z.string().default("gold Fed|gold Treasury yields|gold dollar|Fed Chair gold|XAUUSD Fed"),
  GOLD_NEWS_LOOKBACK_MINUTES: z.coerce.number().int().positive().default(240),
  GOLD_MOVE_5M_PCT: z.coerce.number().positive().default(0.4),
  GOLD_MOVE_15M_PCT: z.coerce.number().positive().default(0.8),
  GOLD_MONITOR_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
});

export type AppConfig = {
  binanceBaseUrl: string;
  dbPath: string;
  logLevel: z.infer<typeof LogLevelSchema>;
  bark: {
    baseUrl?: string;
    deviceKey?: string;
    group: string;
    level: z.infer<typeof BarkLevelSchema>;
  };
  collectMinRequestIntervalMs: number;
  alerts: {
    sharpMove15mPct: number;
    sharpMove1hPct: number;
    aggregationWindowMs: number;
  };
  digestIntervalHours: number;
  structure: {
    markets: readonly Market[];
    intervalMs: number;
    depthLimit: number;
    slippageNotional: number;
  };
  goldCause: {
    enabled: boolean;
    symbol: string;
    newsQueries: readonly string[];
    newsLookbackMinutes: number;
    move5mPct: number;
    move15mPct: number;
    monitorIntervalMs: number;
  };
  markets: readonly Market[];
  intervals: readonly Interval[];
  dataDir: string;
  reportsDir: string;
};

function loadEnv(): Record<string, string> {
  // Tiny .env loader (no extra dep). Only loads if file exists.
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};
  const out: Record<string, string> = {};
  const text = fs.readFileSync(envPath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function buildConfig(): AppConfig {
  const fileEnv = loadEnv();
  const merged = { ...fileEnv, ...process.env };
  const parsed = EnvSchema.parse({
    BINANCE_BASE_URL: merged.BINANCE_BASE_URL,
    DB_PATH: merged.DB_PATH,
    LOG_LEVEL: merged.LOG_LEVEL,
    MARKETS: merged.MARKETS,
    INTERVALS: merged.INTERVALS,
    COLLECT_MIN_REQUEST_INTERVAL_MS: merged.COLLECT_MIN_REQUEST_INTERVAL_MS,
    ALERT_SHARP_MOVE_15M_PCT: merged.ALERT_SHARP_MOVE_15M_PCT,
    ALERT_SHARP_MOVE_1H_PCT: merged.ALERT_SHARP_MOVE_1H_PCT,
    ALERT_AGGREGATION_WINDOW_MS: merged.ALERT_AGGREGATION_WINDOW_MS,
    DIGEST_INTERVAL_HOURS: merged.DIGEST_INTERVAL_HOURS,
    STRUCTURE_MARKETS: merged.STRUCTURE_MARKETS,
    STRUCTURE_INTERVAL_MS: merged.STRUCTURE_INTERVAL_MS,
    STRUCTURE_DEPTH_LIMIT: merged.STRUCTURE_DEPTH_LIMIT,
    STRUCTURE_SLIPPAGE_NOTIONAL: merged.STRUCTURE_SLIPPAGE_NOTIONAL,
    BARK_BASE_URL: merged.BARK_BASE_URL,
    BARK_DEVICE_KEY: merged.BARK_DEVICE_KEY,
    BARK_GROUP: merged.BARK_GROUP,
    BARK_LEVEL: merged.BARK_LEVEL,
    GOLD_CAUSE_ENABLED: merged.GOLD_CAUSE_ENABLED,
    GOLD_SYMBOL: merged.GOLD_SYMBOL,
    GOLD_NEWS_QUERIES: merged.GOLD_NEWS_QUERIES,
    GOLD_NEWS_LOOKBACK_MINUTES: merged.GOLD_NEWS_LOOKBACK_MINUTES,
    GOLD_MOVE_5M_PCT: merged.GOLD_MOVE_5M_PCT,
    GOLD_MOVE_15M_PCT: merged.GOLD_MOVE_15M_PCT,
    GOLD_MONITOR_INTERVAL_MS: merged.GOLD_MONITOR_INTERVAL_MS,
  });

  const dataDir = path.resolve(path.dirname(parsed.DB_PATH));
  const reportsDir = path.resolve("./reports");
  const markets = parseMarkets(parsed.MARKETS);
  const structureMarkets = parseStructureMarkets(parsed.STRUCTURE_MARKETS, markets);
  const intervals = parseIntervals(parsed.INTERVALS);

  if (![20, 50, 100, 500, 1000].includes(parsed.STRUCTURE_DEPTH_LIMIT)) {
    throw new Error("STRUCTURE_DEPTH_LIMIT must be one of: 20,50,100,500,1000");
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  return {
    binanceBaseUrl: parsed.BINANCE_BASE_URL.replace(/\/+$/, ""),
    dbPath: path.resolve(parsed.DB_PATH),
    logLevel: parsed.LOG_LEVEL,
    bark: {
      baseUrl: parsed.BARK_BASE_URL?.replace(/\/+$/, ""),
      deviceKey: parsed.BARK_DEVICE_KEY,
      group: parsed.BARK_GROUP,
      level: parsed.BARK_LEVEL,
    },
    collectMinRequestIntervalMs: parsed.COLLECT_MIN_REQUEST_INTERVAL_MS,
    alerts: {
      sharpMove15mPct: parsed.ALERT_SHARP_MOVE_15M_PCT,
      sharpMove1hPct: parsed.ALERT_SHARP_MOVE_1H_PCT,
      aggregationWindowMs: parsed.ALERT_AGGREGATION_WINDOW_MS,
    },
    digestIntervalHours: parsed.DIGEST_INTERVAL_HOURS,
    structure: {
      markets: structureMarkets,
      intervalMs: parsed.STRUCTURE_INTERVAL_MS,
      depthLimit: parsed.STRUCTURE_DEPTH_LIMIT,
      slippageNotional: parsed.STRUCTURE_SLIPPAGE_NOTIONAL,
    },
    goldCause: {
      enabled: parsed.GOLD_CAUSE_ENABLED,
      symbol: parsed.GOLD_SYMBOL,
      newsQueries: parsePipeList(parsed.GOLD_NEWS_QUERIES),
      newsLookbackMinutes: parsed.GOLD_NEWS_LOOKBACK_MINUTES,
      move5mPct: parsed.GOLD_MOVE_5M_PCT,
      move15mPct: parsed.GOLD_MOVE_15M_PCT,
      monitorIntervalMs: parsed.GOLD_MONITOR_INTERVAL_MS,
    },
    markets,
    intervals,
    dataDir,
    reportsDir,
  };
}

function parsePipeList(input: string): readonly string[] {
  const values = input
    .split("|")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) throw new Error("pipe-separated list must contain at least one value");
  return values;
}

function parseStructureMarkets(
  input: string | undefined,
  observedMarkets: readonly Market[],
): readonly Market[] {
  if (input !== undefined && input.trim() !== "") return parseMarkets(input);

  const liquidDefaults = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  const picked = observedMarkets.filter((market) => liquidDefaults.has(market));
  return picked.length > 0 ? picked : observedMarkets.slice(0, 3);
}

export const config: AppConfig = buildConfig();

function parseMarkets(input: string | undefined): readonly Market[] {
  if (input === undefined || input.trim() === "") return DEFAULT_MARKETS;

  const seen = new Set<string>();
  const markets: Market[] = [];
  for (const raw of input.split(",")) {
    const market = raw.trim().toUpperCase();
    if (!market || seen.has(market)) continue;
    assertSafeSymbol(market);
    seen.add(market);
    markets.push(market);
  }

  if (markets.length === 0) {
    throw new Error("MARKETS must contain at least one Binance symbol");
  }
  return markets;
}

function parseIntervals(input: string | undefined): readonly Interval[] {
  if (input === undefined || input.trim() === "") return ALL_INTERVALS;

  const allowed = new Set<Interval>(ALL_INTERVALS);
  const seen = new Set<string>();
  const intervals: Interval[] = [];
  for (const raw of input.split(",")) {
    const interval = raw.trim() as Interval;
    if (!interval || seen.has(interval)) continue;
    if (!allowed.has(interval)) {
      throw new Error(`INTERVALS contains unsupported interval: ${interval}`);
    }
    seen.add(interval);
    intervals.push(interval);
  }

  if (intervals.length === 0) {
    throw new Error("INTERVALS must contain at least one supported interval");
  }
  return intervals;
}
