import React, { useState, useEffect, useCallback } from "react";
import { fetchStatsList, fetchItemsList, type StatEntry, type ItemCategory } from "../api/tradeClient";
import type { TradeSearchBody, StatFilter, WatchConfig } from "../types/trade";
import { useAppState } from "../store/appStore";
import { searchItems, fetchItems } from "../api/tradeClient";

// ─── Constants ────────────────────────────────────────────────────────────────

const ITEM_CATEGORIES = [
  { label: "Any Weapon", value: "weapon" },
  { label: "One-Handed Melee", value: "weapon.one" },
  { label: "Two-Handed Melee", value: "weapon.two" },
  { label: "Bow", value: "weapon.bow" },
  { label: "Claw", value: "weapon.claw" },
  { label: "Dagger", value: "weapon.dagger" },
  { label: "One-Handed Axe", value: "weapon.oneaxe" },
  { label: "One-Handed Mace", value: "weapon.onemace" },
  { label: "One-Handed Sword", value: "weapon.onesword" },
  { label: "Sceptre", value: "weapon.sceptre" },
  { label: "Staff", value: "weapon.staff" },
  { label: "Two-Handed Axe", value: "weapon.twoaxe" },
  { label: "Two-Handed Mace", value: "weapon.twomace" },
  { label: "Two-Handed Sword", value: "weapon.twosword" },
  { label: "Wand", value: "weapon.wand" },
  { label: "Quarterstaff", value: "weapon.quarterstaff" },
  { label: "Spear", value: "weapon.spear" },
  { label: "Crossbow", value: "weapon.crossbow" },
  { label: "Any Armour", value: "armour" },
  { label: "Body Armour", value: "armour.chest" },
  { label: "Boots", value: "armour.boots" },
  { label: "Gloves", value: "armour.gloves" },
  { label: "Helmets", value: "armour.helmet" },
  { label: "Shields", value: "armour.shield" },
  { label: "Quivers", value: "armour.quiver" },
  { label: "Any Accessory", value: "accessory" },
  { label: "Amulets", value: "accessory.amulet" },
  { label: "Belts", value: "accessory.belt" },
  { label: "Rings", value: "accessory.ring" },
  { label: "Any Gem", value: "gem" },
  { label: "Skill Gems", value: "gem.active" },
  { label: "Support Gems", value: "gem.support" },
  { label: "Jewel", value: "jewel" },
  { label: "Flask", value: "flask" },
  { label: "Waystone / Map", value: "map" },
  { label: "Logbook", value: "logbook" },
];

// ─── Local state for the builder ─────────────────────────────────────────────

interface BuilderState {
  name: string;
  baseType: string;
  itemCategory: string;
  itemRarity: string;
  // Type Filters
  iLvlMin: string; iLvlMax: string;
  qualityMin: string; qualityMax: string;
  // Equipment - Weapon
  dpsMin: string; dpsMax: string;
  pdpsMin: string; pdpsMax: string;
  edpsMin: string; edpsMax: string;
  apsMin: string; apsMax: string;
  critMin: string; critMax: string;
  // Equipment - Armour
  armourMin: string; armourMax: string;
  evasionMin: string; evasionMax: string;
  esMin: string; esMax: string;
  blockMin: string; blockMax: string;
  spiritMin: string; spiritMax: string;
  // Requirements
  reqLvlMin: string; reqLvlMax: string;
  reqStrMin: string; reqStrMax: string;
  reqDexMin: string; reqDexMax: string;
  reqIntMin: string; reqIntMax: string;
  // Misc
  corrupted: "any" | "true" | "false";
  identified: "any" | "true" | "false";
  mirrored: "any" | "true" | "false";
  socketsMin: string; socketsMax: string;
  linksMin: string; linksMax: string;
  // Trade
  priceMin: string;
  priceMax: string;
  priceCurrency: string;
  saleType: "any" | "instant" | "priced";
  indexed: string;
  // Meta
  statFilters: ActiveStatFilter[];
  watchLabel: string;
  thresholdAmount: string;
  thresholdCurrency: string;
}

