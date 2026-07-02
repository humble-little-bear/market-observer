import type { GoldNewsItem } from "../types.js";
import { fetchText, stripHtml } from "../utils.js";

const FED_PAGES = [
  "https://www.federalreserve.gov/newsevents/speeches.htm",
  "https://www.federalreserve.gov/newsevents/pressreleases.htm",
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
] as const;

function isFedContentUrl(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase();
  return (
    /\/newsevents\/speech\/[a-z]+20\d{6}[a-z]?\.htm$/.test(path) ||
    /\/newsevents\/testimony\/[a-z]+20\d{6}[a-z]?\.htm$/.test(path) ||
    /\/newsevents\/pressreleases\/monetary20\d{6}[a-z]?\.htm$/.test(path) ||
    /\/monetarypolicy\/fomcminutes20\d{6}\.htm$/.test(path) ||
    /\/monetarypolicy\/fomcstatement20\d{6}\.htm$/.test(path)
  );
}

function fedDateFromUrl(url: string): Date | undefined {
  const match = new URL(url).pathname.match(/20\d{6}/);
  if (!match) return undefined;
  const raw = match[0]!;
  const date = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function isWithinFedDateWindow(url: string, lookbackMinutes: number): boolean {
  const publishedAt = fedDateFromUrl(url);
  if (!publishedAt) return false;
  const now = new Date();
  const days = Math.max(1, Math.ceil(lookbackMinutes / 1440));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - days + 1);
  return publishedAt >= start;
}

function extractFedItems(html: string, pageUrl: string, lookbackMinutes: number): GoldNewsItem[] {
  const items: GoldNewsItem[] = [];
  for (const match of html.matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]{10,300}?)<\/a>/g)) {
    const href = match[1]!;
    const title = stripHtml(match[2]!);
    if (!title || title.length < 8) continue;
    const url = new URL(href, pageUrl).toString();
    if (!isFedContentUrl(url)) continue;
    if (!isWithinFedDateWindow(url, lookbackMinutes)) continue;
    items.push({ source: "fed", title, url, publishedAt: fedDateFromUrl(url) });
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title.toLowerCase()}|${item.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchFedGoldItems(lookbackMinutes: number): Promise<GoldNewsItem[]> {
  const results = await Promise.allSettled(
    FED_PAGES.map(async (url) => extractFedItems(await fetchText(url), url, lookbackMinutes)),
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}
