import React from "react";
import { useAppState } from "../store/appStore";
import { travelToHideout } from "../api/tradeClient";

export function AlertPanel() {
  const { state, dispatch } = useAppState();

  const handleTravel = async (token: string) => {
    if (!state.settings.poesessid) return;
    try {
      await travelToHideout(token, state.settings.poesessid);
    } catch (err) {
      alert("Travel failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="alerts-container">
      <div className="alerts-header">
        <div className="panel-title">Snipe Alerts</div>
        <button className="btn btn-secondary btn-sm" onClick={() => dispatch({ type: "CLEAR_ALERTS" })}>
          Clear All
        </button>
      </div>

      {state.alerts.length === 0 && (
        <div className="empty-state">No alerts yet. Set a watch and wait for the magic.</div>
      )}

      <div className="alerts-list">
        {state.alerts.map(alert => (
          <div key={alert.id} className={`alert-item ${alert.dismissed ? "dismissed" : ""}`}>
            <div className="alert-time">{new Date(alert.seenAt).toLocaleTimeString()}</div>
            <div className="alert-content">
              <img src={alert.listing.item.icon} alt="" className="item-icon-sm" />
              <div className="alert-text">
                <strong>{alert.listing.item.name || alert.listing.item.typeLine}</strong> hit target price!
                <div className="alert-price">
                  {alert.listing.listing.price.amount} {alert.listing.listing.price.currency}
                </div>
              </div>
            </div>
            <div className="alert-btns">
              {alert.listing.listing.method === "merchant" && (
                <button className="btn btn-primary btn-sm" onClick={() => handleTravel(alert.listing.listing.whisper_token)}>
                  ⚡ Travel
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => dispatch({ type: "DISMISS_ALERT", payload: alert.id })}>
                Dismiss
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
