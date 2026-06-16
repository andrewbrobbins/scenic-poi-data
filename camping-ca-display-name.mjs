/**
 * Canadian campground labels for map / embed (OSM names left as tagged).
 */
import { resolvePcDisplayName } from "./camping-ca-pc-display-names.mjs";

export function isCampingCaOsmSource(rec) {
  const src = rec?.ingestSource || "";
  if (src === "02-osm") return true;
  const id = rec?.id || "";
  if (/-OSM-/i.test(id)) return true;
  return /^OSM\s+(node|way|relation)\b/i.test(rec?.name || "");
}

/** @param {string} name */
export function ensureCampgroundSuffix(name) {
  const n = (name || "").trim();
  if (!n) return n;
  if (/\bcampground\s*$/i.test(n)) return n;
  return `${n} Campground`;
}

/**
 * @param {object} rec master, ingest, or rolled row (needs ingestSource + name)
 * @returns {string}
 */
export function formatCaCampgroundDisplayName(rec) {
  if (isCampingCaOsmSource(rec)) return (rec.name || "").trim();

  let name =
    rec.ingestSource === "01-parks-canada"
      ? resolvePcDisplayName(rec)
      : (rec.name || "").trim();

  return ensureCampgroundSuffix(name);
}
