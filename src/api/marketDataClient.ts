import type { MarketPrice, MarketSnapshot } from "../types/trade";

const MARKET_CACHE_TTL = 45 * 60_000;
const MARKET_TYPES: Array<{ endpoint: "exchange" | "stash"; type: string }> = [
  { endpoint: "exchange", type: "Currency" },
  { endpoint: "exchange", type: "Fragments" },
  { endpoint: "exchange", type: "Essences" },
  { endpoint: "exchange", type: "Runes" },
  { endpoint: "exchange", type: "Ritual" },
  { endpoint: "stash", type: "UniqueWeapons" },
  { endpoint: "stash", type: "UniqueArmours" },
  { endpoint: "stash", type: "UniqueAccessories" },
  { endpoint: "stash", type: "UniqueFlasks" },
  { endpoint: "stash", type: "UniqueCharms" },
  { endpoint: "stash", type: "UniqueJewels" },
];

function normalizeLeagueName(league: string) {
  return league.replace(/^poe2\//, "") || "Runes of Aldur";
}

export async function fetchMarketSnapshot(league: string, force = false): Promise<MarketSnapshot> {
  const leagueName = normalizeLeagueName(league);
  const cacheKey = `poe2sniper:marketSnapshots:${leagueName}`;

  if (!force) {
    const cached = readSnapshot(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < MARKET_CACHE_TTL) {
      return cached;
    }
  }

  const settled = await Promise.allSettled(MARKET_TYPES.map(meta => fetchMarketType(leagueName, meta)));
  const prices = settled.flatMap(result => result.status === "fulfilled" ? result.value.prices : []);
  const rates = settled.find((result): result is PromiseFulfilledResult<{ rates: Record<string, number>; prices: MarketPrice[] }> =>
    result.status === "fulfilled" && Object.keys(result.value.rates).length > 0
  )?.value.rates || {};

  const snapshot: MarketSnapshot = {
    league: leagueName,
    fetchedAt: Date.now(),
    prices,
    rates,
    error: prices.length === 0 ? "No market data returned from poe.ninja." : undefined,
  };
  writeSnapshot(cacheKey, snapshot);
  return snapshot;
}

async function fetchMarketType(
  league: string,
  meta: { endpoint: "exchange" | "stash"; type: string }
): Promise<{ rates: Record<string, number>; prices: MarketPrice[] }> {
  const path = meta.endpoint === "exchange"
    ? `/poeninja/poe2/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(meta.type)}`
    : `/poeninja/poe2/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(meta.type)}`;

  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`poe.ninja ${meta.type} failed: ${res.status}`);
  const data = await res.json();

  const core = data.core || {};
  const rates = normalizeRates(core);
  const now = Date.now();

  if (meta.endpoint === "exchange") {
    const itemsById = new Map((data.items || []).map((item: any) => [item.id, item]));
    const prices = (data.lines || []).map((line: any) => {
      const item: any = itemsById.get(line.id) || {};
      const primaryValue = Number(line.primaryValue || 0);
      return normalizeMarketPrice({
        id: line.id,
        name: item.name || line.id,
        type: meta.type,
        category: item.category,
        detailsId: item.detailsId,
        icon: item.image ? absolutePoeNinjaImage(item.image) : undefined,
        primaryValue,
        divineValue: convertPrimaryToDivine(primaryValue, core),
        chaosValue: convertPrimaryToCurrency(primaryValue, core, "chaos"),
        exaltedValue: convertPrimaryToCurrency(primaryValue, core, "exalted"),
        volumePerHour: Number(line.volumePrimaryValue || 0),
        trend7d: Number(line.sparkline?.totalChange || 0),
        updatedAt: now,
        source: "poe.ninja" as const,
      });
    });
    return { rates, prices };
  }

  const prices = (data.lines || []).map((line: any) => normalizeMarketPrice({
    id: String(line.itemId || line.id),
    name: line.name,
    type: meta.type,
    category: line.category,
    detailsId: line.detailsId,
    icon: line.icon ? absolutePoeNinjaImage(line.icon) : undefined,
    primaryValue: Number(line.primaryValue || 0),
    divineValue: convertPrimaryToDivine(Number(line.primaryValue || 0), core),
    chaosValue: convertPrimaryToCurrency(Number(line.primaryValue || 0), core, "chaos"),
    exaltedValue: convertPrimaryToCurrency(Number(line.primaryValue || 0), core, "exalted"),
    listingCount: Number(line.listingCount || 0),
    trend7d: Number(line.sparkLine?.totalChange || 0),
    updatedAt: now,
    source: "poe.ninja" as const,
  }));

  return { rates, prices };
}

function normalizeMarketPrice(price: MarketPrice): MarketPrice {
  return {
    ...price,
    id: price.id.toLowerCase(),
    name: price.name || price.id,
  };
}

function normalizeRates(core: { primary?: string; rates?: Record<string, number> }) {
  const normalized: Record<string, number> = { divine: 1 };
  if (core.primary) normalized[core.primary] = 1;
  for (const [currency, rate] of Object.entries(core.rates || {})) {
    normalized[currency] = Number(rate);
  }
  return normalized;
}

function convertPrimaryToDivine(primaryValue: number, core: any) {
  if (!primaryValue) return 0;
  if (core.primary === "divine") return primaryValue;
  return primaryValue * Number(core.rates?.divine || 0);
}

function convertPrimaryToCurrency(primaryValue: number, core: any, currency: string) {
  if (!primaryValue) return 0;
  if (core.primary === currency) return primaryValue;
  return primaryValue * Number(core.rates?.[currency] || 0);
}

function absolutePoeNinjaImage(src: string) {
  if (src.startsWith("http")) return src;
  return `https://poe.ninja${src}`;
}

function readSnapshot(key: string): MarketSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSnapshot(key: string, snapshot: MarketSnapshot) {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}
