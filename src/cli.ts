import { Command } from "commander";
import { config } from "./config/index.js";
import { makeLogger } from "./logger.js";
import { runCollect } from "./collectors/collect.js";
import { runAnalyze } from "./agents/observer.js";
import { buildDailyReport } from "./reports/daily.js";
import { dispatchPendingBarkAlerts, sendBarkMarketSummary } from "./notifications/bark.js";
import { runDaemon } from "./daemon/worker.js";
import { renderAlerts, renderStatus } from "./inspect/status.js";
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

function addLogLevelOption(command: Command): Command {
  return command.option("--log-level <level>", "override LOG_LEVEL (error|warn|info|debug)");
}

function addMarketOption(command: Command): Command {
  return addLogLevelOption(
    command.option("-m, --market <list>", "comma-separated market filter (e.g. BTCUSDT,XAUTUSDT)"),
  );
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

  addMarketOption(program.command("collect"))
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

  addMarketOption(program.command("analyze"))
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

  addLogLevelOption(program.command("report"))
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

  addLogLevelOption(program.command("notify"))
    .description("Send the latest market summary through Bark")
    .action(async (opts: { logLevel?: string }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      try {
        const res = await sendBarkMarketSummary({ logger: log });
        log.info(`notify: ${res.title}`);
        closeDb();
        process.exit(0);
      } catch (e) {
        log.error("notify failed", e);
        closeDb();
        process.exit(1);
      }
    });

  addLogLevelOption(program.command("dispatch-alerts"))
    .description("Send pending unsent alert events through Bark")
    .action(async (opts: { logLevel?: string }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      try {
        const res = await dispatchPendingBarkAlerts({ logger: log });
        log.info(`dispatch-alerts: sent=${res.sent}`);
        closeDb();
        process.exit(0);
      } catch (e) {
        log.error("dispatch-alerts failed", e);
        closeDb();
        process.exit(1);
      }
    });

  addLogLevelOption(program.command("daemon"))
    .description("Run the long-lived collector → observer → alert worker")
    .option("--notify", "push newly created alerts through Bark")
    .action(async (opts: { logLevel?: string; notify?: boolean }) => {
      const log = opts.logLevel ? makeLogger(asLogLevel(opts.logLevel)) : logger;
      try {
        await runDaemon({ logger: log, notify: opts.notify === true });
      } catch (e) {
        log.error("daemon failed", e);
        closeDb();
        process.exit(1);
      }
    });

  program
    .command("status")
    .description("Show database freshness, latest observations, and alert counts")
    .action(() => {
      try {
        console.log(renderStatus());
        closeDb();
        process.exit(0);
      } catch (e) {
        logger.error("status failed", e);
        closeDb();
        process.exit(1);
      }
    });

  program
    .command("alerts")
    .description("List recent alert events")
    .option("-n, --limit <n>", "number of alerts to show", "20")
    .option("--unsent", "show only unsent alerts")
    .action((opts: { limit?: string; unsent?: boolean }) => {
      try {
        const limit = parsePositiveInt(opts.limit ?? "20", "limit");
        console.log(renderAlerts({ limit, unsentOnly: opts.unsent === true }));
        closeDb();
        process.exit(0);
      } catch (e) {
        logger.error("alerts failed", e);
        closeDb();
        process.exit(1);
      }
    });

  addMarketOption(program.command("run"))
    .description("Run collect → analyze → report in one shot")
    .option("--notify", "send a Bark market summary after report generation")
    .action(async (opts: { market?: string; logLevel?: string; notify?: boolean }) => {
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
        if (opts.notify === true) {
          log.info("=== run: notify ===");
          await sendBarkMarketSummary({ logger: log });
        }
        closeDb();
        process.exit(0);
      } catch (e) {
        log.error("run failed", e);
        closeDb();
        process.exit(1);
      }
    });

  addLogLevelOption(program.command("cron"))
    .description("Start in-process scheduler: collect every 5m, analyze every 15m, report hourly at :05")
    .option("--notify", "send a Bark market summary after each scheduled report")
    .action((opts: { logLevel?: string; notify?: boolean }) => {
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
          if (opts.notify === true) {
            sendBarkMarketSummary({ logger: log }).catch((e) => log.error("[cron] notify failed", e));
          }
        } catch (e) {
          log.error("[cron] report failed", e);
        }
      });
      log.info("schedule:");
      log.info("  collect  */5 * * * *");
      log.info("  analyze  */15 * * * *");
      log.info("  report   5 * * * *");
      if (opts.notify === true) log.info("  notify   after report");
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

function parsePositiveInt(input: string, label: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
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
