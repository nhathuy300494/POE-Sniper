import type {
  DealScore,
  ListingResult,
  MarketSnapshot,
  StrategyType,
  WatchConfig,
} from "../types/trade";
import { getItemMetrics } from "./itemDisplay";

const HIGH_VALUE_UNDERCUT = 2;
const LOW_VALUE_UNDERCUT_RATE = 0.08;

export function scoreListing(
  listing: ListingResult,
  watch: WatchConfig,
  liveListings: ListingResult[],
  market: MarketSnapshot | null
): DealScore {
  const buyPriceDivine = convertPriceToDivine(
    listing.listing.price.amount,
    listing.listing.price.currency,
    market
  );
  const liveFloor = getLiveFloorDivine(listing, liveListings, market);
  const marketPrice = findMarketPrice(listing, market);
  const marketFloor = marketPrice?.divineValue || 0;

  const estimatedResaleFloor = pickResaleFloor(liveFloor, marketFloor);
  if (!estimatedResaleFloor || !buyPriceDivine) {
    return emptyScore(buyPriceDivine, "No reliable live or poe.ninja baseline.");
  }

  const undercut = estimatedResaleFloor >= 25
    ? HIGH_VALUE_UNDERCUT
    : Math.max(0.15, estimatedResaleFloor * LOW_VALUE_UNDERCUT_RATE);
  const quickSellPrice = Math.max(0, estimatedResaleFloor - undercut);
  const grossMargin = estimatedResaleFloor - buyPriceDivine;
  const marginAfterUndercut = quickSellPrice - buyPriceDivine;
  const liquidity = getLiquidity(marketPrice?.listingCount, marketPrice?.volumePerHour, liveListings.length);
  const confidence = getConfidence(watch.strategy || "mixed", marginAfterUndercut, estimatedResaleFloor, liquidity, Boolean(marketFloor), Boolean(liveFloor));

  return {
    estimatedResaleFloor,
    quickSellPrice,
    grossMargin,
    marginAfterUndercut,
    confidence,
    liquidity,
    buyPriceDivine,
    source: liveFloor && marketFloor ? "hybrid" : liveFloor ? "live-floor" : "poe.ninja",
    reason: buildReason(liveFloor, marketFloor, liquidity),
  };
}

export function shouldCreateOpportunity(score: DealScore, watch: WatchConfig) {
  const minProfit = watch.minProfitDivine ?? 1;
  if (score.confidence === "Low") return false;
  return score.marginAfterUndercut >= minProfit;
}

export function canAutoTravel(score: DealScore, watch: WatchConfig) {
  const minProfit = Math.max(watch.minProfitDivine ?? 1, 1);
  return watch.mode === "auto" && score.confidence === "High" && score.marginAfterUndercut >= minProfit;
}

export function listingFingerprint(listing: ListingResult) {
  const item = listing.item;
  const mods = [
    ...(item.implicitMods || []),
    ...(item.explicitMods || []),
    ...(item.craftedMods || []),
    ...(item.fracturedMods || []),
  ].join("|");
  return [
    item.name || item.typeLine,
    item.baseType || item.typeLine,
    item.rarity || "",
    getItemMetrics(item).map(metric => `${metric.label}:${metric.value}`).join("|"),
    mods,
    listing.listing.account.name,
  ].join("::").toLowerCase();
}

export function inferStrategy(listing?: ListingResult): StrategyType {
  if (!listing) return "mixed";
  const rarity = listing.item.rarity?.toLowerCase();
  if (rarity === "unique") return "unique-liquid";
  const metrics = getItemMetrics(listing.item).map(metric => metric.label);
  if (metrics.includes("pDPS") || metrics.includes("Critical Hit Chance") || metrics.includes("Attacks per Second")) {
    return "rare-weapon";
  }
  if (metrics.some(label => ["Armour", "Evasion", "Energy Shield", "Ward", "Block Chance"].includes(label))) {
    return "defensive-gear";
  }
  return "mixed";
}

