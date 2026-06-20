// MACD(12, 26, 9): macd = EMA12(close) - EMA26(close); signal = EMA9(macd); hist = macd - signal.
// Returns three arrays aligned to the input length, with nulls where not yet computable.

import { ema } from "./ema.js";

export type MacdOutput = {
  macd: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
};

export function macd(
  closes: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdOutput {
  const e12 = ema(closes, fastPeriod);
  const e26 = ema(closes, slowPeriod);
  const n = closes.length;
  const macdLine: Array<number | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (e12[i] !== null && e26[i] !== null) {
      macdLine[i] = e12[i]! - e26[i]!;
    }
  }
  // Signal: EMA over the numeric values of macdLine, starting where both EMAs are valid.
  // We need at least `signalPeriod` MACD values.
  const signal: Array<number | null> = new Array(n).fill(null);
  // Find first index where macdLine is non-null and there are `signalPeriod` valid points from there.
  const validStart = macdLine.findIndex((v) => v !== null);
  if (validStart >= 0 && validStart + signalPeriod <= n) {
    const slice = macdLine.slice(validStart, validStart + signalPeriod) as number[];
    let prevSig = slice.reduce((a, b) => a + b, 0) / signalPeriod;
    signal[validStart + signalPeriod - 1] = prevSig;
    const k = 2 / (signalPeriod + 1);
    for (let i = validStart + signalPeriod; i < n; i++) {
      if (macdLine[i] === null) continue;
      prevSig = macdLine[i]! * k + prevSig * (1 - k);
      signal[i] = prevSig;
    }
  }
  const hist: Array<number | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (macdLine[i] !== null && signal[i] !== null) {
      hist[i] = macdLine[i]! - signal[i]!;
    }
  }
  return { macd: macdLine, signal, hist };
}
