// Shared type contracts for market-observer.
// Keep these aligned with the docs in README.md / SAFETY.md.

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type Market = string;

export const ALL_INTERVALS: readonly Interval[] = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export const DEFAULT_MARKETS: readonly Market[] = ["BTCUSDT", "CKBUSDT", "XAUTUSDT", "XAUUSDT"] as const;

export interface Candle {
  market: Market;
  interval: Interval;
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number; // ms epoch
}

export interface Indicator {
  market: Market;
  interval: Interval;
  openTime: number;
  ema20: number | null;
  ema60: number | null;
  atr: number | null;
  atrPct: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
}

export type Trend = "bullish" | "bearish" | "ranging";
export type Volatility = "low" | "normal" | "elevated" | "high";
export type StrategyBias = "observe";
export type AlertSeverity = "info" | "warn" | "critical";
export type AlertType =
  | "trend_change"
  | "volatility_upgrade"
  | "sharp_move"
  | "multi_timeframe_alignment";

export interface Observation {
  market: Market;
  strategyBias: StrategyBias; // always "observe" — we never trade
  confidence: number; // 0..1
  trend: Trend;
  volatility: Volatility;
  summary: string;
  interval: Interval; // which timeframe this observation was derived from
  ts: number; // ms epoch
  close: number; // latest close price at observation time
}

export interface SymbolStatus {
  market: Market;
  available: 0 | 1;
  lastChecked: number;
  note?: string;
}

export interface AlertEvent {
  id?: number;
  market: Market;
  interval: Interval;
  ts: number;
  type: AlertType;
  severity: AlertSeverity;
  fingerprint: string;
  title: string;
  body: string;
  dataJson: string;
  sentAt: number | null;
}

export interface DigestRun {
  id?: number;
  periodStart: number;
  periodEnd: number;
  title: string;
  body: string;
  sentAt: number | null;
}
