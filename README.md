# market-observer

A local-first, **read-only** cryptocurrency & gold market observation
system. It fetches public market data from Binance (no API keys, no
account access), stores candles in SQLite, computes a panel of technical
indicators (EMA20, EMA60, ATR14, RSI14, MACD 12/26/9), emits structured
non-predictive observations, and writes a daily markdown report.

**No trades. No withdrawals. No account mutation. GET-only public market
data.** See [SAFETY.md](./SAFETY.md) for the full invariant.

## Markets

Default symbols: `BTCUSDT,CKBUSDT,XAUTUSDT,XAUUSDT`.

Override the observed asset set with `MARKETS`:

```bash
MARKETS=BTCUSDT,ETHUSDT,SOLUSDT,XAUTUSDT
```

Each symbol is fetched from Binance spot first (`/api/v3/klines`). If Binance
returns invalid symbol, the collector falls back to USDT-M futures
(`/fapi/v1/klines`). If a symbol is unavailable on both surfaces,
`symbol_status(market, 0, …)` is recorded and the rest of the run continues.

## Intervals

Default intervals: `1m,5m,15m,1h,4h,1d`.

Override them with `INTERVALS`:

```bash
INTERVALS=15m,1h,4h,1d
```

The primary observation timeframe used by the daily report and compact Bark
summary is **`4h`**.

## Setup

Requirements: Node ≥ 18, pnpm ≥ 10. Network access to `https://api.binance.com`.

```bash
cd market-observer
pnpm install
pnpm run build
```

Configuration is read from environment variables (a `.env` file is
optional). All three have safe public defaults:

| Var               | Default                       | Purpose                       |
| ----------------- | ----------------------------- | ----------------------------- |
| `BINANCE_BASE_URL` | `https://api.binance.com`    | public market data host       |
| `DB_PATH`         | `./data/observer.db`          | local SQLite file             |
| `LOG_LEVEL`       | `info`                        | `error`/`warn`/`info`/`debug` |
| `MARKETS`         | `BTCUSDT,CKBUSDT,XAUTUSDT,XAUUSDT` | comma-separated Binance symbols |
| `INTERVALS`       | `1m,5m,15m,1h,4h,1d`          | comma-separated Binance intervals |
| `COLLECT_MIN_REQUEST_INTERVAL_MS` | `1200`        | daemon-mode global request gap |
| `ALERT_SHARP_MOVE_15M_PCT` | `1.5`              | 15m sharp-move alert threshold |
| `ALERT_SHARP_MOVE_1H_PCT` | `3`                 | 1h sharp-move alert threshold |
| `ALERT_AGGREGATION_WINDOW_MS` | `180000`        | group similar pending alerts into one Bark push |
| `DIGEST_INTERVAL_HOURS` | `6`                    | Bark digest period in hours |
| `BARK_BASE_URL`   | unset                         | optional Bark server URL      |
| `BARK_DEVICE_KEY` | unset                         | optional Bark iOS device key  |
| `BARK_GROUP`      | `market-observer`             | Bark notification group       |
| `BARK_LEVEL`      | `active`                      | `active`/`timeSensitive`/`passive` |

See `.env.example`.

## Commands

```bash
# One-shot end-to-end (collect → analyze → report)
node dist/cli.js run

# Step-by-step
node dist/cli.js collect   # fetch latest candles for all markets/intervals
node dist/cli.js analyze   # compute indicators + emit observations
node dist/cli.js report    # render reports/YYYY-MM-DD.md
node dist/cli.js notify    # send latest 4h summary to Bark
node dist/cli.js dispatch-alerts # send pending unsent alerts to Bark
node dist/cli.js digest    # render latest completed digest window
node dist/cli.js daemon    # long-lived collector → observer → alert worker
node dist/cli.js status    # inspect DB freshness and latest observations
node dist/cli.js alerts    # list recent alert events
node dist/cli.js cron      # start the in-process scheduler (Ctrl+C to stop)

# Optional market filter
node dist/cli.js run --market BTCUSDT,XAUTUSDT

# Optional push after a one-shot run or scheduled hourly report
node dist/cli.js run --notify
node dist/cli.js cron --notify

# Recommended server mode: record continuously, push only alert events
node dist/cli.js daemon
node dist/cli.js daemon --notify

# Operational checks
node dist/cli.js status
node dist/cli.js alerts --limit 20
node dist/cli.js alerts --unsent
node dist/cli.js dispatch-alerts
node dist/cli.js digest
node dist/cli.js digest --notify
```

