import React from "react";
import { useAppState } from "../store/appStore";

export function WatchList() {
  const { state, pauseWatch, resumeWatch, removeWatch } = useAppState();

  return (
    <div className="watches-container">
      <div className="panel-title">Active Watches</div>
      
      {state.watches.length === 0 && (
        <div className="empty-state">No watches active. Add one from the Search tab.</div>
      )}

      <div className="watches-grid">
        {state.watches.map(w => {
          const live = state.liveResults[w.id];
          return (
            <div key={w.id} className={`watch-card status-${w.status}`}>
              <div className="watch-header">
                <div className="watch-label">{w.label}</div>
                <div className="watch-badge">{w.status}</div>
              </div>

              <div className="watch-threshold">
                Target: ≤ {w.threshold.amount} {w.threshold.currency}
              </div>

              {live && (
                <div className="watch-live">
                  {live.error ? (
                    <div className="watch-error">{live.error}</div>
                  ) : (
                    <>
                      <div className="cheapest-now">
                        Cheapest: {live.cheapest 
                          ? `${live.cheapest.listing.price.amount} ${live.cheapest.listing.price.currency}`
                          : "None found"}
                      </div>
                      <div className="last-update">
                        Updated: {new Date(live.updatedAt).toLocaleTimeString()}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="watch-actions">
                {w.status === "active" ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => pauseWatch(w.id)}>Pause</button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => resumeWatch(w.id)}>Resume</button>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => removeWatch(w.id)}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
