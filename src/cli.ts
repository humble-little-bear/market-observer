import { Command } from "commander";
import { config } from "./config/index.js";
import { makeLogger } from "./logger.js";
import { runCollect } from "./collectors/collect.js";
import { runAnalyze } from "./agents/observer.js";
import { buildDailyReport } from "./reports/daily.js";
import cron from "node-cron";
import type { Market } from "./types.js";
import { closeDb } from "./storage/db.js";

function parseMarkets(input: string | undefined): Market[] | undefined {
  if (!input) return undefined;
  return input
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0) as Market[];
}

export function buildProgram(): Command {
  const logger = makeLogger(config.logLevel);
  const program = new Command();
  program
    .name("observe")
    .description(
      "Local-first, READ-ONLY cryptocurrency & gold market observer. Public Binance data only.",
    )
    .version("0.1.0")
    .option("-m, --market <list>", "comma-separated market filter (e.g. BTCUSDT,XAUTUSDT)")
    .option("--log-level <level>", "override LOG_LEVEL (error|warn|info|debug)");

  program
    .command("collect")
    .description("Fetch latest candles for all markets/intervals and store in SQLite")
    .action(async (opts: { market?: string; logLevel?: string }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      const markets = parseMarkets(opts.market);
      try {
        const res = await runCollect({ markets, logger: log });
        log.info(
          `collect: fetched=${res.fetched} upserted=${res.upserted} unavailable=${res.unavailable.length}`,
        );
        if (res.unavailable.length > 0) {
          for (const u of res.unavailable) {
            log.warn(`unavailable: ${u.market} — ${u.reason}`);
          }
        }
        closeDb();
        process.exit(0);
      } catch (e) {
        log.error("collect failed", e);
        closeDb();
        process.exit(1);
      }
    });

  program
    .command("analyze")
    .description("Compute indicators and emit one observation per (market, interval)")
    .action(async (opts: { market?: string; logLevel?: string }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      const markets = parseMarkets(opts.market);
      try {
        const res = await runAnalyze({ markets, logger: log });
        log.info(
          `analyze: markets=${res.marketsAnalyzed} indicators=${res.indicatorsUpserted} observations=${res.observationsInserted}`,
        );
        closeDb();
        process.exit(0);
      } catch (e) {
        log.error("analyze failed", e);
        closeDb();
        process.exit(1);
      }
    });

  program
    .command("report")
    .description("Generate today's daily markdown report")
    .action((opts: { logLevel?: string }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      try {
        const res = buildDailyReport({ logger: log });
        log.info(`report: ${res.path}`);
        closeDb();
        process.exit(0);
      } catch (e) {
        log.error("report failed", e);
        closeDb();
        process.exit(1);
      }
    });

  program
    .command("run")
    .description("Run collect → analyze → report in one shot")
    .action(async (opts: { market?: string; logLevel?: string }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      const markets = parseMarkets(opts.market);
      try {
        log.info("=== run: collect ===");
        const c = await runCollect({ markets, logger: log });
        log.info(`collect: fetched=${c.fetched} upserted=${c.upserted} unavailable=${c.unavailable.length}`);
        log.info("=== run: analyze ===");
        const a = await runAnalyze({ markets, logger: log });
        log.info(`analyze: indicators=${a.indicatorsUpserted} observations=${a.observationsInserted}`);
        log.info("=== run: report ===");
        const r = buildDailyReport({ logger: log });
        log.info(`report: ${r.path}`);
        closeDb();
        process.exit(0);
      } catch (e) {
        log.error("run failed", e);
        closeDb();
        process.exit(1);
      }
    });

  program
    .command("cron")
    .description("Start in-process scheduler: collect every 5m, analyze every 15m, report hourly at :05")
    .action((opts: { logLevel?: string }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      log.info("starting cron scheduler");
      // Every 5 minutes: collect
      cron.schedule("*/5 * * * *", () => {
        log.info("[cron] collect tick");
        runCollect({ logger: log }).catch((e) => log.error("[cron] collect failed", e));
      });
      // Every 15 minutes: analyze
      cron.schedule("*/15 * * * *", () => {
        log.info("[cron] analyze tick");
        runAnalyze({ logger: log }).catch((e) => log.error("[cron] analyze failed", e));
      });
      // Hourly at :05: report
      cron.schedule("5 * * * *", () => {
        log.info("[cron] report tick");
        try {
          buildDailyReport({ logger: log });
        } catch (e) {
          log.error("[cron] report failed", e);
        }
      });
      log.info("schedule:");
      log.info("  collect  */5 * * * *");
      log.info("  analyze  */15 * * * *");
      log.info("  report   5 * * * *");
      log.info("press Ctrl+C to stop.");
      // Keep the process alive.
      process.stdin.resume();
      const shutdown = (): void => {
        log.info("cron scheduler stopping");
        closeDb();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  return program;
}

function asLogLevel(s: string): "error" | "warn" | "info" | "debug" {
  if (s === "error" || s === "warn" || s === "info" || s === "debug") return s;
  throw new Error(`invalid log level: ${s}`);
}

export async function main(argv: readonly string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv as string[]);
}

// Self-invocation: when this file is run directly via `node dist/cli.js`,
// dispatch to main(). When required (e.g. by tests or by dist/index.js),
// the require.main check fails and we just export the helpers.
if (require.main === module) {
  main(process.argv).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[fatal]", err);
    process.exit(1);
  });
}
