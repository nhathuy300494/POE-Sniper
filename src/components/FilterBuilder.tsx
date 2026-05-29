import React, { useState, useEffect, useCallback } from "react";
import { fetchStatsList, fetchItemsList, type StatEntry, type ItemCategory } from "../api/tradeClient";
import type { TradeSearchBody, StatFilter, WatchConfig } from "../types/trade";
import { useAppState } from "../store/appStore";
import { searchItems, fetchItems } from "../api/tradeClient";

// ─── Local state for the builder ─────────────────────────────────────────────

interface BuilderState {
  name: string;
  itemCategory: string;
  itemRarity: string;
  iLvlMin: string;
  iLvlMax: string;
  qualityMin: string;
  qualityMax: string;
  // Equipment
  dpsMin: string; dpsMax: string;
  pdpsMin: string; pdpsMax: string;
  edpsMin: string; edpsMax: string;
  apsMin: string; apsMax: string;
  critMin: string; critMax: string;
  armourMin: string; armourMax: string;
  evasionMin: string; evasionMax: string;
  esMin: string; esMax: string;
  // Trade
  priceMin: string;
  priceMax: string;
  priceCurrency: string;
  saleType: "any" | "instant" | "priced";
  statFilters: ActiveStatFilter[];
  watchLabel: string;
  thresholdAmount: string;
  thresholdCurrency: string;
}

interface ActiveStatFilter extends StatFilter {
  displayText: string;
  minStr: string;
  maxStr: string;
}

