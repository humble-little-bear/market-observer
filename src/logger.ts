// Tiny console-based logger that respects LOG_LEVEL.
// Levels (in order of severity): error < warn < info < debug.

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function ts(): string {
  return new Date().toISOString();
}

export interface Logger {
  level: LogLevel;
  error: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  info: (msg: string, extra?: unknown) => void;
  debug: (msg: string, extra?: unknown) => void;
}

export function makeLogger(level: LogLevel): Logger {
  const cutoff = LEVEL_ORDER[level];
  const log = (lvl: LogLevel, msg: string, extra?: unknown): void => {
    if (LEVEL_ORDER[lvl] > cutoff) return;
    const tag = lvl.toUpperCase().padEnd(5, " ");
    const line = `[${ts()}] ${tag} ${msg}`;
    if (lvl === "error") {
      console.error(line);
    } else if (lvl === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
    if (extra !== undefined) {
      const serialized =
        extra instanceof Error
          ? `${extra.name}: ${extra.message}\n${extra.stack ?? ""}`
          : JSON.stringify(extra, null, 2);
      console.log(serialized);
    }
  };
  return {
    level,
    error: (m, e) => log("error", m, e),
    warn: (m, e) => log("warn", m, e),
    info: (m, e) => log("info", m, e),
    debug: (m, e) => log("debug", m, e),
  };
}
