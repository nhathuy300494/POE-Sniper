/**
 * Builds a valid POE2 Trade API search payload.
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
  socketsMin: string; priceMin: string; priceMax: string;
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
  reqLvlMin: "", reqLvlMax: "", reqStrMin: "", reqStrMax: "",
  reqDexMin: "", reqDexMax: "", reqIntMin: "", reqIntMax: "",
  corrupted: "any", identified: "any", mirrored: "any",
  socketsMin: "", priceMin: "", priceMax: "", priceCurrency: "divine",
  saleType: "instant", indexed: "any",
  statFilters: [], watchLabel: "", thresholdAmount: "", thresholdCurrency: "divine",
};

const pf = (s: string) => { const n = parseFloat(s); return isNaN(n) ? undefined : n; };
const pi = (s: string) => { const n = parseInt(s); return isNaN(n) ? undefined : n; };

const mm = (min?: number, max?: number) =>
  (min !== undefined || max !== undefined) ? { ...(min !== undefined && { min }), ...(max !== undefined && { max }) } : null;

export function buildSearchBody(form: FilterFormState): TradeSearchBody {
  // POE2: "instant" is a top-level status option, NOT a sale_type.
  const query: any = {
    status: { option: form.saleType === "instant" ? "instant" : "online" },
  };

  if (form.name) query.name = form.name;
  if (form.baseType) query.type = form.baseType;

  const filters: Record<string, any> = {};

  // type_filters
  const tf: Record<string, any> = {};
  if (form.itemCategory) tf.category = { option: form.itemCategory };
  if (form.itemRarity !== "any") tf.rarity = { option: form.itemRarity };
  if (Object.keys(tf).length) filters.type_filters = { filters: tf };

  // misc_filters
  const mf: Record<string, any> = {};
  const ilvl = mm(pi(form.iLvlMin), pi(form.iLvlMax));
  const qual = mm(pi(form.qualityMin), pi(form.qualityMax));
  if (ilvl) mf.ilvl = ilvl;
  if (qual) mf.quality = qual;
  if (form.corrupted !== "any") mf.corrupted = { option: form.corrupted === "true" };
  if (form.identified !== "any") mf.identified = { option: form.identified === "true" };
  if (form.mirrored !== "any") mf.mirrored = { option: form.mirrored === "true" };
  if (Object.keys(mf).length) filters.misc_filters = { filters: mf };

  // weapon_filters
  const wf: Record<string, any> = {};
  const dps  = mm(pf(form.dpsMin),  pf(form.dpsMax));
  const pdps = mm(pf(form.pdpsMin), pf(form.pdpsMax));
  const edps = mm(pf(form.edpsMin), pf(form.edpsMax));
  const aps  = mm(pf(form.apsMin),  pf(form.apsMax));
  const crit = mm(pf(form.critMin), pf(form.critMax));
  if (dps)  wf.dps  = dps;
  if (pdps) wf.pdps = pdps;
  if (edps) wf.edps = edps;
  if (aps)  wf.aps  = aps;
  if (crit) wf.crit = crit;
  if (Object.keys(wf).length) filters.weapon_filters = { filters: wf };

  // armour_filters
  const arf: Record<string, any> = {};
  const ar     = mm(pf(form.armourMin),  pf(form.armourMax));
  const ev     = mm(pf(form.evasionMin), pf(form.evasionMax));
  const es     = mm(pf(form.esMin),      pf(form.esMax));
  const block  = mm(pf(form.blockMin),   pf(form.blockMax));
  const spirit = mm(pf(form.spiritMin),  pf(form.spiritMax));
  if (ar)     arf.ar     = ar;
  if (ev)     arf.ev     = ev;
  if (es)     arf.es     = es;
  if (block)  arf.block  = block;
  if (spirit) arf.spirit = spirit;
  if (Object.keys(arf).length) filters.armour_filters = { filters: arf };

  // req_filters
  const rf: Record<string, any> = {};
  const reqLvl = mm(pi(form.reqLvlMin), pi(form.reqLvlMax));
  const reqStr = mm(pi(form.reqStrMin), pi(form.reqStrMax));
  const reqDex = mm(pi(form.reqDexMin), pi(form.reqDexMax));
  const reqInt = mm(pi(form.reqIntMin), pi(form.reqIntMax));
  if (reqLvl) rf.lvl = reqLvl;
  if (reqStr) rf.str = reqStr;
  if (reqDex) rf.dex = reqDex;
  if (reqInt) rf.int = reqInt;
  if (Object.keys(rf).length) filters.req_filters = { filters: rf };

  // trade_filters
  const trf: Record<string, any> = {};
  const pMin = pf(form.priceMin);
  const pMax = pf(form.priceMax);
  if (pMin !== undefined || pMax !== undefined) {
    trf.price = {
      option: form.priceCurrency || "divine",
      ...(pMin !== undefined && { min: pMin }),
      ...(pMax !== undefined && { max: pMax }),
    };
  }
  // Valid sale_type in POE2: "any", "priced", "unpriced"
  if (form.saleType === "priced" || form.saleType === "instant") {
    trf.sale_type = { option: "priced" };
  }
  if (form.indexed !== "any") trf.indexed = { option: form.indexed };
  if (Object.keys(trf).length) filters.trade_filters = { filters: trf };

  if (Object.keys(filters).length) query.filters = filters;

  // stats
  if (form.statFilters.length > 0) {
    query.stats = [{
      type: "and",
      filters: form.statFilters.map(s => ({
        id: s.id,
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
