// SAFETY guard for the entire system.
//
// INVARIANT: This program only ever issues READ-ONLY public market data
// requests to Binance. Any URL whose path includes a forbidden token is
// rejected immediately, before a network request is initiated.

const FORBIDDEN_PATH_TOKENS: readonly string[] = [
  "order",
  "trade",
  "withdraw",
  "capital",
  "sapi",
];

/**
 * Throws if `url` is not safe to request under the read-only invariant.
 * - Must be an absolute http(s) URL.
 * - Method must be GET (callers pass the method they intend to use).
 * - Pathname must not contain any FORBIDDEN_PATH_TOKENS (case-insensitive).
 *
 * The blocklist intentionally also rejects the SAPI surface (signed/private
 * endpoints) even though our fetcher never signs requests.
 */
export class SafetyError extends Error {
  public readonly reason: string;
  public readonly url: string;
  constructor(reason: string, url: string) {
    super(`SAFETY: ${reason} (url=${url})`);
    this.name = "SafetyError";
    this.reason = reason;
    this.url = url;
  }
}

export function assertSafeUrl(url: string, method: string = "GET"): void {
  if (method.toUpperCase() !== "GET") {
    throw new SafetyError(`method ${method} is not allowed; only GET is permitted`, url);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SafetyError("url is not a valid absolute URL", url);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SafetyError(`protocol ${parsed.protocol} is not allowed`, url);
  }

  const pathLower = parsed.pathname.toLowerCase();
  for (const token of FORBIDDEN_PATH_TOKENS) {
    if (pathLower.includes(token)) {
      throw new SafetyError(
        `path contains forbidden token "${token}" (read-only invariant)`,
        url,
      );
    }
  }
}

export function assertSafeSymbol(symbol: string): void {
  // Symbols are part of the URL query string; we sanity-check that they
  // are short uppercase alphanumerics so they can't smuggle a path segment.
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
    throw new SafetyError(`symbol "${symbol}" failed safety check`, `symbol=${symbol}`);
  }
}

export const FORBIDDEN_TOKENS: readonly string[] = FORBIDDEN_PATH_TOKENS;
