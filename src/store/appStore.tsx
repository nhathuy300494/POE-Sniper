/**
 * App-level state store using React Context + useReducer.
 * Keeps settings, watch list, and live results.
 */

import React, { createContext, useContext, useReducer, useEffect } from "react";
import type { WatchConfig, AppSettings, ListingResult } from "../types/trade";
import { watcherEngine, WatchEvent } from "../api/watcherEngine";

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
  | { type: "CLEAR_ALERTS" };

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
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    settings: loadSettings(),
    watches: loadWatches(),
    liveResults: loadLiveResults(),
    alerts: [],
  });

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

  // Re-configure engine when settings change
  useEffect(() => {
    watcherEngine.configure({
      poesessid: state.settings.poesessid,
      pollIntervalMs: state.settings.pollIntervalMs,
    });
  }, [state.settings]);

  useEffect(() => {
    persistWatches(state.watches);
  }, [state.watches]);

  useEffect(() => {
    persistLiveResults(state.liveResults);
  }, [state.liveResults]);

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

  return (
    <AppContext.Provider value={{ state, dispatch, addWatch, removeWatch, pauseWatch, resumeWatch, updateWatch, saveSettings }}>
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
    }));
  } catch {
    return [];
  }
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
    });
  };

  if (Notification.permission === "granted") {
    show();
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then(p => { if (p === "granted") show(); });
  }
}
