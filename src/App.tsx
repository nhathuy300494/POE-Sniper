import React, { useState } from "react";
import { AppProvider, useAppState } from "./store/appStore";
import { FilterBuilder } from "./components/FilterBuilder";
import { ResultsList } from "./components/ResultsList";
import { WatchList } from "./components/WatchList";
import { AlertPanel } from "./components/AlertPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { travelToHideout } from "./api/tradeClient";
import "./styles/app.css";

type Tab = "search" | "watches" | "alerts" | "settings";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("search");

  React.useEffect(() => {
    const handleOpenTab = (event: Event) => {
      const tab = (event as CustomEvent<Tab>).detail;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("poe2:openTab", handleOpenTab);
    return () => window.removeEventListener("poe2:openTab", handleOpenTab);
  }, []);

  return (
    <AppProvider>
      <div className="app-shell">
        {/* Header */}
        <header className="app-header">
          <div className="app-logo">
            <span className="logo-gem" />
            <span className="logo-text">POE2 <em>Sniper</em></span>
          </div>
          <nav className="app-nav">
            {(["search","watches","alerts","settings"] as Tab[]).map(tab => (
              <button
                key={tab}
                className={`nav-btn ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {NAV_ICONS[tab]}
                <span>{tab.charAt(0).toUpperCase() + tab.slice(1)}</span>
              </button>
            ))}
          </nav>
        </header>

        {/* Body */}
        <main className="app-body">
          <div className={`tab-panel search-layout ${activeTab === "search" ? "active" : ""}`}>
              <FilterBuilder />
              <ResultsList />
          </div>
          <div className={`tab-panel ${activeTab === "watches" ? "active" : ""}`}>
            <WatchList />
          </div>
          <div className={`tab-panel ${activeTab === "alerts" ? "active" : ""}`}>
            <AlertPanel />
          </div>
          <div className={`tab-panel ${activeTab === "settings" ? "active" : ""}`}>
            <SettingsPanel />
          </div>
        </main>
        <AlertToast />
      </div>
    </AppProvider>
  );
}

function AlertToast() {
  const { state, dispatch } = useAppState();
  const [loading, setLoading] = useState(false);
  const alert = state.alerts.find(a => !a.dismissed);

  if (!alert) return null;

  const token = alert.listing.listing.whisper_token || alert.listing.listing.hideout_token;
  const itemName = alert.listing.item.name || alert.listing.item.typeLine;
  const price = alert.listing.listing.price;

  const handleTravel = async () => {
    if (!token || !state.settings.poesessid) return;
    setLoading(true);
    try {
      await travelToHideout(token, state.settings.poesessid);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="alert-toast">
      <div className="alert-toast-title">Threshold Hit</div>
      <div className="alert-toast-body">
        {itemName} at {price.amount} {price.currency}
      </div>
      <div className="alert-toast-actions">
        {token && (
          <button className="btn btn-travel btn-sm" onClick={handleTravel} disabled={loading}>
            Travel
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => dispatch({ type: "DISMISS_ALERT", payload: alert.id })}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

const NAV_ICONS: Record<Tab, React.ReactNode> = {
  search:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>,
  watches:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  alerts:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};
