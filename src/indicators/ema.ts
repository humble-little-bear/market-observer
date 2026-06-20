// Standard EMA: seed with SMA of the first `period` values, then apply
// EMA = price * k + prevEMA * (1-k), k = 2/(period+1).
// Returns an array of the same length as `values`, with nulls before the
// seed completes.

export function ema(values: readonly number[], period: number): Array<number | null> {
  if (period < 1) throw new Error("period must be >= 1");
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period) return out;

  // Seed with SMA of the first `period` values.
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    const v = values[i]!;
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