After a `run`, check `data/observer.db` (SQLite) and `reports/YYYY-MM-DD.md`
(the daily markdown report).

## Bark notifications

Set these in `.env` after your Bark server is reachable and the iPhone app
has registered against it:

```bash
BARK_BASE_URL=https://bark.example.com
BARK_DEVICE_KEY=your-device-key
BARK_GROUP=market-observer
BARK_LEVEL=active
```

Then send the latest compact market summary:

```bash
node dist/cli.js notify
```

For hands-off operation on a server, run the scheduler with push enabled:

```bash
node dist/cli.js daemon --notify
```

`daemon` is the preferred always-on mode. It processes one `(market, interval)`
at a time, enforces `COLLECT_MIN_REQUEST_INTERVAL_MS` between Binance requests,
records observations, writes alert events, and only pushes newly created alerts
when `--notify` is enabled. On startup, `daemon --notify` also attempts to send
any pending unsent alerts left over from a previous run or temporary Bark
failure. Similar pending alerts inside `ALERT_AGGREGATION_WINDOW_MS` are grouped
into one Bark push, so BTC/ETH/SOL synchronized moves do not vibrate the watch
three times. You can trigger pending alert catch-up manually with:

```bash
node dist/cli.js dispatch-alerts
```

`daemon --notify` also sends a compact market digest every
`DIGEST_INTERVAL_HOURS` hours. The default is a 6-hour digest. Render or send it
manually with:

```bash
node dist/cli.js digest
node dist/cli.js digest --notify
```

First-pass alert rules:

- 15m/1h sharp moves above configured percentage thresholds.
- 1h/4h/1d trend changes.
- Volatility upgrades into `elevated` or `high`.
- 1h and 4h trend alignment when both are non-ranging.

## Server deployment

Use `daemon` as the long-running process. Start without `--notify` for the
first 24-48 hours if you want to inspect `alert_events` before Bark pushes are
enabled.

Example `.env` for a server:

```bash
DB_PATH=/opt/market-observer/data/observer.db
LOG_LEVEL=info
MARKETS=BTCUSDT,ETHUSDT,SOLUSDT,XAUTUSDT
INTERVALS=15m,1h,4h,1d
COLLECT_MIN_REQUEST_INTERVAL_MS=1200
BARK_BASE_URL=https://bark.example.com
BARK_DEVICE_KEY=your-device-key
BARK_GROUP=market-observer
BARK_LEVEL=active
```

Systemd unit example:

```ini
[Unit]
Description=Market Observer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/market-observer
EnvironmentFile=/opt/market-observer/.env
ExecStart=/usr/bin/env node dist/cli.js daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Switch `ExecStart` to `node dist/cli.js daemon --notify` after the alert stream
looks useful.

Useful checks:

```bash
systemctl status market-observer
journalctl -u market-observer -n 100 --no-pager
node dist/cli.js status
node dist/cli.js alerts --limit 20
node dist/cli.js alerts --unsent
node dist/cli.js dispatch-alerts
node dist/cli.js digest
```

The Bark body is intentionally short for watch display:

```text
BTC 67123.45 up normal
CKB 0.009123 flat elevated
XAUT 2345.67 down normal
```

## Project layout

```
market-observer/
  src/
    config/index.ts         # env loading (zod-validated), markets/intervals
    safety/guard.ts         # URL blocklist + GET-only enforcement
    storage/
      schema.ts             # idempotent DDL
      db.ts                 # better-sqlite3 singleton (WAL on)
      repository.ts         # prepared statements + typed accessors
    collectors/
      binance.ts            # fetchKlines with safety guard + retry + timeout
      collect.ts            # backfill-on-first-run + poll-latest orchestration
    indicators/
      ema.ts                # standard EMA
      atr.ts                # Wilder ATR(14) + atr_pct = atr/close*100
      rsi.ts                # Wilder RSI(14)
      macd.ts               # MACD(12,26,9)
      compute.ts            # align everything by open_time
    agents/observer.ts      # latest indicators → structured Observation
    alerts/rules.ts         # observation/candle rules → deduplicated alert events
    daemon/worker.ts        # long-lived paced worker
    inspect/status.ts       # operational status/alerts rendering
    notifications/bark.ts   # Bark summary/alert dispatch
    reports/daily.ts        # markdown daily report
    reports/digest.ts       # 6h market digest generation/dispatch
    cli.ts                  # commander (collect|analyze|report|run|cron)
    index.ts                # entry
  data/                     # observer.db (gitignored)
  reports/                  # YYYY-MM-DD.md (gitignored)
  package.json
  tsconfig.json
  README.md
  SAFETY.md
  .gitignore
  .env.example
