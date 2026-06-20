// ATR(14) using Wilder's smoothing.
// TrueRange[i] = max(high[i]-low[i], |high[i]-close[i-1]|, |low[i]-close[i-1]|)
// ATR[i] = (prevATR * (period-1) + TR[i]) / period
// Seed ATR with the simple average of the first `period` true ranges.

export function atr(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period: number,
): Array<number | null> {
  if (period < 1) throw new Error("period must be >= 1");
  const n = highs.length;
  if (lows.length !== n || closes.length !== n) {
    throw new Error("highs/lows/closes length mismatch");
  }
  const out: Array<number | null> = new Array(n).fill(null);
  if (n < period + 1) return out;

  // First TR at index 1 (need prev close).
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const high = highs[i]!;
    const low = lows[i]!;
    const prevClose = closes[i - 1]!;
    const range = high - low;
    const up = Math.abs(high - prevClose);
    const down = Math.abs(low - prevClose);
    tr[i] = Math.max(range, up, down);
  }

  // Seed ATR with mean of TRs[1..period].
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i]!;
  let prevAtr = sum / period;
  out[period] = prevAtr;

  for (let i = period + 1; i < n; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]!) / period;
    out[i] = prevAtr;
  }
  return out;
}
