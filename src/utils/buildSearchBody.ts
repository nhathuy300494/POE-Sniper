/**
 * Builds a valid POE2 Trade API search payload.
 *
 * KEY FIXES vs broken version:
 * 1. saleType "buyout" (not "instant") — this is what GGG uses for Merchant Tab
 * 2. status "any" (not "online") — "online" excludes offline Merchant Tab sellers
 * 3. Empty filter groups are OMITTED — GGG returns 400 for empty filter objects
 * 4. All filters wrapped in { filters: {...} } correctly
 */

import type { TradeSearchBody } from "../types/trade";

export interface ActiveStatFilter {
  id: string;
  displayText: string;
  minStr: string;
  maxStr: string;
  disabled?: boolean;
}

export interface FilterFormState {
  name: string;
  baseType: string;
  itemCategory: string;
  itemRarity: string;
  iLvlMin: string; iLvlMax: string;
  qualityMin: string; qualityMax: string;
  dpsMin: string; dpsMax: string;
  pdpsMin: string; pdpsMax: string;
  edpsMin: string; edpsMax: string;
  apsMin: string; apsMax: string;
  critMin: string; critMax: string;
  armourMin: string; armourMax: string;
  evasionMin: string; evasionMax: string;
  esMin: string; esMax: string;
  blockMin: string; blockMax: string;
  spiritMin: string; spiritMax: string;
  reqLvlMin: string; reqLvlMax: string;
  reqStrMin: string; reqStrMax: string;
  reqDexMin: string; reqDexMax: string;
  reqIntMin: string; reqIntMax: string;
  corrupted: "any" | "true" | "false";
  identified: "any" | "true" | "false";
  mirrored: "any" | "true" | "false";
  socketsMin: string; socketsMax: string;
  priceMin: string; priceMax: string;
  priceCurrency: string;
  saleType: "any" | "instant" | "priced";
  indexed: string;
  statFilters: ActiveStatFilter[];
  watchLabel: string;
  thresholdAmount: string;
  thresholdCurrency: string;
}

export const DEFAULT_FORM: FilterFormState = {
  name: "", baseType: "", itemCategory: "", itemRarity: "any",
  iLvlMin: "", iLvlMax: "", qualityMin: "", qualityMax: "",
  dpsMin: "", dpsMax: "", pdpsMin: "", pdpsMax: "", edpsMin: "", edpsMax: "",
  apsMin: "", apsMax: "", critMin: "", critMax: "",
  armourMin: "", armourMax: "", evasionMin: "", evasionMax: "", esMin: "", esMax: "",
  blockMin: "", blockMax: "", spiritMin: "", spiritMax: "",
  reqLvlMin: "", reqLvlMax: "", reqStrMin: "", reqStrMax: "", reqDexMin: "", reqDexMax: "", reqIntMin: "", reqIntMax: "",
  corrupted: "any", identified: "any", mirrored: "any",
  socketsMin: "", socketsMax: "",
  priceMin: "", priceMax: "", priceCurrency: "divine",
  saleType: "instant",
  indexed: "any",
  statFilters: [],
  watchLabel: "", thresholdAmount: "", thresholdCurrency: "divine",
};

// ... (keep pf, pi, mm)

export function buildSearchBody(form: FilterFormState): TradeSearchBody {
  const query: any = {
    status: { option: "any" },  // "any" includes offline Merchant Tab sellers
  };

  if (form.name) query.name = form.name;
  if (form.baseType) query.type = form.baseType;

  const filters: Record<string, any> = {};

  // ... (keep tf, mf, wf, arf, rf groups)

  // ── trade_filters ─────────────────────────────────────────────────────────
  const trf: Record<string, any> = {};
  const priceMin = pf(form.priceMin);
  const priceMax = pf(form.priceMax);
  if (priceMin !== undefined || priceMax !== undefined) {
    trf.price = {
      option: form.priceCurrency || "divine",
      ...(priceMin !== undefined && { min: priceMin }),
      ...(priceMax !== undefined && { max: priceMax }),
    };
  }
  // POE2 uses "instant" for Merchant Tab trades
  if (form.saleType !== "any") trf.sale_type = { option: form.saleType };
  if (form.indexed !== "any") trf.indexed = { option: form.indexed };
  if (Object.keys(trf).length) filters.trade_filters = { filters: trf };

  if (Object.keys(filters).length) query.filters = filters;

  // ── stat filters ──────────────────────────────────────────────────────────
  if (form.statFilters.length > 0) {
    query.stats = [{
      type: "and",
      filters: form.statFilters.map(s => ({
        id: s.id,
        disabled: false,
        value: {
          ...(pf(s.minStr) !== undefined && { min: pf(s.minStr)! }),
          ...(pf(s.maxStr) !== undefined && { max: pf(s.maxStr)! }),
        },
      })),
    }];
  }

  const body: TradeSearchBody = { query, sort: { price: "asc" } };
  console.log("[POE2 Sniper] Search payload:", JSON.stringify(body, null, 2));
  return body;
}

