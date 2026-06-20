// SQLite schema. Idempotent: safe to run on every db open.

export const DDL: readonly string[] = [
  `PRAGMA journal_mode = WAL;`,
  `PRAGMA synchronous = NORMAL;`,
  `PRAGMA foreign_keys = ON;`,

  `CREATE TABLE IF NOT EXISTS candles (
     market      TEXT    NOT NULL,
     interval    TEXT    NOT NULL,
     open_time   INTEGER NOT NULL,
     open        REAL    NOT NULL,
     high        REAL    NOT NULL,
     low         REAL    NOT NULL,
     close       REAL    NOT NULL,
     volume      REAL    NOT NULL,
     close_time  INTEGER NOT NULL,
     PRIMARY KEY (market, interval, open_time)
   );`,

  `CREATE INDEX IF NOT EXISTS idx_candles_lookup
     ON candles (market, interval, open_time);`,

  `CREATE TABLE IF NOT EXISTS indicators (
     market        TEXT    NOT NULL,
     interval      TEXT    NOT NULL,
     open_time     INTEGER NOT NULL,
     ema20         REAL,
     ema60         REAL,
     atr           REAL,
     atr_pct       REAL,
     rsi           REAL,
     macd          REAL,
     macd_signal   REAL,
     macd_hist     REAL,
     PRIMARY KEY (market, interval, open_time)
   );`,

  `CREATE INDEX IF NOT EXISTS idx_indicators_lookup
     ON indicators (market, interval, open_time DESC);`,

  `CREATE TABLE IF NOT EXISTS observations (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     market        TEXT    NOT NULL,
     interval      TEXT    NOT NULL,
     ts            INTEGER NOT NULL,
     close         REAL    NOT NULL,
     strategy_bias TEXT    NOT NULL,
     confidence    REAL    NOT NULL,
     trend         TEXT    NOT NULL,
     volatility    TEXT    NOT NULL,
     summary       TEXT    NOT NULL
   );`,

  `CREATE INDEX IF NOT EXISTS idx_observations_market_ts
     ON observations (market, ts DESC);`,

  `CREATE TABLE IF NOT EXISTS reports (
     date     TEXT PRIMARY KEY,
     path     TEXT NOT NULL,
     content  TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS symbol_status (
     market        TEXT PRIMARY KEY,
     available     INTEGER NOT NULL,
     last_checked  INTEGER NOT NULL,
     note          TEXT
   );`,
];
