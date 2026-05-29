/**
 * POE2 Trade API Client
 *
 * Wraps the undocumented /api/trade2/* endpoints used by pathofexile.com/trade2.
 * All requests require a valid POESESSID cookie.
 *
 * Rate limits (community-observed):
 *   /api/trade2/search  → 12 req / 60s  (per IP + account)
 *   /api/trade2/fetch   → 60 req / 60s, max 10 item hashes per request
 *   /api/trade2/whisper → ~5 req / 60s  (be conservative, not fully known)
 */

import type {
  TradeSearchBody,
  SearchResponse,
  FetchResponse,
  ListingResult,
} from "../types/trade";

const BASE = "";

// GGG asks all third-party tools to identify themselves
const USER_AGENT = "poe2-trade-sniper/1.0.0 (contact: your@email.com)";

export class TradeApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
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

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  canRequest(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    return this.timestamps.length < this.maxRequests;
  }

  consume(): void {
    this.timestamps.push(Date.now());
  }

  msUntilNext(): number {
    if (this.canRequest()) return 0;
    const oldest = this.timestamps[0];
    return this.windowMs - (Date.now() - oldest) + 50; // +50ms buffer
  }
}

// Conservative limits — slightly under observed max to avoid 429s
const searchLimiter = new RateLimiter(10, 60_000);  // 10/60s (max 12)
const fetchLimiter  = new RateLimiter(50, 60_000);  // 50/60s (max 60)
const whisperLimiter = new RateLimiter(4, 60_000);  // 4/60s (conservative)

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function request<T>(
  method: "GET" | "POST",
  path: string,
  poesessid: string,
  body?: unknown,
  limiter?: RateLimiter
): Promise<T> {
  if (limiter && !limiter.canRequest()) {
    const wait = limiter.msUntilNext();
    throw new RateLimitError(Math.ceil(wait / 1000));
  }

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Cookie": `POESESSID=${poesessid}`,
    "X-Requested-With": "XMLHttpRequest",  // required by GGG trade API
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  // In Electron, main process makes these calls to bypass CORS.
  // In browser/dev, requests go through local proxy.
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "omit", // we pass cookie manually above
  });

  limiter?.consume();

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("X-Rate-Limit-Retry-After") ?? "60");
    throw new RateLimitError(retryAfter);
  }

  if (!res.ok) {
    let errorBody: unknown;
    try { errorBody = await res.json(); } catch { /* ignore */ }
    throw new TradeApiError(
      `API error ${res.status} on ${path}`,
      res.status,
      errorBody
    );
  }

  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function searchItems(
  league: string,
  body: TradeSearchBody,
  poesessid: string
): Promise<SearchResponse> {
  // POE2 API requires the realm prefix in the league path
  const realmLeague = league.startsWith("poe2/") ? league : `poe2/${league}`;
  return request<SearchResponse>(
    "POST",
    `/api/trade2/search/${encodeURIComponent(realmLeague)}`,
    poesessid,
    body,
    searchLimiter
  );
}

/**
 * Fetch full listing data for up to 10 item hashes at a time.
 * Automatically batches larger arrays.
 */
export async function fetchItems(
  hashes: string[],
  queryId: string,
  poesessid: string
): Promise<ListingResult[]> {
  const results: ListingResult[] = [];

  // Fetch in batches of 10 (API hard limit)
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

    // Small delay between batches to be polite
    if (i + 10 < hashes.length) {
      await delay(300);
    }
  }

  return results;
}

/**
 * Trigger "Travel to Hideout" for a Merchant Tab listing.
 * Uses whisper_token from the listing's fetch response.
 *
 * Returns true on success (HTTP 200), throws on failure.
 *
 * NOTE: Requires game client to be running and logged in.
 * GGG's server signals the game client via the session.
 */
export async function travelToHideout(
  whisperToken: string,
  poesessid: string
): Promise<void> {
  // The trade site POSTs the whisper_token to trigger Travel to Hideout.
  // 400 = not logged in / item no longer available / not a Merchant Tab item.
  await request<unknown>(
    "POST",
    "/api/trade2/whisper",
    poesessid,
    { token: whisperToken },
    whisperLimiter
  );
}

/**
 * Re-run a search using an existing search_id (cheaper than full re-POST).
 * Returns fresh list of matching item hashes, sorted by price asc.
 * The search_id TTL is ~60 minutes.
 */
export async function refreshSearch(
  searchId: string,
  league: string,
  poesessid: string
): Promise<SearchResponse> {
  const realmLeague = league.startsWith("poe2/") ? league : `poe2/${league}`;
  // Re-fetching the search URL gives us fresh results
  return request<SearchResponse>(
    "GET",
    `/api/trade2/search/${encodeURIComponent(realmLeague)}/${searchId}`,
    poesessid,
    undefined,
    searchLimiter
  );
}

// ─── Stat lookup ──────────────────────────────────────────────────────────────

/**
 * Fetch the full stat list from trade site (needed for filter builder).
 * This is a large JSON (~4MB) — cache it, don't refetch every session.
 */
export async function fetchStatsList(): Promise<StatEntry[]> {
  const res = await fetch(`${BASE}/api/trade2/data/stats`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error("Failed to fetch stats list");
  const data = await res.json();
  // data.result is array of { label, entries: [{ id, text, type }] }
  return data.result.flatMap(
    (group: { label: string; entries: StatEntry[] }) => group.entries
  );
}

export interface StatEntry {
  id: string;
  text: string;
  type: string;
}

/**
 * Fetch item categories/types for the type filter dropdown.
 */
export async function fetchItemsList(): Promise<ItemCategory[]> {
  const res = await fetch(`${BASE}/api/trade2/data/items`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error("Failed to fetch items list");
  const data = await res.json();
  return data.result;
}

export interface ItemCategory {
  label: string;
  entries: Array<{ name: string; type?: string; flags?: Record<string, boolean> }>;
}

// ─── Utils ────────────────────────────────────────────────────────────────────

export function buildTradeUrl(league: string, searchId: string): string {
  return `https://www.pathofexile.com/trade2/search/poe2/${encodeURIComponent(league)}/${searchId}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
