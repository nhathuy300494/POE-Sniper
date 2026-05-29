import React, { useState, useEffect } from "react";
import { fetchStatsList, fetchItemsList, type StatEntry, type ItemCategory } from "../api/tradeClient";
import type { WatchConfig } from "../types/trade";
import { useAppState } from "../store/appStore";
import { searchItems, fetchItems } from "../api/tradeClient";
import { buildSearchBody, DEFAULT_FORM, type FilterFormState } from "../utils/buildSearchBody";

const ITEM_CATEGORIES = [
  { label: "── Weapons ──", value: "", disabled: true },
  { label: "Any Weapon",        value: "weapon" },
  { label: "One-Handed Melee",  value: "weapon.one" },
  { label: "Two-Handed Melee",  value: "weapon.two" },
  { label: "Bow",               value: "weapon.bow" },
  { label: "Claw",              value: "weapon.claw" },
  { label: "Dagger",            value: "weapon.dagger" },
  { label: "One-Handed Axe",    value: "weapon.oneaxe" },
  { label: "One-Handed Mace",   value: "weapon.onemace" },
  { label: "One-Handed Sword",  value: "weapon.onesword" },
  { label: "Sceptre",           value: "weapon.sceptre" },
  { label: "Staff",             value: "weapon.staff" },
  { label: "Two-Handed Axe",    value: "weapon.twoaxe" },
  { label: "Two-Handed Mace",   value: "weapon.twomace" },
  { label: "Two-Handed Sword",  value: "weapon.twosword" },
  { label: "Wand",              value: "weapon.wand" },
  { label: "Quarterstaff",      value: "weapon.quarterstaff" },
  { label: "Spear",             value: "weapon.spear" },
  { label: "Crossbow",          value: "weapon.crossbow" },
  { label: "── Armour ──", value: "", disabled: true },
  { label: "Any Armour",        value: "armour" },
  { label: "Body Armour",       value: "armour.chest" },
  { label: "Boots",             value: "armour.boots" },
  { label: "Gloves",            value: "armour.gloves" },
  { label: "Helmet",            value: "armour.helmet" },
  { label: "Shield",            value: "armour.shield" },
  { label: "Quiver",            value: "armour.quiver" },
  { label: "── Accessories ──", value: "", disabled: true },
  { label: "Any Accessory",     value: "accessory" },
  { label: "Amulet",            value: "accessory.amulet" },
  { label: "Belt",              value: "accessory.belt" },
  { label: "Ring",              value: "accessory.ring" },
  { label: "── Other ──", value: "", disabled: true },
  { label: "Any Gem",           value: "gem" },
  { label: "Skill Gem",         value: "gem.active" },
  { label: "Support Gem",       value: "gem.support" },
  { label: "Jewel",             value: "jewel" },
  { label: "Flask",             value: "flask" },
  { label: "Waystone / Map",    value: "map" },
  { label: "Logbook",           value: "logbook" },
  { label: "Sanctum",           value: "sanctum" },
  { label: "Currency",          value: "currency" },
];

