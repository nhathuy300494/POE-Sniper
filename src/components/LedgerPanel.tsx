import React, { useState } from "react";
import { useAppState } from "../store/appStore";

export function LedgerPanel() {
  const { state, markOpportunity } = useAppState();
  const [sellPrices, setSellPrices] = useState<Record<string, string>>({});

  const totalProfit = state.tradeLedger.reduce((sum, entry) => sum + (entry.profitDivine || 0), 0);
  const openBuys = state.tradeLedger.filter(entry => entry.status === "bought").length;

  return (
    <div className="ledger-container">
      <div className="panel-title">Portfolio / Ledger</div>
      <div className="ledger-summary">
        <div>
          <span>Open Buys</span>
          <strong>{openBuys}</strong>
        </div>
        <div>
          <span>Realized Profit</span>
          <strong className={totalProfit >= 0 ? "price-down" : "price-up"}>{totalProfit.toFixed(2)}d</strong>
        </div>
        <div>
          <span>Closed Trades</span>
          <strong>{state.tradeLedger.filter(entry => entry.status !== "bought").length}</strong>
        </div>
      </div>

      {state.tradeLedger.length === 0 ? (
        <div className="empty-state">No ledger entries yet. Mark an opportunity as Bought to start tracking.</div>
      ) : (
        <div className="opportunity-table-wrap">
          <table className="opportunity-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Strategy</th>
                <th>Buy</th>
                <th>Suggested Sell</th>
                <th>Actual Sell</th>
                <th>Profit</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {state.tradeLedger.map(entry => (
                <tr key={entry.id}>
                  <td>
                    <div className="opp-name">{entry.itemName}</div>
                    <div className="opp-sub">Bought {new Date(entry.boughtAt).toLocaleString()}</div>
                  </td>
                  <td>{entry.strategy}</td>
                  <td>{entry.buyPriceDivine.toFixed(2)}d</td>
                  <td>{entry.suggestedListPrice.toFixed(2)}d</td>
                  <td>
                    {entry.status === "bought" ? (
                      <input
                        className="ledger-sell-input"
                        type="number"
                        min={0}
                        step={0.25}
                        value={sellPrices[entry.opportunityId] || ""}
                        placeholder={entry.suggestedListPrice.toFixed(2)}
                        onChange={e => setSellPrices(prev => ({ ...prev, [entry.opportunityId]: e.target.value }))}
                      />
                    ) : (
                      `${(entry.actualSellPrice || 0).toFixed(2)}d`
                    )}
                  </td>
                  <td className={(entry.profitDivine || 0) >= 0 ? "price-down" : "price-up"}>
                    {entry.profitDivine === undefined ? "-" : `${entry.profitDivine.toFixed(2)}d`}
                  </td>
                  <td>{entry.status}</td>
                  <td>
                    {entry.status === "bought" && (
                      <div className="opp-actions">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => markOpportunity(
                            entry.opportunityId,
                            "sold",
                            Number(sellPrices[entry.opportunityId] || entry.suggestedListPrice)
                          )}
                        >
                          Sold
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => markOpportunity(entry.opportunityId, "failed")}>
                          Failed
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
