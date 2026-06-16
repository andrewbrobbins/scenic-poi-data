/**
 * Roll Parks Canada per-pitch records to one map pin per campground (embed only).
 */
import { haversineMi } from "./camping-ca-lib.mjs";
import { pcCampgroundCodeFromUrl } from "./camping-ca-pc-codes.mjs";
import { formatCaCampgroundDisplayName } from "./camping-ca-display-name.mjs";

export { pcCampgroundCodeFromUrl } from "./camping-ca-pc-codes.mjs";

const MERGE_MI = 0.35;

export function normCampName(n) {
  return (n || "")
    .toLowerCase()
    .replace(/\b(campground|camp|camping area|cg)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40);
}

export function pcCampgroundGroupKey(rec) {
  const urlCode = rec.sourceIds?.urlCode || rec.parentUnit?.siteCode || "";
  const code = pcCampgroundCodeFromUrl(urlCode);
  if (code) return `code:${code}`;

  const park = (rec.parentUnit?.parkCode || rec.parentUnit?.name || "").toLowerCase();
  const nm = normCampName(rec.name);
  if (park && nm) return `name:${park}:${nm}`;
  if (nm) return `name:${nm}`;
  return `id:${rec.id}`;
}

function isParksCanadaPitch(rec) {
  return rec.landManager === "Parks Canada" && rec.ingestSource === "01-parks-canada";
}

function rollupPcGroup(group) {
  const first = group[0];
  let latSum = 0;
  let lonSum = 0;
  let n = 0;
  for (const r of group) {
    if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      latSum += r.lat;
      lonSum += r.lon;
      n++;
    }
  }
  const lat = n ? latSum / n : first.lat;
  const lon = n ? lonSum / n : first.lon;
  return {
    ...first,
    name: formatCaCampgroundDisplayName(first),
    lat,
    lon,
    _rollupCount: group.length,
    _rollupKey: pcCampgroundGroupKey(first),
  };
}

function parkCode(rec) {
  return (rec.parentUnit?.parkCode || rec.parentUnit?.name || "").toLowerCase();
}

function canMergeCampgrounds(a, b) {
  if (a.landManager !== b.landManager) return false;
  if (normCampName(a.name) !== normCampName(b.name)) return false;
  if (a.landManager === "Parks Canada") {
    const pa = parkCode(a);
    const pb = parkCode(b);
    if (pa && pb && pa !== pb) return false;
  }
  return haversineMi([a.lat, a.lon], [b.lat, b.lon]) <= MERGE_MI;
}

function mergeNearbyCampgrounds(records) {
  const parent = new Map();
  for (let i = 0; i < records.length; i++) parent.set(i, i);

  function find(i) {
    let p = i;
    while (parent.get(p) !== p) p = parent.get(p);
    let c = i;
    while (parent.get(c) !== c) {
      const n = parent.get(c);
      parent.set(c, p);
      c = n;
    }
    return p;
  }

  function unite(i, j) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent.set(ri, rj);
  }

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (canMergeCampgrounds(records[i], records[j])) unite(i, j);
    }
  }

  const buckets = new Map();
  for (let i = 0; i < records.length; i++) {
    const root = find(i);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(records[i]);
  }

  const merged = [];
  for (const group of buckets.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    let latSum = 0;
    let lonSum = 0;
    let n = 0;
    let pitchCount = 0;
    for (const r of group) {
      pitchCount += r._rollupCount || 1;
      if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
        latSum += r.lat;
        lonSum += r.lon;
        n++;
      }
    }
    const rep = group[0];
    const names = group.map((r) => formatCaCampgroundDisplayName(r));
    const displayName = names.sort((a, b) => b.length - a.length)[0] || rep.name;
    merged.push({
      ...rep,
      name: displayName,
      lat: n ? latSum / n : rep.lat,
      lon: n ? lonSum / n : rep.lon,
      _rollupCount: pitchCount,
    });
  }
  return merged;
}

/**
 * @param {object[]} records master rows eligible for embed
 * @returns {object[]}
 */
export function rollupParksCanadaForEmbed(records) {
  const pc = [];
  const other = [];
  for (const rec of records) {
    if (isParksCanadaPitch(rec)) pc.push(rec);
    else other.push(rec);
  }

  const byKey = new Map();
  for (const rec of pc) {
    const key = pcCampgroundGroupKey(rec);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(rec);
  }

  const rolled = [...other];
  for (const group of byKey.values()) {
    rolled.push(rollupPcGroup(group));
  }

  return mergeNearbyCampgrounds(rolled);
}
