/**
 * POE2 Trade API Client
 * Wraps /api/trade2/* endpoints used by pathofexile.com/trade2.
 * Auth via POESESSID cookie (passed as X-Session-Id header → proxy rewrites to Cookie).
 */

import type {
  TradeSearchBody,
  SearchResponse,
  FetchResponse,
  ListingResult,
} from "../types/trade";

const BASE = "";
const USER_AGENT = "poe2-trade-sniper/1.0.0 (contact: your@email.com)";

export class TradeApiError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
    this.name = "TradeApiError";
  }
}

export class RateLimitError extends TradeApiError {
  constructor(public retryAfter: number) {
    super(`Rate limited. Retry after ${retryAfter}s`, 429);
    this.name = "RateLimitError";
  }
}

class RateLimiter {
  private timestamps: number[] = [];
  constructor(private maxRequests: number, private windowMs: number) {}
  canRequest(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    return this.timestamps.length < this.maxRequests;
  }
  consume(): void { this.timestamps.push(Date.now()); }
  msUntilNext(): number {
    if (this.canRequest()) return 0;
    return this.windowMs - (Date.now() - this.timestamps[0]) + 50;
  }
}

const searchLimiter = new RateLimiter(10, 60_000);
const fetchLimiter  = new RateLimiter(50, 60_000);
const whisperLimiter = new RateLimiter(4, 60_000);

async function request<T>(
  method: "GET" | "POST",
  path: string,
  poesessid: string,
  body?: unknown,
  limiter?: RateLimiter
): Promise<T> {
  if (limiter && !limiter.canRequest()) {
    throw new RateLimitError(Math.ceil(limiter.msUntilNext() / 1000));
  }

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "X-Session-Id": poesessid,
    "X-Requested-With": "XMLHttpRequest",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "omit",
  });

  limiter?.consume();

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("X-Rate-Limit-Retry-After") ?? "60");
    throw new RateLimitError(retryAfter);
  }

  if (!res.ok) {
    let errorBody: unknown;
    try { errorBody = await res.json(); } catch { /* ignore */ }
    console.error(`API ${res.status} on ${path}:`, errorBody);
    throw new TradeApiError(`API error ${res.status} on ${path}`, res.status, errorBody);
  }

  return res.json() as Promise<T>;
}

export async function searchItems(
  league: string,
  body: TradeSearchBody,
  poesessid: string
): Promise<SearchResponse> {
  const clean = league.replace(/^poe2\//, "");
  return request<SearchResponse>(
    "POST",
    `/api/trade2/search/poe2/${encodeURIComponent(clean)}`,
    poesessid,
    body,
    searchLimiter
  );
}

export async function fetchItems(
  hashes: string[],
  queryId: string,
  poesessid: string
): Promise<ListingResult[]> {
  const results: ListingResult[] = [];
  for (let i = 0; i < hashes.length; i += 10) {
    const batch = hashes.slice(i, i + 10);
    const data = await request<FetchResponse>(
      "GET",
      `/api/trade2/fetch/${batch.join(",")}?query=${queryId}&realm=poe2`,
      poesessid,
      undefined,
      fetchLimiter
    );
    results.push(...data.result);
    if (i + 10 < hashes.length) await delay(300);
  }
  return results;
}

export async function travelToHideout(whisperToken: string, poesessid: string): Promise<void> {
  await request<unknown>("POST", "/api/trade2/whisper", poesessid, { token: whisperToken }, whisperLimiter);
}

export async function refreshSearch(searchId: string, league: string, poesessid: string): Promise<SearchResponse> {
  const clean = league.replace(/^poe2\//, "");
  return request<SearchResponse>(
    "GET",
    `/api/trade2/search/poe2/${encodeURIComponent(clean)}/${searchId}`,
    poesessid,
    undefined,
    searchLimiter
  );
}

export async function fetchStatsList(): Promise<StatEntry[]> {
  const res = await fetch(`${BASE}/api/trade2/data/stats`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error("Failed to fetch stats list");
  const data = await res.json();
  return data.result.flatMap((group: { label: string; entries: StatEntry[] }) => group.entries);
}

export interface StatEntry { id: string; text: string; type: string; }

export async function fetchItemsList(): Promise<ItemCategory[]> {
  const res = await fetch(`${BASE}/api/trade2/data/items`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error("Failed to fetch items list");
  return (await res.json()).result;
}

export interface ItemCategory {
  label: string;
  entries: Array<{ name: string; type?: string; flags?: Record<string, boolean> }>;
}

export function buildTradeUrl(league: string, searchId: string): string {
  return `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league)}/${searchId}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