export function FilterBuilder() {
  const { state: appState, addWatch } = useAppState();
  const [form, setForm] = useState<FilterFormState>(DEFAULT_FORM);
  const [statSearch, setStatSearch] = useState("");
  const [statOptions, setStatOptions] = useState<StatEntry[]>([]);
  const [allStats, setAllStats] = useState<StatEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addWatchError, setAddWatchError] = useState("");

  useEffect(() => {
    let cached: StatEntry[] | null = null;
    try { const raw = sessionStorage.getItem("poe2:stats"); if (raw) cached = JSON.parse(raw); } catch {}
    if (cached) {
      setAllStats(cached);
    } else {
      fetchStatsList().then(stats => {
        setAllStats(stats);
        try { sessionStorage.setItem("poe2:stats", JSON.stringify(stats)); } catch {}
      }).catch(console.error);
    }
  }, []);

  useEffect(() => {
    if (statSearch.length < 2) { setStatOptions([]); return; }
    const q = statSearch.toLowerCase();
    setStatOptions(allStats.filter(s => s.text.toLowerCase().includes(q)).slice(0, 12));
  }, [statSearch, allStats]);

  const set = (key: keyof FilterFormState, value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  const addStat = (stat: StatEntry) => {
    if (form.statFilters.find(f => f.id === stat.id)) return;
    setForm(f => ({
      ...f,
      statFilters: [...f.statFilters, { id: stat.id, displayText: stat.text, minStr: "", maxStr: "", disabled: false }],
    }));
    setStatSearch(""); setStatOptions([]);
  };

  const updateStat = (id: string, key: "minStr" | "maxStr", val: string) =>
    setForm(f => ({ ...f, statFilters: f.statFilters.map(s => s.id === id ? { ...s, [key]: val } : s) }));

  const removeStat = (id: string) =>
    setForm(f => ({ ...f, statFilters: f.statFilters.filter(s => s.id !== id) }));

  const handleSearch = async () => {
    if (!appState.settings.poesessid) { setSearchError("Set your POESESSID in Settings first."); return; }
    setIsSearching(true); setSearchError("");
    try {
      const body = buildSearchBody(form);
      const res = await searchItems(appState.settings.league, body, appState.settings.poesessid);
      const listings = res.result.length > 0
        ? await fetchItems(res.result.slice(0, 10), res.id, appState.settings.poesessid)
        : [];
      window.dispatchEvent(new CustomEvent("poe2:searchResult", {
        detail: { listings, total: res.total, searchId: res.id, searchBody: body },
      }));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally { setIsSearching(false); }
  };

  const handleAddWatch = () => {
    setAddWatchError("");
    const label = form.watchLabel.trim() || form.name || form.itemCategory || "Unnamed Watch";
    const amount = parseFloat(form.thresholdAmount);
    if (isNaN(amount) || amount <= 0) { setAddWatchError("Enter a valid threshold price."); return; }
    const config: WatchConfig = {
      id: `watch-${Date.now()}`, label,
      league: appState.settings.league,
      searchBody: buildSearchBody(form),
      threshold: { amount, currency: form.thresholdCurrency as any },
      createdAt: Date.now(), status: "active",
    };
    const result = addWatch(config);
    if (!result.ok) setAddWatchError(result.error ?? "Could not add watch.");
    else setForm(f => ({ ...f, watchLabel: "", thresholdAmount: "" }));
  };

  return (
    <div className="panel" style={{ borderRight: "1px solid var(--border-dim)" }}>
      <div className="panel-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: 14, height: 14 }}>
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filter
      </div>

      {/* ── Basic ── */}
      <div className="field-group">
        <label className="field-label">Item Name</label>
        <input className="field-input" placeholder="e.g. Headhunter, Mageblood…"
          value={form.name} onChange={e => set("name", e.target.value)} />
      </div>
      <div className="field-group">
        <label className="field-label">Base Type</label>
        <input className="field-input" placeholder="e.g. Demon Mace, Silk Slippers…"
          value={form.baseType} onChange={e => set("baseType", e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Category</label>
          <select className="field-select" value={form.itemCategory} onChange={e => set("itemCategory", e.target.value)}>
            <option value="">Any</option>
            {ITEM_CATEGORIES.map((o, i) => (
              <option key={i} value={o.value} disabled={o.disabled}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Rarity</label>
          <select className="field-select" value={form.itemRarity} onChange={e => set("itemRarity", e.target.value)}>
            <option value="any">Any</option>
            <option value="normal">Normal</option>
            <option value="magic">Magic</option>
            <option value="rare">Rare</option>
            <option value="unique">Unique</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">iLvl Min</label>
          <input className="field-input" type="number" value={form.iLvlMin} onChange={e => set("iLvlMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">iLvl Max</label>
          <input className="field-input" type="number" value={form.iLvlMax} onChange={e => set("iLvlMax", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">Quality Min</label>
          <input className="field-input" type="number" value={form.qualityMin} onChange={e => set("qualityMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Sockets Min</label>
          <input className="field-input" type="number" value={form.socketsMin} onChange={e => set("socketsMin", e.target.value)} /></div>
      </div>

      {/* ── Weapon ── */}
      <div className="section-sep">Weapon</div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">DPS Min</label>
          <input className="field-input" type="number" value={form.dpsMin} onChange={e => set("dpsMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">DPS Max</label>
          <input className="field-input" type="number" value={form.dpsMax} onChange={e => set("dpsMax", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">pDPS Min</label>
          <input className="field-input" type="number" value={form.pdpsMin} onChange={e => set("pdpsMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">eDPS Min</label>
          <input className="field-input" type="number" value={form.edpsMin} onChange={e => set("edpsMin", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">APS Min</label>
          <input className="field-input" type="number" value={form.apsMin} onChange={e => set("apsMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Crit Min</label>
          <input className="field-input" type="number" value={form.critMin} onChange={e => set("critMin", e.target.value)} /></div>
      </div>

      {/* ── Armour ── */}
      <div className="section-sep">Armour</div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">Armour Min</label>
          <input className="field-input" type="number" value={form.armourMin} onChange={e => set("armourMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Evasion Min</label>
          <input className="field-input" type="number" value={form.evasionMin} onChange={e => set("evasionMin", e.target.value)} /></div>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">ES Min</label>
          <input className="field-input" type="number" value={form.esMin} onChange={e => set("esMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Spirit Min</label>
          <input className="field-input" type="number" value={form.spiritMin} onChange={e => set("spiritMin", e.target.value)} /></div>
      </div>

      {/* ── Misc ── */}
      <div className="section-sep">Misc</div>
      <div className="field-row">
        <div className="field-group">
          <label className="field-label">Corrupted</label>
          <select className="field-select" value={form.corrupted} onChange={e => set("corrupted", e.target.value as any)}>
            <option value="any">Any</option><option value="true">Yes</option><option value="false">No</option>
          </select>
        </div>
        <div className="field-group">
          <label className="field-label">Identified</label>
          <select className="field-select" value={form.identified} onChange={e => set("identified", e.target.value as any)}>
            <option value="any">Any</option><option value="true">Yes</option><option value="false">No</option>
          </select>
        </div>
      </div>

      {/* ── Trade ── */}
      <div className="section-sep">Trade</div>
      <div className="field-group">
        <label className="field-label">Listing Type</label>
        <select className="field-select" value={form.saleType} onChange={e => set("saleType", e.target.value as any)}>
          <option value="any">Any</option>
          <option value="instant">⚡ Instant Buyout (Merchant Tab)</option>
          <option value="priced">Priced (Whisper Required)</option>
        </select>
      </div>
      <div className="field-row">
        <div className="field-group"><label className="field-label">Price Min</label>
          <input className="field-input" type="number" value={form.priceMin} onChange={e => set("priceMin", e.target.value)} /></div>
        <div className="field-group"><label className="field-label">Price Max</label>
          <input className="field-input" type="number" value={form.priceMax} onChange={e => set("priceMax", e.target.value)} /></div>
      </div>
      <div className="field-group">
        <label className="field-label">Currency</label>
        <select className="field-select" value={form.priceCurrency} onChange={e => set("priceCurrency", e.target.value)}>
          <option value="divine">Divine Orb</option>
          <option value="exalted">Exalted Orb</option>
          <option value="chaos">Chaos Orb</option>
          <option value="gold">Gold</option>
          <option value="regal-orb">Regal Orb</option>
        </select>
      </div>

      {/* ── Stat Filters ── */}
      <div className="section-sep">Modifiers</div>
      <div className="field-group" style={{ position: "relative" }}>
        <label className="field-label">Add Modifier</label>
        <input className="field-input" placeholder="Search modifiers…"
          value={statSearch} onChange={e => setStatSearch(e.target.value)} autoComplete="off" />
        {statOptions.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
            background: "var(--bg-raised)", border: "1px solid var(--border-glow)",
            borderRadius: "0 0 var(--radius-md) var(--radius-md)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)", maxHeight: 220, overflowY: "auto",
          }}>
            {statOptions.map(s => (
              <div key={s.id} onClick={() => addStat(s)}
                style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12,
                  color: "var(--text-primary)", borderBottom: "1px solid var(--border-dim)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={e => (e.currentTarget.style.background = "")}>
                <span style={{ color: "var(--text-dim)", fontSize: 10, marginRight: 6,
                  textTransform: "uppercase", fontFamily: "Cinzel, serif" }}>{s.type}</span>
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
          <button className="stat-row-del" onClick={() => removeStat(sf.id)}>×</button>
        </div>
      ))}

      {/* ── Search ── */}
      {searchError && <div style={{ color: "var(--price-alert)", fontSize: 12, marginBottom: 8 }}>{searchError}</div>}
      <button className="btn btn-primary btn-full" onClick={handleSearch} disabled={isSearching}
        style={{ marginTop: 8, marginBottom: 14 }}>
        {isSearching ? <span className="spinner" /> : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        )}
        {isSearching ? "Searching…" : "Search"}
      </button>

      {/* ── Watch ── */}
      <div className="section-sep">Snipe Watch</div>
      <div className="field-group">
        <label className="field-label">Watch Label</label>
        <input className="field-input" placeholder="e.g. Mageblood &lt;70 divine"
          value={form.watchLabel} onChange={e => set("watchLabel", e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div className="field-group" style={{ flex: 1 }}>
          <label className="field-label">Alert if price ≤</label>
          <input className="field-input" type="number" min={0} placeholder="70"
            value={form.thresholdAmount} onChange={e => set("thresholdAmount", e.target.value)} />
        </div>
        <div className="field-group" style={{ flex: 1 }}>
          <label className="field-label">Currency</label>
          <select className="field-select" value={form.thresholdCurrency} onChange={e => set("thresholdCurrency", e.target.value)}>
            <option value="divine">Divine</option>
            <option value="exalted">Exalted</option>
            <option value="chaos">Chaos</option>
            <option value="gold">Gold</option>
          </select>
        </div>
      </div>
      {addWatchError && <div style={{ color: "var(--price-alert)", fontSize: 12, marginBottom: 8 }}>{addWatchError}</div>}
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
