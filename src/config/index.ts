import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_INTERVALS, ALL_MARKETS, type Interval, type Market } from "../types.js";

const LogLevelSchema = z.enum(["error", "warn", "info", "debug"]);

const EnvSchema = z.object({
  BINANCE_BASE_URL: z.string().url().default("https://api.binance.com"),
  DB_PATH: z.string().default("./data/observer.db"),
  LOG_LEVEL: LogLevelSchema.default("info"),
});

export type AppConfig = {
  binanceBaseUrl: string;
  dbPath: string;
  logLevel: z.infer<typeof LogLevelSchema>;
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
  });

  const dataDir = path.resolve(path.dirname(parsed.DB_PATH));
  const reportsDir = path.resolve("./reports");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  return {
    binanceBaseUrl: parsed.BINANCE_BASE_URL.replace(/\/+$/, ""),
    dbPath: path.resolve(parsed.DB_PATH),
    logLevel: parsed.LOG_LEVEL,
    markets: ALL_MARKETS,
    intervals: ALL_INTERVALS,
    dataDir,
    reportsDir,
  };
}

export const config: AppConfig = buildConfig();
