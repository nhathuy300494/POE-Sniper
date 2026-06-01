import React, { useState } from "react";
import { useAppState } from "../store/appStore";
import { fetchItems, searchItems, travelToHideout } from "../api/tradeClient";
import {
  buildMarketSuggestions,
  buildSuggestionSearchBody,
  createWatchFromSuggestion,
  type MarketSuggestion,
} from "../utils/marketSuggestions";
import { convertPriceToDivine } from "../utils/pricingEngine";

interface SuggestionValidation {
  status: "validating" | "valid" | "risky" | "error";
  liveFloorDivine?: number;
  stableFloorDivine?: number;
  depreciationPct?: number;
  targetBuyDivine?: number;
  profitScore?: number;
  message: string;
}

interface BuildState {
  running: boolean;
  current: number;
  total: number;
  message: string;
}

const BUILD_LIMIT = 24;
const VALIDATION_DELAY_MS = 6500;

export function OpportunitiesPanel() {
  const { state, refreshMarket, markOpportunity, addWatch, clearOpportunities } = useAppState();
  const [travelingId, setTravelingId] = useState("");
  const [suggestionFilter, setSuggestionFilter] = useState("all");
  const [validations, setValidations] = useState<Record<string, SuggestionValidation>>({});
  const [builtSuggestions, setBuiltSuggestions] = useState<MarketSuggestion[]>([]);
  const [buildState, setBuildState] = useState<BuildState>({
    running: false,
    current: 0,
    total: 0,
    message: "Run Build Suggestions to generate a validated profit list.",
  });

  const openOpportunities = state.opportunities.filter(op => op.status === "open");
  const suggestions = builtSuggestions.length > 0 ? builtSuggestions : buildMarketSuggestions(state.marketSnapshot);
  const visibleSuggestions = suggestions.filter(suggestion =>
    suggestionFilter === "all" || suggestion.type === suggestionFilter
  );
  const suggestionTypes = Array.from(new Set(suggestions.map(suggestion => suggestion.type)));

  const handleTravel = async (id: string) => {
    const opportunity = state.opportunities.find(op => op.id === id);
    const token = opportunity?.listing.listing.whisper_token || opportunity?.listing.listing.hideout_token;
    if (!opportunity || !token || !state.settings.poesessid) return;
    setTravelingId(id);
    try {
      await travelToHideout(token, state.settings.poesessid);
    } catch {
      alert("Your account must be logged in game to use this feature");
    } finally {
      setTravelingId("");
    }
  };

  const validateSuggestion = async (suggestion: MarketSuggestion): Promise<SuggestionValidation> => {
    if (!state.settings.poesessid) {
      throw new Error("Set your POE cookies in Settings first.");
    }
    setValidations(prev => ({
      ...prev,
      [suggestion.id]: { status: "validating", message: "Checking live trade floor..." },
    }));
    try {
      const body = buildSuggestionSearchBody(suggestion);
      const res = await searchItems(state.settings.league, body, state.settings.poesessid);
      const listings = res.result.length
        ? await fetchItems(res.result.slice(0, 10), res.id, state.settings.poesessid, state.settings.league)
        : [];
      const prices = listings
        .map(listing => convertPriceToDivine(
          listing.listing.price.amount,
          listing.listing.price.currency,
          state.marketSnapshot
        ))
        .filter(price => price > 0)
        .sort((a, b) => a - b);

      if (prices.length === 0) {
        const validation = { status: "risky" as const, message: "No live priced listings found." };
        setValidations(prev => ({ ...prev, [suggestion.id]: validation }));
        return validation;
      }

      const liveFloor = prices[0];
      const stableFloor = prices[Math.min(2, prices.length - 1)];
      const depreciationPct = suggestion.marketFloorDivine
        ? ((suggestion.marketFloorDivine - liveFloor) / suggestion.marketFloorDivine) * 100
        : 0;
      const undercut = stableFloor >= 25 ? 2 : Math.max(0.15, stableFloor * 0.08);
      const targetBuy = Math.floor(Math.max(0, stableFloor - undercut - suggestion.minProfitDivine));
      const isRisky =
        depreciationPct > 12 ||
        liveFloor < suggestion.quickSellDivine * 0.95 ||
        targetBuy <= 0 ||
        prices.length < 3;
      const trendBonus = Math.min(Math.max(suggestion.trend7d, 0), 80) / 100;
      const unstablePenalty = suggestion.trend7d > 300 ? 0.65 : suggestion.trend7d > 150 ? 0.8 : 1;
      const depreciationPenalty = depreciationPct > 0 ? Math.max(0.2, 1 - depreciationPct / 40) : 1;
      const profitScore = Math.max(0, targetBuy)
        * suggestion.liquidityScore
        * (1 + trendBonus)
        * unstablePenalty
        * depreciationPenalty;

      const validation = {
        status: isRisky ? "risky" as const : "valid" as const,
        liveFloorDivine: liveFloor,
        stableFloorDivine: stableFloor,
        depreciationPct,
        targetBuyDivine: targetBuy,
        profitScore,
        message: isRisky
          ? `Risky: live floor ${liveFloor.toFixed(1)}d vs poe.ninja ${suggestion.marketFloorDivine.toFixed(1)}d.`
          : `Validated: live stable floor ${stableFloor.toFixed(1)}d, buy at ${targetBuy.toFixed(1)}d or lower.`,
      };
      setValidations(prev => ({ ...prev, [suggestion.id]: validation }));
      return validation;
    } catch (err) {
      const validation = {
        status: "error" as const,
        message: err instanceof Error ? err.message : String(err),
      };
      setValidations(prev => ({ ...prev, [suggestion.id]: validation }));
      return validation;
    }
  };

  const handleBuildSuggestions = async () => {
    if (!state.settings.poesessid) {
      alert("Set your POE cookies in Settings first.");
      return;
    }
    setBuildState({ running: true, current: 0, total: BUILD_LIMIT, message: "Refreshing poe.ninja market baseline..." });
    setBuiltSuggestions([]);
    setValidations({});
    clearOpportunities();

    const snapshot = await refreshMarket(true);
    const candidates = buildMarketSuggestions(snapshot);
    const validationCandidates = candidates.slice(0, BUILD_LIMIT);
    setBuiltSuggestions(candidates);
    setBuildState({
      running: true,
      current: 0,
      total: validationCandidates.length,
      message: `Loaded ${candidates.length} poe.ninja candidates. Validating top ${validationCandidates.length} with rate-limit spacing...`,
    });

    const ranked: Array<{ suggestion: MarketSuggestion; validation: SuggestionValidation }> = [];
    for (let index = 0; index < validationCandidates.length; index += 1) {
      const suggestion = validationCandidates[index];
      setBuildState({
        running: true,
        current: index + 1,
        total: validationCandidates.length,
        message: `Validating ${suggestion.name} (${index + 1}/${validationCandidates.length})...`,
      });
      const validation = await validateSuggestion(suggestion);
      ranked.push({ suggestion, validation });
      if (index < validationCandidates.length - 1) {
        await sleep(VALIDATION_DELAY_MS);
      }
    }

    const validatedIds = new Set(ranked.map(entry => entry.suggestion.id));
    const sortedValidated = ranked
      .sort((a, b) => {
        const validA = a.validation.status === "valid" ? 1 : 0;
        const validB = b.validation.status === "valid" ? 1 : 0;
        if (validA !== validB) return validB - validA;
        return (b.validation.profitScore || 0) - (a.validation.profitScore || 0);
      })
      .map(entry => entry.suggestion);
    const sorted = [
      ...sortedValidated,
      ...candidates.filter(suggestion => !validatedIds.has(suggestion.id)),
    ];

    setBuiltSuggestions(sorted);
    const validCount = ranked.filter(entry => entry.validation.status === "valid").length;
    setBuildState({
      running: false,
      current: validationCandidates.length,
      total: validationCandidates.length,
      message: `Built ${validCount} validated suggestions from ${validationCandidates.length} live checks. ${candidates.length} poe.ninja candidates loaded.`,
    });
  };

  const handleCreateWatch = (suggestionId: string) => {
    const suggestion = suggestions.find(item => item.id === suggestionId);
    if (!suggestion) return;
    const validation = validations[suggestionId];
    if (validation?.status !== "valid" || !validation.targetBuyDivine) {
      alert("Validate live floor first. Risky suggestions are blocked from one-click watch creation.");
      return;
    }
    const result = addWatch(createWatchFromSuggestion(
      suggestion,
      state.settings.league,
      state.settings.pollIntervalMs,
      validation.targetBuyDivine
    ));
    if (!result.ok) {
      alert(result.error || "Could not create watch from suggestion.");
      return;
    }
    window.dispatchEvent(new CustomEvent("poe2:openTab", { detail: "watches" }));
  };

  return (
    <div className="opportunities-container">
      <div className="opportunity-header">
        <div>
          <div className="panel-title">Opportunities</div>
          <div className="watch-rate-note">
            Ranked by expected fast-resale profit. poe.ninja refresh is slow and separate from live polling.
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => void refreshMarket(true)} disabled={state.marketLoading}>
          {state.marketLoading ? "Refreshing" : "Refresh Market"}
        </button>
      </div>

      <MarketStatus />

      <section className="suggestion-panel">
        <div className="suggestion-head">
          <div>
            <div className="watch-column-title">Market Suggestions</div>
            <div className="opp-sub">Build uses poe.ninja first, then validates live floors sequentially to avoid rate-limit noise.</div>
          </div>
          <div className="suggestion-tools">
            <select className="suggestion-filter" value={suggestionFilter} onChange={e => setSuggestionFilter(e.target.value)}>
              <option value="all">All uniques</option>
              {suggestionTypes.map(type => (
                <option key={type} value={type}>{type.replace("Unique", "Unique ")}</option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" disabled={buildState.running} onClick={() => void handleBuildSuggestions()}>
              {buildState.running ? "Building" : "Build Suggestions"}
            </button>
          </div>
        </div>
        <div className="build-status">
          <span>{buildState.message}</span>
          {buildState.total > 0 && <strong>{buildState.current}/{buildState.total}</strong>}
        </div>

        {visibleSuggestions.length === 0 ? (
          <div className="watch-empty">No market suggestions yet. Use Build Suggestions to crawl poe.ninja and validate live prices.</div>
        ) : (
          <div className="suggestion-grid">
            {visibleSuggestions.map(suggestion => (
              <div className="suggestion-card" key={suggestion.id}>
                {suggestion.icon && <img src={suggestion.icon} alt="" />}
                <div className="suggestion-body">
                  <div className="opp-name">{suggestion.name}</div>
                  <div className="opp-sub">{suggestion.category || suggestion.type}</div>
                  <div className="suggestion-metrics">
                    <span>Floor <strong>{suggestion.marketFloorDivine.toFixed(1)}d</strong></span>
                    <span>Quick <strong>{suggestion.quickSellDivine.toFixed(1)}d</strong></span>
                    <span>Buy ≤ <strong>{suggestion.targetBuyDivine.toFixed(1)}d</strong></span>
                    <span>Trend <strong className={suggestion.trend7d >= 0 ? "price-down" : "price-up"}>{suggestion.trend7d.toFixed(1)}%</strong></span>
                  </div>
                  <div className="opp-sub">{suggestion.reason}</div>
                  <ValidationBadge validation={validations[suggestion.id]} />
                  <div className="suggestion-actions">
                    <button
                      className="btn btn-watch btn-sm"
                      disabled={validations[suggestion.id]?.status !== "valid"}
                      onClick={() => handleCreateWatch(suggestion.id)}
                    >
                      Create Watch
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {openOpportunities.length === 0 ? (
        <div className="empty-state">No profitable opportunities yet. Activate watches and let them poll.</div>
      ) : (
        <div className="opportunity-table-wrap">
          <table className="opportunity-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Buy</th>
                <th>Quick Sell</th>
                <th>Margin</th>
                <th>Confidence</th>
                <th>Liquidity</th>
                <th>Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {openOpportunities.map(op => (
                <tr key={op.id}>
                  <td>
                    <div className="opp-item">
                      <img src={op.icon} alt="" />
                      <div>
                        <div className="opp-name">{op.itemName}</div>
                        <div className="opp-sub">{op.baseType} · {op.strategy} · seen {op.seenCount}x</div>
                        <div className="opp-sub">{op.score.reason}</div>
                      </div>
                    </div>
                  </td>
                  <td>{op.score.buyPriceDivine.toFixed(2)}d</td>
                  <td>{op.score.quickSellPrice.toFixed(2)}d</td>
                  <td className={op.score.marginAfterUndercut >= 0 ? "price-down" : "price-up"}>
                    {op.score.marginAfterUndercut.toFixed(2)}d
                  </td>
                  <td><span className={`score-pill score-${op.score.confidence.toLowerCase()}`}>{op.score.confidence}</span></td>
                  <td>{op.score.liquidity}</td>
                  <td>{op.score.source}</td>
                  <td>
                    <div className="opp-actions">
                      <button className="btn btn-travel btn-sm" disabled={travelingId === op.id} onClick={() => handleTravel(op.id)}>
                        Travel
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={() => markOpportunity(op.id, "bought")}>
                        Bought
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => markOpportunity(op.id, "skipped")}>
                        Skip
                      </button>
                    </div>
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ValidationBadge({ validation }: { validation?: SuggestionValidation }) {
  if (!validation) {
    return <div className="suggestion-validation">Live validation required before creating a watch.</div>;
  }
  return (
    <div className={`suggestion-validation validation-${validation.status}`}>
      <div>{validation.message}</div>
      {validation.liveFloorDivine !== undefined && (
        <div>
          Live {validation.liveFloorDivine.toFixed(1)}d · Stable {validation.stableFloorDivine?.toFixed(1)}d ·
          Gap {validation.depreciationPct?.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function MarketStatus() {
  const { state } = useAppState();
  const market = state.marketSnapshot;
  if (!market) {
    return <div className="market-status">Market baseline not loaded yet.</div>;
  }
  return (
    <div className={`market-status ${market.error ? "status-error" : ""}`}>
      <span>{market.prices.length} market baselines</span>
      <span>Updated {new Date(market.fetchedAt).toLocaleTimeString()}</span>
      {market.error && <span>{market.error}</span>}
    </div>
  );
}
