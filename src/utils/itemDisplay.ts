import type { PoeItem } from "../types/trade";

export interface ItemMetric {
  label: string;
  value: string;
}

export function getItemMetrics(item: PoeItem): ItemMetric[] {
  const metrics: ItemMetric[] = [];
  const quality = getPropertyValue(item, ["Quality"]);
  const physicalDamage = getPropertyValue(item, ["Physical Damage"]);
  const elementalDamage = getPropertyValue(item, ["Elemental Damage"]);
  const crit = getPropertyValue(item, ["Critical Hit Chance"]);
  const aps = getPropertyValue(item, ["Attacks per Second"]);
  const armour = getPropertyValue(item, ["Armour"]) || formatExtended(item.extended?.ar);
  const evasion = getPropertyValue(item, ["Evasion Rating", "Evasion"]) || formatExtended(item.extended?.ev);
  const energyShield = getPropertyValue(item, ["Energy Shield"]) || formatExtended(item.extended?.es);
  const ward = getPropertyValue(item, ["Ward"]) || formatExtended((item.extended as { ward?: number } | undefined)?.ward);
  const block = getPropertyValue(item, ["Block Chance", "Chance to Block"]);
  const spirit = getPropertyValue(item, ["Spirit"]);
  const pdps = getPhysicalDps(physicalDamage, aps, item.extended?.pdps);

  if (quality) metrics.push({ label: "Quality", value: quality });
  if (physicalDamage) metrics.push({ label: "Physical Damage", value: physicalDamage });
  if (elementalDamage) metrics.push({ label: "Elemental Damage", value: elementalDamage });
  if (crit) metrics.push({ label: "Critical Hit Chance", value: crit });
  if (aps) metrics.push({ label: "Attacks per Second", value: aps });
  if (pdps) metrics.push({ label: "pDPS", value: pdps });
  if (!pdps && item.extended?.dps) {
    metrics.push({ label: "DPS", value: String(Math.round(item.extended.dps)) });
  }
  if (item.extended?.edps) {
    metrics.push({ label: "eDPS", value: String(Math.round(item.extended.edps)) });
  }
  if (armour) metrics.push({ label: "Armour", value: armour });
  if (evasion) metrics.push({ label: "Evasion", value: evasion });
  if (energyShield) metrics.push({ label: "Energy Shield", value: energyShield });
  if (ward) metrics.push({ label: "Ward", value: ward });
  if (block) metrics.push({ label: "Block Chance", value: block });
  if (spirit) metrics.push({ label: "Spirit", value: spirit });
  if (item.ilvl) metrics.push({ label: "Item Level", value: String(item.ilvl) });

  return metrics;
}

export function cleanModText(text: string) {
  return text.replace(/\[([^|\]]+\|)?([^\]]+)\]/g, "$2");
}

function getPropertyValue(item: PoeItem, propertyNames: string[]) {
  const lowerNames = propertyNames.map(name => name.toLowerCase());
  const property = item.properties?.find(p => lowerNames.includes(cleanPropertyName(p.name).toLowerCase()));
  if (!property || property.values.length === 0) return "";
  return cleanModText(property.values.map(([value]) => value).join(" / "));
}

function cleanPropertyName(name: string) {
  return cleanModText(name).replace(/:$/, "").trim();
}

function formatExtended(value?: number) {
  return value === undefined ? "" : String(Math.round(value));
}

function getPhysicalDps(physicalDamage: string, aps: string, fallback?: number) {
  const damageMatch = physicalDamage.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  const apsMatch = aps.match(/(\d+(?:\.\d+)?)/);
  if (damageMatch && apsMatch) {
    const min = Number(damageMatch[1]);
    const max = Number(damageMatch[2]);
    const attacksPerSecond = Number(apsMatch[1]);
    return (((min + max) / 2) * attacksPerSecond).toFixed(1);
  }
  return fallback ? String(Math.round(fallback)) : "";
}
