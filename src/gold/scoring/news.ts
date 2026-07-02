import type { GoldBias, GoldCauseSignal, GoldConfidence, GoldNewsItem, GoldRead } from "../types.js";

const DOVISH = [
  "inflation risks have come down",
  "inflation risks are receding",
  "risks are receding",
  "rate cut",
  "cuts",
  "easing",
  "ease fed rate-hike prospects",
  "ease rate-hike prospects",
  "ease fed rate hike prospects",
  "ease rate hike prospects",
  "less hawkish",
  "slowing inflation",
  "cooling inflation",
  "growth risks",
  "labor market weakness",
  "yields fall",
  "treasury yields retreat",
  "dollar falls",
  "dollar weakens",
  "gold rebounding",
  "gold rebounds",
  "gold holds gain",
  "gold finds support",
];

const HAWKISH = [
  "rate hike bets",
  "rate-hike bets",
  "rate hike fears",
  "rate-hike fears",
  "rate hike prospects weigh",
  "rate-hike prospects weigh",
  "higher for longer",
  "inflation remains elevated",
  "sticky inflation",
  "tightening",
  "hot inflation",
  "higher treasury yields",
  "yields rise",
  "treasury yields rise",
  "treasury yields weigh",
  "dollar rises",
  "dollar strengthens",
];

const RELEVANCE = [
  "fed",
  "fomc",
  "federal reserve",
  "chair",
  "powell",
  "warsh",
  "waller",
  "williams",
  "inflation",
  "rates",
  "treasury yields",
  "dollar",
  "gold",
];

function countHits(text: string, phrases: readonly string[]): number {
  return phrases.reduce((count, phrase) => count + (text.includes(phrase) ? 1 : 0), 0);
}

function biasFromScore(score: number): GoldBias {
  if (score >= 2) return "dovish";
  if (score <= -2) return "hawkish";
  if (score !== 0) return "mixed";
  return "neutral";
}

function goldReadFromBias(bias: GoldBias): GoldRead {
  if (bias === "dovish") return "bullish";
  if (bias === "hawkish") return "bearish";
  return "unclear";
}

function confidenceFromEvidence(evidenceCount: number, absScore: number): GoldConfidence {
  if (evidenceCount >= 4 && absScore >= 3) return "high";
  if (evidenceCount >= 2 || absScore >= 2) return "medium";
  return "low";
}

function mappedIndicators(items: readonly GoldNewsItem[]): string[] {
  const text = items.map((item) => item.title).join(" ").toLowerCase();
  const mapped = new Set<string>();
  if (text.includes("yield") || text.includes("rate") || text.includes("fed")) mapped.add("#4 10Y TIPS real yield");
  if (text.includes("dollar") || text.includes("dxy")) mapped.add("#5 dollar index / dollar proxy");
  if (text.includes("stock") || text.includes("s&p") || text.includes("risk")) mapped.add("#10 gold-S&P 60D stress regime");
  if (mapped.size === 0) {
    mapped.add("#4 10Y TIPS real yield");
    mapped.add("#5 dollar index / dollar proxy");
  }
  return [...mapped];
}

function buildReasons(bias: GoldBias, evidence: readonly GoldNewsItem[], score: number): string[] {
  if (evidence.length === 0) return ["No relevant Fed/rates/dollar/gold headlines found in the scan window."];
  if (bias === "dovish") {
    return [
      `Headline mix leans dovish by rules score +${score}.`,
      "Dovish Fed/rates headlines usually support gold through lower real-yield expectations.",
    ];
  }
  if (bias === "hawkish") {
    return [
      `Headline mix leans hawkish by rules score ${score}.`,
      "Hawkish Fed/rates headlines usually pressure gold through higher real-yield and dollar expectations.",
    ];
  }
  if (bias === "mixed") {
    return [
      `Headline mix is mixed by rules score ${score}.`,
      "Treat this as unconfirmed until yields and the dollar confirm.",
    ];
  }
  return ["Relevant headlines exist, but no strong hawkish/dovish phrase was found."];
}

export function scoreGoldNews(items: readonly GoldNewsItem[]): GoldCauseSignal {
  const relevant = items
    .filter((item) => {
      const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
      return RELEVANCE.some((keyword) => text.includes(keyword));
    })
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const scored = relevant.slice(0, 12);

  let score = 0;
  for (const item of scored) {
    const text = `${item.title} ${item.summary ?? ""}`.toLowerCase();
    score += countHits(text, DOVISH);
    score -= countHits(text, HAWKISH);
  }

  const bias = biasFromScore(score);
  return {
    bias,
    goldRead: goldReadFromBias(bias),
    confidence: confidenceFromEvidence(scored.length, Math.abs(score)),
    score,
    reasons: buildReasons(bias, scored, score),
    mappedIndicators: mappedIndicators(scored),
    evidence: scored.slice(0, 8),
  };
}
