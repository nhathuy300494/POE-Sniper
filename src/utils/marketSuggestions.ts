import type { MarketPrice, MarketSnapshot, TradeSearchBody, WatchConfig } from "../types/trade";

export interface MarketSuggestion {
  id: string;
  name: string;
  type: string;
  category?: string;
  icon?: string;
  marketFloorDivine: number;
  quickSellDivine: number;
  targetBuyDivine: number;
  minProfitDivine: number;
  liquidityScore: number;
  trend7d: number;
  reason: string;
}

const UNIQUE_TYPES = new Set([
  "UniqueWeapons",
  "UniqueArmours",
  "UniqueAccessories",
  "UniqueFlasks",
  "UniqueCharms",
  "UniqueJewels",
]);

export function buildMarketSuggestions(snapshot: MarketSnapshot | null): MarketSuggestion[] {
  if (!snapshot) return [];
  return snapshot.prices
    .filter(isSuggestionCandidate)
    .map(toSuggestion)
    .filter((suggestion): suggestion is MarketSuggestion => Boolean(suggestion))
    .sort((a, b) => {
      const scoreA = getSuggestionRank(a);
      const scoreB = getSuggestionRank(b);
      return scoreB - scoreA;
    })
    .slice(0, 180);
}

export function createWatchFromSuggestion(
  suggestion: MarketSuggestion,
  league: string,
  pollIntervalMs: number,
  targetBuyOverride?: number
): WatchConfig {
  const targetBuy = targetBuyOverride ?? suggestion.targetBuyDivine;
  return {
    id: `watch-suggested-${suggestion.id}-${Date.now()}`,
    label: suggestion.name,
    league,
    searchBody: buildSuggestionSearchBody(suggestion),
    threshold: {
      amount: roundPrice(targetBuy),
      currency: "divine",
    },
    mode: suggestion.liquidityScore >= 4 ? "auto" : "report",
    strategy: "unique-liquid",
    minProfitDivine: suggestion.minProfitDivine,
    pollIntervalMs: Math.max(pollIntervalMs, 20_000),
    createdAt: Date.now(),
    status: "paused",
  };
}

function isSuggestionCandidate(price: MarketPrice) {
  if (!UNIQUE_TYPES.has(price.type)) return false;
  if (!price.divineValue || price.divineValue < 2) return false;
  if ((price.listingCount || 0) < 3) return false;
  return true;
}

function toSuggestion(price: MarketPrice): MarketSuggestion | null {
  const floor = price.divineValue || 0;
  if (!floor) return null;
  const undercut = floor >= 25 ? 2 : Math.max(0.15, floor * 0.08);
  const minProfit = floor >= 50 ? 2 : floor >= 15 ? 1 : 0.5;
  const quickSell = Math.max(0, floor - undercut);
  const targetBuy = Math.floor(quickSell - minProfit);
  if (targetBuy <= 0) return null;

  const listingCount = price.listingCount || 0;
  const liquidityScore = listingCount >= 30 ? 5 : listingCount >= 15 ? 4 : listingCount >= 8 ? 3 : 2;
  const trend = price.trend7d || 0;
  const trendText = trend > 5 ? `up ${trend.toFixed(1)}%` : trend < -5 ? `down ${Math.abs(trend).toFixed(1)}%` : "stable";

  return {
    id: price.id.replace(/[^a-z0-9-]/g, "-"),
    name: price.name,
    type: price.type,
    category: price.category,
    icon: price.icon,
    marketFloorDivine: floor,
    quickSellDivine: quickSell,
    targetBuyDivine: targetBuy,
    minProfitDivine: minProfit,
    liquidityScore,
    trend7d: trend,
    reason: `${listingCount} listed, ${trendText}, target leaves ${minProfit.toFixed(1)}d minimum margin`,
  };
}

export function buildSuggestionSearchBody(suggestion: MarketSuggestion, maxPriceDivine?: number): TradeSearchBody {
  return {
    query: {
      status: { option: "securable" },
      name: suggestion.name,
      filters: {
        type_filters: { filters: { rarity: { option: "unique" } } },
        trade_filters: {
          filters: {
            price: {
              option: "divine",
              ...(maxPriceDivine !== undefined && { max: roundPrice(maxPriceDivine) }),
            },
          },
        },
      },
      stats: [{ type: "and", filters: [] }],
    },
    sort: { price: "asc" },
  };
}

function roundPrice(value: number) {
  return Math.max(0, Math.floor(value));
}

function getSuggestionRank(suggestion: MarketSuggestion) {
  const trendBonus = Math.min(Math.max(suggestion.trend7d, 0), 80) / 100;
  const unstablePenalty = suggestion.trend7d > 300 ? 0.65 : suggestion.trend7d > 150 ? 0.8 : 1;
  const valueScore = Math.sqrt(Math.max(suggestion.targetBuyDivine, 0));
  return valueScore * suggestion.liquidityScore * (1 + trendBonus) * unstablePenalty;
}
