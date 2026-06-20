# SAFETY — Read-Only Invariant

This document defines the safety contract for `market-observer`. It is
intentionally short and unambiguous. If a future change appears to violate
any item below, **do not merge that change** — open an issue instead.

## The invariant

`market-observer` is a **local-first, read-only** market observation tool.
It MUST NOT, under any circumstances, take any action that mutates an
account on Binance or any other venue.

Concretely:

1. **No trades.** No orders, no conditional orders, no OCO, no algo orders.
2. **No withdrawals.** No asset transfers of any kind.
3. **No account mutation.** No profile changes, no API-key creation, no
   sub-account creation, no enable/disable of features.
4. **No private endpoints.** No `sapi/*` calls. No signed requests. No
   API keys, no secrets, no auth headers. Public endpoints only.
5. **GET only.** Every HTTP request is `GET`. There is no `POST`, `PUT`,
   `DELETE`, or any other method in the codebase.

## How the invariant is enforced

A single function enforces the network-level invariant:

```ts
// src/safety/guard.ts
import { assertSafeUrl } from "./src/safety/guard.js";
assertSafeUrl(url, "GET");
```

`assertSafeUrl` throws `SafetyError` if ANY of the following is true:

- The method is not `GET`.
- The URL is not absolute `http(s)`.
- The URL path (case-insensitive) contains any of the following tokens:
  - `order`
  - `trade`
  - `withdraw`
  - `capital`
  - `sapi`

`assertSafeUrl` is called in `src/collectors/binance.ts` BEFORE every
HTTP request — both for the spot URL and the futures-fallback URL. A
symbol that fails a basic alphanumeric sanity check (`assertSafeSymbol`)
is also rejected.

The blocklist intentionally includes `sapi` even though our fetcher
never signs requests: defense in depth — if a future contributor
inadvertently constructs an `https://api.binance.com/sapi/v1/...` URL,
the guard will refuse it before the bytes leave the process.

## What is in the codebase

- HTTP client: Node's built-in `fetch`. No `axios`, no `node-fetch`.
- HTTP method enforced: `GET` (asserted in the safety guard).
- Timeouts: every request uses `AbortController` (default 15s).
- Retries: 3 attempts with exponential backoff (250ms, 500ms, 1s) for
  transient errors. 4xx (other than 429) are NOT retried — they will not
  succeed. Safety errors are never retried.
- No `.env` with secrets. `.env.example` only documents three public
  variables: `BINANCE_BASE_URL`, `DB_PATH`, `LOG_LEVEL`. None of them
  can authenticate anything.
- No API key handling anywhere in the source tree.
- The `observations.strategy_bias` column is hardcoded to the value
  `"observe"`. The observer agent's summary uses non-predictive
  language: it describes current conditions only, never "will rise" or
  "expected to."

## What is explicitly NOT in the codebase

- Trading logic, order construction, or position tracking.
- Withdrawal endpoints, transfer endpoints, or any account-mutating call.
- A wallet, a key store, or a credentials file.
- Any code path that issues a non-GET request.
- Any HTTP client other than Node's built-in `fetch`.

## Auditing

To audit the invariant yourself, run:

```bash
# Confirm no axios / node-fetch:
grep -RIn --include='*.ts' -E 'axios|node-fetch' src/ || echo "OK: no axios/node-fetch"

# Confirm no POST/PUT/DELETE/PATCH:
grep -RIn --include='*.ts' -E "method:\s*['\"](POST|PUT|DELETE|PATCH)['\"]" src/ || echo "OK: GET only"

# Confirm blocklist:
grep -RIn --include='*.ts' 'FORBIDDEN_PATH_TOKENS' src/

# Confirm no API keys / secrets in env:
cat .env.example
```

If any of those checks return non-empty output, treat it as a bug.
