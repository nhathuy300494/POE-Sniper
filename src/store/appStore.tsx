/**
 * App-level state store using React Context + useReducer.
 * Keeps settings, watch list, and live results.
 */

import React, { createContext, useContext, useReducer, useEffect, useRef } from "react";
import type {
  AppSettings,
  ListingResult,
  MarketSnapshot,
  Opportunity,
  TradeLedgerEntry,
  WatchConfig,
} from "../types/trade";
import { watcherEngine, WatchEvent } from "../api/watcherEngine";
import { fetchMarketSnapshot } from "../api/marketDataClient";
import { travelToHideout } from "../api/tradeClient";
import {
  canAutoTravel,
  listingFingerprint,
  scoreListing,
  shouldCreateOpportunity,
} from "../utils/pricingEngine";

// ─── State shape ──────────────────────────────────────────────────────────────

export interface LiveResult {
  watchId: string;
  listings: ListingResult[];
  cheapest: ListingResult | null;
  updatedAt: number;
  error?: string;
  rateLimitedUntil?: number;
  priceHistory?: PricePoint[];
}

export interface PricePoint {
  time: number;
  amount: number;
  currency: string;
}

export interface AppState {
  settings: AppSettings;
  watches: WatchConfig[];
  liveResults: Record<string, LiveResult>;
  alerts: Alert[];
  marketSnapshot: MarketSnapshot | null;
  marketLoading: boolean;
  opportunities: Opportunity[];
  tradeLedger: TradeLedgerEntry[];
}

