import http from "node:http";
import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { getDb } from "../storage/db.js";
import { Repository } from "../storage/repository.js";
import { buildStructureInsight } from "../structure/insights.js";
import { ALL_INTERVALS, type Interval, type Market } from "../types.js";
import { assertSafeSymbol } from "../safety/guard.js";
import { DASHBOARD_HTML } from "./dashboard.js";

export type ServeOptions = {
  host?: string;
  port?: number;
  logger?: Logger;
};

type ApiHandler = (url: URL, repo: Repository) => unknown;

const MAX_HOURS = 24 * 14;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

function text(res: http.ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function parseMarket(url: URL): Market {
  const raw = url.searchParams.get("market") ?? config.markets[0];
  if (!raw) throw new Error("missing market");
  const market = raw.trim().toUpperCase();
  assertSafeSymbol(market);
  return market;
}

function parseInterval(url: URL): Interval {
  const raw = url.searchParams.get("interval") ?? "15m";
  if (!ALL_INTERVALS.includes(raw as Interval)) {
    throw new Error(`unsupported interval: ${raw}`);
  }
  return raw as Interval;
}

function parseHours(url: URL): number {
  const raw = url.searchParams.get("hours") ?? "24";
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours must be positive");
  return Math.min(hours, MAX_HOURS);
}

function timeWindow(url: URL): { start: number; end: number; hours: number } {
  const hours = parseHours(url);
  const end = Date.now();
  return { start: end - hours * 60 * 60_000, end, hours };
}

function routeMarkets(): unknown {
  return {
    markets: config.markets,
    structureMarkets: config.structure.markets,
    intervals: config.intervals,
    defaults: {
      interval: "15m",
      hours: 24,
    },
  };
}

const handlers: Record<string, ApiHandler> = {
  "/api/markets": () => routeMarkets(),

  "/api/status": (_url, repo) => ({
    dbPath: config.dbPath,
    markets: config.markets,
    intervals: config.intervals,
    structureMarkets: config.structure.markets,
    now: Date.now(),
    summaries: config.markets.map((market) => ({
      market,
      latest15m: repo.queryLatestCandles(market, "15m", Date.now(), 1)[0] ?? null,
      primaryObservation: repo.queryLatestObservation(market, "4h"),
      structureInsight: buildStructureInsight(repo, market),
      latestAlert: repo.queryAlertEvents(50).find((event) => event.market === market) ?? null,
    })),
  }),

  "/api/candles": (url, repo) => {
    const market = parseMarket(url);
    const interval = parseInterval(url);
    const { start, end, hours } = timeWindow(url);
    return {
      market,
      interval,
      hours,
      candles: repo.queryCandlesBetween(market, interval, start, end),
    };
  },

  "/api/structure": (url, repo) => {
    const market = parseMarket(url);
    const { start, end, hours } = timeWindow(url);
    return {
      market,
      hours,
      metrics: repo.queryMarketMetricsBetween(market, start, end),
      insight: buildStructureInsight(repo, market),
    };
  },

  "/api/observations": (url, repo) => {
    const market = parseMarket(url);
    const { start, end, hours } = timeWindow(url);
    return {
      market,
      hours,
      observations: repo.queryObservationsBetween(market, start, end),
    };
  },

  "/api/alerts": (url, repo) => {
    const market = parseMarket(url);
    const { start, end, hours } = timeWindow(url);
    const alerts = repo.queryAlertEventsBetween(start, end).filter((event) => event.market === market);
    return { market, hours, alerts };
  },

  "/api/summary": (url, repo) => {
    const market = parseMarket(url);
    const interval = parseInterval(url);
    const { start, end, hours } = timeWindow(url);
    const latestCandle = repo.queryLatestCandles(market, interval, end, 1)[0] ?? null;
    const alerts = repo.queryAlertEventsBetween(start, end).filter((event) => event.market === market);
    return {
      market,
      interval,
      hours,
      latestCandle,
      primaryObservation: repo.queryLatestObservation(market, "4h"),
      structure: {
        spot: repo.queryLatestMarketMetric(market, "spot"),
        futures: repo.queryLatestMarketMetric(market, "futures"),
      },
      structureInsight: buildStructureInsight(repo, market),
      alertCount: alerts.length,
      latestAlert: alerts.at(-1) ?? null,
    };
  },
};

function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const handler = handlers[url.pathname];
  if (!handler) {
    json(res, 404, { error: "not_found" });
    return;
  }

  try {
    const repo = new Repository(getDb(config.dbPath));
    json(res, 200, handler(url, repo));
  } catch (e) {
    json(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function runServe(opts: ServeOptions = {}): Promise<void> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;

  const server = http.createServer((req, res) => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      json(res, 405, { error: "method_not_allowed" });
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      text(res, 200, DASHBOARD_HTML, "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url);
      return;
    }
    text(res, 404, "not found", "text/plain; charset=utf-8");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  logger.info(`[serve] listening on http://${host}:${port}`);

  await new Promise<void>((resolve) => {
    const stop = (): void => {
      logger.info("[serve] stopping");
      server.close(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
