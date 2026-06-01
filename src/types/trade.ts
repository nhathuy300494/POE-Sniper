// ─── POE2 Trade API Types ────────────────────────────────────────────────────

export interface TradeSearchBody {
  query: TradeQuery;
  sort?: { price: "asc" | "desc" };
}

export interface TradeQuery {
  status?: { option: "online" | "onlineleague" | "any" | "available" | "securable" };
  name?: string;          // unique item name
  type?: string;          // base type
  filters?: TradeFilters;
  stats?: StatGroup[];
}

export interface TradeFilters {
  type_filters?: { filters: { category?: { option: string }; rarity?: { option: string } } };
  equipment_filters?: {
    filters: {
      quality?: MinMax;
      ilvl?: MinMax;
      dps?: MinMax;
      pdps?: MinMax;
      edps?: MinMax;
      aps?: MinMax;
      crit?: MinMax;
      ar?: MinMax;
      ev?: MinMax;
      es?: MinMax;
      block?: MinMax;
      spirit?: MinMax;
    };
  };
  trade_filters?: {
    filters: {
      price?: { min?: number; max?: number; option?: string }; // option = currency type
      indexed?: { option: string };
    };
  };
  socket_filters?: { filters: { sockets?: MinMax; links?: MinMax } };
  armour_filters?: { filters: { ar?: MinMax; ev?: MinMax; es?: MinMax } };
  weapon_filters?: { filters: { pdps?: MinMax; crit?: MinMax; aps?: MinMax; dps?: MinMax } };
  misc_filters?: { filters: { corrupted?: { option: boolean }; ilvl?: MinMax } };
}

// ─── Market / automation types ───────────────────────────────────────────────

export type StrategyType =
  | "unique-liquid"
  | "rare-weapon"
  | "defensive-gear"
  | "currency-bulk"
  | "mixed";

export type ConfidenceLabel = "High" | "Medium" | "Low";

export interface MarketPrice {
  id: string;
  name: string;
  type: string;
  category?: string;
  detailsId?: string;
  icon?: string;
  primaryValue?: number;
  divineValue?: number;
  chaosValue?: number;
  exaltedValue?: number;
  volumePerHour?: number;
  listingCount?: number;
  trend7d?: number;
  updatedAt: number;
  source: "poe.ninja";
}

export interface MarketSnapshot {
  league: string;
  fetchedAt: number;
  prices: MarketPrice[];
  rates: Record<string, number>;
  error?: string;
}

export interface DealScore {
  estimatedResaleFloor: number;
  quickSellPrice: number;
  grossMargin: number;
  marginAfterUndercut: number;
  confidence: ConfidenceLabel;
  liquidity: ConfidenceLabel;
  buyPriceDivine: number;
  source: "live-floor" | "poe.ninja" | "hybrid" | "insufficient-data";
  reason: string;
}

export interface Opportunity {
  id: string;
  watchId: string;
  listingId: string;
  fingerprint: string;
  itemName: string;
  baseType: string;
  icon: string;
  seller: string;
  listing: ListingResult;
  strategy: StrategyType;
  score: DealScore;
  status: "open" | "bought" | "skipped" | "sold" | "failed";
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
  suggestedListPrice: number;
  actualSellPrice?: number;
  closedAt?: number;
}

export interface TradeLedgerEntry {
  id: string;
  opportunityId: string;
  itemName: string;
  strategy: StrategyType;
  buyPriceDivine: number;
  suggestedListPrice: number;
  actualSellPrice?: number;
  status: "bought" | "sold" | "failed";
  boughtAt: number;
  closedAt?: number;
  profitDivine?: number;
}

export interface StatGroup {
  type: "and" | "or" | "count" | "weight" | "not";
  filters: StatFilter[];
  value?: MinMax; // for "count" type: min matches needed
}

export interface StatFilter {
  id: string;   // e.g. "explicit.stat_3299347043"
  value?: MinMax;
  disabled?: boolean;
}

export interface MinMax {
  min?: number;
  max?: number;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface SearchResponse {
  id: string;           // search_id used for fetch & URL
  complexity: number;
  total: number;
  result: string[];     // array of item hashes (up to 100)
}

export interface FetchResponse {
  result: ListingResult[];
}

export interface ListingResult {
  id: string;
  listing: {
    method: "psapi" | "merchant";  // merchant = instant buyout
    indexed: string;               // ISO8601
    stash?: { name: string; x: number; y: number };
    whisper: string;               // legacy whisper text
    whisper_token?: string;        // token used for /api/trade2/whisper POST
    hideout_token?: string;        // alternative token for travel
    account: {
      name: string;
      lastCharacterName: string;
      online?: { league: string; status?: string };
      language: string;
    };
    price: {
      type: "~price" | "~b/o";
      amount: number;
      currency: string;            // "divine", "chaos", "exalted", etc.
    };
  };
  item: PoeItem;
}

export interface PoeItem {
  verified: boolean;
  w: number; h: number;
  icon: string;
  league?: string;
  id?: string;
  name: string;
  typeLine: string;
  baseType: string;
  rarity?: string;
  identified: boolean;
  ilvl: number;
  corrupted?: boolean;
  implicitMods?: string[];
  explicitMods?: string[];
  craftedMods?: string[];
  fracturedMods?: string[];
  properties?: Array<{ name: string; values: [string, number][] }>;
  extended?: {
    dps?: number; pdps?: number; edps?: number;
    ar?: number; ev?: number; es?: number; ward?: number;
  };
}

// ─── App-level types ──────────────────────────────────────────────────────────

export type CurrencyType =
  | "divine" | "exalted" | "chaos" | "gold"
  | "orb-of-augmentation" | "orb-of-alteration"
  | "orb-of-annulment" | "regal-orb" | "vaal-orb";

export interface WatchConfig {
  id: string;
  label: string;
  league: string;
  searchBody: TradeSearchBody;
  threshold: {
    amount: number;
    currency: string;
  };
  mode: "auto" | "report";
  strategy?: StrategyType;
  minProfitDivine?: number;
  pollIntervalMs: number;
  createdAt: number;
  lastChecked?: number;
  lastResult?: ListingResult[];
  lastHit?: ListingResult;
  status: "active" | "paused" | "triggered";
}

export interface AppSettings {
  poesessid: string;
  league: string;
  pollIntervalMs: number;   // default 10000 (10s)
  maxWatches: number;       // default 3
  automationMode: "auto" | "report"; // default global mode
}

export interface StatMeta {
  id: string;
  text: string;
  type: "explicit" | "implicit" | "fractured" | "crafted" | "pseudo";
}