export interface Alert {
  id: string;
  watchId: string;
  listing: ListingResult;
  seenAt: number;
  dismissed: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  poesessid: "",
  league: "poe2/Runes of Aldur",
  pollIntervalMs: 10_000,
  maxWatches: 3,
  automationMode: "report",
  keepAwake: true,
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_SETTINGS"; payload: Partial<AppSettings> }
  | { type: "ADD_WATCH"; payload: WatchConfig }
  | { type: "UPDATE_WATCH"; payload: { id: string; patch: Partial<WatchConfig> } }
  | { type: "REMOVE_WATCH"; payload: string }
  | { type: "UPDATE_WATCH_STATUS"; payload: { id: string; status: WatchConfig["status"] } }
  | { type: "SET_LIVE_RESULT"; payload: LiveResult }
  | { type: "ADD_ALERT"; payload: Alert }
  | { type: "DISMISS_ALERT"; payload: string }
  | { type: "CLEAR_ALERTS" }
  | { type: "SET_MARKET_LOADING"; payload: boolean }
  | { type: "SET_MARKET_SNAPSHOT"; payload: MarketSnapshot }
  | { type: "UPSERT_OPPORTUNITIES"; payload: Opportunity[] }
  | { type: "CLEAR_OPPORTUNITIES" }
  | { type: "MARK_OPPORTUNITY"; payload: { id: string; status: Opportunity["status"]; actualSellPrice?: number } }
  | { type: "ADD_OR_UPDATE_LEDGER"; payload: TradeLedgerEntry };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.payload } };

    case "ADD_WATCH":
      return { ...state, watches: [...state.watches, action.payload] };

    case "UPDATE_WATCH":
      return {
        ...state,
        watches: state.watches.map(w =>
          w.id === action.payload.id ? { ...w, ...action.payload.patch } : w
        ),
      };

    case "REMOVE_WATCH":
      return { ...state, watches: state.watches.filter(w => w.id !== action.payload) };

    case "UPDATE_WATCH_STATUS":
      return {
        ...state,
        watches: state.watches.map(w =>
          w.id === action.payload.id ? { ...w, status: action.payload.status } : w
        ),
      };

    case "SET_LIVE_RESULT": {
      const previous = state.liveResults[action.payload.watchId];
      const nextPoint = action.payload.cheapest
        ? {
            time: action.payload.updatedAt,
            amount: action.payload.cheapest.listing.price.amount,
            currency: action.payload.cheapest.listing.price.currency,
          }
        : null;
      const priceHistory = nextPoint
        ? [...(previous?.priceHistory || []), nextPoint].slice(-120)
        : previous?.priceHistory || [];
      return {
        ...state,
        liveResults: {
          ...state.liveResults,
          [action.payload.watchId]: { ...previous, ...action.payload, priceHistory },
        },
      };
    }

    case "ADD_ALERT":
      return { ...state, alerts: [action.payload, ...state.alerts].slice(0, 50) };

    case "DISMISS_ALERT":
      return {
        ...state,
        alerts: state.alerts.map(a =>
          a.id === action.payload ? { ...a, dismissed: true } : a
        ),
      };

    case "CLEAR_ALERTS":
      return { ...state, alerts: [] };

    case "SET_MARKET_LOADING":
      return { ...state, marketLoading: action.payload };

    case "SET_MARKET_SNAPSHOT":
      return { ...state, marketSnapshot: action.payload, marketLoading: false };

    case "UPSERT_OPPORTUNITIES": {
      const merged = new Map(state.opportunities.map(op => [op.fingerprint, op]));
      for (const incoming of action.payload) {
        const previous = merged.get(incoming.fingerprint);
        merged.set(incoming.fingerprint, previous
          ? {
              ...previous,
              ...incoming,
              id: previous.id,
              status: previous.status === "open" ? incoming.status : previous.status,
              firstSeenAt: previous.firstSeenAt,
              seenCount: previous.seenCount + 1,
            }
          : incoming
        );
      }
      return {
        ...state,
        opportunities: Array.from(merged.values())
          .sort((a, b) => b.score.marginAfterUndercut - a.score.marginAfterUndercut)
          .slice(0, 150),
      };
    }

    case "CLEAR_OPPORTUNITIES":
      return { ...state, opportunities: [] };

    case "MARK_OPPORTUNITY":
      return {
        ...state,
        opportunities: state.opportunities.map(op =>
          op.id === action.payload.id
            ? {
                ...op,
                status: action.payload.status,
                actualSellPrice: action.payload.actualSellPrice ?? op.actualSellPrice,
                closedAt: ["sold", "failed", "skipped"].includes(action.payload.status) ? Date.now() : op.closedAt,
              }
            : op
        ),
      };

    case "ADD_OR_UPDATE_LEDGER": {
      const exists = state.tradeLedger.some(entry => entry.id === action.payload.id);
      return {
        ...state,
        tradeLedger: exists
          ? state.tradeLedger.map(entry => entry.id === action.payload.id ? action.payload : entry)
          : [action.payload, ...state.tradeLedger].slice(0, 250),
      };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  addWatch: (config: WatchConfig) => { ok: boolean; error?: string };
  removeWatch: (id: string) => void;
  pauseWatch: (id: string) => void;
  resumeWatch: (id: string) => { ok: boolean; error?: string };
  updateWatch: (id: string, patch: Partial<WatchConfig>) => { ok: boolean; error?: string };
  saveSettings: (s: Partial<AppSettings>) => void;
  refreshMarket: (force?: boolean) => Promise<MarketSnapshot | null>;
  markOpportunity: (id: string, status: Opportunity["status"], actualSellPrice?: number) => void;
  clearOpportunities: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    settings: loadSettings(),
    watches: loadWatches(),
    liveResults: loadLiveResults(),
    alerts: [],
    marketSnapshot: loadMarketSnapshot(),
    marketLoading: false,
    opportunities: loadOpportunities(),
    tradeLedger: loadTradeLedger(),
  });
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    state.watches.forEach(watch => {
      watcherEngine.addWatch(watch);
    });
  }, []);

  // Wire up watcher engine events → dispatch
  useEffect(() => {
    const unsub = watcherEngine.on((event: WatchEvent) => {
      switch (event.type) {
        case "result":
          queueOpportunities(event.watchId, event.listings);
          dispatch({
            type: "SET_LIVE_RESULT",
            payload: {
              watchId: event.watchId,
              listings: event.listings,
              cheapest: event.cheapest,
              updatedAt: Date.now(),
            },
          });
          break;

        case "threshold_hit":
          dispatch({
            type: "ADD_ALERT",
            payload: {
              id: `${event.watchId}-${event.listing.id}-${Date.now()}`,
              watchId: event.watchId,
              listing: event.listing,
              seenAt: Date.now(),
              dismissed: false,
            },
          });
          // Browser notification
          showDesktopNotification(event.watchId, event.listing);
          break;

        case "error":
          dispatch({
            type: "SET_LIVE_RESULT",
            payload: {
              watchId: event.watchId,
              listings: [],
              cheapest: null,
              updatedAt: Date.now(),
              error: event.error,
            },
          });
          break;

        case "rate_limited":
          dispatch({
            type: "SET_LIVE_RESULT",
            payload: {
              watchId: event.watchId,
              listings: [],
              cheapest: null,
              updatedAt: Date.now(),
              rateLimitedUntil: Date.now() + event.retryAfter * 1000,
            },
          });
          break;

        case "status":
          dispatch({
            type: "UPDATE_WATCH_STATUS",
            payload: { id: event.watchId, status: event.status },
          });
          break;
      }
    });

    return unsub;
  }, []);

  useEffect(() => {
    void refreshMarket();
  }, []);

  // Re-configure engine when settings change
  useEffect(() => {
    watcherEngine.configure({
      poesessid: state.settings.poesessid,
      pollIntervalMs: state.settings.pollIntervalMs,
      marketSnapshot: state.marketSnapshot,
    });
  }, [state.settings, state.marketSnapshot]);

  useEffect(() => {
    persistWatches(state.watches);
  }, [state.watches]);

  useEffect(() => {
    persistLiveResults(state.liveResults);
  }, [state.liveResults]);

  useEffect(() => {
    persistOpportunities(state.opportunities);
  }, [state.opportunities]);

  useEffect(() => {
    persistTradeLedger(state.tradeLedger);
  }, [state.tradeLedger]);

  const addWatch = (config: WatchConfig) => {
    const result = watcherEngine.addWatch(config);
    if (result.ok) {
      dispatch({ type: "ADD_WATCH", payload: config });
    }
    return result;
  };

  const removeWatch = (id: string) => {
    watcherEngine.removeWatch(id);
    dispatch({ type: "REMOVE_WATCH", payload: id });
  };

  const pauseWatch = (id: string) => {
    watcherEngine.pauseWatch(id);
    dispatch({ type: "UPDATE_WATCH_STATUS", payload: { id, status: "paused" } });
  };

  const resumeWatch = (id: string) => {
    const watch = state.watches.find(w => w.id === id);
    if (!watch) return { ok: false, error: "Watch not found" };
    const result = watcherEngine.resumeWatch(id);
    if (!result.ok) return result;
    dispatch({ type: "UPDATE_WATCH_STATUS", payload: { id, status: "active" } });
    return { ok: true };
  };

  const updateWatch = (id: string, patch: Partial<WatchConfig>) => {
    const result = watcherEngine.updateWatch(id, patch);
    if (!result.ok) return result;
    dispatch({ type: "UPDATE_WATCH", payload: { id, patch } });
    return { ok: true };
  };

  const saveSettings = (partial: Partial<AppSettings>) => {
    dispatch({ type: "SET_SETTINGS", payload: partial });
    persistSettings({ ...state.settings, ...partial });
  };

  const refreshMarket = async (force = false) => {
    dispatch({ type: "SET_MARKET_LOADING", payload: true });
    try {
      const snapshot = await fetchMarketSnapshot(stateRef.current.settings.league, force);
      dispatch({ type: "SET_MARKET_SNAPSHOT", payload: snapshot });
      return snapshot;
    } catch (err: any) {
      const failedSnapshot: MarketSnapshot = {
        league: stateRef.current.settings.league,
        fetchedAt: Date.now(),
        prices: [],
        rates: {},
        error: err?.message || "Failed to refresh market data.",
      };
      dispatch({ type: "SET_MARKET_SNAPSHOT", payload: failedSnapshot });
      return failedSnapshot;
    }
  };

  const markOpportunity = (id: string, status: Opportunity["status"], actualSellPrice?: number) => {
    const opportunity = stateRef.current.opportunities.find(op => op.id === id);
    if (!opportunity) return;
    dispatch({ type: "MARK_OPPORTUNITY", payload: { id, status, actualSellPrice } });

    if (status === "bought") {
      dispatch({
        type: "ADD_OR_UPDATE_LEDGER",
        payload: {
          id: `ledger-${id}`,
          opportunityId: id,
          itemName: opportunity.itemName,
          strategy: opportunity.strategy,
          buyPriceDivine: opportunity.score.buyPriceDivine,
          suggestedListPrice: opportunity.suggestedListPrice,
          status: "bought",
          boughtAt: Date.now(),
        },
      });
    }

    if (status === "sold" || status === "failed") {
      const existing = stateRef.current.tradeLedger.find(entry => entry.opportunityId === id);
      if (existing) {
        const sellPrice = actualSellPrice ?? existing.actualSellPrice;
        dispatch({
          type: "ADD_OR_UPDATE_LEDGER",
          payload: {
            ...existing,
            status,
            actualSellPrice: sellPrice,
            closedAt: Date.now(),
            profitDivine: status === "sold" && sellPrice !== undefined
              ? sellPrice - existing.buyPriceDivine
              : existing.profitDivine,
          },
        });
      }
    }
  };

  const clearOpportunities = () => {
    dispatch({ type: "CLEAR_OPPORTUNITIES" });
  };

  const queueOpportunities = (watchId: string, listings: ListingResult[]) => {
    const snapshot = stateRef.current;
    const watch = snapshot.watches.find(w => w.id === watchId);
    if (!watch) return;
    const opportunities = listings
      .map(listing => {
        const score = scoreListing(listing, watch, listings, snapshot.marketSnapshot);
        if (!shouldCreateOpportunity(score, watch)) return null;
        const fingerprint = listingFingerprint(listing);
        const opportunity: Opportunity = {
          id: `opp-${listing.id}`,
          watchId,
          listingId: listing.id,
          fingerprint,
          itemName: listing.item.name || listing.item.typeLine,
          baseType: listing.item.baseType || listing.item.typeLine,
          icon: listing.item.icon,
          seller: listing.listing.account.lastCharacterName || listing.listing.account.name,
          listing,
          strategy: watch.strategy || "mixed",
          score,
          status: "open" as const,
          firstSeenAt: Date.now(),
          lastSeenAt: Date.now(),
          seenCount: 1,
          suggestedListPrice: score.quickSellPrice,
        };
        return opportunity;
      })
      .filter((op): op is Opportunity => op !== null);

    if (opportunities.length) {
      dispatch({ type: "UPSERT_OPPORTUNITIES", payload: opportunities });
      handleOpportunityActions(watch, opportunities);
    }
  };

  const handleOpportunityActions = (watch: WatchConfig, opportunities: Opportunity[]) => {
    const existingFingerprints = new Set(stateRef.current.opportunities.map(op => op.fingerprint));
    for (const opportunity of opportunities) {
      if (existingFingerprints.has(opportunity.fingerprint)) continue;
      const token = opportunity.listing.listing.whisper_token || opportunity.listing.listing.hideout_token;

      if (canAutoTravel(opportunity.score, watch) && token && stateRef.current.settings.poesessid) {
        void travelToHideout(token, stateRef.current.settings.poesessid).catch(() => {
          dispatch({
            type: "SET_LIVE_RESULT",
            payload: {
              watchId: watch.id,
              listings: [],
              cheapest: null,
              updatedAt: Date.now(),
              error: "Auto-travel opportunity failed: Login required",
            },
          });
        });
        dispatch({
          type: "ADD_ALERT",
          payload: {
            id: `${watch.id}-${opportunity.listing.id}-deal-${Date.now()}`,
            watchId: watch.id,
            listing: opportunity.listing,
            seenAt: Date.now(),
            dismissed: false,
          },
        });
      } else if (watch.mode === "report") {
        dispatch({
          type: "ADD_ALERT",
          payload: {
            id: `${watch.id}-${opportunity.listing.id}-deal-${Date.now()}`,
            watchId: watch.id,
            listing: opportunity.listing,
            seenAt: Date.now(),
            dismissed: false,
          },
        });
      }
    }
  };

  return (
    <AppContext.Provider value={{
      state,
      dispatch,
      addWatch,
      removeWatch,
      pauseWatch,
      resumeWatch,
      updateWatch,
      saveSettings,
      refreshMarket,
      markOpportunity,
      clearOpportunities,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem("poe2sniper:settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS;
}

function persistSettings(s: AppSettings) {
  try {
    localStorage.setItem("poe2sniper:settings", JSON.stringify(s));
  } catch { /* ignore */ }
}

function loadWatches(): WatchConfig[] {
  try {
    const raw = localStorage.getItem("poe2sniper:watches");
    if (!raw) return [];
    return JSON.parse(raw).map((watch: WatchConfig) => ({
      ...watch,
      status: watch.status === "active" ? "paused" : watch.status,
      pollIntervalMs: watch.pollIntervalMs || 10_000,
      strategy: watch.strategy || "mixed",
      minProfitDivine: watch.minProfitDivine ?? 1,
    }));
  } catch {
    return [];
  }
}

function loadMarketSnapshot(): MarketSnapshot | null {
  try {
    const raw = localStorage.getItem("poe2sniper:marketSnapshots:Runes of Aldur");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadOpportunities(): Opportunity[] {
  try {
    const raw = localStorage.getItem("poe2sniper:opportunities");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistOpportunities(opportunities: Opportunity[]) {
  try {
    localStorage.setItem("poe2sniper:opportunities", JSON.stringify(opportunities));
  } catch { /* ignore */ }
}

function loadTradeLedger(): TradeLedgerEntry[] {
  try {
    const raw = localStorage.getItem("poe2sniper:tradeLedger");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistTradeLedger(entries: TradeLedgerEntry[]) {
  try {
    localStorage.setItem("poe2sniper:tradeLedger", JSON.stringify(entries));
  } catch { /* ignore */ }
}

function persistWatches(watches: WatchConfig[]) {
  try {
    localStorage.setItem("poe2sniper:watches", JSON.stringify(watches));
  } catch { /* ignore */ }
}

function loadLiveResults(): Record<string, LiveResult> {
  try {
    const raw = localStorage.getItem("poe2sniper:price-history");
    if (!raw) return {};
    const histories = JSON.parse(raw) as Record<string, PricePoint[]>;
    return Object.fromEntries(Object.entries(histories).map(([watchId, priceHistory]) => [
      watchId,
      {
        watchId,
        listings: [],
        cheapest: null,
        updatedAt: priceHistory.at(-1)?.time || Date.now(),
        priceHistory,
      },
    ]));
  } catch {
    return {};
  }
}

function persistLiveResults(liveResults: Record<string, LiveResult>) {
  try {
    const histories = Object.fromEntries(
      Object.entries(liveResults)
        .filter(([, result]) => result.priceHistory?.length)
        .map(([watchId, result]) => [watchId, result.priceHistory])
    );
    localStorage.setItem("poe2sniper:price-history", JSON.stringify(histories));
  } catch { /* ignore */ }
}

// ─── Desktop notifications ────────────────────────────────────────────────────

function showDesktopNotification(watchId: string, listing: ListingResult) {
  if (!("Notification" in window)) return;

  const show = () => {
    const price = listing.listing.price;
    new Notification("POE2 Sniper — Price Alert!", {
      body: `${listing.item.name || listing.item.typeLine} — ${price.amount} ${price.currency}\nSeller: ${listing.listing.account.lastCharacterName}`,
      icon: listing.item.icon,
      tag: watchId,
      requireInteraction: true,
    });
  };

  if (Notification.permission === "granted") {
    show();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(p => { if (p === "granted") show(); });
  }
}
