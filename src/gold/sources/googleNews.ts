import type { GoldNewsItem } from "../types.js";
import { decodeXml, stripHtml } from "../utils.js";

function tag(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]).trim() : undefined;
}

async function fetchGoogleNewsRss(query: string, lookbackMinutes: number): Promise<GoldNewsItem[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  const response = await fetch(url, {
    headers: {
      "user-agent": "market-observer/0.1 (+local read-only gold monitor)",
      accept: "application/rss+xml,application/xml,text/xml",
    },
  });
  if (!response.ok) throw new Error(`Google News RSS failed: ${response.status}`);

  const xml = await response.text();
  const now = Date.now();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((match): GoldNewsItem | null => {
      const block = match[1]!;
      const title = tag(block, "title");
      if (!title) return null;

      const pubDate = tag(block, "pubDate");
      const publishedAt = pubDate ? new Date(pubDate) : undefined;
      if (
        publishedAt &&
        Number.isFinite(publishedAt.getTime()) &&
        (now - publishedAt.getTime()) / 60_000 > lookbackMinutes
      ) {
        return null;
      }

      return {
        source: "google_news",
        title: stripHtml(title),
        url: tag(block, "link"),
        publishedAt:
          publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : undefined,
        summary: tag(block, "description") ? stripHtml(tag(block, "description") ?? "") : undefined,
      };
    })
    .filter((item): item is GoldNewsItem => item !== null);
}

export async function fetchGoogleNewsRssMany(
  queries: readonly string[],
  lookbackMinutes: number,
): Promise<GoldNewsItem[]> {
  const results = await Promise.allSettled(
    queries.map((query) => fetchGoogleNewsRss(query, lookbackMinutes)),
  );
  const seen = new Set<string>();
  return results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => {
      const key = `${item.title.toLowerCase()}|${item.url ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}
