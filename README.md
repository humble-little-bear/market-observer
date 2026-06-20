# market-observer

A local-first, **read-only** cryptocurrency & gold market observation
system. It fetches public market data from Binance (no API keys, no
account access), stores candles in SQLite, computes a panel of technical
indicators (EMA20, EMA60, ATR14, RSI14, MACD 12/26/9), emits structured
non-predictive observations, and writes a daily markdown report.

**No trades. No withdrawals. No account mutation. GET-only public market
data.** See [SAFETY.md](./SAFETY.md) for the full invariant.

## Markets

| Symbol   | Source         | Notes                          |
| -------- | -------------- | ------------------------------ |
| BTCUSDT  | spot (`/api/v3/klines`) | primary                  |
| CKBUSDT  | spot (`/api/v3/klines`) | primary                  |
| XAUTUSDT | spot (`/api/v3/klines`) | Tether Gold (spot)       |
| XAUUSDT  | spot → futures  | spot returns -1121; falls back to `/fapi/v1/klines` |

If a symbol is unavailable on both surfaces, `symbol_status(market, 0, …)`
is recorded and the rest of the run continues.

## Intervals

`1m`, `5m`, `1h`, `4h`, `1d`. The primary observation timeframe used by
the observer agent and the daily report is **`4h`**.

## Setup

Requirements: Node ≥ 18, npm ≥ 10. Network access to `https://api.binance.com`.

```bash
cd market-observer
npm install
npm run build
```

Configuration is read from environment variables (a `.env` file is
optional). All three have safe public defaults:

| Var               | Default                       | Purpose                       |
| ----------------- | ----------------------------- | ----------------------------- |
| `BINANCE_BASE_URL` | `https://api.binance.com`    | public market data host       |
| `DB_PATH`         | `./data/observer.db`          | local SQLite file             |
| `LOG_LEVEL`       | `info`                        | `error`/`warn`/`info`/`debug` |

See `.env.example`.

## Commands

```bash
# One-shot end-to-end (collect → analyze → report)
node dist/cli.js run

# Step-by-step
node dist/cli.js collect   # fetch latest candles for all markets/intervals
node dist/cli.js analyze   # compute indicators + emit observations
node dist/cli.js report    # render reports/YYYY-MM-DD.md
node dist/cli.js cron      # start the in-process scheduler (Ctrl+C to stop)

# Optional market filter
node dist/cli.js run --market BTCUSDT,XAUTUSDT
```

After a `run`, check `data/observer.db` (SQLite) and `reports/YYYY-MM-DD.md`
(the daily markdown report).

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
    reports/daily.ts        # markdown daily report
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
2. `## BTC`
3. `## CKB`
4. `## Gold` (XAUTUSDT primary, plus XAUUSDT if available)
5. `## Cross Market`
6. `## Changes Since Yesterday` (diffs vs the most-recent stored
   observation from the prior UTC day)
7. `## Things Worth Watching` (descriptive only — no predictions)

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
