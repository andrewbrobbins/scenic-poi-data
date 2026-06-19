/**
 * Strict Pilot / Flying J matching shared by US and CA fuel pipelines.
 * Rejects name-only "Pilot" hits when OSM brand is a retail chain (Shell, Esso, etc.).
 */
import { FUEL_TYPE_TRAVEL_PLAZA, normalizeFuelType } from "./fuel-brand-lib.mjs";
function normToken(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CONFLICTING_RETAIL = [
  "esso",
  "petro canada",
  "petrocanada",
  "shell",
  "chevron",
  "mobil",
  "exxon",
  "hess",
  "sunoco",
  "marathon",
  "speedway",
  "circle k",
  "7 eleven",
  "costco",
  "safeway",
  "husky",
  "ultramar",
  "texaco",
  "valero",
  "phillips",
  "conoco",
  "marina",
  "76",
  "co op",
  "petro",
];

export function brandTagMatches(normBrand, raw) {
  const t = normToken(raw);
  if (!t || !normBrand) return false;
  if (normBrand === t) return true;
  if (t.length >= 8 && normBrand.includes(t)) return true;
  return false;
}

export function isConflictingRetailBrand(normBrand) {
  if (!normBrand) return false;
  for (const r of CONFLICTING_RETAIL) {
    if (normBrand === r || normBrand.startsWith(r + " ")) return true;
  }
  return false;
}

function nameHasAny(normName, frags) {
  for (const raw of frags || []) {
    const f = normToken(raw);
    if (!f) continue;
    if (f.length <= 4) {
      if (normName === f || normName.startsWith(f + " ") || normName.includes(" " + f + " ")) {
        return true;
      }
    } else if (normName.includes(f)) {
      return true;
    }
  }
  return false;
}

function hasPilotOperator(normOp) {
  if (!normOp) return false;
  return (
    normOp === "pilot" ||
    normOp.startsWith("pilot ") ||
    normOp.includes("pilot travel") ||
    normOp.includes("pilot flying j")
  );
}

function hasFlyingJOperator(normOp) {
  if (!normOp) return false;
  return normOp === "flying j" || normOp.startsWith("flying j");
}

function pickBrand(b) {
  return {
    brandId: b.id,
    displayName: b.displayName,
    tier: b.tier || "A",
    type: normalizeFuelType(b.type),
    mergeWith: b.mergeWith || null,
  };
}

/**
 * @param {{ normBrand: string, normOp: string, normName: string }} ctx
 * @returns {{ brandId: string, displayName: string, tier: string, type: string, mergeWith?: string } | null}
 */
export function matchPilotFlyingJ(ctx, flyingjEntry, pilotEntry) {
  const { normBrand, normOp, normName } = ctx;
  const conflict = isConflictingRetailBrand(normBrand);

  if (flyingjEntry) {
    for (const raw of flyingjEntry.osm?.brand || []) {
      if (brandTagMatches(normBrand, raw)) return pickBrand(flyingjEntry);
    }
    if (hasFlyingJOperator(normOp)) return pickBrand(flyingjEntry);
    if ((normName.startsWith("flying j") || normName === "flyingj") && !conflict) {
      return pickBrand(flyingjEntry);
    }
    if (!conflict && nameHasAny(normName, flyingjEntry.osm?.nameContains)) {
      return pickBrand(flyingjEntry);
    }
  }

  if (pilotEntry) {
    for (const raw of pilotEntry.osm?.brand || []) {
      if (brandTagMatches(normBrand, raw)) return pickBrand(pilotEntry);
    }
    if (hasPilotOperator(normOp)) return pickBrand(pilotEntry);
    if ((normName === "pilot" || normName.startsWith("pilot ")) && !conflict) {
      if (!normBrand || normBrand.includes("pilot")) return pickBrand(pilotEntry);
    }
    if (!conflict && nameHasAny(normName, pilotEntry.osm?.nameContains)) {
      return pickBrand(pilotEntry);
    }
  }

  return null;
}

/** Explain why a station matched (for audits). */
export function explainPilotFlyingJMatch(ctx, flyingjEntry, pilotEntry) {
  const { normBrand, normOp, normName } = ctx;
  const conflict = isConflictingRetailBrand(normBrand);
  const reasons = [];

  if (flyingjEntry) {
    for (const raw of flyingjEntry.osm?.brand || []) {
      if (brandTagMatches(normBrand, raw)) reasons.push(`flyingj:brand=${raw}`);
    }
    if (hasFlyingJOperator(normOp)) reasons.push("flyingj:operator");
    if ((normName.startsWith("flying j") || normName === "flyingj") && !conflict) {
      reasons.push("flyingj:name");
    }
    if (!conflict && nameHasAny(normName, flyingjEntry.osm?.nameContains)) {
      reasons.push("flyingj:nameContains");
    }
  }

  if (pilotEntry) {
    for (const raw of pilotEntry.osm?.brand || []) {
      if (brandTagMatches(normBrand, raw)) reasons.push(`pilot:brand=${raw}`);
    }
    if (hasPilotOperator(normOp)) reasons.push("pilot:operator");
    if ((normName === "pilot" || normName.startsWith("pilot ")) && !conflict) {
      if (!normBrand || normBrand.includes("pilot")) reasons.push("pilot:name");
    }
    if (!conflict && nameHasAny(normName, pilotEntry.osm?.nameContains)) {
      reasons.push("pilot:nameContains");
    }
  }

  if (conflict) reasons.push(`conflict:brand=${normBrand}`);
  return reasons;
}