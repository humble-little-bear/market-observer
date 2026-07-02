import type { GoldCauseRun, GoldMove } from "../types.js";
import { formatPct } from "../scoring/move.js";

function labelGoldRead(read: string): string {
  if (read === "bullish") return "short-term bullish for gold";
  if (read === "bearish") return "short-term bearish for gold";
  return "unclear for gold";
}

function renderMove(move: GoldMove): string[] {
  const lines = [
    "Gold move:",
    `- ${move.symbol} latest ${move.latest.price.toFixed(2)} at ${move.latest.time.toISOString()}`,
  ];
  if (move.change5mPct !== undefined) lines.push(`- 5m: ${formatPct(move.change5mPct)}`);
  else lines.push("- 5m: n/a");
  if (move.change15mPct !== undefined) lines.push(`- 15m: ${formatPct(move.change15mPct)}`);
  else lines.push("- 15m: n/a");
  lines.push(`- Triggered: ${move.triggered ? "yes" : "no"}`);
  for (const reason of move.triggerReasons) lines.push(`  ${reason}`);
  if (!move.triggered) lines.push("  No short-window move threshold crossed; news bias below is context, not an alert.");
  return lines;
}

export function renderGoldCauseReport(run: GoldCauseRun): string {
  const lines: string[] = [];
  lines.push("Gold Cause Report");
  lines.push(`Window: last ${run.lookbackMinutes} minutes`);
  lines.push(
    `Sources: fed=${run.diagnostics.fedItems}, news=${run.diagnostics.newsItems}, goldPoints=${run.diagnostics.goldPricePoints}`,
  );
  lines.push("");
  if (run.move) {
    lines.push(...renderMove(run.move));
    lines.push("");
  }
  lines.push(`Bias: ${run.signal.bias}`);
  lines.push(`Gold read: ${labelGoldRead(run.signal.goldRead)}`);
  lines.push(`Confidence: ${run.signal.confidence}`);
  lines.push(`Rules score: ${run.signal.score}`);
  lines.push("");
  lines.push("Likely cause:");
  for (const reason of run.signal.reasons) lines.push(`- ${reason}`);
  lines.push("");
  lines.push("Mapped indicators:");
  for (const indicator of run.signal.mappedIndicators) lines.push(`- ${indicator}`);
  if (run.signal.evidence.length > 0) {
    lines.push("");
    lines.push("Evidence:");
    for (const item of run.signal.evidence) {
      const when = item.publishedAt ? ` | ${item.publishedAt.toISOString()}` : "";
      lines.push(`- [${item.source}] ${item.title}${when}`);
      if (item.url) lines.push(`  ${item.url}`);
    }
  }
  if (run.diagnostics.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of run.diagnostics.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

export function renderGoldCauseBark(run: GoldCauseRun): { title: string; body: string } {
  const move = run.move;
  const direction = move?.direction === "up" ? "急涨" : move?.direction === "down" ? "急跌" : "异动";
  const title = move?.triggered ? `黄金${direction}：${run.signal.bias}` : `黄金宏观背景：${run.signal.bias}`;
  const lines: string[] = [];
  if (move) {
    lines.push(`${move.symbol} ${move.latest.price.toFixed(2)}`);
    if (move.change5mPct !== undefined) lines.push(`5m ${formatPct(move.change5mPct)}`);
    if (move.change15mPct !== undefined) lines.push(`15m ${formatPct(move.change15mPct)}`);
  }
  lines.push(`${run.signal.goldRead} / ${run.signal.confidence}`);
  lines.push(...run.signal.reasons.slice(0, 2));
  if (run.signal.evidence[0]) lines.push(run.signal.evidence[0].title);
  lines.push(`指标：${run.signal.mappedIndicators.join(", ")}`);
  return { title, body: lines.join("\n") };
}
