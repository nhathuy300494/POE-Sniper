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
import { normalizePoeCookieInput } from "../utils/cookies";

const BASE = "";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

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

function ensurePoe2(league: string) {
  if (!league) return "poe2/Standard";
  if (league.startsWith("poe2/")) return league;
  return `poe2/${league}`;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  poesessid: string,
  body?: unknown,
  limiter?: RateLimiter,
  searchId?: string,
  league?: string
): Promise<T> {
  if (limiter && !limiter.canRequest()) {
    throw new RateLimitError(Math.ceil(limiter.msUntilNext() / 1000));
  }

  // league can be like "poe2/Runes of Aldur" or "Runes of Aldur"
  const rawLeague = league || "Runes of Aldur";
  const currentLeague = ensurePoe2(rawLeague);

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "X-Session-Id": normalizePoeCookieInput(poesessid), // Proxy will convert this to Cookie header
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "*/*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5",
    "Origin": "https://www.pathofexile.com",
    "Referer": searchId 
      ? `https://www.pathofexile.com/trade2/search/${encodeURI(currentLeague)}/${searchId}`
      : `https://www.pathofexile.com/trade2/search/${encodeURI(currentLeague)}`,
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
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

  const data = await res.json();
  if (path.includes("/fetch/")) {
    console.log(`[DEBUG API] RAW FETCH RESPONSE:`, data);
  }
  return data as T;
}

export async function searchItems(
  league: string,
  body: TradeSearchBody,
  poesessid: string
): Promise<SearchResponse> {
  const l = ensurePoe2(league);
  // We need to encode the space in 'Runes of Aldur' but keep the '/' in 'poe2/'
  const encodedLeague = l.split('/').map(part => encodeURIComponent(part)).join('/');
  
  return request<SearchResponse>(
    "POST",
    `/api/trade2/search/${encodedLeague}`,
    poesessid,
    body,
    searchLimiter,
    undefined,
    l
  );
}

export async function fetchItems(
  hashes: string[],
  queryId: string,
  poesessid: string,
  league: string
): Promise<ListingResult[]> {
  const l = ensurePoe2(league);
  const encodedLeague = l.split('/').map(part => encodeURIComponent(part)).join('/');
  const results: ListingResult[] = [];
  for (let i = 0; i < hashes.length; i += 10) {
    const batch = hashes.slice(i, i + 10);
    const data = await request<FetchResponse>(
      "GET",
      `/api/trade2/fetch/${batch.join(",")}?query=${queryId}`,
      poesessid,
      undefined,
      fetchLimiter,
      queryId,
      l
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
  const l = ensurePoe2(league);
  const encodedLeague = l.split('/').map(part => encodeURIComponent(part)).join('/');
  
  return request<SearchResponse>(
    "GET",
    `/api/trade2/search/${encodedLeague}/${searchId}`,
    poesessid,
    undefined,
    searchLimiter,
    searchId,
    l
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
  const l = ensurePoe2(league);
  return `https://www.pathofexile.com/trade2/search/${l}/${searchId}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
