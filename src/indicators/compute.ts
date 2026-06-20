// Compute the full indicator panel for a single (market, interval) candle series.
// All outputs are aligned to the input candles by index / openTime.
// Values are null when not yet computable (insufficient history); downstream
// code should treat null as "absent" — do not coerce to 0.

import type { Candle, Indicator, Interval, Market } from "../types.js";
import { ema } from "./ema.js";
import { atr } from "./atr.js";
import { rsi } from "./rsi.js";
import { macd } from "./macd.js";

export function computeIndicators(
  market: Market,
  interval: Interval,
  candles: readonly Candle[],
): Indicator[] {
  if (candles.length === 0) return [];
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const e20 = ema(closes, 20);
  const e60 = ema(closes, 60);
  const a14 = atr(highs, lows, closes, 14);
  const r14 = rsi(closes, 14);
  const m = macd(closes, 12, 26, 9);

  const out: Indicator[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const atrVal = a14[i];
    const close = c.close;
    const atrPct = atrVal !== null && close > 0 ? (atrVal / close) * 100 : null;
    out[i] = {
      market,
      interval,
      openTime: c.openTime,
      ema20: e20[i],
      ema60: e60[i],
      atr: atrVal,
      atrPct,
      rsi: r14[i],
      macd: m.macd[i],
      macdSignal: m.signal[i],
      macdHist: m.hist[i],
    };
  }
  return out;
}
