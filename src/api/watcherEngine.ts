/**
 * Watcher Engine
 *
 * Manages multiple active "watches" (search + threshold pairs).
 * Enforces rate limit budget across all watches.
 *
 * Budget math:
 *   searchLimiter = 10 req / 60s
 *   Each watch needs 1 search req per poll
 *   At 5s poll interval: 60s / 5s = 12 polls needed → exceeds budget
 *   At 10s poll interval: 60s / 10s = 6 polls → fits 1 watch easily
 *   For N watches at interval I: N * (60/I) <= 10
 *   → maxWatches(5s)  = 1 safe, 2 risky (we allow 2 as default)
 *   → maxWatches(10s) = 3 safe
 *   → maxWatches(20s) = 5 safe
 */

import {
  searchItems,
  fetchItems,
  refreshSearch,
  buildTradeUrl,
  delay,
  TradeApiError,
  RateLimitError,
} from "./tradeClient";
import type { WatchConfig, ListingResult } from "../types/trade";

export type WatchEvent =
  | { type: "result"; watchId: string; listings: ListingResult[]; cheapest: ListingResult | null }
  | { type: "threshold_hit"; watchId: string; listing: ListingResult }
  | { type: "error"; watchId: string; error: string }
  | { type: "rate_limited"; watchId: string; retryAfter: number }
  | { type: "status"; watchId: string; status: WatchConfig["status"] };

type EventHandler = (event: WatchEvent) => void;

interface ActiveWatch {
  config: WatchConfig;
  searchId: string | null;
  searchExpiry: number;        // epoch ms, re-POST after this
  knownListingIds: Set<string>; // to detect genuinely new listings
  timer: ReturnType<typeof setTimeout> | null;
}

export class WatcherEngine {
  private watches = new Map<string, ActiveWatch>();
  private handlers: EventHandler[] = [];
  private poesessid = "";
  private pollIntervalMs = 10_000;
  private maxWatches = 3;

  configure(opts: {
    poesessid: string;
    pollIntervalMs?: number;
    maxWatches?: number;
  }) {
    this.poesessid = opts.poesessid;
    if (opts.pollIntervalMs) this.pollIntervalMs = opts.pollIntervalMs;
    if (opts.maxWatches) this.maxWatches = opts.maxWatches;
  }

  on(handler: EventHandler) {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  private emit(event: WatchEvent) {
    this.handlers.forEach(h => h(event));
  }

  // ── Add / Remove ──────────────────────────────────────────────────────────

  addWatch(config: WatchConfig): { ok: boolean; error?: string } {
    if (this.watches.size >= this.maxWatches) {
      return {
        ok: false,
        error: `Maximum ${this.maxWatches} active watches (rate limit). Pause another first.`,
      };
    }
    if (this.watches.has(config.id)) {
      return { ok: false, error: "Watch already exists" };
    }

    const watch: ActiveWatch = {
      config: { ...config, status: "active" },
      searchId: null,
      searchExpiry: 0,
      knownListingIds: new Set(),
      timer: null,
    };

    this.watches.set(config.id, watch);
    this.scheduleNext(config.id, 0); // start immediately
    return { ok: true };
  }

  removeWatch(id: string) {
    const watch = this.watches.get(id);
    if (!watch) return;
    if (watch.timer) clearTimeout(watch.timer);
    this.watches.delete(id);
  }

  pauseWatch(id: string) {
    const watch = this.watches.get(id);
    if (!watch) return;
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = null;
    watch.config.status = "paused";
    this.emit({ type: "status", watchId: id, status: "paused" });
  }

  resumeWatch(id: string) {
    const watch = this.watches.get(id);
    if (!watch || watch.config.status !== "paused") return;
    watch.config.status = "active";
    this.emit({ type: "status", watchId: id, status: "active" });
    this.scheduleNext(id, 0);
  }

  getWatches(): WatchConfig[] {
    return Array.from(this.watches.values()).map(w => w.config);
  }

  // ── Poll cycle ────────────────────────────────────────────────────────────

  private scheduleNext(id: string, afterMs: number) {
    const watch = this.watches.get(id);
    if (!watch) return;
    watch.timer = setTimeout(() => this.poll(id), afterMs);
  }

  private async poll(id: string) {
    const watch = this.watches.get(id);
    if (!watch || watch.config.status !== "active") return;

    try {
      // Decide: re-POST (new search_id) or re-use existing search_id
      const needsReSearch = !watch.searchId || Date.now() > watch.searchExpiry;

      let searchId: string;
      let hashes: string[];

      if (needsReSearch) {
        const res = await searchItems(
          watch.config.league,
          watch.config.searchBody,
          this.poesessid
        );
        searchId = res.id;
        hashes = res.result.slice(0, 20); // first 20 = cheapest (sorted price asc)
        watch.searchId = searchId;
        watch.searchExpiry = Date.now() + 55 * 60 * 1000; // 55min TTL
      } else {
        // Re-fetch same search — just get current top results
        // We don't re-POST, saving a search request
        const res = await refreshSearch(
          watch.searchId!,
          watch.config.league,
          this.poesessid
        );
        searchId = watch.searchId!;
        hashes = res.result.slice(0, 20);
      }

      if (hashes.length === 0) {
        this.emit({ type: "result", watchId: id, listings: [], cheapest: null });
        this.scheduleNext(id, this.pollIntervalMs);
        return;
      }

      // Fetch top results (up to 10 per request)
      const listings = await fetchItems(hashes.slice(0, 10), searchId, this.poesessid);

      watch.config.lastChecked = Date.now();
      watch.config.lastResult = listings;

      this.emit({ type: "result", watchId: id, listings, cheapest: listings[0] ?? null });

      // Check thresholds
      this.checkThreshold(watch, listings);

      this.scheduleNext(id, this.pollIntervalMs);

    } catch (err) {
      if (err instanceof RateLimitError) {
        this.emit({ type: "rate_limited", watchId: id, retryAfter: err.retryAfter });
        // Back off and retry
        this.scheduleNext(id, err.retryAfter * 1000 + 1000);
      } else if (err instanceof TradeApiError) {
        this.emit({ type: "error", watchId: id, error: `API ${err.status}: ${err.message}` });
        this.scheduleNext(id, this.pollIntervalMs * 2); // exponential backoff light
      } else {
        this.emit({ type: "error", watchId: id, error: String(err) });
        this.scheduleNext(id, this.pollIntervalMs);
      }
    }
  }

  // ── Threshold check ───────────────────────────────────────────────────────

  private checkThreshold(watch: ActiveWatch, listings: ListingResult[]) {
    const { threshold } = watch.config;

    for (const listing of listings) {
      const price = listing.listing.price;

      // Only compare same currency
      if (price.currency !== threshold.currency) continue;
      if (price.amount > threshold.amount) continue;

      // Only fire once per listing id (don't spam same item)
      if (watch.knownListingIds.has(listing.id)) continue;

      watch.knownListingIds.add(listing.id);
      watch.config.status = "triggered";

      this.emit({ type: "threshold_hit", watchId: watch.config.id, listing });
    }

    // Clean up known IDs if set grows too large (> 500 = some listings delisted)
    if (watch.knownListingIds.size > 500) {
      const currentIds = new Set(listings.map(l => l.id));
      watch.knownListingIds = new Set(
        [...watch.knownListingIds].filter(id => currentIds.has(id))
      );
    }
  }

  stopAll() {
    for (const [id] of this.watches) {
      this.pauseWatch(id);
    }
  }
}

export const watcherEngine = new WatcherEngine();
