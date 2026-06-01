import React, { useState } from "react";
import { useAppState, type PricePoint } from "../store/appStore";
import { travelToHideout } from "../api/tradeClient";
import type { ListingResult } from "../types/trade";
import { getItemMetrics } from "../utils/itemDisplay";

const POLL_OPTIONS = [5_000, 10_000, 20_000, 30_000, 60_000];

export function WatchList() {
  const { state, pauseWatch, resumeWatch, removeWatch, updateWatch } = useAppState();
  const [travelingId, setTravelingId] = useState("");

  const handleActivate = (id: string) => {
    const result = resumeWatch(id);
    if (!result.ok) {
      alert(result.error || "Could not activate watch.");
    }
  };

  const handleTravel = async (listing: ListingResult) => {
    const token = listing.listing.whisper_token || listing.listing.hideout_token;
    if (!token || !state.settings.poesessid) return;
    setTravelingId(listing.id);
    try {
      await travelToHideout(token, state.settings.poesessid);
    } catch {
      alert("Your account must be logged in game to use this feature");
    } finally {
      setTravelingId("");
    }
  };

  return (
    <div className="watches-container">
      <div className="panel-title">Watches</div>
      <div className="watch-rate-note">
        Conservative budget: about 10 searches/minute total. Use 20s+ polling for multiple active watches.
      </div>

      {state.watches.length === 0 && (
        <div className="empty-state">No watches saved. Run a search, then use Watch this Search.</div>
      )}

      <div className="watch-dashboard-list">
        {state.watches.map(w => {
          const live = state.liveResults[w.id];
          const found = (live?.listings || []).filter(listing =>
            listing.listing.price.currency === w.threshold.currency &&
            listing.listing.price.amount <= w.threshold.amount
          );
          const history = live?.priceHistory || [];

          return (
            <div key={w.id} className={`watch-dashboard status-${w.status}`}>
              <section className="watch-column watch-snipe">
                <div className="watch-column-title">Snipe</div>
                <div className="watch-header">
                  <div className="watch-label">{w.label}</div>
                  <div className="watch-badge">{w.status}</div>
                </div>

                <div className="watch-controls compact">
                  <label className="watch-control">
                    <span>Target</span>
                    <input
                      type="number"
                      min={0}
                      value={w.threshold.amount}
                      onChange={e => updateWatch(w.id, {
                        threshold: { ...w.threshold, amount: Number(e.target.value) || 0 },
                      })}
                    />
                  </label>
                  <label className="watch-control">
                    <span>Currency</span>
                    <select
                      value={w.threshold.currency}
                      onChange={e => updateWatch(w.id, {
                        threshold: { ...w.threshold, currency: e.target.value },
                      })}
                    >
                      <option value="divine">Divine</option>
                      <option value="exalted">Exalted</option>
                      <option value="chaos">Chaos</option>
                      <option value="gold">Gold</option>
                    </select>
                  </label>
                  <label className="watch-control">
                    <span>Polling</span>
                    <select
                      value={w.pollIntervalMs}
                      onChange={e => {
                        const result = updateWatch(w.id, { pollIntervalMs: Number(e.target.value) });
                        if (!result.ok) alert(result.error || "Could not update polling interval.");
                      }}
                    >
                      {POLL_OPTIONS.map(ms => (
                        <option key={ms} value={ms}>{Math.round(ms / 1000)}s</option>
                      ))}
                    </select>
                  </label>
                  <label className="watch-control">
                    <span>Mode</span>
                    <select
                      value={w.mode}
                      onChange={e => updateWatch(w.id, { mode: e.target.value as "auto" | "report" })}
                    >
                      <option value="report">Report</option>
                      <option value="auto">Auto</option>
                    </select>
                  </label>
                </div>

                <div className="watch-live">
                  {live?.error ? (
                    <div className="watch-error">{live.error}</div>
                  ) : (
                    <>
                      <div>Cheapest: {live?.cheapest ? `${live.cheapest.listing.price.amount} ${live.cheapest.listing.price.currency}` : "No poll yet"}</div>
                      <div>Updated: {live ? new Date(live.updatedAt).toLocaleTimeString() : "Waiting"}</div>
                    </>
                  )}
                </div>

                <div className="watch-actions">
                  {w.status === "active" ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => pauseWatch(w.id)}>Deactivate</button>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={() => handleActivate(w.id)}>Activate</button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => removeWatch(w.id)}>Remove</button>
                </div>
              </section>

              <section className="watch-column watch-found">
                <div className="watch-column-title">Found</div>
                {found.length === 0 ? (
                  <div className="watch-empty">No item at or below target.</div>
                ) : (
                  <div className="found-list">
                    {found.map(listing => {
                      const token = listing.listing.whisper_token || listing.listing.hideout_token;
                      return (
                        <div className="found-item" key={listing.id}>
                          <img src={listing.item.icon} alt="" className="found-icon" />
                          <div className="found-info">
                            <div className="found-name">{listing.item.name || listing.item.typeLine}</div>
                            <div className="found-price">
                              {listing.listing.price.amount} {listing.listing.price.currency}
                            </div>
                            <div className="found-metrics">
                              {getItemMetrics(listing.item).slice(0, 8).map(metric => (
                                <span key={metric.label}>{metric.label}: {metric.value}</span>
                              ))}
                            </div>
                            <div className="found-seller">
                              {listing.listing.account.lastCharacterName || listing.listing.account.name}
                            </div>
                          </div>
                          {token && (
                            <button
                              className="btn btn-travel btn-sm"
                              disabled={travelingId === listing.id}
                              onClick={() => handleTravel(listing)}
                            >
                              Travel
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="watch-column watch-analyze">
                <div className="watch-column-title">Analyze</div>
                <PriceChart history={history} />
                <PriceStats history={history} />
              </section>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PriceChart({ history }: { history: PricePoint[] }) {
  if (history.length < 2) {
    return <div className="watch-empty">Need at least 2 polls for chart.</div>;
  }

  const width = 260;
  const height = 92;
  const values = history.map(p => p.amount);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const points = history.map((point, index) => {
    const x = history.length === 1 ? 0 : (index / (history.length - 1)) * width;
    const y = height - ((point.amount - min) / span) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="price-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function PriceStats({ history }: { history: PricePoint[] }) {
  if (history.length === 0) {
    return <div className="price-stats">No price data yet.</div>;
  }

  const latest = history[history.length - 1];
  const baseline = history.reduce((sum, point) => sum + point.amount, 0) / history.length;
  const delta = latest.amount - baseline;
  const percent = baseline ? (delta / baseline) * 100 : 0;

  return (
    <div className="price-stats">
      <div>Latest: {latest.amount} {latest.currency}</div>
      <div>Average: {baseline.toFixed(1)} {latest.currency}</div>
      <div className={delta >= 0 ? "price-up" : "price-down"}>
        Change: {delta >= 0 ? "+" : ""}{delta.toFixed(1)} ({percent >= 0 ? "+" : ""}{percent.toFixed(1)}%)
      </div>
      <div>Samples: {history.length}</div>
    </div>
  );
}
