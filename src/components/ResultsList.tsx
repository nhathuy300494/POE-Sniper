import React, { useState, useEffect } from "react";
import { useAppState } from "../store/appStore";
import type { ListingResult, TradeSearchBody } from "../types/trade";
import { travelToHideout } from "../api/tradeClient";
import { cleanModText, getItemMetrics } from "../utils/itemDisplay";

export function ResultsList() {
  const { state, addWatch } = useAppState();
  const [results, setResults] = useState<{
    listings: ListingResult[];
    total: number;
    searchId: string;
    searchBody: TradeSearchBody;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      setResults(e.detail);
    };
    window.addEventListener("poe2:searchResult", handler);
    return () => window.removeEventListener("poe2:searchResult", handler);
  }, []);

  const handleTravel = async (token: string) => {
    if (!state.settings.poesessid) return;
    setLoading(true);
    try {
      await travelToHideout(token, state.settings.poesessid);
    } catch (err) {
      alert("Your account must be logged in game to use this feature");
    } finally {
      setLoading(false);
    }
  };

  const handleWatchSearch = () => {
    if (!results) return;
    const firstListing = results.listings[0];
    const query = results.searchBody.query;
    const label =
      query.name ||
      query.type ||
      firstListing?.item.name ||
      firstListing?.item.typeLine ||
      `Search ${new Date().toLocaleTimeString()}`;
    const currency = firstListing?.listing.price?.currency || "divine";
    const amount = firstListing?.listing.price?.amount || 0;
    const result = addWatch({
      id: `watch-${Date.now()}`,
      label,
      league: state.settings.league,
      searchBody: results.searchBody,
      threshold: { amount, currency },
      mode: "report",
      pollIntervalMs: state.settings.pollIntervalMs,
      createdAt: Date.now(),
      status: "paused",
    });

    if (!result.ok) {
      alert(result.error || "Could not create watch.");
      return;
    }

    window.dispatchEvent(new CustomEvent("poe2:openTab", { detail: "watches" }));
  };

  if (!results) {
    return (
      <div className="results-empty">
        <div className="empty-icon">🔍</div>
        <p>Run a search to see live results</p>
      </div>
    );
  }

  return (
    <div className="panel results-pane">
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
           Live Results ({results.total} found)
        </div>
        <button className="btn btn-watch btn-sm" onClick={handleWatchSearch}>
          👁 Watch this Search
        </button>
      </div>
      
      <div className="results-scroll">
        {results.listings.map(l => {
          const token = l.listing.whisper_token || l.listing.hideout_token || (l.listing as any).token;
          const sellerName = l.listing.account.lastCharacterName || l.listing.account.name || "Unknown Seller";
          
          return (
            <div key={l.id} className={`item-card rarity-${l.item.rarity?.toLowerCase()}`}>
              <img src={l.item.icon} alt={l.item.name} className="item-icon" />
              
              <div className="item-info">
                <div className={`item-name rarity-${l.item.rarity?.toLowerCase()}`}>
                  {l.item.name || l.item.typeLine}
                </div>
                <div className="item-type">{l.item.typeLine}</div>
                {getItemMetrics(l.item).length > 0 && (
                  <div className="item-metrics">
                    {getItemMetrics(l.item).map(metric => (
                      <div key={metric.label} className="item-metric">
                        <span>{metric.label}</span>
                        <strong>{metric.value}</strong>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Modifiers Display */}
                <div className="item-mods">
                  {l.item.implicitMods && l.item.implicitMods.length > 0 && (
                    <div className="mods-group implicit">
                      {l.item.implicitMods.map((m, i) => (
                        <div key={`imp-${i}`} className="mod-line">{cleanModText(m)}</div>
                      ))}
                    </div>
                  )}
                  {l.item.explicitMods && l.item.explicitMods.length > 0 && (
                    <div className="mods-group explicit">
                      {l.item.explicitMods.map((m, i) => (
                        <div key={`exp-${i}`} className="mod-line">{cleanModText(m)}</div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="seller-name">Seller: {sellerName}</div>
              </div>
              
              <div className="item-actions">
                <div className={`price-tag ${l.listing.price?.currency}`}>
                  <span className="price-val">{l.listing.price?.amount ?? "No Price"}</span>
                  <span className="currency-name">{l.listing.price?.currency || ""}</span>
                </div>
                
                {token ? (
                  <button 
                    className="btn btn-travel btn-sm" 
                    onClick={() => handleTravel(token)}
                    disabled={loading}
                  >
                    ⚡ Travel to Hideout
                  </button>
                ) : (
                  <div className="no-token-label" style={{ fontSize: 10, color: "var(--text-dim)" }}>
                    No Travel Token Found
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