export function convertPriceToDivine(amount: number, currency: string, market: MarketSnapshot | null) {
  if (!amount) return 0;
  const normalized = currency.toLowerCase();
  if (normalized === "divine") return amount;
  const direct = market?.rates?.[normalized];
  if (direct) return amount * direct;
  const currencyBaseline = market?.prices.find(price =>
    price.id === normalized ||
    price.detailsId === normalized ||
    price.name.toLowerCase() === normalized.replace(/-/g, " ")
  );
  if (currencyBaseline?.divineValue) return amount * currencyBaseline.divineValue;
  return 0;
}

function getLiveFloorDivine(listing: ListingResult, liveListings: ListingResult[], market: MarketSnapshot | null) {
  const comparable = liveListings
    .filter(item => isComparable(listing, item))
    .map(item => convertPriceToDivine(item.listing.price.amount, item.listing.price.currency, market))
    .filter(value => value > 0)
    .sort((a, b) => a - b);

  if (comparable.length >= 3) return comparable[1];
  if (comparable.length > 0) return comparable[0];
  return 0;
}

function isComparable(a: ListingResult, b: ListingResult) {
  if (a.item.rarity?.toLowerCase() === "unique") {
    return (a.item.name || a.item.typeLine) === (b.item.name || b.item.typeLine);
  }
  return (a.item.baseType || a.item.typeLine) === (b.item.baseType || b.item.typeLine);
}

function findMarketPrice(listing: ListingResult, market: MarketSnapshot | null) {
  if (!market) return undefined;
  const itemName = (listing.item.name || listing.item.typeLine).toLowerCase();
  const base = listing.item.baseType.toLowerCase();
  return market.prices.find(price =>
    price.name.toLowerCase() === itemName ||
    `${price.name} ${price.category || ""}`.toLowerCase() === `${itemName} ${base}`.trim()
  );
}

function pickResaleFloor(liveFloor: number, marketFloor: number) {
  if (liveFloor && marketFloor) return Math.min(liveFloor, marketFloor * 1.08);
  return liveFloor || marketFloor || 0;
}

function getLiquidity(listingCount = 0, volumePerHour = 0, liveCount = 0) {
  if (volumePerHour >= 20 || listingCount >= 25 || liveCount >= 8) return "High";
  if (volumePerHour >= 3 || listingCount >= 5 || liveCount >= 3) return "Medium";
  return "Low";
}

function getConfidence(
  strategy: StrategyType,
  marginAfterUndercut: number,
  floor: number,
  liquidity: "High" | "Medium" | "Low",
  hasMarket: boolean,
  hasLive: boolean
) {
  const marginPct = floor ? marginAfterUndercut / floor : 0;
  if (hasLive && hasMarket && liquidity === "High" && marginAfterUndercut >= 2 && marginPct >= 0.08) return "High";
  if (strategy === "unique-liquid" && hasMarket && liquidity !== "Low" && marginAfterUndercut >= 1) return "High";
  if (hasLive && liquidity !== "Low" && marginAfterUndercut >= 1) return "Medium";
  return "Low";
}

function buildReason(liveFloor: number, marketFloor: number, liquidity: "High" | "Medium" | "Low") {
  const parts = [];
  if (liveFloor) parts.push(`live floor ${liveFloor.toFixed(1)}d`);
  if (marketFloor) parts.push(`poe.ninja ${marketFloor.toFixed(1)}d`);
  parts.push(`${liquidity.toLowerCase()} liquidity`);
  return parts.join(", ");
}

function emptyScore(buyPriceDivine: number, reason: string): DealScore {
  return {
    estimatedResaleFloor: 0,
    quickSellPrice: 0,
    grossMargin: 0,
    marginAfterUndercut: 0,
    confidence: "Low",
    liquidity: "Low",
    buyPriceDivine,
    source: "insufficient-data",
    reason,
  };
}
