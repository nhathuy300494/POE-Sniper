import { searchItems, fetchItems, travelToHideout } from "./tradeClient";
import type { WatchConfig, ListingResult, MarketSnapshot } from "../types/trade";
import { isListingAtOrBelowThreshold } from "../utils/pricingEngine";

export type WatchEvent =
  | { type: "result"; watchId: string; listings: ListingResult[]; cheapest: ListingResult | null }
  | { type: "threshold_hit"; watchId: string; listing: ListingResult; mode: "auto" | "report" }
  | { type: "error"; watchId: string; error: string }
  | { type: "rate_limited"; watchId: string; retryAfter: number }
  | { type: "status"; watchId: string; status: WatchConfig["status"] };

class WatcherEngine {
  private watches = new Map<string, {
    config: WatchConfig;
    timer?: any;
    searchId?: string;
    searchExpiry: number;
    triggeredListingIds: Set<string>;
    consecutiveErrors: number;
  }>();

  private listeners: ((event: WatchEvent) => void)[] = [];
  private poesessid = "";
  private pollIntervalMs = 10_000;
  private marketSnapshot: MarketSnapshot | null = null;
  private readonly searchBudgetPerMinute = 10;

  configure(settings: { poesessid: string; pollIntervalMs: number; marketSnapshot?: MarketSnapshot | null }) {
    this.poesessid = settings.poesessid;
    this.pollIntervalMs = settings.pollIntervalMs;
    this.marketSnapshot = settings.marketSnapshot ?? null;
  }

  on(cb: (event: WatchEvent) => void) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private emit(event: WatchEvent) {
    this.listeners.forEach(l => l(event));
  }

  addWatch(config: WatchConfig) {
    if (this.watches.has(config.id)) return { ok: false, error: "Watch exists" };
    this.watches.set(config.id, { config, searchExpiry: 0, triggeredListingIds: new Set(), consecutiveErrors: 0 });
    if (config.status === "active") {
      const capacity = this.canActivate(config.id);
      if (!capacity.ok) {
        this.watches.delete(config.id);
        return capacity;
      }
      this.scheduleNext(config.id, 0);
    }
    return { ok: true };
  }

  updateWatch(id: string, patch: Partial<WatchConfig>) {
    const watch = this.watches.get(id);
    if (!watch) return { ok: false, error: "Watch not found" };
    const previousConfig = watch.config;
    const nextConfig = { ...watch.config, ...patch };
    watch.config = nextConfig;
    this.watches.set(id, watch);
    if (watch.config.status === "active" && (patch.pollIntervalMs || patch.status === "active")) {
      const capacity = this.canActivate(id);
      if (!capacity.ok) {
        watch.config = previousConfig;
        this.watches.set(id, watch);
        return capacity;
      }
    }
    if (watch.config.status === "active" && patch.pollIntervalMs) {
      this.scheduleNext(id, watch.config.pollIntervalMs);
    }
    return { ok: true };
  }

  removeWatch(id: string) {
    const watch = this.watches.get(id);
    if (watch?.timer) clearTimeout(watch.timer);
    this.watches.delete(id);
  }

  pauseWatch(id: string) {
    const watch = this.watches.get(id);
    if (watch) {
      watch.config.status = "paused";
      if (watch.timer) clearTimeout(watch.timer);
      this.emit({ type: "status", watchId: id, status: "paused" });
    }
  }

  resumeWatch(id: string) {
    const watch = this.watches.get(id);
    if (!watch) return { ok: false, error: "Watch not found" };
    if (watch.config.status === "active") return { ok: true };
    const capacity = this.canActivate(id);
    if (!capacity.ok) {
      this.emit({ type: "error", watchId: id, error: capacity.error || "Rate limit budget exceeded" });
      return capacity;
    }
    watch.config.status = "active";
    this.emit({ type: "status", watchId: id, status: "active" });
    this.scheduleNext(id, 0);
    return { ok: true };
  }

