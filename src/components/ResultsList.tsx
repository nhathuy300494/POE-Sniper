import React, { useState, useEffect } from "react";
import { useAppState } from "../store/appStore";
import type { ListingResult, TradeSearchBody } from "../types/trade";
import { travelToHideout } from "../api/tradeClient";

export function ResultsList() {
  const { state } = useAppState();
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
      alert("Travel failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
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
    <div className="panel results-panel">
      <div className="panel-title">
        Live Results ({results.total} found)
        <a 
          href={`https://www.pathofexile.com/trade2/search/poe2/${state.settings.league}/${results.searchId}`}
          target="_blank"
          rel="noreferrer"
          className="external-link"
        >
          View on Official Site
        </a>
      </div>
      
      <div className="results-scroll">
        {results.listings.map(l => (
          <div key={l.id} className="item-card">
            <div className="item-main">
              <img src={l.item.icon} alt={l.item.name} className="item-icon" />
              <div className="item-info">
                <div className={`item-name rarity-${l.item.rarity?.toLowerCase()}`}>
                  {l.item.name || l.item.typeLine}
                </div>
                <div className="item-type">{l.item.typeLine}</div>
                <div className="item-seller">Seller: {l.listing.account.lastCharacterName}</div>
              </div>
              <div className="item-price">
                <div className="price-val">{l.listing.price.amount}</div>
                <div className={`currency-icon ${l.listing.price.currency}`} />
              </div>
            </div>
            
            <div className="item-actions">
              {l.listing.method === "merchant" ? (
                <button 
                  className="btn btn-primary btn-sm" 
                  onClick={() => handleTravel(l.listing.whisper_token)}
                  disabled={loading}
                >
                  ⚡ Travel to Hideout
                </button>
              ) : (
                <button 
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(l.listing.whisper);
                    alert("Whisper copied to clipboard!");
                  }}
                >
                  📋 Copy Whisper
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