const DEFAULT_STATE: BuilderState = {
  name: "",
  itemCategory: "",
  itemRarity: "any",
  iLvlMin: "",
  iLvlMax: "",
  qualityMin: "",
  qualityMax: "",
  dpsMin: "", dpsMax: "",
  pdpsMin: "", pdpsMax: "",
  edpsMin: "", edpsMax: "",
  apsMin: "", apsMax: "",
  critMin: "", critMax: "",
  armourMin: "", armourMax: "",
  evasionMin: "", evasionMax: "",
  esMin: "", esMax: "",
  priceMin: "",
  priceMax: "",
  priceCurrency: "divine",
  saleType: "instant",
  statFilters: [],
  watchLabel: "",
  thresholdAmount: "",
  thresholdCurrency: "divine",
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
    const body: TradeSearchBody = {
      query: {
        status: { option: "any" },
        filters: {},
        stats: [],
      },
      sort: { price: "asc" },
    };

    if (form.name) body.query.name = form.name;

    // Type / rarity
    const ilvlMin = parseInt(form.iLvlMin);
    const ilvlMax = parseInt(form.iLvlMax);
    const qualMin = parseInt(form.qualityMin);
    const qualMax = parseInt(form.qualityMax);

    body.query.filters!.type_filters = {
      filters: {
        ...(form.itemCategory && { category: { option: form.itemCategory } }),
        ...(form.itemRarity !== "any" && { rarity: { option: form.itemRarity } }),
      },
    };

    if (!isNaN(ilvlMin) || !isNaN(ilvlMax) || !isNaN(qualMin) || !isNaN(qualMax)) {
      body.query.filters!.misc_filters = {
        filters: {
          ...((!isNaN(ilvlMin) || !isNaN(ilvlMax)) && { ilvl: { min: ilvlMin || undefined, max: ilvlMax || undefined } }),
          ...((!isNaN(qualMin) || !isNaN(qualMax)) && { quality: { min: qualMin || undefined, max: qualMax || undefined } }),
        },
      };
    }

    // Equipment filters
    const e = {
      dps: { min: parseFloat(form.dpsMin), max: parseFloat(form.dpsMax) },
      pdps: { min: parseFloat(form.pdpsMin), max: parseFloat(form.pdpsMax) },
      edps: { min: parseFloat(form.edpsMin), max: parseFloat(form.edpsMax) },
      aps: { min: parseFloat(form.apsMin), max: parseFloat(form.apsMax) },
      crit: { min: parseFloat(form.critMin), max: parseFloat(form.critMax) },
      ar: { min: parseFloat(form.armourMin), max: parseFloat(form.armourMax) },
      ev: { min: parseFloat(form.evasionMin), max: parseFloat(form.evasionMax) },
      es: { min: parseFloat(form.esMin), max: parseFloat(form.esMax) },
    };

    const hasEquip = Object.values(e).some(v => !isNaN(v.min!) || !isNaN(v.max!));
    if (hasEquip) {
      body.query.filters!.weapon_filters = { filters: {} };
      body.query.filters!.armour_filters = { filters: {} };
      
      if (!isNaN(e.dps.min!) || !isNaN(e.dps.max!)) body.query.filters!.weapon_filters!.filters.dps = { min: e.dps.min || undefined, max: e.dps.max || undefined };
      if (!isNaN(e.pdps.min!) || !isNaN(e.pdps.max!)) body.query.filters!.weapon_filters!.filters.pdps = { min: e.pdps.min || undefined, max: e.pdps.max || undefined };
      if (!isNaN(e.edps.min!) || !isNaN(e.edps.max!)) body.query.filters!.weapon_filters!.filters.edps = { min: e.edps.min || undefined, max: e.edps.max || undefined };
      if (!isNaN(e.aps.min!) || !isNaN(e.aps.max!)) body.query.filters!.weapon_filters!.filters.aps = { min: e.aps.min || undefined, max: e.aps.max || undefined };
      if (!isNaN(e.crit.min!) || !isNaN(e.crit.max!)) body.query.filters!.weapon_filters!.filters.crit = { min: e.crit.min || undefined, max: e.crit.max || undefined };
      
      if (!isNaN(e.ar.min!) || !isNaN(e.ar.max!)) body.query.filters!.armour_filters!.filters.ar = { min: e.ar.min || undefined, max: e.ar.max || undefined };
      if (!isNaN(e.ev.min!) || !isNaN(e.ev.max!)) body.query.filters!.armour_filters!.filters.ev = { min: e.ev.min || undefined, max: e.ev.max || undefined };
      if (!isNaN(e.es.min!) || !isNaN(e.es.max!)) body.query.filters!.armour_filters!.filters.es = { min: e.es.min || undefined, max: e.es.max || undefined };
    }

    // Price
    const priceMin = parseFloat(form.priceMin);
    const priceMax = parseFloat(form.priceMax);
    if (!isNaN(priceMin) || !isNaN(priceMax) || form.saleType !== "any") {
      body.query.filters!.trade_filters = {
        filters: {
          price: {
            ...(form.priceCurrency && { option: form.priceCurrency }),
            ...(!isNaN(priceMin) && { min: priceMin }),
            ...(!isNaN(priceMax) && { max: priceMax }),
          },
          ...(form.saleType !== "any" && {
            sale_type: { option: form.saleType === "instant" ? "instant" : "priced" },
          }),
        },
      };
    }

    // Stat filters
    if (form.statFilters.length > 0) {
      body.query.stats = [{
        type: "and",
        filters: form.statFilters.map(s => ({
          id: s.id,
          disabled: false,
          value: {
            ...(!isNaN(parseFloat(s.minStr)) && { min: parseFloat(s.minStr) }),
            ...(!isNaN(parseFloat(s.maxStr)) && { max: parseFloat(s.maxStr) }),
          },
        })),
      }];
    }

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

      {/* Item Name */}
      <div className="field-group">
        <label className="field-label">Item Name</label>
        <input
          className="field-input"
          placeholder="e.g. Headhunter, Mageblood…"
          value={form.name}
          onChange={e => set("name", e.target.value)}
        />
      </div>

      {/* Category + Rarity */}
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Category</label>
          <select className="field-select" value={form.itemCategory} onChange={e => set("itemCategory", e.target.value)}>
            <option value="">Any</option>
            {categoryOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Rarity</label>
          <select className="field-select" value={form.itemRarity} onChange={e => set("itemRarity", e.target.value)}>
            {["any","normal","magic","rare","unique"].map(r => (
              <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Sale type */}
      <div className="field-group">
        <label className="field-label">Listing Type</label>
        <select className="field-select" value={form.saleType} onChange={e => set("saleType", e.target.value as any)}>
          <option value="any">Any</option>
          <option value="instant">Instant Buyout (Merchant Tab) ⚡</option>
          <option value="priced">Priced (Whisper)</option>
        </select>
      </div>

      {/* Price range */}
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Price Min</label>
          <input className="field-input" type="number" min={0} placeholder="0"
            value={form.priceMin} onChange={e => set("priceMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Price Max</label>
          <input className="field-input" type="number" min={0} placeholder="∞"
            value={form.priceMax} onChange={e => set("priceMax", e.target.value)} />
        </div>
      </div>

      <div className="field-group">
        <label className="field-label">Currency</label>
        <select className="field-select" value={form.priceCurrency} onChange={e => set("priceCurrency", e.target.value)}>
          <option value="divine">Divine Orb</option>
          <option value="exalted">Exalted Orb</option>
          <option value="chaos">Chaos Orb</option>
          <option value="gold">Gold</option>
          <option value="regal-orb">Regal Orb</option>
          <option value="orb-of-alteration">Orb of Alteration</option>
        </select>
      </div>

      {/* Item level & Quality */}
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">iLvl Min</label>
          <input className="field-input" type="number" placeholder="1"
            value={form.iLvlMin} onChange={e => set("iLvlMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">iLvl Max</label>
          <input className="field-input" type="number" placeholder="100"
            value={form.iLvlMax} onChange={e => set("iLvlMax", e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Quality Min</label>
          <input className="field-input" type="number" placeholder="0"
            value={form.qualityMin} onChange={e => set("qualityMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Quality Max</label>
          <input className="field-input" type="number" placeholder="20"
            value={form.qualityMax} onChange={e => set("qualityMax", e.target.value)} />
        </div>
      </div>

      {/* Equipment Filters */}
      <div className="section-sep">Equipment Filters</div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">DPS Min</label>
          <input className="field-input" type="number" value={form.dpsMin} onChange={e => set("dpsMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">DPS Max</label>
          <input className="field-input" type="number" value={form.dpsMax} onChange={e => set("dpsMax", e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Armour Min</label>
          <input className="field-input" type="number" value={form.armourMin} onChange={e => set("armourMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">Armour Max</label>
          <input className="field-input" type="number" value={form.armourMax} onChange={e => set("armourMax", e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">ES Min</label>
          <input className="field-input" type="number" value={form.esMin} onChange={e => set("esMin", e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">ES Max</label>
          <input className="field-input" type="number" value={form.esMax} onChange={e => set("esMax", e.target.value)} />
        </div>
      </div>

      {/* Sale type */}
      <div className="section-sep">Trade Filters</div>

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
