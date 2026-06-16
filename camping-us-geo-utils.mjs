import { STATE_BBOXES } from "./camping-us-state-bboxes.mjs";

/** Idaho–Montana border (39th meridian west of Washington), degrees W. */
const ID_MT_MERIDIAN_LON = -116.050694;

function bboxHits(lat, lon) {
  const hits = [];
  for (const [st, bbox] of Object.entries(STATE_BBOXES)) {
    const [s, w, n, e] = bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) hits.push(st);
  }
  return hits;
}

function resolveOverlap(hits, lat, lon) {
  const set = new Set(hits);
  if (set.has("ID") && set.has("MT")) {
    return lon > ID_MT_MERIDIAN_LON ? "MT" : "ID";
  }
  if (set.has("ID") && set.has("WY")) {
    return lon > -111.05 ? "WY" : "ID";
  }
  if (set.has("MT") && set.has("WY")) {
    return lon > -104.05 ? "MT" : "WY";
  }
  return hits[0];
}

export function inferStateFromCoords(lat, lon) {
  const hits = bboxHits(lat, lon);
  if (hits.length === 0) return "";
  if (hits.length === 1) return hits[0];
  return resolveOverlap(hits, lat, lon);
}

/** Set `state` from coordinates; fixes overlap mis-tags (e.g. MT camps labeled ID). */
export function applyInferredState(rec) {
  const st = inferStateFromCoords(rec.lat, rec.lon);
  if (!st) return;
  const prev = rec.state;
  rec.state = st;
  if (!rec.reviewReasons) rec.reviewReasons = [];
  if (!rec.mapFlags) rec.mapFlags = [];
  if (prev && prev !== st) {
    if (!rec.reviewReasons.includes("state-corrected-from-coords")) {
      rec.reviewReasons = [...rec.reviewReasons, "state-corrected-from-coords"];
    }
    if (!rec.mapFlags.includes("STATE_CORRECTED")) {
      rec.mapFlags = [...rec.mapFlags, "STATE_CORRECTED"];
    }
    rec.needsReview = true;
  } else {
    rec.reviewReasons = (rec.reviewReasons || []).filter(
      (r) => r !== "missing-state" && r !== "missing-state-infer-from-geo"
    );
    rec.mapFlags = (rec.mapFlags || []).filter((f) => f !== "NO_STATE");
    if (!rec.reviewReasons.length) rec.needsReview = (rec.mapFlags || []).length > 0;
  }
}
