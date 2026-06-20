// Wilder's RSI(14).
//   gains[i] = max(close[i] - close[i-1], 0)
//   losses[i] = max(close[i-1] - close[i], 0)
//   avgGain / avgLoss seeded as SMA over first `period` changes, then smoothed:
//     avgGain[i] = (avgGain[i-1] * (period-1) + gain[i]) / period
//     avgLoss[i] = (avgLoss[i-1] * (period-1) + loss[i]) / period
//   RS  = avgGain / avgLoss
//   RSI = 100 - 100 / (1 + RS)

export function rsi(closes: readonly number[], period: number): Array<number | null> {
  if (period < 1) throw new Error("period must be >= 1");
  const n = closes.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (n < period + 1) return out;

  const gains: number[] = new Array(n).fill(0);
  const losses: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    gains[i] = diff > 0 ? diff : 0;
    losses[i] = diff < 0 ? -diff : 0;
  }

  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 1; i <= period; i++) {
    sumGain += gains[i]!;
    sumLoss += losses[i]!;
  }
  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  const rsiAt = (g: number, l: number): number => {
    if (l === 0) return g === 0 ? 50 : 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };
  out[period] = rsiAt(avgGain, avgLoss);

  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
    out[i] = rsiAt(avgGain, avgLoss);
  }
  return out;
}