```

## Collection logic

- **First run** for a `(market, interval)`: backfill the most recent
  `limit=1000` candles.
- **Subsequent runs**: fetch the latest 10 candles, drop the still-forming
  one (the row whose `closeTime` is `>= now`), and upsert the rest.
- The 250 ms pause between requests keeps us far below Binance's weight
  limits.

## Indicators (per candle, aligned by `open_time`)

- **EMA20**, **EMA60** — seeded with SMA of the first `period` values.
- **ATR(14)** — Wilder's smoothing of True Range; `atr_pct = atr / close * 100`.
- **RSI(14)** — Wilder's RSI, 0–100.
- **MACD(12,26,9)** — `macd = EMA12 - EMA26`, `signal = EMA9(macd)`, `hist = macd - signal`.

Rows where an indicator is not yet computable (insufficient history) are
stored as SQL `NULL` — they are treated as absent, never coerced to 0.

## Observer agent (read-only, descriptive only)

Inputs: latest indicators for a (market, interval). The primary
observation timeframe is **4h**.

Output:

```json
{
  "market": "BTCUSDT",
  "strategy_bias": "observe",
  "confidence": 0.62,
  "trend": "bullish | bearish | ranging",
  "volatility": "low | normal | elevated | high",
  "summary": "Price above EMA20 and EMA60. RSI 58. MACD histogram positive. ATR 1.2% vs 0.9% 20-period mean.",
  "interval": "4h",
  "ts": 1700000000000,
  "close": 67123.45
}
```

- `strategy_bias` is **always** `"observe"`. This system never trades.
- `summary` describes current conditions only. No "will rise" / "expected
  to" / "likely to" language is used or accepted in code.

Trend heuristic:

- `price > EMA20 > EMA60` → bullish
- `price < EMA20 < EMA60` → bearish
- else → ranging

Volatility heuristic (vs the 20-period mean of `atr_pct`):

- `< 0.8x` → low
- `0.8x – 1.2x` → normal
- `1.2x – 2x` → elevated
- `> 2x` → high

Confidence is higher when EMA20/EMA60 agree on direction AND MACD
histogram sign agrees; lower when they conflict. Clamped to 0..1.

## Daily report

`reports/YYYY-MM-DD.md` contains, in this exact order:

1. `# Daily Summary — YYYY-MM-DD`
2. One `## SYMBOL` section per configured market
3. `## Cross Market`
4. `## Changes Since Yesterday` (diffs vs the most-recent stored
   observation from the prior UTC day)
5. `## Things Worth Watching` (descriptive only — no predictions)

The same content is also stored in the `reports` table (upsert by date).

## Storage

SQLite via `better-sqlite3` (synchronous, prepared statements, WAL on).
Tables:

- `candles (market, interval, open_time, …)` — PK `(market, interval, open_time)`.
- `indicators (market, interval, open_time, ema20, ema60, atr, atr_pct, rsi, macd, macd_signal, macd_hist)`.
- `observations (id, market, interval, ts, strategy_bias, confidence, trend, volatility, summary)`.
- `reports (date, path, content)`.
- `symbol_status (market, available, last_checked, note)`.

Quick local inspection (no sqlite3 CLI required):

```bash
node -e 'const Db=require("better-sqlite3"); const db=new Db("./data/observer.db"); console.log(db.prepare("SELECT market, interval, COUNT(*) c FROM candles GROUP BY 1,2").all());'
```

## Safety

See [SAFETY.md](./SAFETY.md). Highlights:

- `src/safety/guard.ts` `assertSafeUrl` rejects any URL whose path
  contains `order`, `trade`, `withdraw`, `capital`, or `sapi` (case
  insensitive) and rejects any non-GET method.
- The blocklist is consulted on every HTTP call, before the request.
- No API keys, no secrets, no auth headers, no signed requests.
- `axios` / `node-fetch` are not used; Node's built-in `fetch` is the
  only HTTP client.

## TypeScript

- `strict: true` (and the strict family: `noImplicitAny`,
  `strictNullChecks`, `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- No `any` anywhere. No `as any`, no `@ts-ignore`, no `@ts-expect-error`.
- All API responses are validated with `zod` before being used.

## License

UNLICENSED. Local use only.
