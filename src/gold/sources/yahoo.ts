import type { GoldPricePoint } from "../types.js";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: unknown;
  };
};

export async function fetchYahooGoldIntraday(symbol: string): Promise<GoldPricePoint[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "5m");
  url.searchParams.set("includePrePost", "true");

  const response = await fetch(url, {
    headers: {
      "user-agent": "market-observer/0.1 (+local read-only gold monitor)",
      accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`Yahoo chart ${symbol} failed: ${response.status}`);

  const json = (await response.json()) as YahooChartResponse;
  if (json.chart?.error) throw new Error(`Yahoo chart ${symbol} error: ${JSON.stringify(json.chart.error)}`);

  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  return timestamps
    .map((timestamp, index): GoldPricePoint | null => {
      const price = closes[index];
      if (price === null || price === undefined || !Number.isFinite(price)) return null;
      return { source: "yahoo", symbol, time: new Date(timestamp * 1000), price };
    })
    .filter((point): point is GoldPricePoint => point !== null);
}