  private canActivate(id: string) {
    const requested = this.watches.get(id);
    if (!requested) return { ok: false, error: "Watch not found" };

    const usedBudget = Array.from(this.watches.entries()).reduce((sum, [watchId, watch]) => {
      if (watchId === id || watch.config.status !== "active") return sum;
      return sum + 60_000 / (watch.config.pollIntervalMs || this.pollIntervalMs);
    }, 0);
    const requestedBudget = 60_000 / (requested.config.pollIntervalMs || this.pollIntervalMs);
    const total = usedBudget + requestedBudget;

    if (total > this.searchBudgetPerMinute) {
      return {
        ok: false,
        error: `Rate limit budget exceeded. At ${Math.round((requested.config.pollIntervalMs || this.pollIntervalMs) / 1000)}s polling, reduce active watches or use a longer interval.`,
      };
    }

    return { ok: true };
  }

  private scheduleNext(id: string, ms: number) {
    const watch = this.watches.get(id);
    if (watch) {
      if (watch.timer) clearTimeout(watch.timer);
      watch.timer = setTimeout(() => this.poll(id), addJitter(ms));
    }
  }

  private async poll(id: string) {
    const watch = this.watches.get(id);
    if (!watch || watch.config.status !== "active") return;

    try {
      let searchId = watch.searchId;
      let hashes: string[] = [];

      // Always perform a search to get the freshest results for snipping
      const res = await searchItems(watch.config.league, watch.config.searchBody, this.poesessid);
      searchId = res.id;
      hashes = res.result.slice(0, 10);
      watch.searchId = searchId;

      if (hashes.length === 0) {
        this.emit({ type: "result", watchId: id, listings: [], cheapest: null });
      this.scheduleNext(id, watch.config.pollIntervalMs || this.pollIntervalMs);
      return;
      }

      const listings = await fetchItems(hashes, searchId, this.poesessid, watch.config.league);
      const cheapest = listings[0] || null;
      watch.consecutiveErrors = 0;

      this.emit({ type: "result", watchId: id, listings, cheapest });

      const thresholdHit = listings.find(listing =>
        isListingAtOrBelowThreshold(listing, watch.config.threshold, this.marketSnapshot) &&
        !watch.triggeredListingIds.has(listing.id)
      );

      if (thresholdHit) {
        watch.triggeredListingIds.add(thresholdHit.id);
        const token = thresholdHit.listing.whisper_token || thresholdHit.listing.hideout_token;
        
        if (watch.config.mode === "auto" && token) {
          console.log(`[Watcher] Threshold hit! AUTO TRAVEL for ${id}`);
          try {
            await travelToHideout(token, this.poesessid);
            this.emit({ type: "threshold_hit", watchId: id, listing: thresholdHit, mode: "auto" });
          } catch (err) {
            this.emit({ type: "error", watchId: id, error: "Auto-travel failed: Login required" });
          }
        } else {
          console.log(`[Watcher] Threshold hit! REPORT for ${id}`);
          this.emit({ type: "threshold_hit", watchId: id, listing: thresholdHit, mode: "report" });
        }
      }

      this.scheduleNext(id, watch.config.pollIntervalMs || this.pollIntervalMs);
    } catch (err: any) {
      console.error(`[Watcher] Error polling ${id}:`, err);
      if (err.status === 429) {
        this.emit({ type: "rate_limited", watchId: id, retryAfter: err.retryAfter || 60 });
        this.scheduleNext(id, (err.retryAfter || 60) * 1000);
      } else if (err.status === 502 || err.status === 403 || err.status === 503) {
        watch.consecutiveErrors += 1;
        const cooldown = Math.min(15 * 60_000, 60_000 * Math.pow(2, watch.consecutiveErrors - 1));
        this.emit({
          type: "error",
          watchId: id,
          error: `${err.message}. Cooling down for ${Math.round(cooldown / 1000)}s to avoid bot/rate-limit escalation.`,
        });
        this.scheduleNext(id, cooldown);
      } else {
        watch.consecutiveErrors += 1;
        this.emit({ type: "error", watchId: id, error: err.message });
        this.scheduleNext(id, (watch.config.pollIntervalMs || this.pollIntervalMs) * 2);
      }
    }
  }
}

function addJitter(ms: number) {
  if (ms <= 0) return Math.floor(500 + Math.random() * 1500);
  const jitter = 0.15 + Math.random() * 0.2;
  return Math.floor(ms * (1 + jitter));
}

export const watcherEngine = new WatcherEngine();
