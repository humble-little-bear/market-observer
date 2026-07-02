export type GoldNewsSource = "fed" | "google_news";

export type GoldBias = "dovish" | "hawkish" | "mixed" | "neutral";

export type GoldRead = "bullish" | "bearish" | "unclear";

export type GoldConfidence = "low" | "medium" | "high";

export type GoldMoveDirection = "up" | "down" | "flat";

export type GoldPricePoint = {
  source: "yahoo";
  symbol: string;
  time: Date;
  price: number;
};

export type GoldMove = {
  symbol: string;
  latest: GoldPricePoint;
  change5mPct?: number;
  change15mPct?: number;
  direction: GoldMoveDirection;
  triggered: boolean;
  triggerReasons: string[];
};

export type GoldNewsItem = {
  source: GoldNewsSource;
  title: string;
  url?: string;
  publishedAt?: Date;
  summary?: string;
};

export type GoldCauseSignal = {
  bias: GoldBias;
  goldRead: GoldRead;
  confidence: GoldConfidence;
  score: number;
  reasons: string[];
  mappedIndicators: string[];
  evidence: GoldNewsItem[];
};

export type GoldCauseDiagnostics = {
  fedItems: number;
  newsItems: number;
  goldPricePoints: number;
  warnings: string[];
};

export type GoldCauseRun = {
  move?: GoldMove;
  signal: GoldCauseSignal;
  diagnostics: GoldCauseDiagnostics;
  lookbackMinutes: number;
};