const DEFAULT_STATE: BuilderState = {
  name: "", baseType: "", itemCategory: "", itemRarity: "any",
  iLvlMin: "", iLvlMax: "", qualityMin: "", qualityMax: "",
  dpsMin: "", dpsMax: "", pdpsMin: "", pdpsMax: "", edpsMin: "", edpsMax: "",
  apsMin: "", apsMax: "", critMin: "", critMax: "",
  armourMin: "", armourMax: "", evasionMin: "", evasionMax: "", esMin: "", esMax: "",
  blockMin: "", blockMax: "", spiritMin: "", spiritMax: "",
  reqLvlMin: "", reqLvlMax: "", reqStrMin: "", reqStrMax: "", reqDexMin: "", reqDexMax: "", reqIntMin: "", reqIntMax: "",
  corrupted: "any", identified: "any", mirrored: "any",
  socketsMin: "", socketsMax: "", linksMin: "", linksMax: "",
  priceMin: "", priceMax: "", priceCurrency: "divine",
  saleType: "instant", indexed: "any",
  statFilters: [], watchLabel: "", thresholdAmount: "", thresholdCurrency: "divine",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FilterBuilder() {
  const { state: appState, addWatch } = useAppState();
  const [form, setForm] = useState<BuilderState>(DEFAULT_STATE);
  const [statSearch, setStatSearch] = useState("");
  const [statOptions, setStatOptions] = useState<StatEntry[]>([]);
  const [allStats, setAllStats] = useState<StatEntry[]>([]);
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addWatchError, setAddWatchError] = useState("");

  // Load stats list on mount (cached)
  useEffect(() => {
    let cached: StatEntry[] | null = null;
    try {
      const raw = sessionStorage.getItem("poe2:stats");
      if (raw) cached = JSON.parse(raw);
    } catch { /* ignore */ }

    if (cached) {
      setAllStats(cached);
    } else {
      fetchStatsList().then(stats => {
        setAllStats(stats);
        try { sessionStorage.setItem("poe2:stats", JSON.stringify(stats)); } catch { /* ignore */ }
      }).catch(console.error);
    }

    fetchItemsList().then(cats => setCategories(cats)).catch(console.error);
  }, []);

  // Filter stat options as user types
  useEffect(() => {
    if (statSearch.length < 2) { setStatOptions([]); return; }
    const q = statSearch.toLowerCase();
    setStatOptions(
      allStats
        .filter(s => s.text.toLowerCase().includes(q))
        .slice(0, 12)
    );
  }, [statSearch, allStats]);

  const set = (key: keyof BuilderState, value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  const addStat = (stat: StatEntry) => {
    if (form.statFilters.find(f => f.id === stat.id)) return;
    setForm(f => ({
      ...f,
      statFilters: [
        ...f.statFilters,
        { id: stat.id, displayText: stat.text, minStr: "", maxStr: "", disabled: false },
      ],
    }));
    setStatSearch("");
    setStatOptions([]);
  };

  const updateStat = (id: string, key: "minStr" | "maxStr", val: string) => {
    setForm(f => ({
      ...f,
      statFilters: f.statFilters.map(s => s.id === id ? { ...s, [key]: val } : s),
    }));
  };

  const removeStat = (id: string) => {
    setForm(f => ({ ...f, statFilters: f.statFilters.filter(s => s.id !== id) }));
  };

  // Build the search body from form state
  const buildSearchBody = useCallback((): TradeSearchBody => {
    const filters: any = {};

    // Basic Type Filters
    const type_filters: any = {};
    if (form.itemCategory) type_filters.category = { option: form.itemCategory };
    if (form.itemRarity !== "any") type_filters.rarity = { option: form.itemRarity };
    if (Object.keys(type_filters).length > 0) filters.type_filters = { filters: type_filters };

    // Misc Filters
    const misc_filters: any = {};
    const ilvlMin = parseInt(form.iLvlMin);
    const ilvlMax = parseInt(form.iLvlMax);
    const qualMin = parseInt(form.qualityMin);
    const qualMax = parseInt(form.qualityMax);
    if (!isNaN(ilvlMin) || !isNaN(ilvlMax)) misc_filters.ilvl = { min: ilvlMin || undefined, max: ilvlMax || undefined };
    if (!isNaN(qualMin) || !isNaN(qualMax)) misc_filters.quality = { min: qualMin || undefined, max: qualMax || undefined };
    if (form.corrupted !== "any") misc_filters.corrupted = { option: form.corrupted === "true" };
    if (form.identified !== "any") misc_filters.identified = { option: form.identified === "true" };
    if (form.mirrored !== "any") misc_filters.mirrored = { option: form.mirrored === "true" };
    if (Object.keys(misc_filters).length > 0) filters.misc_filters = { filters: misc_filters };

    // Weapon Filters
    const weapon_filters: any = {};
    const dps = { min: parseFloat(form.dpsMin), max: parseFloat(form.dpsMax) };
    const pdps = { min: parseFloat(form.pdpsMin), max: parseFloat(form.pdpsMax) };
    const edps = { min: parseFloat(form.edpsMin), max: parseFloat(form.edpsMax) };
    const aps = { min: parseFloat(form.apsMin), max: parseFloat(form.apsMax) };
    const crit = { min: parseFloat(form.critMin), max: parseFloat(form.critMax) };
    if (!isNaN(dps.min!) || !isNaN(dps.max!)) weapon_filters.dps = { min: dps.min || undefined, max: dps.max || undefined };
    if (!isNaN(pdps.min!) || !isNaN(pdps.max!)) weapon_filters.pdps = { min: pdps.min || undefined, max: pdps.max || undefined };
    if (!isNaN(edps.min!) || !isNaN(edps.max!)) weapon_filters.edps = { min: edps.min || undefined, max: edps.max || undefined };
    if (!isNaN(aps.min!) || !isNaN(aps.max!)) weapon_filters.aps = { min: aps.min || undefined, max: aps.max || undefined };
    if (!isNaN(crit.min!) || !isNaN(crit.max!)) weapon_filters.crit = { min: crit.min || undefined, max: crit.max || undefined };
    if (Object.keys(weapon_filters).length > 0) filters.weapon_filters = { filters: weapon_filters };

    // Armour Filters
    const armour_filters: any = {};
    const ar = { min: parseFloat(form.armourMin), max: parseFloat(form.armourMax) };
    const ev = { min: parseFloat(form.evasionMin), max: parseFloat(form.evasionMax) };
    const es = { min: parseFloat(form.esMin), max: parseFloat(form.esMax) };
    const block = { min: parseFloat(form.blockMin), max: parseFloat(form.blockMax) };
    const spirit = { min: parseFloat(form.spiritMin), max: parseFloat(form.spiritMax) };
    if (!isNaN(ar.min!) || !isNaN(ar.max!)) armour_filters.ar = { min: ar.min || undefined, max: ar.max || undefined };
    if (!isNaN(ev.min!) || !isNaN(ev.max!)) armour_filters.ev = { min: ev.min || undefined, max: ev.max || undefined };
    if (!isNaN(es.min!) || !isNaN(es.max!)) armour_filters.es = { min: es.min || undefined, max: es.max || undefined };
    if (!isNaN(block.min!) || !isNaN(block.max!)) armour_filters.block = { min: block.min || undefined, max: block.max || undefined };
    if (!isNaN(spirit.min!) || !isNaN(spirit.max!)) armour_filters.spirit = { min: spirit.min || undefined, max: spirit.max || undefined };
    if (Object.keys(armour_filters).length > 0) filters.armour_filters = { filters: armour_filters };

    // Req Filters
    const req_filters: any = {};
    const reqLvl = { min: parseInt(form.reqLvlMin), max: parseInt(form.reqLvlMax) };
    const reqStr = { min: parseInt(form.reqStrMin), max: parseInt(form.reqStrMax) };
    const reqDex = { min: parseInt(form.reqDexMin), max: parseInt(form.reqDexMax) };
    const reqInt = { min: parseInt(form.reqIntMin), max: parseInt(form.reqIntMax) };
    if (!isNaN(reqLvl.min!) || !isNaN(reqLvl.max!)) req_filters.lvl = { min: reqLvl.min || undefined, max: reqLvl.max || undefined };
    if (!isNaN(reqStr.min!) || !isNaN(reqStr.max!)) req_filters.str = { min: reqStr.min || undefined, max: reqStr.max || undefined };
    if (!isNaN(reqDex.min!) || !isNaN(reqDex.max!)) req_filters.dex = { min: reqDex.min || undefined, max: reqDex.max || undefined };
    if (!isNaN(reqInt.min!) || !isNaN(reqInt.max!)) req_filters.int = { min: reqInt.min || undefined, max: reqInt.max || undefined };
    if (Object.keys(req_filters).length > 0) filters.req_filters = { filters: req_filters };

    // Socket Filters
    const socket_filters: any = {};
    const sockets = { min: parseInt(form.socketsMin), max: parseInt(form.socketsMax) };
    if (!isNaN(sockets.min!) || !isNaN(sockets.max!)) socket_filters.sockets = { min: sockets.min || undefined, max: sockets.max || undefined };
    if (Object.keys(socket_filters).length > 0) filters.socket_filters = { filters: socket_filters };

    // Trade Filters
    const trade_filters: any = {};
    const priceMin = parseFloat(form.priceMin);
    const priceMax = parseFloat(form.priceMax);
    if (!isNaN(priceMin) || !isNaN(priceMax)) {
      trade_filters.price = {
        option: form.priceCurrency || "divine",
        min: isNaN(priceMin) ? undefined : priceMin,
        max: isNaN(priceMax) ? undefined : priceMax,
      };
    }
    if (form.saleType !== "any") trade_filters.sale_type = { option: form.saleType };
    if (form.indexed !== "any") trade_filters.indexed = { option: form.indexed };
    if (Object.keys(trade_filters).length > 0) filters.trade_filters = { filters: trade_filters };

    const body: TradeSearchBody = {
      query: {
        status: { option: "online" },
      },
      sort: { price: "asc" },
    };

    if (form.name) body.query.name = form.name;
    if (form.baseType) body.query.type = form.baseType;
    if (Object.keys(filters).length > 0) body.query.filters = filters;

    // Stats
    if (form.statFilters.length > 0) {
      body.query.stats = [{
        type: "and",
        filters: form.statFilters.map(s => ({
          id: s.id,
          value: {
            min: isNaN(parseFloat(s.minStr)) ? undefined : parseFloat(s.minStr),
            max: isNaN(parseFloat(s.maxStr)) ? undefined : parseFloat(s.maxStr),
          },
        })),
      }];
    }

    console.log("Generated Search Payload:", JSON.stringify(body, null, 2));
    return body;
  }, [form]);

  const handleSearch = async () => {
    if (!appState.settings.poesessid) {
      setSearchError("Set your POESESSID in Settings first.");
      return;
    }
    setIsSearching(true);
    setSearchError("");
    try {
      const body = buildSearchBody();
      const res = await searchItems(appState.settings.league, body, appState.settings.poesessid);
      const listings = res.result.length > 0
        ? await fetchItems(res.result.slice(0, 10), res.id, appState.settings.poesessid)
        : [];
      // Emit to results pane via a custom event (simple approach)
      window.dispatchEvent(new CustomEvent("poe2:searchResult", {
        detail: { listings, total: res.total, searchId: res.id, searchBody: body },
      }));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddWatch = () => {
    setAddWatchError("");
    const label = form.watchLabel.trim() || form.name || form.itemCategory || "Unnamed Watch";
    const amount = parseFloat(form.thresholdAmount);

    if (isNaN(amount) || amount <= 0) {
      setAddWatchError("Enter a valid threshold price.");
      return;
    }

    const config: WatchConfig = {
      id: `watch-${Date.now()}`,
      label,
      league: appState.settings.league,
      searchBody: buildSearchBody(),
      threshold: { amount, currency: form.thresholdCurrency as any },
      createdAt: Date.now(),
      status: "active",
    };

    const result = addWatch(config);
    if (!result.ok) {
      setAddWatchError(result.error ?? "Could not add watch.");
    } else {
      setForm(f => ({ ...f, watchLabel: "", thresholdAmount: "" }));
    }
  };

  // Item category flat list
  const categoryOptions = categories.flatMap(cat =>
    cat.entries.map(e => ({ label: e.name, value: e.name }))
  );

  return (
    <div className="panel" style={{ borderRight: "1px solid var(--border-dim)" }}>
      <div className="panel-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 14, height: 14 }}>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filter
      </div>

      {/* Basic Filters */}
      <div className="field-group">
        <label className="field-label">Item Name</label>
        <input className="field-input" placeholder="e.g. Headhunter…"
          value={form.name} onChange={e => set("name", e.target.value)} />
      </div>

      <div className="field-group">
        <label className="field-label">Base Type (e.g. Broadsword)</label>
        <input className="field-input" placeholder="Search base types…"
          value={form.baseType} onChange={e => set("baseType", e.target.value)} />
      </div>

      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Category</label>
          <select className="field-select" value={form.itemCategory} onChange={e => set("itemCategory", e.target.value)}>
            <option value="">Any</option>
            {ITEM_CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Rarity</label>
          <select className="field-select" value={form.itemRarity} onChange={e => set("itemRarity", e.target.value)}>
            {["any","normal","magic","rare","unique"].map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field-group">
          <label className="field-label">iLvl Min</label>
          <input className="field-input" type="number" value={form.iLvlMin} onChange={e => set("iLvlMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">iLvl Max</label>
          <input className="field-input" type="number" value={form.iLvlMax} onChange={e => set("iLvlMax", e.target.value)} />
        </div>
      </div>

      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Quality Min</label>
          <input className="field-input" type="number" value={form.qualityMin} onChange={e => set("qualityMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Quality Max</label>
          <input className="field-input" type="number" value={form.qualityMax} onChange={e => set("qualityMax", e.target.value)} />
        </div>
      </div>

      {/* Equipment Filters - Weapon */}
      <div className="section-sep">Weapon Filters</div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">DPS Min</label>
          <input className="field-input" type="number" value={form.dpsMin} onChange={e => set("dpsMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">DPS Max</label>
          <input className="field-input" type="number" value={form.dpsMax} onChange={e => set("dpsMax", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">PDPS Min</label>
          <input className="field-input" type="number" value={form.pdpsMin} onChange={e => set("pdpsMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">EDPS Min</label>
          <input className="field-input" type="number" value={form.edpsMin} onChange={e => set("edpsMin", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">APS Min</label>
          <input className="field-input" type="number" value={form.apsMin} onChange={e => set("apsMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Crit Min</label>
          <input className="field-input" type="number" value={form.critMin} onChange={e => set("critMin", e.target.value)} /></div>
      </div>

      {/* Equipment Filters - Armour */}
      <div className="section-sep">Armour Filters</div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">Armour Min</label>
          <input className="field-input" type="number" value={form.armourMin} onChange={e => set("armourMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Evasion Min</label>
          <input className="field-input" type="number" value={form.evasionMin} onChange={e => set("evasionMin", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">ES Min</label>
          <input className="field-input" type="number" value={form.esMin} onChange={e => set("esMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Block Min</label>
          <input className="field-input" type="number" value={form.blockMin} onChange={e => set("blockMin", e.target.value)} /></div>
      </div>

      {/* Requirements */}
      <div className="section-sep">Requirements</div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">Lvl Min</label>
          <input className="field-input" type="number" value={form.reqLvlMin} onChange={e => set("reqLvlMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Str Min</label>
          <input className="field-input" type="number" value={form.reqStrMin} onChange={e => set("reqStrMin", e.target.value)} /></div>
      </div>

      {/* Miscellaneous */}
      <div className="section-sep">Miscellaneous</div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Corrupted</label>
          <select className="field-select" value={form.corrupted} onChange={e => set("corrupted", e.target.value as any)}>
            <option value="any">Any</option><option value="true">Yes</option><option value="false">No</option>
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Sockets Min</label>
          <input className="field-input" type="number" value={form.socketsMin} onChange={e => set("socketsMin", e.target.value)} />
        </div>
      </div>

      {/* Trade Filters */}
      <div className="section-sep">Trade Filters</div>
      <div className="field-group">
        <label className="field-label">Listing Type</label>
        <select className="field-select" value={form.saleType} onChange={e => set("saleType", e.target.value as any)}>
          <option value="any">Any</option>
          <option value="instant">Instant Buyout ⚡</option>
          <option value="priced">Priced (Whisper)</option>
        </select>
      </div>

      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Price Min</label>
          <input className="field-input" type="number" value={form.priceMin} onChange={e => set("priceMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Price Max</label>
          <input className="field-input" type="number" value={form.priceMax} onChange={e => set("priceMax", e.target.value)} />
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Currency</label>
        <select className="field-select" value={form.priceCurrency} onChange={e => set("priceCurrency", e.target.value)}>
          <option value="divine">Divine Orb</option><option value="exalted">Exalted Orb</option>
          <option value="chaos">Chaos Orb</option><option value="gold">Gold</option>
        </select>
      </div>

      {/* Stat filters */}
      <div className="section-sep">Stat Filters</div>

      <div className="field-group" style={{ position: "relative" }}>
        <label className="field-label">Add Modifier</label>
        <input
          className="field-input"
          placeholder="Search modifiers…"
          value={statSearch}
          onChange={e => setStatSearch(e.target.value)}
          autoComplete="off"
        />
        {statOptions.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
            background: "var(--bg-raised)", border: "1px solid var(--border-glow)",
            borderRadius: "0 0 var(--radius-md) var(--radius-md)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            maxHeight: 220, overflowY: "auto",
          }}>
            {statOptions.map(s => (
              <div key={s.id}
                onClick={() => addStat(s)}
                style={{
                  padding: "7px 10px", cursor: "pointer", fontSize: 12,
                  color: "var(--text-primary)", borderBottom: "1px solid var(--border-dim)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}
              >
                <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 6,
                  textTransform: "uppercase", fontFamily: "Cinzel, serif" }}>
                  {s.type}
                </span>
                {s.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {form.statFilters.map(sf => (
        <div key={sf.id} className="stat-row">
          <span className="stat-row-name" title={sf.displayText}>{sf.displayText}</span>
          <input type="number" placeholder="min" value={sf.minStr}
            onChange={e => updateStat(sf.id, "minStr", e.target.value)} />
          <input type="number" placeholder="max" value={sf.maxStr}
            onChange={e => updateStat(sf.id, "maxStr", e.target.value)} />
          <button className="stat-row-del" onClick={() => removeStat(sf.id)} title="Remove">×</button>
        </div>
      ))}

      {/* Search button */}
      {searchError && (
        <div style={{ color: "var(--price-alert)", fontSize: 12, marginBottom: 8 }}>{searchError}</div>
      )}
      <button className="btn btn-primary btn-full" onClick={handleSearch} disabled={isSearching}
        style={{ marginTop: 8, marginBottom: 14 }}>
        {isSearching ? <span className="spinner" /> : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        )}
        {isSearching ? "Searching…" : "Search"}
      </button>

      {/* ── Watch setup ──────────────────────────────────────────────────── */}
      <div className="section-sep">Follow / Snipe</div>

      <div className="field-group">
        <label className="field-label">Watch Label</label>
        <input className="field-input" placeholder="e.g. Mageblood &lt;70div"
          value={form.watchLabel} onChange={e => set("watchLabel", e.target.value)} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div className="field-group" style={{ flex: 1 }}>
          <label className="field-label">Alert if price ≤</label>
          <input className="field-input" type="number" min={0} placeholder="e.g. 70"
            value={form.thresholdAmount} onChange={e => set("thresholdAmount", e.target.value)} />
        </div>
        <div className="field-group" style={{ flex: 1 }}>
          <label className="field-label">Currency</label>
          <select className="field-select" value={form.thresholdCurrency}
            onChange={e => set("thresholdCurrency", e.target.value)}>
            <option value="divine">Divine</option>
            <option value="exalted">Exalted</option>
            <option value="chaos">Chaos</option>
            <option value="gold">Gold</option>
          </select>
        </div>
      </div>

      {addWatchError && (
        <div style={{ color: "var(--price-alert)", fontSize: 12, marginBottom: 8 }}>{addWatchError}</div>
      )}

      <button className="btn btn-watch btn-full" onClick={handleAddWatch}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        Add to Watch List
      </button>
    </div>
  );
}
