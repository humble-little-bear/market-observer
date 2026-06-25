import { config } from "../config/index.js";
import { makeLogger, type Logger } from "../logger.js";
import { runCollect } from "../collectors/collect.js";
import { runAnalyze } from "../agents/observer.js";
import { evaluateAlerts } from "../alerts/rules.js";
import { dispatchPendingBarkAlerts } from "../notifications/bark.js";
import { closeDb } from "../storage/db.js";
import { nextClosedCandleDueMs } from "../intervals.js";
import type { Interval, Market } from "../types.js";

export type RunDaemonOptions = {
  logger?: Logger;
  notify?: boolean;
};

type Task = {
  market: Market;
  interval: Interval;
  nextDueMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildTasks(now: number): Task[] {
  const tasks: Task[] = [];
  let offset = 0;
  for (const market of config.markets) {
    for (const interval of config.intervals) {
      tasks.push({
        market,
        interval,
        nextDueMs: now + offset,
      });
      offset += config.collectMinRequestIntervalMs;
    }
  }
  return tasks;
}

function describeTasks(tasks: readonly Task[]): string {
  return tasks.map((t) => `${t.market}:${t.interval}`).join(", ");
}

async function enforceRequestGap(lastRequestAt: { value: number }): Promise<void> {
  const elapsed = Date.now() - lastRequestAt.value;
  const waitMs = config.collectMinRequestIntervalMs - elapsed;
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt.value = Date.now();
}

async function processTask(
  task: Task,
  opts: { logger: Logger; lastRequestAt: { value: number }; notify: boolean },
): Promise<void> {
  const { logger, lastRequestAt, notify } = opts;
  await enforceRequestGap(lastRequestAt);

  logger.info(`[daemon] collect ${task.market} ${task.interval}`);
  const c = await runCollect({
    markets: [task.market],
    intervals: [task.interval],
    logger,
  });
  logger.info(`[daemon] collected ${task.market} ${task.interval}: upserted=${c.upserted}`);

  logger.info(`[daemon] observe ${task.market} ${task.interval}`);
  const a = await runAnalyze({
    markets: [task.market],
    intervals: [task.interval],
    logger,
  });
  logger.info(`[daemon] observed ${task.market} ${task.interval}: observations=${a.observationsInserted}`);

  const alerts = evaluateAlerts({ market: task.market, interval: task.interval, logger });
  if (notify && alerts.created > 0) {
    const pushed = await dispatchPendingBarkAlerts({ logger });
    logger.info(`[daemon] pushed alerts=${pushed.sent}`);
  }

  task.nextDueMs = nextClosedCandleDueMs(task.interval, Date.now());
}

export async function runDaemon(opts: RunDaemonOptions = {}): Promise<void> {
  const logger = opts.logger ?? makeLogger(config.logLevel);
  const notify = opts.notify ?? false;
  const tasks = buildTasks(Date.now());
  const lastRequestAt = { value: 0 };
  let stopping = false;

  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  logger.info("[daemon] starting market observer");
  logger.info(`[daemon] tasks: ${describeTasks(tasks)}`);
  logger.info(`[daemon] min request gap: ${config.collectMinRequestIntervalMs}ms`);
  logger.info(`[daemon] bark alerts: ${notify ? "enabled" : "disabled"}`);

  while (!stopping) {
    tasks.sort((a, b) => a.nextDueMs - b.nextDueMs);
    const next = tasks[0];
    if (!next) break;

    const waitMs = next.nextDueMs - Date.now();
    if (waitMs > 0) {
      await sleep(Math.min(waitMs, 5_000));
      continue;
    }

    try {
      await processTask(next, { logger, lastRequestAt, notify });
    } catch (e) {
      logger.error(`[daemon] task failed ${next.market} ${next.interval}`, e);
      next.nextDueMs = Date.now() + 60_000;
    }
  }

  logger.info("[daemon] stopping");
  closeDb();
}
